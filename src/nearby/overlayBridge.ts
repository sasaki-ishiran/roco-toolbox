import type { NearbyOverlayPayload } from './overlayPayload';
import { readNearbyOverlayPanels, type NearbyOverlayPanels } from './overlayPanels';

/**
 * 手机端悬浮面板的网页侧桥（2026-11-08）。
 *
 * 与安卓壳的接口分两条，二者都缺字段容错、任何一侧没就绪都不影响网页：
 *
 * 1) 网页 → 壳（主动推，节流 800ms，和 PC 同一套）：壳注册
 *    `window.RocoCapture.updateNearbyOverlay(json)`；旧 APK 没有该方法时静默跳过，
 *    仍走原来的战斗悬浮球。
 *    `json` 字段与 PC 小窗一致（见 src/collector/desktopOverlay.ts），额外带
 *    `panels: { battle, nearby }`；壳不认识 / 缺这个字段时按「两个都开」渲染。
 *
 * 2) 壳 → 网页（随时读）：网页暴露 `window.RocoNearbyOverlay`，
 *    - `read()`：完整状态 `{ version, panels, payload }` 的 JSON；
 *    - `getPanels()`：只取面板配置；
 *    - `getPayload()`：只取当前 payload（还没推过时为 `null`）。
 *    壳调用前先判断 `window.RocoNearbyOverlay` 是否存在；还没就绪时按默认配置兜底即可。
 *    网页侧自己读不会抛错：没安装、没推送、localStorage 坏数据都返回默认值。
 */
export const NEARBY_OVERLAY_BRIDGE_VERSION = 1;

export interface NearbyOverlayShellPayload extends NearbyOverlayPayload {
  panels: NearbyOverlayPanels;
}

export interface NearbyOverlayBridgeState {
  version: number;
  panels: NearbyOverlayPanels;
  /** 已组装好的 payload；还没推送过时为 null */
  payload: NearbyOverlayShellPayload | null;
}

export interface RocoNearbyOverlayBridge {
  version: number;
  read: () => string;
  getPanels: () => string;
  getPayload: () => string;
}

declare global {
  interface Window {
    /** 安卓壳读取悬浮面板配置与数据的入口（网页加载后可用） */
    RocoNearbyOverlay?: RocoNearbyOverlayBridge;
  }
}

/** 安卓壳暴露给网页的桥；只有新壳才有 `updateNearbyOverlay`。 */
interface RocoCaptureShellBridge {
  updateNearbyOverlay?: (json: string) => string | Promise<string>;
}

let current: NearbyOverlayPayload | null = null;

function shellBridge(): RocoCaptureShellBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { RocoCapture?: RocoCaptureShellBridge }).RocoCapture;
}

/** 当前壳是否支持悬浮面板推送（旧 APK / 网页版为 false）。 */
export function hasNearbyOverlayShell(): boolean {
  return typeof shellBridge()?.updateNearbyOverlay === 'function';
}

/** 网页侧读取：面板配置 + 当前 payload；永远不会抛错。 */
export function readNearbyOverlayState(): NearbyOverlayBridgeState {
  const panels = readNearbyOverlayPanels();
  return {
    version: NEARBY_OVERLAY_BRIDGE_VERSION,
    panels,
    payload: current ? { ...current, panels } : null,
  };
}

/** 安装 `window.RocoNearbyOverlay`（幂等）；网页加载即可用，壳不需要等页面切到「附近」。 */
export function installNearbyOverlayBridge(): void {
  if (typeof window === 'undefined') return;
  const existing = window.RocoNearbyOverlay;
  if (existing && existing.version === NEARBY_OVERLAY_BRIDGE_VERSION) return;
  window.RocoNearbyOverlay = {
    version: NEARBY_OVERLAY_BRIDGE_VERSION,
    read: () => JSON.stringify(readNearbyOverlayState()),
    getPanels: () => JSON.stringify(readNearbyOverlayPanels()),
    getPayload: () => JSON.stringify(readNearbyOverlayState().payload),
  };
}

/** 记下最新 payload，供壳随时读取（不触发推送）。 */
export function publishNearbyOverlayPayload(payload: NearbyOverlayPayload | null): void {
  current = payload;
}

/**
 * 推送最新 payload 给安卓壳。
 *
 * 返回 false 表示没有桥 / 旧壳 / 壳侧报错；调用方不需要区分，网页照常运行。
 * 同时把 payload 记进读取接口，保证「推」和「读」看到同一份数据。
 */
export async function pushNearbyOverlayToShell(payload: NearbyOverlayPayload): Promise<boolean> {
  publishNearbyOverlayPayload(payload);
  const update = shellBridge()?.updateNearbyOverlay;
  if (typeof update !== 'function') return false;
  try {
    const json = JSON.stringify({ ...payload, panels: readNearbyOverlayPanels() });
    const result = await update(json);
    return result !== 'unsupported';
  } catch {
    return false;
  }
}

/** 测试用：清空已推送的 payload（不影响已安装的读取接口）。 */
export function resetNearbyOverlayBridgeForTest(): void {
  current = null;
}

// 网页加载即安装读取接口：App 静态引入「附近」页，壳在任意时刻都能读到配置。
if (typeof window !== 'undefined') installNearbyOverlayBridge();
