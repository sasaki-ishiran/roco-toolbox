import { createModuleStore } from '../ui/createModuleStore';

/**
 * 「我的 · 附近精灵」卡看哪一类结果（2026-11-28 UX1 口径修正）。
 *
 * 一次采集、一次解码**同时**产出附近精灵与战斗守卫；这里只是 UI 偏好，
 * 决定卡片状态行 / 详情入口 / 详情面板显示哪一类。
 * **不碰采集会话、不清快照、不联动悬浮球开关、不改提醒阈值**——切回来零成本。
 */
export type CaptureFocus = 'battle' | 'nearby';

export const CAPTURE_FOCUS_KEY = 'roco.captureFocus';

export const DEFAULT_CAPTURE_FOCUS: CaptureFocus = 'nearby';

export function normalizeCaptureFocus(value: unknown): CaptureFocus {
  return value === 'battle' ? 'battle' : 'nearby';
}

const store = createModuleStore<CaptureFocus>(DEFAULT_CAPTURE_FOCUS, {
  persistKey: CAPTURE_FOCUS_KEY,
  migrate: normalizeCaptureFocus,
});

export function readCaptureFocus(): CaptureFocus {
  return normalizeCaptureFocus(store.get());
}

export function useCaptureFocus(): CaptureFocus {
  return store.use();
}

export function setCaptureFocus(focus: CaptureFocus): void {
  store.set(normalizeCaptureFocus(focus));
}

/** 测试用：恢复默认（跑图）。 */
export function resetCaptureFocusForTest(): void {
  store.set(DEFAULT_CAPTURE_FOCUS);
}
