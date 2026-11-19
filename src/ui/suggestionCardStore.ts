import { createModuleStore } from './createModuleStore';

/**
 * 「优质种公推荐」卡的交互状态（2026-10-07）。
 *
 * 为什么是模块级：看板切到别的页签会卸载重建组件，放组件 state 里
 * 「用户刚标记的已换到」会丢——这是用户的实际工作成果，不能丢。
 * 与「我的精灵 / 覆盖度」的筛选一样，选择要跨页签保留。
 */
export interface SuggestionCardState {
  /** 已换到：推荐 id → 完成时间戳（栈式排序用，先完成的沉底） */
  doneAt: Record<string, number>;
  /** 已换到折叠区是否展开 */
  doneOpen: boolean;
}

const INITIAL: SuggestionCardState = { doneAt: {}, doneOpen: false };

const isTimestampMap = (value: unknown): value is Record<string, number> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item));

const store = createModuleStore<SuggestionCardState>(INITIAL, {
  persistKey: 'roco.suggestionCard',
  migrate: (loaded) => ({
    doneAt: isTimestampMap(loaded.doneAt) ? loaded.doneAt : {},
    doneOpen: loaded.doneOpen === true,
  }),
});

export function useSuggestionCard(): SuggestionCardState {
  return store.use();
}

/** 切换一条「已换到」推荐的完成状态。 */
export function toggleSuggestionDone(id: string): void {
  const { doneAt } = store.get();
  const next = { ...doneAt };
  if (id in next) delete next[id];
  else next[id] = Date.now();
  store.set({ ...store.get(), doneAt: next });
}

/** 同一精灵的多个推荐合并成一张卡，批量更新其完成状态。 */
export function setSuggestionGroupDone(ids: readonly string[], done: boolean): void {
  const next = { ...store.get().doneAt };
  const completedAt = Date.now();
  for (const id of ids) {
    if (done) {
      if (!(id in next)) next[id] = completedAt;
    } else {
      delete next[id];
    }
  }
  store.set({ ...store.get(), doneAt: next });
}

export function setSuggestionDoneOpen(doneOpen: boolean): void {
  store.set({ ...store.get(), doneOpen });
}

/** 重置导入数据时清空「已换到」：它们是基于上一次账号数据的成果。 */
export function clearSuggestionCard(): void {
  store.set(INITIAL);
}
