/**
 * 小组页本机偏好（二期）：是否已入组、上次打开的组、邀请码等。
 *
 * 与 `motherGroupStore.ts` 的区别：那份是一期只服务母本共享的单槽记忆；
 * 二期按类型分开记住当前组。
 */
import type { CollectionGroupType } from '../shared/collectionGroups';

const KEY_PREFIX = 'roco.collectionGroups:';
const GUEST_KEY = `${KEY_PREFIX}guest`;
const PENDING_INVITE_KEY = 'roco.collectionGroups.pendingInvite';

/** `group` = 已经打开某个组；`personal` = 未入组（2026-10-30 起没有「个人求蛋」页）。 */
export type GroupPageMode = 'personal' | 'group';

export interface CollectionGroupPrefs {
  mode: GroupPageMode;
  /** 每种类型上次打开的组。 */
  lastGroupIds: Partial<Record<CollectionGroupType, string>>;
  /** 组长本机看到的邀请码明文。 */
  inviteCodes: Record<string, string>;
  /**
   * 主动「停止共享」过的组（本机记忆）。
   * 导入后会自动把资源同步到小组，但不能把用户主动撤回的组又发回去。
   */
  sharingOff: Record<string, true>;
  /** 各组「已确认完成」提示的已读水位（毫秒时间戳），避免同一条反复提示。 */
  completionsSeenAt: Record<string, number>;
}

const EMPTY: CollectionGroupPrefs = {
  mode: 'personal',
  lastGroupIds: {},
  inviteCodes: {},
  sharingOff: {},
  completionsSeenAt: {},
};

const emptyPrefs = (): CollectionGroupPrefs => ({
  ...EMPTY,
  lastGroupIds: {},
  inviteCodes: {},
  sharingOff: {},
  completionsSeenAt: {},
});

const storageKey = (accountId: string | null): string =>
  accountId ? `${KEY_PREFIX}${accountId}` : GUEST_KEY;

export function readCollectionGroupPrefs(accountId: string | null): CollectionGroupPrefs {
  if (typeof window === 'undefined') return emptyPrefs();
  try {
    const raw = window.localStorage.getItem(storageKey(accountId));
    if (!raw) return emptyPrefs();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const lastGroupIds: Partial<Record<CollectionGroupType, string>> = {};
    if (typeof parsed.lastGroupIds === 'object' && parsed.lastGroupIds !== null) {
      for (const [key, value] of Object.entries(parsed.lastGroupIds as Record<string, unknown>)) {
        // 2026-10-27 起小组只剩母本组；旧种公组已在服务端删除，不能再用它恢复页面。
        if (key === 'mother' && typeof value === 'string') {
          lastGroupIds.mother = value;
        }
      }
    }
    const inviteCodes: Record<string, string> = {};
    if (typeof parsed.inviteCodes === 'object' && parsed.inviteCodes !== null) {
      for (const [key, value] of Object.entries(parsed.inviteCodes as Record<string, unknown>)) {
        if (typeof value === 'string') inviteCodes[key] = value;
      }
    }
    const sharingOff: Record<string, true> = {};
    if (typeof parsed.sharingOff === 'object' && parsed.sharingOff !== null) {
      for (const [key, value] of Object.entries(parsed.sharingOff as Record<string, unknown>)) {
        if (value === true) sharingOff[key] = true;
      }
    }
    const completionsSeenAt: Record<string, number> = {};
    if (
      typeof parsed.completionsSeenAt === 'object' &&
      parsed.completionsSeenAt !== null
    ) {
      for (const [key, value] of Object.entries(
        parsed.completionsSeenAt as Record<string, unknown>,
      )) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          completionsSeenAt[key] = value;
        }
      }
    }
    return {
      mode: parsed.mode === 'group' ? 'group' : 'personal',
      lastGroupIds,
      inviteCodes,
      sharingOff,
      completionsSeenAt,
    };
  } catch {
    return emptyPrefs();
  }
}

function write(accountId: string | null, prefs: CollectionGroupPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(prefs));
  } catch {
    // 隐私模式 / 配额满：只影响本机记忆
  }
}

export function savePageMode(accountId: string | null, mode: GroupPageMode): void {
  write(accountId, { ...readCollectionGroupPrefs(accountId), mode });
}

export function readLastGroupId(
  accountId: string | null,
  groupType: CollectionGroupType,
): string | null {
  return readCollectionGroupPrefs(accountId).lastGroupIds[groupType] ?? null;
}

export function saveLastGroupId(
  accountId: string | null,
  groupType: CollectionGroupType,
  groupId: string | null,
): void {
  // 种公组已下线：不再记住 stud 的当前组，避免下次启动指向已删除的组。
  if (groupType !== 'mother') return;
  const prefs = readCollectionGroupPrefs(accountId);
  const lastGroupIds = { ...prefs.lastGroupIds };
  if (groupId) lastGroupIds.mother = groupId;
  else delete lastGroupIds.mother;
  write(accountId, { ...prefs, lastGroupIds });
}

export function readCollectionInviteCode(accountId: string | null, groupId: string): string | null {
  return readCollectionGroupPrefs(accountId).inviteCodes[groupId] ?? null;
}

/** 该组是否被用户主动「停止共享」过（自动发布要跳过，避免把撤回的资源又发回去）。 */
export function isGroupSharingOff(accountId: string | null, groupId: string): boolean {
  return readCollectionGroupPrefs(accountId).sharingOff[groupId] === true;
}

export function setGroupSharingOff(accountId: string | null, groupId: string, off: boolean): void {
  const prefs = readCollectionGroupPrefs(accountId);
  const sharingOff = { ...prefs.sharingOff };
  if (off) sharingOff[groupId] = true;
  else delete sharingOff[groupId];
  write(accountId, { ...prefs, sharingOff });
}

export function saveCollectionInviteCode(
  accountId: string | null,
  groupId: string,
  code: string,
): void {
  const prefs = readCollectionGroupPrefs(accountId);
  write(accountId, { ...prefs, inviteCodes: { ...prefs.inviteCodes, [groupId]: code } });
}

export function clearCollectionGroupPrefs(accountId: string | null): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(accountId));
}

/** 该组「已结单」提示的已读水位；`null` = 还没提示过（首次见到只记水位，不弹历史）。 */
export function readDemandCompletionSeenAt(
  accountId: string | null,
  groupId: string,
): number | null {
  const value = readCollectionGroupPrefs(accountId).completionsSeenAt[groupId];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 只前进不后退：并发 / 乱序写入时保留更大的水位。 */
export function saveDemandCompletionSeenAt(
  accountId: string | null,
  groupId: string,
  at: number,
): void {
  if (!Number.isFinite(at)) return;
  const prefs = readCollectionGroupPrefs(accountId);
  const current = prefs.completionsSeenAt[groupId] ?? 0;
  if (at <= current) return;
  write(accountId, {
    ...prefs,
    completionsSeenAt: { ...prefs.completionsSeenAt, [groupId]: at },
  });
}

export function readPendingInviteCode(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(PENDING_INVITE_KEY) ?? '';
}

export function savePendingInviteCode(code: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = code.trim().toUpperCase();
  if (trimmed) window.localStorage.setItem(PENDING_INVITE_KEY, trimmed);
  else window.localStorage.removeItem(PENDING_INVITE_KEY);
}
