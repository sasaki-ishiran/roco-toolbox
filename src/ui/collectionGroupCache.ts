/**
 * 小组页本地缓存（二期）：先出内容、再后台刷新。
 *
 * 信封带 `schemaVersion`，组详情按组 ID 分别保存（两种类型来回切不会互相顶掉）。
 * 服务器仍是唯一真相；缓存只用于首屏与离线只读。
 */
import type {
  CollectionGroupDetail,
  CollectionGroupSummary,
} from '../shared/collectionGroups';

const KEY_PREFIX = 'roco.collectionGroupCache:';
const SCHEMA_VERSION = 2;

export interface CollectionGroupCache {
  schemaVersion: number;
  groups: CollectionGroupSummary[];
  details: Record<string, CollectionGroupDetail>;
  savedAt: number;
}

const keyOf = (accountId: string): string => `${KEY_PREFIX}${accountId}`;

const isSummary = (value: unknown): value is CollectionGroupSummary => {
  if (!value || typeof value !== 'object') return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.id === 'string' &&
    typeof group.name === 'string' &&
    typeof group.ownerAccountId === 'string' &&
    typeof group.memberCount === 'number' &&
    (group.groupType === 'mother' || group.groupType === 'stud') &&
    typeof group.targetRevision === 'number'
  );
};

const isDetail = (value: unknown): value is CollectionGroupDetail => {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  const group = detail.group as Record<string, unknown> | null;
  return (
    !!group &&
    typeof group.id === 'string' &&
    typeof group.name === 'string' &&
    typeof group.ownerAccountId === 'string' &&
    (group.groupType === 'mother' || group.groupType === 'stud') &&
    typeof group.targetRevision === 'number' &&
    Array.isArray(detail.members) &&
    detail.members.every((member) => {
      if (!member || typeof member !== 'object') return false;
      const item = member as Record<string, unknown>;
      return typeof item.accountId === 'string' && typeof item.displayName === 'string';
    })
  );
};

export function readCollectionGroupCache(accountId: string | null): CollectionGroupCache | null {
  if (!accountId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(keyOf(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.groups) || !parsed.groups.every(isSummary)) return null;
    if (typeof parsed.savedAt !== 'number') return null;
    const details: Record<string, CollectionGroupDetail> = {};
    if (typeof parsed.details === 'object' && parsed.details !== null) {
      for (const [groupId, detail] of Object.entries(parsed.details as Record<string, unknown>)) {
        if (isDetail(detail) && detail.group.id === groupId) details[groupId] = detail;
      }
    }
    return { schemaVersion: SCHEMA_VERSION, groups: parsed.groups, details, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

function write(accountId: string | null, cache: CollectionGroupCache): void {
  if (!accountId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyOf(accountId), JSON.stringify(cache));
  } catch {
    // 配额满：只是少了「先出内容」，不影响服务器数据
  }
}

const base = (accountId: string | null): CollectionGroupCache =>
  readCollectionGroupCache(accountId) ?? {
    schemaVersion: SCHEMA_VERSION,
    groups: [],
    details: {},
    savedAt: 0,
  };

export function saveCollectionGroupCacheGroups(
  accountId: string | null,
  groups: CollectionGroupSummary[],
): void {
  write(accountId, { ...base(accountId), groups, savedAt: Date.now() });
}

export function saveCollectionGroupCacheDetail(
  accountId: string | null,
  detail: CollectionGroupDetail,
): void {
  const previous = base(accountId);
  const groups = previous.groups.some((group) => group.id === detail.group.id)
    ? previous.groups.map((group) =>
        group.id === detail.group.id
          ? {
              ...group,
              groupType: detail.group.groupType,
              targetRevision: detail.group.targetRevision,
              memberCount: detail.members.length,
            }
          : group,
      )
    : [
        ...previous.groups,
        {
          id: detail.group.id,
          name: detail.group.name,
          ownerAccountId: detail.group.ownerAccountId,
          memberCount: detail.members.length,
          groupType: detail.group.groupType,
          targetRevision: detail.group.targetRevision,
          targetReady: true,
        },
      ];
  write(accountId, {
    ...previous,
    groups,
    details: { ...previous.details, [detail.group.id]: detail },
    savedAt: Date.now(),
  });
}

export function clearCollectionGroupCacheDetail(
  accountId: string | null,
  groupId: string,
): void {
  const previous = readCollectionGroupCache(accountId);
  if (!previous || !previous.details[groupId]) return;
  const details = { ...previous.details };
  delete details[groupId];
  write(accountId, { ...previous, details, savedAt: Date.now() });
}

export function clearCollectionGroupCache(accountId: string | null): void {
  if (!accountId || typeof window === 'undefined') return;
  window.localStorage.removeItem(keyOf(accountId));
}
