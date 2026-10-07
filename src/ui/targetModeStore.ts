import { createModuleStore } from './createModuleStore';
import type { TargetMode } from '../domain/petFilters';

/**
 * 全局目标模式（追满分 / 追双牌）——模块级 store，与覆盖度筛选同一套路子。
 *
 * 看板上的开关写它，覆盖度 / 换什么 / 我的精灵 / 配窝 / 待补母本都读它，
 * 保证全程序只用一个口径。
 *
 * 持久化在 localStorage：
 * - 本机记住选择（刷新、重开还在）；
 * - `chosen` 标记「用户是否显式选过」——备份导入时**本地优先**，
 *   只有本机从没选过才会采用备份里的模式。
 *
 * 2026-10-04 重构：样板（listeners/commit/useXxx）提取到 createModuleStore。
 */
const MODE_KEY = 'roco.targetMode';
const CHOSEN_KEY = 'roco.targetModeChosen';

const readMode = (): TargetMode => {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'medal' ? 'medal' : 'perfect';
  } catch {
    return 'perfect';
  }
};

const readChosen = (): boolean => {
  try {
    return window.localStorage.getItem(CHOSEN_KEY) === '1';
  } catch {
    return false;
  }
};

interface TargetModeState {
  mode: TargetMode;
  chosen: boolean;
}

const store = createModuleStore<TargetModeState>({ mode: readMode(), chosen: readChosen() });

export function getTargetMode(): TargetMode {
  return store.get().mode;
}

/** 看板开关：用户切换 → 记进 localStorage 并标记「已显式选择」。 */
export function setTargetMode(next: TargetMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, next);
    window.localStorage.setItem(CHOSEN_KEY, '1');
  } catch {
    // 隐私模式下写不了 localStorage：只在内存里生效
  }
  store.set({ mode: next, chosen: true });
}

/**
 * 备份导入：本地优先——只有本机从没显式选过、且备份里带了模式时，才采用备份的值。
 */
export function adoptBackupTargetMode(incoming: TargetMode | undefined): void {
  const { mode, chosen } = store.get();
  if (chosen || !incoming || incoming === mode) return;
  try {
    window.localStorage.setItem(MODE_KEY, incoming);
  } catch {
    // 同上
  }
  store.set({ mode: incoming, chosen });
}

export function useTargetMode(): TargetMode {
  return store.use().mode;
}

/** 供单元测试复位（jsdom 里 localStorage 是共享的）。 */
export function resetTargetModeForTest(): void {
  store.set({ mode: readMode(), chosen: readChosen() });
}
