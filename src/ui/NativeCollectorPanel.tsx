import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTURE_UPLOAD_MAX_BYTES, collectorAction, readCollectorState, type CaptureUpload, type CollectorAction, type CollectorState } from '../collector/nativeCollector';
import {
  hasAutoImported,
  hasAutoStopped,
  markAutoImported,
  markAutoStopped,
  unmarkAutoStopped,
} from '../collector/captureSessionStore';
import { Button } from './primitives/Button';
import { ModalSurface } from './primitives/ModalSurface';
import { StateNotice } from './primitives/StateNotice';
import { useImportOutcome } from './importOutcomeStore';
import type { ImportOutcome } from './importOutcomeStore';
import { CaptureProgressView } from './CaptureProgressView';

const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MiB`;
/** 导入后的云同步状态：自动导入也会顺手同步，弹窗里要能看到结果（2026-10-25） */
const CLOUD_LABEL: Record<ImportOutcome['cloud'], string> = {
  'not-enabled': '私有同步未开启（只保存在本机）',
  syncing: '正在同步私有云…',
  synced: '私有云已同步',
  failed: '私有云同步失败（本机数据已保存）',
  conflict: '私有云有另一份更新，到「我的 · 私有同步」处理',
};
const uploadStatus = (upload: CaptureUpload) => {
  const uid = upload.gameId ? ` · 游戏 UID ${upload.gameId}` : '';
  switch (upload.state) {
    case 'uploading': return `正在上传 ${upload.progress}%`;
    case 'processing': return '蛋神助手云端处理中';
    case 'pending': return '等待云端确认，可稍后继续查询';
    case 'persisted': return upload.deduplicated ? `已上传蛋神助手（云端已有相同数据）${uid}` : `已上传蛋神助手${uid}`;
    case 'failed': return `上传失败：${upload.message}`;
  }
};
const uploadTone = (upload: CaptureUpload) => upload.state === 'persisted' ? 'text-emerald-700'
  : upload.state === 'failed' ? 'text-rose-600' : 'text-slate-500';

export function NativeCollectorPanel() {
  const [state, setState] = useState<CollectorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 先同步判断有没有采集桥：没有桥时首屏直接给说明卡，避免异步检查后再更新造成闪烁 */
  const [checked, setChecked] = useState(() => typeof window === 'undefined' || !window.RocoCapture);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [requestedImport, setRequestedImport] = useState(false);
  /** 自动停止保存成功后弹「采集完成」，值是本次保存的文件 id */
  const [completed, setCompleted] = useState<string | null>(null);
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
    finally { reading.current = false; if (mounted.current) setChecked(true); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = window.setInterval(() => { if (!document.hidden) refresh(); }, 1500);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; window.clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const action = async (name: CollectorAction, id?: string): Promise<boolean> => {
    setActionError(null);
    if (name === 'importCapture') {
      if (importing || importLock.current) return false;
      importLock.current = true;
      requestedAtOperation.current = outcome.operationId;
      setRequestedImport(true);
    }
    if (name === 'startCapture' || name === 'stopCapture') setState((current) => current ? { ...current, phase: name === 'startCapture' ? 'starting' : 'stopping' } : current);
    try {
      await collectorAction(name, id);
      return true;
    }
    catch (cause) {
      setRequestedImport(false);
      setActionError(cause instanceof Error ? cause.message : '操作失败，请重试');
      return false;
    }
    finally { await refresh(); }
  };
  /**
   * 采集完成（稳定进度条走满）自动停止、保存并**自动导入**（2026-10-25 用户要求）。
   * 不再让用户点「解析并导入」；完成后弹窗只保留「取消 / 上传蛋神助手」。
   * 标记放在模块级会话集合里：切页卸载再回来也不会重复停止或重复导入。
   */
  const handleCaptureReady = (session: string | undefined) => {
    if (!session || hasAutoStopped(session)) return;
    markAutoStopped(session);
    void action('stopCapture').then(async (saved) => {
      if (!saved) {
        unmarkAutoStopped(session);
        return;
      }
      if (mounted.current) setCompleted(session);
      if (hasAutoImported(session)) return;
      markAutoImported(session);
      await action('importCapture', session);
    });
  };
  if (!checked) {
    // 有采集桥但状态还没读完：先撑住卡片高度，避免切进「我的」时整块从无到有闪一下
    return (
      <section
        className="rounded-2xl bg-white p-3 shadow-sm"
        aria-busy="true"
        data-testid="native-collector-loading"
      >
        <h2 className="text-base font-semibold text-slate-900">本机采集</h2>
        <div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-100" />
        <div className="mt-1.5 h-3 w-full animate-pulse rounded bg-slate-100" />
        <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
      </section>
    );
  }
  if (!state && !error) {
    return (
      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="native-collector-fallback">
        <h2 className="text-base font-semibold text-slate-900">本机采集</h2>
        <p className="mt-1 text-xs text-slate-500">
          当前环境没有内置采集（只在安卓工具箱安装包内提供）。网页版请用下面的「导入游戏数据」手选抓包 / 备份文件；装了安卓版仍看不到，请更新安装包。
        </p>
      </section>
    );
  }
  const busy = state != null && ['starting', 'capturing', 'stopping'].includes(state.phase);
  const uploadSupported = typeof window.RocoCapture?.uploadCapture === 'function';
  const completedFile = completed ? state?.files.find((file) => file.id === completed) : undefined;
  return (
    <section className="space-y-2 rounded-2xl bg-white p-3 shadow-sm" data-testid="native-collector">
      <h2 className="text-base font-semibold text-slate-900">本机采集</h2>
      <p className="text-xs text-slate-500">仅在手机本地保存与解析；点「上传蛋神助手」才会把原包发送到蛋神助手云端。</p>
      {error ? <StateNotice kind="error" title={error} action={<Button variant="secondary" onClick={refresh}>重试读取状态</Button>} /> : null}
      {actionError ? <StateNotice kind="error" title={actionError} /> : null}
      {state ? <>
        {!state.supported ? <StateNotice kind="unknown" title="内置采集需要 Android 8 或以上" description="当前手机仍可手动导入已有文件。" /> : <>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-500">
            <li>关闭其他 VPN 或游戏加速器，开始采集并同意系统 VPN 授权。</li>
            <li>打开游戏，重新登录，依次查看精灵仓库、背包与蛋仓。</li>
            <li>查看数据进度；内容稳定（进度条走满）后会自动停止、保存并开始导入。</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            {busy ? <Button disabled={state.phase === 'stopping'} onClick={() => action('stopCapture')}>停止并保存</Button>
              : <Button disabled={importing || !!error} onClick={() => action('startCapture')}>开始采集</Button>}
            <Button variant="secondary" onClick={() => action('openGame')}>打开游戏</Button>
          </div>
        </>}
        <StateNotice kind={state.phase === 'failed' ? 'error' : 'cached'} title={state.message || '准备采集'} />
        <CaptureProgressView state={state} onReady={() => handleCaptureReady(state.fileId)} />
        {busy ? <p className="text-xs text-slate-500">已记录 {state.packets} 包 · {sizeLabel(state.bytes)}。数量不代表数据已收齐。</p> : null}
        <p className="text-xs text-slate-500">最多保留 10 个原包，每次上限 128 MiB；导入后仍保留，不会自动清理。</p>
        {!uploadSupported ? <p className="text-xs text-slate-500">更新安卓安装包后可直接上传蛋神助手。</p> : null}
        {state.files.length === 0 ? <p className="text-sm text-slate-500">还没有本机采集文件</p> : <ul className="space-y-1.5">
          {state.files.map((file) => <li key={file.id} className="space-y-1.5 rounded-xl border border-slate-100 p-2.5">
            <p className="break-all text-sm text-slate-700">{file.name}</p>
            <p className="text-xs text-slate-500">{new Date(file.createdAt).toLocaleString()} · {sizeLabel(file.size)}</p>
            {!file.valid ? <p className="text-xs text-amber-800">未完整保存或没有可用数据，请重新采集；仍可导出原包。</p> : null}
            {file.upload ? <p className={`text-xs ${uploadTone(file.upload)}`}>{uploadStatus(file.upload)}</p> : null}
            {uploadSupported && file.size > CAPTURE_UPLOAD_MAX_BYTES
              ? <p className="text-xs text-amber-800">超过蛋神助手云端 5 MiB 上限，请重新采集较短的一次。</p> : null}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" disabled={busy || importing || !!error || !file.valid} onClick={() => action('importCapture', file.id)}>解析并导入</Button>
              {uploadSupported ? <Button size="sm" variant="secondary"
                busy={file.upload?.state === 'uploading'}
                disabled={busy || importing || !!error || !!state.uploadBusy || !file.valid || file.size > CAPTURE_UPLOAD_MAX_BYTES}
                onClick={() => action('uploadCapture', file.id)}>
                {file.upload?.state === 'pending' ? '继续查询' : file.upload?.state === 'failed' || file.upload?.state === 'persisted' ? '重新上传' : '上传蛋神助手'}
              </Button> : null}
              <Button size="sm" variant="secondary" disabled={busy || importing || !!error || !!state.uploadBusy} onClick={() => action('shareCapture', file.id)}>导出原包</Button>
              <Button size="sm" variant="danger" disabled={busy || importing || !!error || !!state.uploadBusy} onClick={() => setDeleting(file.id)}>删除</Button>
            </div>
          </li>)}
        </ul>}
        <details className="text-xs text-slate-500">
          <summary className="flex min-h-[32px] cursor-pointer items-center">采集组件与开源许可</summary>
          <p>基于蛋神助手采集器 1.2.6 的原生转发与 PCAP 代码；zdtun © Emanuele Faranda，LGPL-3.0-or-later；工具箱集成代码 GPL-3.0-only。</p>
          <a className="inline-flex min-h-[32px] items-center text-emerald-700 underline" href="https://github.com/sasaki-ishiran/roco-toolbox/blob/codex/android-collector/android-shell/THIRD_PARTY.md" target="_blank" rel="noreferrer">查看来源、许可证与对应源码</a>
        </details>
      </> : null}
      <ModalSurface open={completed != null} title="采集完成" onClose={() => setCompleted(null)} testId="capture-complete" footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCompleted(null)}>取消</Button>
          <Button
            disabled={
              !uploadSupported ||
              !completedFile?.valid ||
              completedFile.size > CAPTURE_UPLOAD_MAX_BYTES ||
              busy ||
              !!state?.uploadBusy ||
              !!error
            }
            onClick={() => {
              const id = completed;
              setCompleted(null);
              if (id) void action('uploadCapture', id);
            }}
          >
            上传蛋神助手
          </Button>
        </div>
      }>
        <div className="space-y-1 p-4" data-testid="capture-complete-status">
          <p className="text-sm text-slate-600">已自动停止并保存本次采集，无需再手动解析。</p>
          <p className="text-xs text-slate-400">
            {importing
              ? '正在自动解析并导入工具箱…'
              : outcome.local === 'saved'
                ? '已自动导入工具箱。'
                : outcome.local === 'failed'
                  ? `自动导入失败：${outcome.message ?? '请稍后在文件列表里重试'}`
                  : '正在准备自动导入…'}
          </p>
          {outcome.local === 'saved' ? (
            <div data-testid="capture-complete-after-import">
              <p className="text-xs text-slate-500" data-testid="capture-complete-cloud">{CLOUD_LABEL[outcome.cloud]}</p>
              <p className="text-xs text-slate-500" data-testid="capture-complete-group">小组资源不会自动更新；需要的话去「小组」发布更新。</p>
            </div>
          ) : null}
          <p className="text-xs text-slate-400">原包仍会保留；刷新页面或切回本页不会重复导入。</p>
        </div>
      </ModalSurface>
      <ModalSurface open={deleting != null} title="删除本机原包？" onClose={() => setDeleting(null)} footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>保留文件</Button>
          <Button variant="danger" disabled={busy || importing} onClick={() => { if (deleting) action('deleteCapture', deleting); setDeleting(null); }}>确认删除</Button>
        </div>
      }><p className="p-4 text-sm text-slate-600">删除后无法恢复原包；已导入的游戏数据会保留。</p></ModalSurface>
    </section>
  );
}
