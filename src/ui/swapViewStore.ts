import { createModuleStore } from './createModuleStore';

/**
 * 「换什么」页的视图状态（2026-10-07）：筛选、搜索、以及复制前的勾选集合。
 *
 * 为什么是模块级：切页签会卸载重建页面组件，放组件 state 里用户勾了十几条
 * 准备一起复制、切走再回来就全没了。这里只做**内存级**共享（不落 localStorage）——
 * 目的是「跨页签不丢」，不是「跨重启保留」，语义上更保守。
 */
export interface SwapViewState {
  natureFilter: string[];
  groupFilter: string[];
  query: string;
  /** 复制时勾选的推荐（key 见 SwapWishCard.keyOf）；空 = 复制全部 */
  selected: ReadonlySet<string>;
}

const INITIAL: SwapViewState = {
  natureFilter: [],
  groupFilter: [],
  query: '',
  selected: new Set<string>(),
};

const store = createModuleStore<SwapViewState>(INITIAL);

export function useSwapView(): SwapViewState {
  return store.use();
}

export function setSwapFilters(
  patch: Partial<Pick<SwapViewState, 'natureFilter' | 'groupFilter' | 'query'>>,
): void {
  store.set({ ...store.get(), ...patch });
}

export function setSwapSelected(selected: ReadonlySet<string>): void {
  store.set({ ...store.get(), selected });
}
