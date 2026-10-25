/**
 * 小组页本机偏好（二期）：个人模式 / 小组模式、个人求蛋类型、按类型记住的当前组。
 *
 * 与 `motherGroupStore.ts` 的区别：那份是一期只服务母本共享的单槽记忆；
 * 二期两类组并存后必须按类型分开记住，否则种公组会把母本组的当前组顶掉。
 */
import type { CollectionGroupType } from '../shared/collectionGroups';

const KEY_PREFIX = 'roco.collectionGroups:';
const GUEST_KEY = `${KEY_PREFIX}guest`;
const PENDING_INVITE_KEY = 'roco.collectionGroups.pendingInvite';

export type GroupPageMode = 'personal' | 'group';

export interface CollectionGroupPrefs {
  mode: GroupPageMode;
  /** 个人求蛋当前类型；两种类型分别保留搜索与勾选由组件自己管理。 */
  personalType: CollectionGroupType;
  /** 每种类型上次打开的组。 */
  lastGroupIds: Partial<Record<CollectionGroupType, string>>;
  /** 组长本机看到的邀请码明文。 */
  inviteCodes: Record<string, string>;
  /**
   * 主动「停止共享」过的组（本机记忆）。
   * 导入后会自动把资源同步到小组，但不能把用户主动撤回的组又发回去。
   */
  sharingOff: Record<string, true>;
}

const EMPTY: CollectionGroupPrefs = {
  mode: 'personal',
  personalType: 'mother',
  lastGroupIds: {},
  inviteCodes: {},
  sharingOff: {},
};

const storageKey = (accountId: string | null): string =>
  accountId ? `${KEY_PREFIX}${accountId}` : GUEST_KEY;

export function readCollectionGroupPrefs(accountId: string | null): CollectionGroupPrefs {
  if (typeof window === 'undefined') return { ...EMPTY, lastGroupIds: {}, inviteCodes: {}, sharingOff: {} };
  try {
    const raw = window.localStorage.getItem(storageKey(accountId));
    if (!raw) return { ...EMPTY, lastGroupIds: {}, inviteCodes: {}, sharingOff: {} };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const lastGroupIds: Partial<Record<CollectionGroupType, string>> = {};
    if (typeof parsed.lastGroupIds === 'object' && parsed.lastGroupIds !== null) {
      for (const [key, value] of Object.entries(parsed.lastGroupIds as Record<string, unknown>)) {
        if ((key === 'mother' || key === 'stud') && typeof value === 'string') {
          lastGroupIds[key] = value;
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
    return {
      mode: parsed.mode === 'group' ? 'group' : 'personal',
      personalType: parsed.personalType === 'stud' ? 'stud' : 'mother',
      lastGroupIds,
      inviteCodes,
      sharingOff,
    };
  } catch {
    return { ...EMPTY, lastGroupIds: {}, inviteCodes: {}, sharingOff: {} };
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

export function savePersonalType(accountId: string | null, personalType: CollectionGroupType): void {
  write(accountId, { ...readCollectionGroupPrefs(accountId), personalType });
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
  const prefs = readCollectionGroupPrefs(accountId);
  const lastGroupIds = { ...prefs.lastGroupIds };
  if (groupId) lastGroupIds[groupType] = groupId;
  else delete lastGroupIds[groupType];
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
