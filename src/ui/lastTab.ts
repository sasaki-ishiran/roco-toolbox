import type { TabId } from './TabNav';

/**
 * 记住上次停留的页签。
 *
 * 手机上「关后台再回来」常常是整页重载：如果每次都回到「导入数据」，
 * 用户会以为刚才看的母本共享小组没了。这里只记住主页签（换什么里的子视图不记）。
 */
const KEY = 'roco.lastTab';
const TABS: TabId[] = ['dashboard', 'myPets', 'coverage', 'swap', 'import'];

export function readLastTab(): TabId {
  if (typeof window === 'undefined') return 'import';
  try {
    const raw = window.localStorage.getItem(KEY);
    return TABS.includes(raw as TabId) ? (raw as TabId) : 'import';
  } catch {
    // 隐私模式 / 存储被禁用：退回默认页，不白屏（2026-10-24）
    return 'import';
  }
}

/** 本机是否已经记过页签（= 不是第一次打开这个应用）。 */
export function hasSavedTab(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function saveLastTab(tab: TabId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, tab);
  } catch {
    // 隐私模式 / 配额满：记不住页签不影响功能
  }
}
