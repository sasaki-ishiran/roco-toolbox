import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTURE_UPLOAD_MAX_BYTES, collectorAction, readCollectorState, type CaptureUpload, type CollectorAction, type CollectorState } from '../collector/nativeCollector';
import {
  hasAutoImported,
  hasAutoStopped,
  markAutoImported,
  markAutoStopped,
  setPendingCompletion,
  takePendingCompletion,
  unmarkAutoStopped,
} from '../collector/captureSessionStore';
import { Button } from './primitives/Button';
import { ModalSurface } from './primitives/ModalSurface';
import { StateNotice } from './primitives/StateNotice';
import { getImportOutcome, useImportOutcome } from './importOutcomeStore';
import type { ImportOutcome } from './importOutcomeStore';
import { CaptureProgressView } from './CaptureProgressView';

const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MiB`;
/** 等文件落盘 / 等导入与云同步的上限；超时也要给用户一个结果，不能一直转圈 */
const SAVE_WAIT_MS = 8000;
const IMPORT_WAIT_MS = 20000;
const delay = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });
/** 自动导入走到哪一步（弹窗只在 done / failed 时出现，2026-10-25 用户要求） */
type AutoStage = 'idle' | 'stopping' | 'importing' | 'syncing' | 'done' | 'failed';
const AUTO_STAGE_LABEL: Partial<Record<AutoStage, string>> = {
  stopping: '正在保存本次采集…',
  importing: '已保存，正在导入工具箱…',
  syncing: '已导入工具箱，正在同步私有云…',
};
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
  /** 自动导入结束（成功或失败）后才弹「导入完成」，值是本次保存的文件 id */
  const [completed, setCompleted] = useState<string | null>(null);
  const [autoStage, setAutoStage] = useState<AutoStage>('idle');
  const [completionError, setCompletionError] = useState<string | null>(null);
  const lastActionError = useRef<string | null>(null);
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
    // 等待导入期间切走再回来：补弹上次没看过的「导入完成」
    const pending = takePendingCompletion();
    if (pending) setCompleted(pending);
    void refresh();
    const poll = window.setInterval(() => { if (!document.hidden) refresh(); }, 1500);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; window.clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const action = async (name: CollectorAction, id?: string): Promise<boolean> => {
    setActionError(null);
    lastActionError.current = null;
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
      const message = cause instanceof Error ? cause.message : '操作失败，请重试';
      lastActionError.current = message;
      setRequestedImport(false);
      setActionError(message);
      return false;
    }
    finally { await refresh(); }
  };
  /** 等壳把文件真正保存完（阶段回到 idle 且能看到这个文件），再请求导入 */
  const waitForSaved = async (session: string): Promise<boolean> => {
    const deadline = Date.now() + SAVE_WAIT_MS;
    while (mounted.current && Date.now() < deadline) {
      try {
        const current = await readCollectorState();
        if (mounted.current) setState(current);
        if (current && current.phase === 'idle' && current.files.some((file) => file.id === session)) return true;
      } catch { /* 保存中读不到状态：继续等 */ }
      await delay(300);
    }
    return false;
  };
  /**
   * 壳里的 importCapture 在「还在保存」时会被拒绝（请先停止采集并等待保存完成）。
   * 刚停完就调用很容易撞上这个窗口，所以按提示重试一小会儿再判失败。
   */
  const importWithRetry = async (session: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 30 && mounted.current; attempt += 1) {
      if (await action('importCapture', session)) return true;
      if (!/等待保存完成/.test(lastActionError.current ?? '')) return false;
      await delay(500);
    }
    return false;
  };
  /** 等导入结果：本机保存完成 → 云同步到终态（或超时）。弹窗只在这之后出现。 */
  const waitForImportOutcome = async (baseline: number): Promise<'saved' | 'failed' | 'timeout'> => {
    const deadline = Date.now() + IMPORT_WAIT_MS;
    while (mounted.current && Date.now() < deadline) {
      const current = getImportOutcome();
      if (current.operationId > baseline) {
        if (current.local === 'failed') return 'failed';
        if (current.local === 'saved') {
          if (current.cloud !== 'syncing') return 'saved';
          setAutoStage('syncing');
        }
      }
      await delay(250);
    }
    const current = getImportOutcome();
    if (current.operationId > baseline && current.local === 'saved') return 'saved';
    return current.operationId > baseline && current.local === 'failed' ? 'failed' : 'timeout';
  };
  /**
   * 采集完成（稳定进度条走满）自动停止、保存并**自动导入**（2026-10-25 用户要求）。
   * 本轮再改（2026-10-25）：**先不弹窗**，等本机导入与云同步都到终态再弹「导入完成」，
   * 避免用户只看到「正在准备自动导入」、误以为没同步。
   * 标记放在模块级会话集合里：切页卸载再回来也不会重复停止或重复导入。
   */
  const handleCaptureReady = (session: string | undefined) => {
    if (!session || hasAutoStopped(session)) return;
    markAutoStopped(session);
    setCompletionError(null);
    setAutoStage('stopping');
    void (async () => {
      const stopped = await action('stopCapture');
      if (!stopped) {
        unmarkAutoStopped(session);
        if (mounted.current) setAutoStage('idle');
        return;
      }
      const saved = await waitForSaved(session);
      if (!mounted.current) return;
      if (!saved) {
        setAutoStage('idle');
        setActionError('采集已保存，但没等到文件就绪；请在文件列表里点「解析并导入」');
        return;
      }
      if (hasAutoImported(session)) return;
      markAutoImported(session);
      setAutoStage('importing');
      const baseline = getImportOutcome().operationId;
      const requested = await importWithRetry(session);
      if (!requested) {
        if (!mounted.current) { setPendingCompletion(session); return; }
        setAutoStage('failed');
        setCompletionError(lastActionError.current ?? '无法开始导入');
        setCompleted(session);
        return;
      }
      const result = await waitForImportOutcome(baseline);
      // 等结果期间切页会卸载面板：记下待弹提示，回来再补，且只补一次
      if (!mounted.current) { setPendingCompletion(session); return; }
      if (result === 'failed') {
        setAutoStage('failed');
        setCompletionError(getImportOutcome().message ?? '导入失败，请在文件列表里重试');
      } else if (result === 'timeout') {
        setAutoStage('failed');
        setCompletionError('导入没有完成，请在文件列表里点「解析并导入」重试');
      } else {
        setAutoStage('done');
      }
      setCompleted(session);
    })();
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
  /** 弹窗只在导入结束后出现；失败 / 超时 / 导入报错都算「未完成」，要继续给出可操作提示 */
  const importFailed = autoStage === 'failed' || outcome.local === 'failed' || completionError != null;
  const popupTitle = importFailed ? '导入未完成' : outcome.local === 'importing' ? '正在导入' : '导入完成';
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
        {AUTO_STAGE_LABEL[autoStage] ? (
          <p className="text-xs text-emerald-700" data-testid="capture-auto-status">{AUTO_STAGE_LABEL[autoStage]}</p>
        ) : null}
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
      <ModalSurface open={completed != null} title={popupTitle} onClose={() => setCompleted(null)} testId="capture-complete" footer={
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
          <p className="text-sm text-slate-600">已自动停止并保存本次采集。</p>
          {importFailed ? (
            <p className="text-xs text-rose-600" data-testid="capture-complete-outcome">
              导入没有完成：{completionError ?? outcome.message ?? '请在文件列表里点「解析并导入」重试'}
            </p>
          ) : outcome.local === 'importing' ? (
            <p className="text-xs text-slate-400" data-testid="capture-complete-outcome">正在导入工具箱…</p>
          ) : (
            <p className="text-xs text-slate-600" data-testid="capture-complete-outcome">导入完成，游戏数据已保存到本机。</p>
          )}
          {outcome.local === 'saved' ? (
            <div data-testid="capture-complete-after-import">
              <p className="text-xs text-slate-500" data-testid="capture-complete-cloud">{CLOUD_LABEL[outcome.cloud]}</p>
              <p className="text-xs text-slate-500" data-testid="capture-complete-group">
                {outcome.group === 'updated'
                  ? `小组资源已自动更新（${outcome.groupCount} 个小组）`
                  : '小组资源没有自动更新（未加入小组或同步失败）；需要的话去「小组」看看'}
              </p>
            </div>
          ) : null}
          <p className="text-xs text-slate-400">
            {importFailed ? '原包仍保留在文件列表里，可手动重试或直接上传蛋神助手。' : '原包仍会保留；刷新页面或切回本页不会重复导入。'}
          </p>
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
