import data from './changelog.json';

/**
 * 应用更新日志（发版约定：每次发布在**最前面**追加一条，用户打开时若没看过就弹窗展示）。
 *
 * 用途：App 启动时算出「本机还没看过的更新」，用弹窗给用户看一遍；点「知道了」后记进
 * localStorage，同一条不再打扰。后续每次发版只需在 `changelog.json` 里加一条。
 *
 * 为什么数据放 JSON 而不是这里：`playwright.config.ts` 也要读最新一条的 id 来预置
 * 「已读」（否则弹窗会挡住所有 e2e 用例），而配置文件属于 node 的 ts 工程，不能直接 import
 * src 里的 TS，所以数据单独放 JSON、两边各取所需。
 *
 * 文案要求：写给玩家看，一条一句、说清「哪里变了」；不要解释游戏常识（那是噪音）。
 */
export interface ChangelogEntry {
  /** 发布标识：一般用日期；同一天多次发版可加后缀（如 `2026-10-05b`）。改了它就是新的一条。 */
  id: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = data.entries;

const SEEN_KEY = 'roco.changelogSeen';

/** 本机已看过的发布标识；没记录过返回 null。 */
export function readChangelogSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * 需要弹窗展示的更新（最新的在前）：
 * - 本机没记录过（首次使用）→ 只给最新一条，不倒出历史；
 * - 看过某条 → 给出它之后新增的那些；
 * - 已是最新（或空列表）→ 返回空数组，不弹。
 */
export function pendingChangelog(
  seenId: string | null,
  list: ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  if (list.length === 0) return [];
  const index = seenId ? list.findIndex((entry) => entry.id === seenId) : -1;
  if (index === 0) return [];
  return list.slice(0, index === -1 ? 1 : index);
}

/** 记下已读（写不了 localStorage 时本次会话内仍然能关掉弹窗）。 */
export function markChangelogSeen(id: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, id);
  } catch {
    // 隐私模式下写不了：忽略，下次再弹
  }
}
