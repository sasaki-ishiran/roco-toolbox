/**
 * 使用教程（2026-10-06）：首启自动弹一次分步引导，之后可从顶部「教程」随时回看。
 *
 * 记的键存**版本号**而不是 true：以后教程内容大改（比如加了新功能），把版本号 +1 就能
 * 再给所有用户弹一次，不用清理 localStorage。
 */
const GUIDE_SEEN_KEY = 'roco.guideSeen';

/**
 * 教程版本：改内容时 +1（2026-10-06 → 2：开头加了两页功能简介；→ 3：精简掉重复的两页 + 导入页重排）
 */
export const GUIDE_VERSION = '3';

export function guidePending(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) !== GUIDE_VERSION;
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUIDE_SEEN_KEY, GUIDE_VERSION);
  } catch {
    // 隐私模式写不了：这次看过就算了，下次再弹
  }
}
