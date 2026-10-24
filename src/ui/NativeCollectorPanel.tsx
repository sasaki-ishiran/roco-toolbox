import { useCallback, useEffect, useRef, useState } from 'react';
import { collectorAction, readCollectorState, type CollectorAction, type CollectorState } from '../collector/nativeCollector';
import { Button } from './primitives/Button';
import { ModalSurface } from './primitives/ModalSurface';
import { StateNotice } from './primitives/StateNotice';
import { useImportOutcome } from './importOutcomeStore';
import { CaptureProgressView } from './CaptureProgressView';

const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MiB`;

export function NativeCollectorPanel() {
  const [state, setState] = useState<CollectorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [requestedImport, setRequestedImport] = useState(false);
  const importLock = useRef(false);
  const mounted = useRef(false);
  const reading = useRef(false);
  const requestedAtOperation = useRef(-1);
  const outcome = useImportOutcome();
  const importing = requestedImport || outcome.local === 'importing';
  useEffect(() => { if (!requestedImport) importLock.current = false; }, [requestedImport]);
  useEffect(() => {
    if (outcome.operationId > requestedAtOperation.current && ['saved', 'failed'].includes(outcome.local)) setRequestedImport(false);
  }, [outcome.operationId, outcome.local]);
  useEffect(() => {
    if (!requestedImport || outcome.local === 'importing') return;
    const timer = window.setTimeout(() => {
      setRequestedImport(false);
      setActionError('未收到导入反馈，原包仍保留，请重试');
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [requestedImport, outcome.local]);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const next = await readCollectorState();
      if (mounted.current) { setState(next); setError(null); }
    }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '无法读取采集状态'); }
    finally { reading.current = false; }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = window.setInterval(() => { if (!document.hidden) refresh(); }, 1500);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; window.clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const action = async (name: CollectorAction, id?: string) => {
    setActionError(null);
    if (name === 'importCapture') {
      if (importing || importLock.current) return;
      importLock.current = true;
      requestedAtOperation.current = outcome.operationId;
      setRequestedImport(true);
    }
    if (name === 'startCapture' || name === 'stopCapture') setState((current) => current ? { ...current, phase: name === 'startCapture' ? 'starting' : 'stopping' } : current);
    try { await collectorAction(name, id); }
    catch (cause) {
      setRequestedImport(false);
      setActionError(cause instanceof Error ? cause.message : '操作失败，请重试');
    }
    finally { await refresh(); }
  };
  if (!state && !error) return null;
  const busy = state != null && ['starting', 'capturing', 'stopping'].includes(state.phase);
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="native-collector">
      <h2 className="text-base font-semibold text-slate-900">本机采集</h2>
      <p className="text-sm text-slate-600">仅在手机本地保存与解析游戏抓包。导入沿用你的私有同步设置，小组仍需手动发布。</p>
      {error ? <StateNotice kind="error" title={error} action={<Button variant="secondary" onClick={refresh}>重试读取状态</Button>} /> : null}
      {actionError ? <StateNotice kind="error" title={actionError} /> : null}
      {state ? <>
        {!state.supported ? <StateNotice kind="unknown" title="内置采集需要 Android 8 或以上" description="当前手机仍可手动导入已有文件。" /> : <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>关闭其他 VPN 或游戏加速器，开始采集并同意系统 VPN 授权。</li>
            <li>打开游戏，重新登录，依次查看精灵仓库、背包与蛋仓。</li>
            <li>返回工具箱查看数据进度；内容稳定后停止保存，再解析导入。</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            {busy ? <Button disabled={state.phase === 'stopping'} onClick={() => action('stopCapture')}>停止并保存</Button>
              : <Button disabled={importing || !!error} onClick={() => action('startCapture')}>开始采集</Button>}
            <Button variant="secondary" onClick={() => action('openGame')}>打开游戏</Button>
          </div>
        </>}
        <StateNotice kind={state.phase === 'failed' ? 'error' : 'cached'} title={state.message || '准备采集'} />
        <CaptureProgressView state={state} />
        {busy ? <p className="text-xs text-slate-500">已记录 {state.packets} 包 · {sizeLabel(state.bytes)}。数量不代表数据已收齐。</p> : null}
        <p className="text-xs text-slate-500">最多保留 10 个原包，每次上限 128 MiB；导入后仍保留，不会自动清理。</p>
        {state.files.length === 0 ? <p className="text-sm text-slate-500">还没有本机采集文件</p> : <ul className="space-y-2">
          {state.files.map((file) => <li key={file.id} className="space-y-2 rounded-xl border border-slate-100 p-3">
            <p className="break-all text-sm text-slate-700">{file.name}</p>
            <p className="text-xs text-slate-500">{new Date(file.createdAt).toLocaleString()} · {sizeLabel(file.size)}</p>
            {!file.valid ? <p className="text-sm text-amber-800">未完整保存或没有可用数据，请重新采集；仍可导出原包。</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || importing || !!error || !file.valid} onClick={() => action('importCapture', file.id)}>解析并导入</Button>
              <Button variant="secondary" disabled={busy || importing || !!error} onClick={() => action('shareCapture', file.id)}>导出原包</Button>
              <Button variant="danger" disabled={busy || importing || !!error} onClick={() => setDeleting(file.id)}>删除</Button>
            </div>
          </li>)}
        </ul>}
        <details className="text-xs text-slate-500">
          <summary className="flex min-h-[44px] cursor-pointer items-center">采集组件与开源许可</summary>
          <p>基于蛋神助手采集器 1.2.6 的原生转发与 PCAP 代码；zdtun © Emanuele Faranda，LGPL-3.0-or-later；工具箱集成代码 GPL-3.0-only。</p>
          <a className="inline-flex min-h-[44px] items-center text-emerald-700 underline" href="https://github.com/sasaki-ishiran/roco-toolbox/blob/codex/android-collector/android-shell/THIRD_PARTY.md" target="_blank" rel="noreferrer">查看来源、许可证与对应源码</a>
        </details>
      </> : null}
      <ModalSurface open={deleting != null} title="删除本机原包？" onClose={() => setDeleting(null)} footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>保留文件</Button>
          <Button variant="danger" disabled={busy || importing} onClick={() => { if (deleting) action('deleteCapture', deleting); setDeleting(null); }}>确认删除</Button>
        </div>
      }><p className="p-4 text-sm text-slate-600">删除后无法恢复原包；已导入的游戏数据会保留。</p></ModalSurface>
    </section>
  );
}
