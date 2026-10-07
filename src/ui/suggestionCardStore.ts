import { createModuleStore } from './createModuleStore';

/**
 * 「优质种公推荐」卡的交互状态（2026-10-07）。
 *
 * 为什么是模块级：看板切到别的页签会卸载重建组件，放组件 state 里
 * 「用户刚勾掉的已换到」和数量选择会全部丢失——这是用户的实际工作成果，不能丢。
 * 与「我的精灵 / 覆盖度」的筛选一样，选择要跨页签保留。
 */
export interface SuggestionCardState {
  /** 已换到：推荐 id → 完成时间戳（栈式排序用，先完成的沉底） */
  doneAt: Record<string, number>;
  /** 已换到折叠区是否展开 */
  doneOpen: boolean;
  /** 主列表显示条数（「全部」是跳到「换什么」页，不入这里） */
  quantity: number;
}

const INITIAL: SuggestionCardState = { doneAt: {}, doneOpen: false, quantity: 5 };

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
    quantity:
      typeof loaded.quantity === 'number' && Number.isFinite(loaded.quantity)
        ? loaded.quantity
        : INITIAL.quantity,
  }),
});

export function useSuggestionCard(): SuggestionCardState {
  return store.use();
}

/** 勾选 / 取消勾选一条「已换到」 */
export function toggleSuggestionDone(id: string): void {
  const { doneAt } = store.get();
  const next = { ...doneAt };
  if (id in next) delete next[id];
  else next[id] = Date.now();
  store.set({ ...store.get(), doneAt: next });
}

export function setSuggestionDoneOpen(doneOpen: boolean): void {
  store.set({ ...store.get(), doneOpen });
}

export function setSuggestionQuantity(quantity: number): void {
  store.set({ ...store.get(), quantity });
}
