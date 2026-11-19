import { isCollectorCaptureUrl, MAX_CAPTURE_BYTES } from '../pcap/collectorUrl';

export type CapturePhase = 'idle' | 'starting' | 'capturing' | 'stopping' | 'failed';
export interface CaptureFile { id: string; name: string; size: number; createdAt: number; valid: boolean }
export interface CollectorState {
  version: 1; supported: boolean; phase: CapturePhase; message: string;
  packets: number; bytes: number; files: CaptureFile[];
  progressVersion?: 1; fileId?: string; savedBytes?: number;
}
export type CaptureSnapshot = { id: string; size: number; url: string };
export type CollectorAction = 'startCapture' | 'stopCapture' | 'openGame' | 'importCapture' | 'shareCapture' | 'deleteCapture';
/** 采集模式：battle = 附近 / 战斗浮窗发起，允许原生滚动裁剪控制文件大小；full = 「我的」页导入导向。 */
export type StartCaptureMode = 'battle' | 'full';
declare global {
  interface Window {
    RocoCapture?: {
      getState: () => string | Promise<string>;
      inspectCapture?: () => string | Promise<string>;
      notifyRareAlert?: (title: string, body: string) => string | Promise<string>;
      /** 系统悬浮窗（2026-11-08）：安卓壳在其它应用上方画战斗悬浮球 */
      updateBattleOverlay?: (payload: BattleOverlayPayload) => string | Promise<string>;
      requestOverlayPermission?: () => string | Promise<string>;
      /** 采集模式透传给原生；旧壳忽略该参数，按完整采集处理 */
      startCapture?: (mode?: StartCaptureMode) => string | Promise<string>;
      /** 系统悬浮窗权限查询（仅新壳）：返回 "true" / "false" */
      canDrawOverlay?: () => string | Promise<string>;
      /**
       * 悬浮球隐藏状态（1.3.6）：长按球 500ms 隐藏，附近页按钮恢复。
       * `readOrbHidden` 返回 "true" / "false"；`setOrbHidden` 返回 "ok"。
       */
      readOrbHidden?: () => string | Promise<string>;
      setOrbHidden?: (hidden: boolean) => string | Promise<string>;
      /** 桌面版（Electron）专用：Npcap 网卡列表与选择 */
      listDevices?: () => string | Promise<string>;
      selectDevice?: (name: string) => string | Promise<string>;
    } & Partial<Record<Exclude<CollectorAction, 'startCapture'>, (id?: string) => string | Promise<string>>>;
    /** 桌面壳标识：存在即代表在 Windows 客户端里（不是安卓壳，也不是普通网页） */
    rocoDesktop?: {
      platform: string;
      version: string;
      /** 附近精灵悬浮小窗（桌面专属） */
      showOverlay?: () => string | Promise<string>;
      hideOverlay?: () => string | Promise<string>;
      updateNearbyOverlay?: (text: string) => string | Promise<string>;
      setOverlayClickThrough?: (flag: boolean) => string | Promise<string>;
      getOverlayState?: () => string | Promise<string>;
    };
  }
}

/** 是否运行在 Windows 桌面客户端里 */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && window.rocoDesktop != null;
}

export interface CaptureDevice {
  name: string;
  description: string;
}

export interface CaptureDeviceList {
  ok: boolean;
  error: string;
  devices: CaptureDevice[];
  selected: string | null;
  version: string;
}

/** 桌面版网卡列表；不是桌面版 / 壳不支持时返回空 */
export async function readCaptureDevices(): Promise<CaptureDeviceList> {
  const empty: CaptureDeviceList = { ok: false, error: '', devices: [], selected: null, version: '' };
  if (!window.RocoCapture?.listDevices) return empty;
  try {
    const text = await window.RocoCapture.listDevices();
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!parsed || !Array.isArray(parsed.devices)) return empty;
    return {
      ok: Boolean(parsed.ok),
      error: typeof parsed.error === 'string' ? parsed.error : '',
      version: typeof parsed.version === 'string' ? parsed.version : '',
      selected: typeof parsed.selected === 'string' ? parsed.selected : null,
      devices: parsed.devices
        .filter((item: unknown): item is CaptureDevice => Boolean(item) && typeof (item as CaptureDevice).name === 'string')
        .map((item: CaptureDevice) => ({ name: item.name, description: typeof item.description === 'string' ? item.description : item.name })),
    };
  } catch {
    return empty;
  }
}

/** 选择网卡（桌面版）；返回错误文案，空串表示成功 */
export async function selectCaptureDevice(name: string): Promise<string> {
  if (!window.RocoCapture?.selectDevice) return '当前版本不支持选择网卡';
  return String((await window.RocoCapture.selectDevice(name)) ?? '');
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export async function readCollectorState(): Promise<CollectorState | null> {
  if (typeof window === 'undefined' || !window.RocoCapture) return null;
  let value: CollectorState;
  try { value = JSON.parse(await window.RocoCapture.getState()) as CollectorState; }
  catch { throw new Error('无法读取本机采集状态，请返回小布助手重试'); }
  if (value?.version !== 1) throw new Error('采集桥版本不兼容，请更新安卓版小布助手');
  if (typeof value.supported !== 'boolean' || !['idle', 'starting', 'capturing', 'stopping', 'failed'].includes(value.phase)
    || typeof value.message !== 'string' || !nonnegative(value.packets) || !nonnegative(value.bytes)
    || (value.progressVersion != null && (value.progressVersion !== 1 || typeof value.fileId !== 'string'
      || (value.fileId !== '' && !/^capture-[0-9]+\.pcap$/.test(value.fileId)) || !Number.isSafeInteger(value.savedBytes)
      || !nonnegative(value.savedBytes) || value.savedBytes > MAX_CAPTURE_BYTES))
    || !Array.isArray(value.files) || value.files.length > 10 || value.files.some((file) =>
      !file || !/^capture-[0-9]+\.pcap$/.test(file.id) || typeof file.name !== 'string'
      || !nonnegative(file.size) || !nonnegative(file.createdAt) || typeof file.valid !== 'boolean')) {
    throw new Error('本机采集状态无效，请重新打开小布助手');
  }
  return value;
}
export async function readCaptureSnapshot(): Promise<CaptureSnapshot | null> {
  if (!window.RocoCapture?.inspectCapture) return null;
  const text = await window.RocoCapture.inspectCapture();
  if (!text) return null;
  let snapshot: CaptureSnapshot;
  try { snapshot = JSON.parse(text) as CaptureSnapshot; } catch { throw new Error('无法读取采集快照'); }
  if (!snapshot || !/^capture-[0-9]+\.pcap$/.test(snapshot.id) || !Number.isSafeInteger(snapshot.size)
    || snapshot.size <= 24 || snapshot.size > MAX_CAPTURE_BYTES || typeof snapshot.url !== 'string' || !isCollectorCaptureUrl(snapshot.url)) {
    throw new Error('本机采集快照无效');
  }
  return snapshot;
}

/** 实时巡检的字节缓存：记住已读位置，下一轮只取新增的一段。 */
let liveBytes: { id: string; bytes: Uint8Array } | null = null;

/** 测试用：清空增量缓存。 */
export function resetCaptureBytesCacheForTest(): void {
  liveBytes = null;
}

/**
 * 实时采集的增量读取（2026-11-08 性能优化）。
 *
 * 之前每一轮巡检都把整个 PCAP 重新搬过 WebView：文件涨到几十 MB 后，
 * 搬运本身占掉绝大部分耗时，表现就是「包越多越卡」。
 * 现在主线程缓存已读字节，每轮只 fetch `[已读, 最新)` 这一小段
 * （新壳的拦截器支持 ?from=N；旧壳响应头对不上时自动回退全量），
 * 拼接后交给 worker 解码——解码仍是全量扫，但那是纯 CPU，耗时远小于搬运。
 */
export async function readCaptureSnapshotBytes(snapshot: CaptureSnapshot, signal?: AbortSignal): Promise<Uint8Array> {
  const cached = liveBytes;
  if (cached && cached.id === snapshot.id && cached.bytes.length <= snapshot.size) {
    if (cached.bytes.length === snapshot.size) return cached.bytes;
    try {
      const delta = await fetchCaptureDelta(snapshot.url, cached.bytes.length, signal);
      if (cached.bytes.length + delta.length > MAX_CAPTURE_BYTES) throw new Error('抓包超过 128MiB');
      const merged = new Uint8Array(cached.bytes.length + delta.length);
      merged.set(cached.bytes, 0);
      merged.set(delta, cached.bytes.length);
      liveBytes = { id: snapshot.id, bytes: merged };
      return merged;
    } catch (error) {
      if (error instanceof Error && error.message.includes('128MiB')) throw error;
      // 主动取消（切页 / 后台心跳重启卡死轮次）：不要再回退全量读一遍
      if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
      // 旧壳不支持 from / 响应头对不上：回退全量读取
    }
  }
  const response = await fetch(snapshot.url, { cache: 'no-store', credentials: 'omit', signal });
  if (!response.ok) throw new Error('无法读取本机原包，请返回小布助手重新导入');
  const bytes = new Uint8Array(await response.arrayBuffer());
  liveBytes = { id: snapshot.id, bytes };
  return bytes;
}

async function fetchCaptureDelta(url: string, from: number, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(`${url}?from=${from}`, { cache: 'no-store', credentials: 'omit', signal });
  if (!response.ok) throw new Error('无法增量读取本机原包');
  // 校验拦截器确实理解了 from（旧壳会忽略 query 返回全量，那会让拼接错位，必须识别出来）
  const servedFrom = Number(response.headers.get('X-Capture-From'));
  if (servedFrom !== from) throw new Error('当前壳不支持增量读取');
  return new Uint8Array(await response.arrayBuffer());
}
export async function collectorAction(action: CollectorAction, id?: string): Promise<void> {
  const bridge = window.RocoCapture;
  if (!bridge || typeof bridge[action] !== 'function') throw new Error('请更新安卓版小布助手后使用内置采集');
  if (id != null && !/^capture-[0-9]+\.pcap$/.test(id)) throw new Error('无效的采集文件');
  const call = bridge[action] as (id?: string) => string | Promise<string>;
  const error = await (id == null ? call() : call(id));
  if (error) throw new Error(error);
}

/**
 * 开始采集并指定模式（2026-11-08）。
 *
 * 附近页 / 战斗浮窗发起时传 `battle`：原生侧允许滚动裁剪采集文件（8MiB 触发、只留最近 4MiB），
 * 避免 20 分钟采集动辄 20MB+；「我的」页仍走 `collectorAction('startCapture')`，即完整采集。
 * 旧壳没有该参数时忽略，行为与之前一致。
 */
export async function startCollectorCapture(mode: StartCaptureMode = 'full'): Promise<void> {
  const bridge = window.RocoCapture;
  if (!bridge || typeof bridge.startCapture !== 'function') throw new Error('请更新安卓版小布助手后使用内置采集');
  const error = await bridge.startCapture(mode);
  if (error) throw new Error(error);
}

/**
 * 稀有精灵通知（2026-11-05）。
 * 旧壳没有该方法时静默跳过；标题/正文做长度限制，避免把整段列表塞进通知。
 */
export async function notifyRareAlert(title: string, body: string): Promise<boolean> {
  const notify = window.RocoCapture?.notifyRareAlert;
  if (typeof notify !== 'function') return false;
  const safeTitle = String(title || '').trim().slice(0, 80);
  const safeBody = String(body || '').trim().slice(0, 500);
  if (!safeTitle) return false;
  const error = await notify(safeTitle, safeBody);
  if (error) throw new Error(error);
  return true;
}

/**
 * 系统悬浮窗（2026-11-08）。
 *
 * 网页里的元素只能在应用内显示；要把球浮在游戏上方，必须由安卓壳用
 * WindowManager 画 TYPE_APPLICATION_OVERLAY 窗口。网页这边只负责推数据：
 * - `visible=false` 隐藏（采集结束）；
 * - `hit=true` 命中目标 → 球变红；
 * - `fields` 是点击球展开的详情（原生用同样的小标签样式渲染）。
 *
 * 返回 `'unsupported'` 表示当前是网页版（或旧壳），调用方应回退到应用内球。
 */
export interface BattleOverlayField {
  text: string;
  hot?: boolean;
  primary?: boolean;
  /** 排数：1 = 名字/性别/等级/性格/声音，2 = 身高体重；缺省 1（2026-11-08 固定两行排版） */
  row?: 1 | 2;
}
export interface BattleOverlayPayload { visible: boolean; hit?: boolean; fields?: BattleOverlayField[] }
export type BattleOverlayStatus = 'ok' | 'need-permission' | 'unsupported';

/** 当前运行环境有没有系统悬浮窗能力（安卓新壳才有）。 */
export function hasNativeBattleOverlay(): boolean {
  return typeof window !== 'undefined' && typeof window.RocoCapture?.updateBattleOverlay === 'function';
}

export async function updateBattleOverlay(payload: BattleOverlayPayload): Promise<BattleOverlayStatus> {
  const update = window.RocoCapture?.updateBattleOverlay;
  if (typeof update !== 'function') return 'unsupported';
  // 直接传对象：bridge 会把整个请求 JSON.stringify，原生用 optJSONObject 取
  const status = await update(payload);
  return status === 'ok' || status === 'need-permission' ? status : 'unsupported';
}

/** 跳系统设置页去授予「显示在其他应用上层」；原生打不开时抛错。 */
export async function requestOverlayPermission(): Promise<void> {
  const request = window.RocoCapture?.requestOverlayPermission;
  if (typeof request !== 'function') throw new Error('请更新安卓版小布助手后使用悬浮窗');
  const error = await request();
  if (error) throw new Error(error);
}

/**
 * 查询「显示在其他应用上层」权限（2026-11-08）。
 *
 * 返回 `null` 表示当前壳查不了（旧 APK / 网页版），调用方按「不阻塞采集」处理；
 * 返回 `false` 时应在开始采集前问用户要不要去开启，避免进了游戏才发现没有悬浮球。
 */
export async function canDrawOverlay(): Promise<boolean | null> {
  const check = window.RocoCapture?.canDrawOverlay;
  if (typeof check !== 'function') return null;
  try { return String(await check()) === 'true'; } catch { return null; }
}

/**
 * 悬浮球当前是否被隐藏（1.3.6）。
 * 返回 `null` 表示当前壳没有这个能力（旧 APK / 网页版），调用方不显示按钮。
 */
export async function readOrbHidden(): Promise<boolean | null> {
  const read = window.RocoCapture?.readOrbHidden;
  if (typeof read !== 'function') return null;
  try { return String(await read()) === 'true'; } catch { return null; }
}

/** 隐藏 / 显示悬浮球；只摘掉窗口，采集照常继续。返回是否调用成功。 */
export async function setOrbHidden(hidden: boolean): Promise<boolean> {
  const write = window.RocoCapture?.setOrbHidden;
  if (typeof write !== 'function') return false;
  try { return String(await write(hidden)) === 'ok'; } catch { return false; }
}
