import { createModuleStore } from './createModuleStore';

/**
 * 种公阵列的「代表种公」选择（2026-10-28）。
 *
 * 键 = `档位::蛋组::性格`，值 = 种公的稳定 key（见 `studMatrixPetKey`）。
 * 只影响阵列里展示哪一只，不改背包、不改任何共享数据；本机持久，刷新/重开还在。
 */
export interface StudMatrixState {
  picks: Record<string, string>;
}

const INITIAL: StudMatrixState = { picks: {} };

const isStringMap = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'string');

const store = createModuleStore<StudMatrixState>(INITIAL, {
  persistKey: 'roco.studMatrixPicks',
  migrate: (loaded) => ({ picks: isStringMap(loaded?.picks) ? loaded.picks : {} }),
});

export function useStudMatrixPicks(): StudMatrixState {
  return store.use();
}

export function setStudMatrixPick(key: string, petKey: string): void {
  store.set({ picks: { ...store.get().picks, [key]: petKey } });
}

export function clearStudMatrixPick(key: string): void {
  const picks = { ...store.get().picks };
  delete picks[key];
  store.set({ picks });
}

/** 测试用：清空选择 */
export function resetStudMatrixPicksForTest(): void {
  store.set({ picks: {} });
}
