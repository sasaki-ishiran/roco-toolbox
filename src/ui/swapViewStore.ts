/**
 * 「换什么」页已删除（2026-10-30 随「个人求蛋」一起下线）：
 * 这里只剩旧的视图记忆，用于把老用户的 `roco.swapView` 正确映射到新页面
 * （见 `navigation.initialNavigation`），不再承载任何界面状态。
 */
export type SwapMainView = 'eggs' | 'sharing';

const VIEW_KEY = 'roco.swapView';

/**
 * 记住上次看的是「换蛋清单」还是「母本共享」。
 *
 * 手机上关后台再回来常常是整页重载：如果每次都回到换蛋清单，
 * 用户会以为自己加入的母本共享小组不见了。
 */
export function readSwapMainView(): SwapMainView {
  if (typeof window === 'undefined') return 'eggs';
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'sharing' ? 'sharing' : 'eggs';
  } catch {
    // 隐私模式 / 存储被禁用：退回换蛋清单，不白屏（2026-10-24）
    return 'eggs';
  }
}

export function saveSwapMainView(view: SwapMainView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // 隐私模式 / 配额满：记不住视图不影响功能
  }
}
