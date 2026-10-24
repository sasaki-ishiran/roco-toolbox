import type { MotherGroupDetail, MotherGroupSummary } from '../shared/motherGroups';

/**
 * 小组内容的本地缓存（2026-10-25）。
 *
 * 只缓存「上次成功拉到的组列表 + 当前组详情」，按工具箱身份隔离，用来让小组页
 * **先出内容、再后台刷新**；服务器仍是唯一真相。退出登录 / 被移出小组时清掉。
 */
const KEY_PREFIX = 'roco.motherGroupCache:';

export interface MotherGroupCache {
  groups: MotherGroupSummary[];
  detail: MotherGroupDetail | null;
  savedAt: number;
}

const keyOf = (accountId: string): string => `${KEY_PREFIX}${accountId}`;

const isSummary = (value: unknown): value is MotherGroupSummary => {
  if (!value || typeof value !== 'object') return false;
  const group = value as Record<string, unknown>;
  return typeof group.id === 'string' && typeof group.name === 'string'
    && typeof group.ownerAccountId === 'string' && typeof group.memberCount === 'number';
};

const isDetail = (value: unknown): value is MotherGroupDetail => {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  const group = detail.group as Record<string, unknown> | null;
  return !!group && typeof group === 'object' && typeof group.id === 'string'
    && typeof group.name === 'string' && typeof group.ownerAccountId === 'string'
    && Array.isArray(detail.members) && detail.members.every((member) => {
      if (!member || typeof member !== 'object') return false;
      const item = member as Record<string, unknown>;
      return typeof item.accountId === 'string' && typeof item.displayName === 'string';
    });
};

export function readMotherGroupCache(accountId: string | null): MotherGroupCache | null {
  if (!accountId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(keyOf(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(parsed.groups) || !parsed.groups.every(isSummary)
      || typeof parsed.savedAt !== 'number') return null;
    return {
      groups: parsed.groups,
      detail: isDetail(parsed.detail) ? parsed.detail : null,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function write(accountId: string | null, cache: MotherGroupCache): void {
  if (!accountId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyOf(accountId), JSON.stringify(cache));
  } catch {
    // 隐私模式 / 配额满：只是少了「先出内容」，不影响服务器数据
  }
}

export function saveMotherGroupCacheGroups(
  accountId: string | null,
  groups: MotherGroupSummary[],
): void {
  const previous = readMotherGroupCache(accountId);
  write(accountId, { groups, detail: previous?.detail ?? null, savedAt: Date.now() });
}

export function saveMotherGroupCacheDetail(
  accountId: string | null,
  detail: MotherGroupDetail,
): void {
  const previous = readMotherGroupCache(accountId);
  const groups = previous?.groups ?? [{
    id: detail.group.id,
    name: detail.group.name,
    ownerAccountId: detail.group.ownerAccountId,
    memberCount: detail.members.length,
  }];
  write(accountId, { groups, detail, savedAt: Date.now() });
}

/** 只清详情；传 groupId 时仅当缓存详情属于该组才清，避免误删别的组的缓存。 */
export function clearMotherGroupCacheDetail(accountId: string | null, groupId?: string): void {
  const previous = readMotherGroupCache(accountId);
  if (!previous) return;
  if (groupId && previous.detail?.group.id !== groupId) return;
  write(accountId, { ...previous, detail: null, savedAt: Date.now() });
}

export function clearMotherGroupCache(accountId: string | null): void {
  if (!accountId || typeof window === 'undefined') return;
  window.localStorage.removeItem(keyOf(accountId));
}
