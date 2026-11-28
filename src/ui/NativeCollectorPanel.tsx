import { useCallback, useEffect, useRef, useState } from 'react';
import { collectorAction, isDesktopShell, readCaptureDevices, readCollectorState, selectCaptureDevice, type CaptureDeviceList, type CollectorAction, type CollectorState } from '../collector/nativeCollector';
import { clearAutoImportCompletion, requestAutoImport, useAutoImport, type AutoImportStage } from '../collector/autoImportFlow';
import { markCaptureOrigin, observeCollectorState, useCaptureOrigin } from '../collector/captureOriginStore';
import { Button } from './primitives/Button';
import { ModalSurface } from './primitives/ModalSurface';
import { StateNotice } from './primitives/StateNotice';
import { useImportOutcome } from './importOutcomeStore';
import type { ImportOutcome } from './importOutcomeStore';
import { CaptureProgressView } from './CaptureProgressView';
import { toggleLiveMode, useLiveMode } from '../collector/liveModeStore';
import { toggleRareAlert, useRareAlert } from '../collector/rareAlertStore';

const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MiB`;
/** 自动导入走到哪一步（弹窗只在 done / failed 时出现，2026-10-25 用户要求）。
 *  2026-11-07：自动停止 / 保存 / 导入的流程抽到模块级 autoImportFlow（附近页触发的是同一流程），这里只订阅展示。 */
const AUTO_STAGE_LABEL: Partial<Record<AutoImportStage, string>> = {
  stopping: '正在保存本次采集…',
  importing: '已保存，正在导入数据…',
  syncing: '已导入，正在同步私有云…',
};
/** 导入后的云同步状态：自动导入也会顺手同步，弹窗里要能看到结果（2026-10-25） */
const CLOUD_LABEL: Record<ImportOutcome['cloud'], string> = {
  'not-enabled': '私有同步未开启（只保存在本机）',
  syncing: '正在同步私有云…',
  synced: '私有云已同步',
  failed: '私有云同步失败（本机数据已保存）',
  conflict: '私有云有另一份更新，到「我的 · 私有同步」处理',
};
export interface NativeCollectorPanelProps {
  /** 紧凑卡（2026-11-28 UX1）：「我的」页只留标题+?、状态、一个动作、一行文件数 */
  compact?: boolean;
}

export function NativeCollectorPanel({ compact = false }: NativeCollectorPanelProps = {}) {
  const [state, setState] = useState<CollectorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 桌面版（Electron）：底层是 Npcap 抓本机网卡，需要选网卡 → 见下方 desktop 分支 */
  const [desktop] = useState(() => isDesktopShell());
  const [devices, setDevices] = useState<CaptureDeviceList | null>(null);
  /** 先同步判断有没有采集桥：没有桥时首屏直接给说明卡，避免异步检查后再更新造成闪烁 */
  const [checked, setChecked] = useState(() => typeof window === 'undefined' || !window.RocoCapture);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** 原包批量删除（2026-11-06）：勾选 + 全选，逐条调用原生删除 */
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [requestedImport, setRequestedImport] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** 2026-11-07：自动停止 / 保存 / 导入在模块级 autoImportFlow 里跑，这里只订阅它的状态做展示；
   *  附近页触发的也是同一流程，所以等待期间切页不会中断，回来也不会重复导入。 */
  const flow = useAutoImport();
  const completed = flow.completion;
  const autoStage = flow.stage;
  const completionError = flow.completionError;
  /** 采集归属：这路采集是从附近页还是本页发起的（决定要不要自动停止 / 导入） */
  const captureOrigin = useCaptureOrigin();
  const liveMode = useLiveMode();
  const rareAlertOn = useRareAlert();
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
      // 采集真正开始后把会话 id 绑进「采集归属」（附近页发起 / 本页发起）
      observeCollectorState(next);
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
  // 桌面版：读一次网卡列表（Npcap 未装时 error 里会带原因）
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void readCaptureDevices().then((list) => { if (alive) setDevices(list); });
    return () => { alive = false; };
  }, [desktop]);
  // 文件被删 / 被壳清理后，把已勾选但已不存在的 id 去掉
  useEffect(() => {
    setSelectedFiles((current) => {
      if (current.size === 0 || !state) return current;
      const existing = new Set(state.files.map((file) => file.id));
      const next = new Set([...current].filter((id) => existing.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [state?.files]);
  const toggleSelectedFile = (id: string) => {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const deleteSelectedFiles = async () => {
    const ids = [...selectedFiles];
    setConfirmBatchDelete(false);
    if (ids.length === 0) return;
    setBatchDeleting(true);
    try {
      for (const id of ids) await action('deleteCapture', id);
    } finally {
      setBatchDeleting(false);
      setSelectedFiles(new Set());
    }
  };
  const action = async (name: CollectorAction, id?: string): Promise<boolean> => {
    setActionError(null);
    // 从本页点「开始采集」：这路采集是导入导向（数据收齐自动停止并导入，原有行为）
    if (name === 'startCapture') markCaptureOrigin('profile');
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
      setRequestedImport(false);
      setActionError(message);
      return false;
    }
    finally { await refresh(); }
  };
  if (!checked) {
    // 有采集桥但状态还没读完：先撑住卡片高度，避免切进「我的」时整块从无到有闪一下
    if (compact) {
      return (
        <section data-testid="native-collector" data-compact="true" aria-busy="true" className="space-y-s2">
          <h2 className="text-title font-semibold text-ink-strong">本机采集</h2>
          <p className="text-caption text-ink-muted" data-testid="native-collector-status">读取采集状态…</p>
        </section>
      );
    }
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
    if (compact) {
      return (
        <section data-testid="native-collector" data-compact="true" className="space-y-s2">
          <h2 className="text-title font-semibold text-ink-strong">本机采集</h2>
          <p className="text-caption text-ink-muted" data-testid="native-collector-status">
            {desktop
              ? '桌面版采集组件没有加载成功，请重启小布助手；仍不行请更新到最新安装包。'
              : '当前环境没有内置采集（只在安卓版小布助手安装包内提供）。网页版只做查看：到电脑版 / 安卓版采集，或登录同一账号同步；装了安卓版仍看不到，请更新安装包。'}
          </p>
          <p className="text-caption text-ink-muted" data-testid="native-collector-files">采集文件 0 个</p>
        </section>
      );
    }
    return (
      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="native-collector-fallback">
        <h2 className="text-base font-semibold text-slate-900">本机采集</h2>
        <p className="mt-1 text-xs text-slate-500">
          {desktop
            ? '桌面版采集组件没有加载成功，请重启小布助手；仍不行请更新到最新安装包。'
            : '当前环境没有内置采集（只在安卓版小布助手安装包内提供）。网页版只做查看：到电脑版 / 安卓版采集，或登录同一账号同步；装了安卓版仍看不到，请更新安装包。'}
        </p>
      </section>
    );
  }
  const busy = state != null && ['starting', 'capturing', 'stopping'].includes(state.phase);
  // 采集中创建的当前文件还带着 .incomplete 标记，不能当成「残缺文件」提示。
  // 旧版壳仍会把它放进 files，这里在忙碌时先不展示，停止保存后再自然出现。
  const activeFileId = busy ? state?.fileId : undefined;
  const visibleFiles = state ? state.files.filter((file) => file.id !== activeFileId) : [];
  /** 弹窗只在导入结束后出现；失败 / 超时 / 导入报错都算「未完成」，要继续给出可操作提示 */
  const importFailed = autoStage === 'failed' || outcome.local === 'failed' || completionError != null;
  const popupTitle = importFailed ? '导入未完成' : outcome.local === 'importing' ? '正在导入' : '导入完成';
  /** 这路采集是附近页发起的（雷达导向）：不自动停止 / 导入，给一行说明 */
  const nearbyOwned = busy && captureOrigin.origin === 'nearby'
    && (captureOrigin.session == null || captureOrigin.session === state?.fileId);
  if (compact) {
    const lastFile = visibleFiles[0];
    return (
      <section data-testid="native-collector" data-compact="true" className="space-y-s2">
        <div className="flex items-center justify-between gap-s2">
          <h2 className="text-title font-semibold text-ink-strong">本机采集</h2>
          <button
            type="button"
            aria-expanded={helpOpen}
            aria-label="本机采集说明"
            data-testid="native-collector-help"
            onClick={() => setHelpOpen((open) => !open)}
            className="flex min-h-8 min-w-8 items-center justify-center rounded-full border border-line bg-surface text-meta font-semibold text-ink-muted transition-colors active:bg-surface-sunken"
          >
            ?
          </button>
        </div>

        {/* 边界与错误不收起：没有桥 / 系统过低 / 桥报错直接可见 */}
        {error ? <StateNotice kind="error" title={error} action={<Button variant="secondary" onClick={refresh}>重试读取状态</Button>} /> : null}
        {actionError ? <StateNotice kind="error" title={actionError} /> : null}
        {flow.error ? <StateNotice kind="error" title={flow.error} /> : null}
        {state && !state.supported ? (
          <StateNotice
            kind="unknown"
            title={desktop ? '没有找到 Npcap' : '内置采集需要 Android 8 或以上'}
            description={desktop
              ? '实时采集依赖 Npcap 抓本机网卡。请先安装 Npcap（安装时勾选 WinPcap API 兼容模式），装完重启小布助手。'
              : '当前手机系统版本过低，无法使用内置采集；换一台系统版本更高的手机，或登录同一账号同步。'}
          />
        ) : null}

        <p className="text-caption text-ink-muted" data-testid="native-collector-status">
          {busy ? '采集中' : '已停止'}
          {lastFile ? ` · 上次 ${new Date(lastFile.createdAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>

        <div className="flex flex-wrap gap-s2">
          {busy ? (
            <Button disabled={state?.phase === 'stopping'} onClick={() => void action('stopCapture')}>
              停止并保存
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={importing || !!error || (desktop && !devices?.ok)}
              onClick={() => void action('startCapture')}
              data-testid="native-collector-start"
            >
              采集并导入
            </Button>
          )}
        </div>

        <p className="text-caption text-ink-muted" data-testid="native-collector-files">
          采集文件 {visibleFiles.length} 个
        </p>

        {helpOpen ? (
          <div className="space-y-s2 rounded-tile bg-surface-sunken p-s3" data-testid="native-collector-help-body">
            <p className="text-caption text-ink-soft">
              {desktop
                ? '在你自己的电脑上用 Npcap 抓取游戏流量，只在本地保存与解析，不上传任何数据。'
                : '仅在手机本地保存与解析，不上传任何数据。'}
            </p>
            <ol className="list-decimal space-y-s1 pl-5 text-caption text-ink-muted">
              <li>关闭其他 VPN 或游戏加速器，开始采集并同意系统 VPN 授权。</li>
              <li>打开游戏，重新登录，依次查看精灵仓库、背包与蛋仓。</li>
              <li>{liveMode ? '持续获取已开启：数据会边玩边更新，不收齐也不自动停止；想结束时点「停止并保存」。' : '查看数据进度；内容稳定（进度条走满）后会自动停止、保存并开始导入。'}</li>
            </ol>
            <div className="flex items-center justify-between gap-s2">
              <span className="text-caption text-ink-soft">持续获取模式</span>
              <Button size="sm" variant={liveMode ? 'primary' : 'secondary'} aria-pressed={liveMode} onClick={() => toggleLiveMode()}>
                {liveMode ? '已开启' : '已关闭'}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-s2">
              <span className="text-caption text-ink-soft">稀有提醒</span>
              <Button size="sm" variant={rareAlertOn ? 'primary' : 'secondary'} aria-pressed={rareAlertOn} onClick={() => toggleRareAlert()}>
                {rareAlertOn ? '已开启' : '已关闭'}
              </Button>
            </div>
            <p className="text-caption text-ink-muted">最多保留 10 个原包，每次上限 128 MiB；导入后仍保留，不会自动清理。</p>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-2xl bg-white p-3 shadow-sm" data-testid="native-collector">
      <h2 className="text-base font-semibold text-slate-900">本机采集</h2>
      <p className="text-xs text-slate-500">
        {desktop
          ? '在你自己的电脑上用 Npcap 抓取游戏流量，只在本地保存与解析，不上传任何数据。'
          : '仅在手机本地保存与解析，不上传任何数据。'}
      </p>
      {error ? <StateNotice kind="error" title={error} action={<Button variant="secondary" onClick={refresh}>重试读取状态</Button>} /> : null}
      {actionError ? <StateNotice kind="error" title={actionError} /> : null}
      {flow.error ? <StateNotice kind="error" title={flow.error} /> : null}
      {state ? <>
        {!state.supported ? <StateNotice kind="unknown" title={desktop ? '没有找到 Npcap' : '内置采集需要 Android 8 或以上'}
          description={desktop
            ? '实时采集依赖 Npcap 抓本机网卡。请先安装 Npcap（安装时勾选 WinPcap API 兼容模式），装完重启小布助手。'
            : '当前手机系统版本过低，无法使用内置采集；换一台系统版本更高的手机，或登录同一账号同步。'}
          action={desktop
            ? <a className="text-emerald-700 underline" href="https://npcap.com/#download" target="_blank" rel="noreferrer">下载 Npcap</a>
            : undefined} /> : <>
          {desktop ? <>
            <div className="space-y-1.5 rounded-xl border border-slate-100 px-3 py-2" data-testid="desktop-capture-device">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">抓包网卡</p>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void readCaptureDevices().then(setDevices); }}>刷新</Button>
              </div>
              {devices?.ok && devices.devices.length > 0 ? (
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
                  value={devices.selected ?? 'auto'}
                  disabled={busy}
                  onChange={(event) => {
                    const name = event.target.value;
                    void selectCaptureDevice(name).then((message) => {
                      if (message) setActionError(message);
                      void readCaptureDevices().then(setDevices);
                    });
                  }}
                >
                  <option value="auto">自动（所有网卡，推荐）</option>
                  {devices.devices.map((device) => <option key={device.name} value={device.name}>{device.description}</option>)}
                </select>
              ) : <p className="text-xs text-amber-800">{devices?.error || '正在读取网卡…'}</p>}
              <p className="text-xs text-slate-500">默认自动打开所有网卡，不用猜流量走哪块；用加速器时也可以手动选对应的 TAP 网卡。提示无权限请以管理员身份运行。</p>
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-500">
              <li>保持网络连接，点「开始采集」。</li>
              <li>打开游戏并登录，进入野外或家园场景。</li>
              <li>{liveMode ? '持续获取已开启：数据会边玩边更新，不收齐也不自动停止；想结束时点「停止并保存」。' : '查看数据进度；内容稳定（进度条走满）后会自动停止、保存并开始导入。'}</li>
            </ol>
          </> : (
            <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-500">
              <li>关闭其他 VPN 或游戏加速器，开始采集并同意系统 VPN 授权。</li>
              <li>打开游戏，重新登录，依次查看精灵仓库、背包与蛋仓。</li>
              <li>{liveMode ? '持续获取已开启：数据会边玩边更新，不收齐也不自动停止；想结束时点「停止并保存」。' : '查看数据进度；内容稳定（进度条走满）后会自动停止、保存并开始导入。'}</li>
            </ol>
          )}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2" data-testid="native-live-mode">
            <div>
              <p className="text-sm font-medium text-slate-800">持续获取模式</p>
              <p className="text-xs text-slate-500">{liveMode ? '已开启：数据收齐也不自动停止，边玩边更新。' : '开启后不用点停止，新数据会实时进结果页。'}</p>
            </div>
            <Button size="sm" variant={liveMode ? 'primary' : 'secondary'} aria-pressed={liveMode} onClick={() => toggleLiveMode()}>
              {liveMode ? '已开启' : '已关闭'}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2" data-testid="native-rare-alert">
            <div>
              <p className="text-sm font-medium text-slate-800">附近强提醒</p>
              <p className="text-xs text-slate-500">{rareAlertOn ? '附近刷到稀有（±100dB / 体重牌+声音牌）或命中需求中心时弹通知。' : '已关闭：附近稀有与需求命中只展示，不弹通知。'}</p>
            </div>
            <Button size="sm" variant={rareAlertOn ? 'primary' : 'secondary'} aria-pressed={rareAlertOn} onClick={() => toggleRareAlert()}>
              {rareAlertOn ? '已开启' : '已关闭'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" data-tour="collector-start">
            {busy ? <Button disabled={state.phase === 'stopping'} onClick={() => action('stopCapture')}>停止并保存</Button>
              : <Button disabled={importing || !!error || (desktop && !devices?.ok)} onClick={() => action('startCapture')}>开始采集</Button>}
            {desktop ? null : <Button variant="secondary" onClick={() => action('openGame')}>打开游戏</Button>}
          </div>
        </>}
        <StateNotice kind={state.phase === 'failed' ? 'error' : 'cached'} title={state.message || '准备采集'} />
        <CaptureProgressView state={state} live={liveMode} rareAlertOn={rareAlertOn} onReady={() => requestAutoImport(state.fileId)} />
        {AUTO_STAGE_LABEL[autoStage] ? (
          <p className="text-xs text-emerald-700" data-testid="capture-auto-status">{AUTO_STAGE_LABEL[autoStage]}</p>
        ) : null}
        {nearbyOwned ? (
          <p className="text-xs text-slate-500" data-testid="capture-nearby-owned">
            本次采集由「附近」页开始：不会自动停止，也不会自动导入；想导入先停止，再在文件列表点「解析并导入」。
          </p>
        ) : null}
        {busy ? <p className="text-xs text-slate-500">已记录 {state.packets} 包 · {sizeLabel(state.bytes)}。数量不代表数据已收齐。</p> : null}
        <p className="text-xs text-slate-500">最多保留 10 个原包，每次上限 128 MiB；导入后仍保留，不会自动清理。</p>
        {visibleFiles.length === 0 ? <p className="text-sm text-slate-500">还没有本机采集文件</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="capture-file-bulk">
            <label className="flex min-h-[32px] items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={selectedFiles.size > 0 && selectedFiles.size === visibleFiles.length}
                onChange={(event) => setSelectedFiles(event.target.checked ? new Set(visibleFiles.map((file) => file.id)) : new Set())}
                disabled={busy || importing || batchDeleting}
                data-testid="capture-file-select-all"
              />
              全选（{visibleFiles.length} 个）
            </label>
            <Button
              size="sm"
              variant="danger"
              disabled={busy || importing || batchDeleting || selectedFiles.size === 0}
              busy={batchDeleting}
              onClick={() => setConfirmBatchDelete(true)}
              data-testid="capture-file-delete-selected"
            >
              删除已选 {selectedFiles.size} 个
            </Button>
          </div>
          <ul className="space-y-1.5">
          {visibleFiles.map((file) => <li key={file.id} className="space-y-1.5 rounded-xl border border-slate-100 p-2.5">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={selectedFiles.has(file.id)}
                onChange={() => toggleSelectedFile(file.id)}
                disabled={busy || importing || batchDeleting}
                aria-label={`选择 ${file.name}`}
                data-testid={`capture-file-select-${file.id}`}
              />
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm text-slate-700">{file.name}</p>
                <p className="text-xs text-slate-500">{new Date(file.createdAt).toLocaleString()} · {sizeLabel(file.size)}</p>
              </div>
            </div>
            {!file.valid ? <p className="text-xs text-amber-800">未完整保存或没有可用数据，请重新采集；仍可导出原包。</p> : null}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" disabled={busy || importing || !!error || !file.valid} onClick={() => action('importCapture', file.id)}>解析并导入</Button>
              <Button size="sm" variant="secondary" disabled={busy || importing || !!error} onClick={() => action('shareCapture', file.id)}>导出原包</Button>
              <Button size="sm" variant="danger" disabled={busy || importing || !!error} onClick={() => setDeleting(file.id)}>删除</Button>
            </div>
          </li>)}
          </ul>
        </>}
        <details className="text-xs text-slate-500">
          <summary className="flex min-h-[32px] cursor-pointer items-center">采集组件与开源许可</summary>
          <p>基于蛋神助手采集器 1.2.9 的原生转发与 PCAP 代码；zdtun © Emanuele Faranda，LGPL-3.0-or-later；小布助手集成代码 GPL-3.0-only。</p>
          <a className="inline-flex min-h-[32px] items-center text-emerald-700 underline" href="https://github.com/sasaki-ishiran/roco-toolbox/blob/codex/android-collector/android-shell/THIRD_PARTY.md" target="_blank" rel="noreferrer">查看来源、许可证与对应源码</a>
        </details>
      </> : null}
      <ModalSurface open={completed != null} title={popupTitle} onClose={() => clearAutoImportCompletion()} testId="capture-complete" footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => clearAutoImportCompletion()}>取消</Button>
        </div>
      }>
        <div className="space-y-1 p-4" data-testid="capture-complete-status">
          <p className="text-sm text-slate-600">已自动停止并保存本次采集。</p>
          {importFailed ? (
            <p className="text-xs text-rose-600" data-testid="capture-complete-outcome">
              导入没有完成：{completionError ?? outcome.message ?? '请在文件列表里点「解析并导入」重试'}
            </p>
          ) : outcome.local === 'importing' ? (
            <p className="text-xs text-slate-400" data-testid="capture-complete-outcome">正在导入数据…</p>
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
            {importFailed
              ? '原包仍保留在文件列表里，可手动重试。'
              : '原包仍会保留；刷新页面或切回本页不会重复导入。'}
          </p>
        </div>
      </ModalSurface>
      <ModalSurface open={deleting != null} title="删除本机原包？" onClose={() => setDeleting(null)} footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>保留文件</Button>
          <Button variant="danger" disabled={busy || importing} onClick={() => { if (deleting) action('deleteCapture', deleting); setDeleting(null); }}>确认删除</Button>
        </div>
      }><p className="p-4 text-sm text-slate-600">删除后无法恢复原包；已导入的游戏数据会保留。</p></ModalSurface>
      <ModalSurface open={confirmBatchDelete} title={`删除已选的 ${selectedFiles.size} 个本机原包？`} onClose={() => setConfirmBatchDelete(false)} footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmBatchDelete(false)}>保留文件</Button>
          <Button variant="danger" disabled={busy || importing || batchDeleting} onClick={() => { void deleteSelectedFiles(); }}>确认删除</Button>
        </div>
      }><p className="p-4 text-sm text-slate-600">删除后无法恢复原包；已导入的游戏数据会保留。</p></ModalSurface>
    </section>
  );
}
