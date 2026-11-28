export const HOME_VIEW_KEY = 'roco.homeView';
export type HomeView = 'nests' | 'demands' | 'stock';

export function readHomeView(): HomeView {
  if (typeof window === 'undefined') return 'nests';
  try {
    const saved = window.localStorage.getItem(HOME_VIEW_KEY);
    return saved === 'demands' || saved === 'stock' ? saved : 'nests';
  } catch {
    return 'nests';
  }
}

/** 已挂载的家园页：外部改了分页要立刻跟着切，不能等重新挂载（新手引导用）。 */
const homeViewListeners = new Set<(view: HomeView) => void>();

/** 新手引导要直接把家园切到某一页（导航合同不管页内分页）。 */
export function saveHomeView(view: HomeView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_VIEW_KEY, view);
  } catch {
    // 隐私模式 / 配额满：本次切换照样生效，只是下次打开不记住（同 lastTab.ts）
  }
  for (const listener of homeViewListeners) listener(view);
}

/** 供已挂载的 HomeLand 订阅外部分页变更（如新手引导）。 */
export function subscribeHomeView(listener: (view: HomeView) => void): () => void {
  homeViewListeners.add(listener);
  return () => {
    homeViewListeners.delete(listener);
  };
}
