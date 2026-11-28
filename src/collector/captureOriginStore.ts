import { createModuleStore } from '../ui/createModuleStore';
import type { CollectorState } from './nativeCollector';

/**
 * 采集归属（2026-11-07：附近采集与「我的」导入采集剥离）。
 *
 * 手机底层一次只有一路 VPN 采集；「归属」记录这次采集是从哪里发起的：
 * - `profile`：「我的 · 游戏数据」发起 —— 导入导向，数据收齐自动停止并导入（原有行为）。
 * - `nearby`：「附近」页发起 —— 雷达导向，永不自动停止 / 永不自动导入。
 *
 * 点「开始采集」时还拿不到会话 id（fileId 要等壳的下一次 getState 轮询才出来），
 * 所以先记归属、`session` 置空；等采集真正开始（phase=capturing）后再绑定到具体会话。
 * 归属写进 localStorage：采集期间刷新页面 / 重开应用，也不会把「附近采集」
 * 误判成导入采集、突然自动停掉。
 */
export type CaptureOrigin = 'nearby' | 'profile';

export interface CaptureOriginState {
  origin: CaptureOrigin | null;
  /** 绑定到的采集会话 id；null = 刚点开始、fileId 还没出来（待绑定窗口） */
  session: string | null;
}

const KEY = 'roco.captureOrigin';
const store = createModuleStore<CaptureOriginState>({ origin: null, session: null }, { persistKey: KEY });

/** 点「开始采集」时调用：记录这次采集从哪里发起，并清空待绑定的旧会话。 */
export function markCaptureOrigin(origin: CaptureOrigin): void {
  store.set({ origin, session: null });
}

/**
 * 采集真正开始后把当前会话 id 绑进归属。
 * 只在 phase=capturing 时绑定：idle 时壳里的 fileId 是上一次会话的陈旧值，不能拿来绑定。
 * 附近页 / 我的页的轮询都会调用，谁先拿到 capturing 状态谁完成绑定。
 */
export function observeCollectorState(state: CollectorState | null): void {
  if (!state || state.phase !== 'capturing' || !state.fileId) return;
  const current = store.get();
  if (!current.origin || current.session === state.fileId) return;
  store.set({ origin: current.origin, session: state.fileId });
}

/** 这次采集会话是否由附近页发起（自动停止 / 自动导入都要跳过它）。 */
export function isNearbyOwnedSession(session?: string | null): boolean {
  const current = store.get();
  if (current.origin !== 'nearby') return false;
  // 待绑定窗口（刚点开始）或就是这个会话：都算附近发起
  return current.session == null || session == null || current.session === session;
}

export function useCaptureOrigin(): CaptureOriginState {
  return store.use();
}

/** 测试用：清空归属。 */
export function readCaptureOrigin(): CaptureOriginState {
  return store.get();
}

export function resetCaptureOriginForTest(): void {
  store.set({ origin: null, session: null });
}
