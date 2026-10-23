/**
 * 记住上次停留的页签（旧键 `roco.lastTab`）。
 *
 * 2026-10-24 四入口重构后，新页面不再直接写自己的 page 名，而是经
 * `navigation.legacyLocation()` 换成旧版能理解的五个值——旧版安装升级 / 降级
 * 都不会落到未知页签。读取时这些旧值再由 `initialNavigation()` 映射回新页面。
 */
export type LegacyTab = 'dashboard' | 'myPets' | 'coverage' | 'swap' | 'import';

const KEY = 'roco.lastTab';
const TABS: LegacyTab[] = ['dashboard', 'myPets', 'coverage', 'swap', 'import'];

export function readLastTab(): LegacyTab {
  if (typeof window === 'undefined') return 'import';
  try {
    const raw = window.localStorage.getItem(KEY);
    return TABS.includes(raw as LegacyTab) ? (raw as LegacyTab) : 'import';
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

export function saveLastTab(tab: LegacyTab): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, tab);
  } catch {
    // 隐私模式 / 配额满：记不住页签不影响功能
  }
}
