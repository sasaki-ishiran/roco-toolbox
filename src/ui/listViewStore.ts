import { createModuleStore } from './createModuleStore';

/**
 * 清单的临时查看状态（2026-10-24 重构任务 4）。
 *
 * - **个人清单**的搜索：同一次会话跨页保留，重新加载清空；不写 localStorage。
 * - **小组清单**的搜索 / 分段 / 成员筛选 / 只看已拥有：按「工具箱身份 + 小组」隔离，
 *   换身份立即清空；切组天然互不串。只存查询条件，不缓存别人的资源正文。
 *
 * 长期目标与达标条件不在这里（见 motherCriteriaStore / coverageFilterStore）。
 */

export type PersonalListId = 'inventory-all' | 'inventory-stud' | 'mothers';

export interface PersonalListState {
  query: string;
}

type PersonalLists = Record<PersonalListId, PersonalListState>;

const PERSONAL_INITIAL: PersonalLists = {
  'inventory-all': { query: '' },
  'inventory-stud': { query: '' },
  mothers: { query: '' },
};

const personalStore = createModuleStore<PersonalLists>(PERSONAL_INITIAL);

export function usePersonalList(id: PersonalListId): PersonalListState {
  return personalStore.use()[id];
}

export function setPersonalQuery(id: PersonalListId, query: string): void {
  const current = personalStore.get();
  if (current[id].query === query) return;
  personalStore.set({ ...current, [id]: { query } });
}

export function resetPersonalListViewsForTest(): void {
  personalStore.set({
    'inventory-all': { query: '' },
    'inventory-stud': { query: '' },
    mothers: { query: '' },
  });
}

export interface GroupListState {
  query: string;
  view: 'missing' | 'help' | 'all';
  memberFilter: string;
  onlyOwned: boolean;
}

const GROUP_DEFAULT: GroupListState = {
  query: '',
  view: 'missing',
  memberFilter: '',
  onlyOwned: false,
};

const keyOf = (accountId: string, groupId: string): string => `${accountId}|${groupId}`;

type GroupLists = Record<string, GroupListState>;

const groupStore = createModuleStore<GroupLists>({});

/** 当前本次会话最近一次看到的小组身份（用于换身份时清旧临时态） */
let lastGroupAccountId: string | null = null;

export function ensureGroupSession(accountId: string): void {
  if (lastGroupAccountId !== null && lastGroupAccountId !== accountId) {
    groupStore.set({});
  }
  lastGroupAccountId = accountId;
}

export function useGroupList(accountId: string, groupId: string): GroupListState {
  return groupStore.use()[keyOf(accountId, groupId)] ?? GROUP_DEFAULT;
}

export function setGroupList(
  accountId: string,
  groupId: string,
  patch: Partial<GroupListState>,
): void {
  const key = keyOf(accountId, groupId);
  const current = groupStore.get();
  groupStore.set({ ...current, [key]: { ...(current[key] ?? GROUP_DEFAULT), ...patch } });
}

export function clearGroupListSession(): void {
  lastGroupAccountId = null;
  groupStore.set({});
}
