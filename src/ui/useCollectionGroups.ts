import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MotherGroupsApiError,
  isMotherGroupsApiError,
} from '../api/motherGroups';
import {
  claimCollectionDemand as claimDemandApi,
  claimCollectionTask as claimTaskApi,
  completeCollectionDemand as completeDemandApi,
  createCollectionGroup as createCollectionGroupApi,
  dissolveCollectionGroup,
  getCollectionDemands,
  getCollectionGroup,
  getCollectionTasks,
  joinCollectionGroup as joinCollectionGroupApi,
  leaveCollectionGroup,
  listCollectionGroups,
  previewCollectionInvite,
  publishCollectionDemand as publishDemandApi,
  publishCollectionResources,
  releaseCollectionDemand as releaseDemandApi,
  releaseCollectionTask as releaseTaskApi,
  removeCollectionGroupMember as removeMemberApi,
  resetCollectionGroupInvite,
  transferCollectionTask as transferTaskApi,
  updateCollectionGroupProfile,
  updateCollectionTarget as updateCollectionTargetApi,
  withdrawCollectionDemand as withdrawDemandApi,
  type CollectionTasksResponse,
  type InvitePreview,
} from '../api/collectionGroups';
import { readAccountId, subscribeSession } from '../api/session';
import { diffMotherResources, buildMotherResource } from '../domain/motherResource';
import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import { buildStudResource, diffStudResources } from '../domain/studResource';
import type { SpeciesEntry } from '../domain/types';
import {
  MOTHER_RESOURCE_SCHEMA_VERSION,
  motherResourceCriteriaIdOf,
  type MotherResourceDraft,
} from '../shared/motherGroups';
import {
  isTargetReady,
  studSlotSetIdOf,
  type CollectionDemand,
  type CollectionGroupDetail,
  type CollectionGroupMember,
  type CollectionGroupSummary,
  type CollectionGroupType,
  type CollectionTaskRecord,
  type GroupTargetConfig,
  type StudResourceDraft,
} from '../shared/collectionGroups';
import {
  readCollectionGroupPrefs,
  readLastGroupId,
  saveCollectionInviteCode,
  saveLastGroupId,
  savePageMode,
  savePersonalType,
  setGroupSharingOff,
  type GroupPageMode,
} from './collectionGroupStore';
import {
  clearCollectionGroupCacheDetail,
  readCollectionGroupCache,
  saveCollectionGroupCacheDetail,
  saveCollectionGroupCacheGroups,
} from './collectionGroupCache';

/** 页面可见且打开着小组时，每 15 秒拉一次。 */
export const POLL_INTERVAL_MS = 15_000;

export interface UseCollectionGroupsInput {
  snapshots: AccountSnapshot[];
  species: SpeciesEntry[];
  catalogVersion: string;
}

export interface MotherPublishPreview {
  kind: 'mother';
  resource: MotherResourceDraft | null;
  diff: ReturnType<typeof diffMotherResources> | null;
  missingAccountKeys: string[];
  error: string;
}

export interface StudPublishPreview {
  kind: 'stud';
  resource: StudResourceDraft | null;
  diff: ReturnType<typeof diffStudResources> | null;
  missingAccountKeys: string[];
  error: string;
}

export interface NoPublishPreview {
  kind: 'none';
  resource: null;
  diff: null;
  missingAccountKeys: string[];
  error: string;
}

export type CollectionPublishPreview = MotherPublishPreview | StudPublishPreview | NoPublishPreview;

export interface CollectionGroupsHook {
  accountId: string | null;
  pageMode: GroupPageMode;
  personalType: CollectionGroupType;
  groups: CollectionGroupSummary[];
  groupsLoaded: boolean;
  currentGroupId: string | null;
  currentGroup: CollectionGroupDetail | null;
  /** 当前组的类型；个人模式 / 未选组时为 null。 */
  groupType: CollectionGroupType | null;
  /** 当前组的目标；旧组为 null（界面按默认口径展示）。 */
  target: GroupTargetConfig | null;
  targetReady: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string;
  offline: boolean;
  nextPollAt: number | null;
  draftSelection: string[];
  draftDirty: boolean;
  publishPreview: CollectionPublishPreview;
  myMember: CollectionGroupMember | null;
  /** 共同寻找：当前目标修订下的任务与「是否全员确认」。 */
  tasks: CollectionTaskRecord[];
  tasksConfirmed: boolean;
  tasksPendingMemberIds: string[];
  tasksLoading: boolean;
  tasksError: string;
  refreshTasks: () => Promise<void>;
  claimTask: (targetKey: string) => Promise<void>;
  releaseTask: (targetKey: string) => Promise<void>;
  transferTask: (targetKey: string, toAccountId: string) => Promise<void>;
  /** 需求承接（2026-10-26）：组内需求与我的操作。 */
  demands: CollectionDemand[];
  demandsLoading: boolean;
  demandsError: string;
  refreshDemands: () => Promise<void>;
  addDemand: (
    eggGameId: number,
    natures: string[],
    criteria: Pick<CollectionDemand, 'gender' | 'body' | 'voice'>,
  ) => Promise<CollectionDemand[]>;
  withdrawDemand: (
    eggGameId: number,
    criteria: Pick<CollectionDemand, 'nature' | 'gender' | 'body' | 'voice'>,
  ) => Promise<void>;
  claimDemand: (demand: CollectionDemand) => Promise<CollectionDemand>;
  releaseDemand: (demand: CollectionDemand) => Promise<CollectionDemand>;
  completeDemand: (demand: CollectionDemand) => Promise<CollectionDemand>;
  selectGroup: (groupId: string, groupTypeHint?: CollectionGroupType) => void;
  selectPersonal: () => void;
  setPersonalType: (type: CollectionGroupType) => void;
  setDraftSelection: (accountKeys: string[]) => void;
  refresh: () => Promise<void>;
  createGroup: (
    name: string,
    displayName: string,
    groupType: CollectionGroupType,
    target?: GroupTargetConfig | null,
  ) => Promise<{ groupId: string; inviteCode: string }>;
  joinGroup: (inviteCode: string, displayName: string) => Promise<{ groupId: string; groupType: CollectionGroupType }>;
  preflightInvite: (inviteCode: string) => Promise<InvitePreview>;
  publish: () => Promise<void>;
  stopSharing: () => Promise<void>;
  updateTarget: (target: GroupTargetConfig) => Promise<number>;
  updateProfile: (displayName: string) => Promise<void>;
  resetInvite: () => Promise<string>;
  /** 组长移除组员（2026-10-26）：会取消对方未完成的需求，已完成保留。 */
  removeMember: (memberAccountId: string) => Promise<void>;
  leave: () => Promise<void>;
  dissolve: () => Promise<void>;
  clearError: () => void;
}

const messageOf = (error: unknown): string => {
  if (error instanceof Error) {
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(error.message)) {
      return '网络连接失败，请检查网络后重试';
    }
    return error.message;
  }
  return '操作失败，请稍后再试';
};

const selectionOf = (detail: CollectionGroupDetail | null, accountId: string | null): string[] => {
  if (!detail || !accountId) return [];
  const mine = detail.members.find((member) => member.accountId === accountId);
  // 母本组只有 resource，种公组只有 studResource；按组类型取账号，否则种公组会永远显示「未选号」。
  const accounts =
    detail.group.groupType === 'stud'
      ? mine?.studResource?.accounts
      : mine?.resource?.accounts;
  return accounts?.map((account) => account.accountKey) ?? [];
};

const emptyMotherDraft = (
  catalogVersion: string,
  criteriaId: string = motherResourceCriteriaIdOf('perfect'),
): MotherResourceDraft => ({
  schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
  criteriaId,
  catalogVersion,
  accounts: [],
});

const EMPTY_TASKS: CollectionTasksResponse = {
  targetRevision: 0,
  confirmed: false,
  pendingMemberIds: [],
  tasks: [],
};

interface Boot {
  accountId: string | null;
  pageMode: GroupPageMode;
  personalType: CollectionGroupType;
  groups: CollectionGroupSummary[];
  groupsLoaded: boolean;
  currentGroupId: string | null;
  currentGroup: CollectionGroupDetail | null;
  loading: boolean;
}

const bootState = (): Boot => {
  const accountId = readAccountId();
  const prefs = readCollectionGroupPrefs(accountId);
  const cache = readCollectionGroupCache(accountId);
  // 2026-10-27 起小组只剩母本组：缓存里残留的种公组不能再用来恢复页面。
  const groups = (cache?.groups ?? []).filter((group) => group.groupType === 'mother');
  const lastMother = readLastGroupId(accountId, 'mother');
  const stored = prefs.mode === 'group'
    ? (lastMother && (groups.length === 0 || groups.some((group) => group.id === lastMother))
        ? lastMother
        : groups[0]?.id ?? null)
    : null;
  const detail = stored ? cache?.details[stored] ?? null : null;
  return {
    accountId,
    pageMode: prefs.mode,
    personalType: prefs.personalType,
    groups,
    groupsLoaded: cache != null,
    currentGroupId: detail?.group.id ?? stored ?? null,
    currentGroup: detail,
    loading: accountId != null && stored != null && detail == null,
  };
};

/**
 * 小组页的会话作用域状态：个人模式 / 小组模式、组列表、当前组详情、草稿与发布预览。
 *
 * 与一期 `useMotherGroups` 的关键差异：
 * - 走 `/api/collection-groups`，同时支持母本组与种公组；
 * - 个人模式不需要登录，也不会自动上传本机需求；
 * - 本机记住「每种类型上次打开的组」，切类型不会互相覆盖；
 * - 发布预览按组类型产出母本或种公摘要，绝不混用。
 */
export function useCollectionGroups(input: UseCollectionGroupsInput): CollectionGroupsHook {
  const [boot] = useState(bootState);
  const [accountId, setAccountId] = useState<string | null>(boot.accountId);
  const [pageMode, setPageMode] = useState<GroupPageMode>(boot.pageMode);
  const [personalType, setPersonalTypeState] = useState<CollectionGroupType>(boot.personalType);
  const [groups, setGroups] = useState<CollectionGroupSummary[]>(boot.groups);
  const [groupsLoaded, setGroupsLoaded] = useState(boot.groupsLoaded);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(boot.currentGroupId);
  const [currentGroup, setCurrentGroup] = useState<CollectionGroupDetail | null>(boot.currentGroup);
  const [loading, setLoading] = useState(boot.loading);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);
  const [draftSelection, setDraftSelectionState] = useState<string[]>(
    () => selectionOf(boot.currentGroup, boot.accountId),
  );
  const [draftDirty, setDraftDirty] = useState(false);
  const [tasksView, setTasksView] = useState<CollectionTasksResponse>(EMPTY_TASKS);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [demands, setDemands] = useState<CollectionDemand[]>([]);
  const [demandsLoading, setDemandsLoading] = useState(false);
  const [demandsError, setDemandsError] = useState('');

  const accountRef = useRef(accountId);
  const modeRef = useRef(pageMode);
  const groupRef = useRef<string | null>(boot.currentGroupId);
  const detailRef = useRef<CollectionGroupDetail | null>(boot.currentGroup);
  const draftRef = useRef<string[]>(selectionOf(boot.currentGroup, boot.accountId));
  const dirtyRef = useRef(false);
  const generationRef = useRef(0);
  const groupEpochRef = useRef(0);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const tasksRequestRef = useRef(0);
  const demandsRequestRef = useRef(0);
  const nextPollAtRef = useRef<number | null>(null);
  const inputRef = useRef(input);

  inputRef.current = input;
  accountRef.current = accountId;
  modeRef.current = pageMode;

  const scope = useCallback((includeGroup = false) => {
    const generation = generationRef.current;
    const epoch = groupEpochRef.current;
    return () =>
      generation === generationRef.current && (!includeGroup || epoch === groupEpochRef.current);
  }, []);

  useEffect(() => () => { generationRef.current += 1; }, []);

  const applySelection = useCallback((detail: CollectionGroupDetail | null) => {
    const keys = selectionOf(detail, accountRef.current);
    draftRef.current = keys;
    setDraftSelectionState(keys);
  }, []);

  const loadTasks = useCallback(async (groupId: string) => {
    const active = scope(true);
    const request = ++tasksRequestRef.current;
    setTasksLoading(true);
    try {
      const view = await getCollectionTasks(groupId);
      if (!active() || request !== tasksRequestRef.current) return;
      setTasksView(view);
      setTasksError('');
    } catch (failure) {
      if (!active() || request !== tasksRequestRef.current) return;
      setTasksError(messageOf(failure));
    } finally {
      if (active() && request === tasksRequestRef.current) setTasksLoading(false);
    }
  }, [scope]);

  const clearTasks = useCallback(() => {
    tasksRequestRef.current += 1;
    setTasksView(EMPTY_TASKS);
    setTasksError('');
    setTasksLoading(false);
    // 需求与任务同生命周期：切组 / 退出时一起清掉，避免串组（2026-10-26）
    demandsRequestRef.current += 1;
    setDemands([]);
    setDemandsError('');
    setDemandsLoading(false);
  }, []);

  /* ---------- 需求承接（2026-10-26） ---------- */

  const loadDemands = useCallback(
    async (groupId: string) => {
      const active = scope(true);
      const request = ++demandsRequestRef.current;
      setDemandsLoading(true);
      try {
        const list = await getCollectionDemands(groupId);
        if (!active() || request !== demandsRequestRef.current) return;
        setDemands(list);
        setDemandsError('');
      } catch (failure) {
        if (!active() || request !== demandsRequestRef.current) return;
        setDemandsError(messageOf(failure));
      } finally {
        if (active() && request === demandsRequestRef.current) setDemandsLoading(false);
      }
    },
    [scope],
  );

  const refreshDemands = useCallback(async () => {
    const groupId = groupRef.current;
    if (!groupId) return;
    await loadDemands(groupId);
  }, [loadDemands]);

  /** 用服务器返回的那一条覆盖本地，避免整表重拉（一个性格一条）。 */
  const mergeDemand = useCallback((next: CollectionDemand) => {
    // 慢网下切组后旧组的响应不能写进新组列表
    if (next.groupId !== groupRef.current) return;
    setDemands((list) => [
      next,
      ...list.filter(
        (item) =>
          item.status === 'done' ||
          !(
            item.demanderAccountId === next.demanderAccountId &&
            item.eggGameId === next.eggGameId &&
            item.nature === next.nature &&
            item.gender === next.gender &&
            item.body === next.body &&
            item.voice === next.voice
          ),
      ),
    ]);
  }, []);

  const addDemand = useCallback(
    async (
      eggGameId: number,
      natures: string[],
      criteria: Pick<CollectionDemand, 'gender' | 'body' | 'voice'>,
    ) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const saved = await publishDemandApi(groupId, { eggGameId, natures, ...criteria });
      saved.forEach(mergeDemand);
      return saved;
    },
    [mergeDemand],
  );

  const withdrawDemand = useCallback(
    async (
      eggGameId: number,
      criteria: Pick<CollectionDemand, 'nature' | 'gender' | 'body' | 'voice'>,
    ) => {
      const groupId = groupRef.current;
      const account = accountRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      await withdrawDemandApi(groupId, eggGameId, criteria);
      setDemands((list) =>
        list.filter(
          (item) =>
            item.status === 'done' ||
            !(
              item.demanderAccountId === account &&
              item.eggGameId === eggGameId &&
              item.nature === criteria.nature &&
              item.gender === criteria.gender &&
              item.body === criteria.body &&
              item.voice === criteria.voice
            ),
        ),
      );
    },
    [],
  );

  const demandAction = useCallback(
    async (
      action: 'claim' | 'release' | 'complete',
      demand: Pick<
        CollectionDemand,
        'demanderAccountId' | 'eggGameId' | 'nature' | 'gender' | 'body' | 'voice' | 'version'
      >,
    ) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const call =
        action === 'claim' ? claimDemandApi : action === 'release' ? releaseDemandApi : completeDemandApi;
      const saved = await call(groupId, {
        demanderAccountId: demand.demanderAccountId,
        eggGameId: demand.eggGameId,
        nature: demand.nature,
        gender: demand.gender,
        body: demand.body,
        voice: demand.voice,
        version: demand.version,
      });
      mergeDemand(saved);
      return saved;
    },
    [mergeDemand],
  );

  /* ---------- 会话切换 ---------- */
  useEffect(
    () =>
      subscribeSession(() => {
        const next = readAccountId();
        if (next === accountRef.current) return;
        generationRef.current += 1;
        groupEpochRef.current += 1;
        accountRef.current = next;
        const prefs = readCollectionGroupPrefs(next);
        const cache = readCollectionGroupCache(next);
        const cachedGroups = (cache?.groups ?? []).filter((group) => group.groupType === 'mother');
        const nextGroupId = prefs.mode === 'group'
          ? readLastGroupId(next, 'mother') ?? cachedGroups[0]?.id ?? null
          : null;
        const detail = nextGroupId ? cache?.details[nextGroupId] ?? null : null;
        const selection = selectionOf(detail, next);
        groupRef.current = nextGroupId;
        detailRef.current = detail;
        draftRef.current = selection;
        dirtyRef.current = false;
        nextPollAtRef.current = null;
        setAccountId(next);
        setPageMode(prefs.mode);
        setPersonalTypeState(prefs.personalType);
        setGroups(cachedGroups);
        setGroupsLoaded(cache != null);
        setCurrentGroupId(nextGroupId);
        setCurrentGroup(detail);
        setDraftSelectionState(selection);
        setDraftDirty(false);
        setError('');
        setOffline(false);
        setNextPollAt(null);
        setLoading(next != null && nextGroupId != null && detail == null);
        clearTasks();
      }),
    [clearTasks],
  );

  /* ---------- 组列表 ---------- */
  const refreshGroups = useCallback(async (): Promise<CollectionGroupSummary[] | null> => {
    if (!accountRef.current) return null;
    const active = scope();
    const request = ++listRequestRef.current;
    try {
      const list = await listCollectionGroups();
      if (!active() || request !== listRequestRef.current) return null;
      setGroups(list);
      setGroupsLoaded(true);
      saveCollectionGroupCacheGroups(accountRef.current, list);
      return list;
    } catch (failure) {
      if (!active() || request !== listRequestRef.current) return null;
      throw failure;
    }
  }, [scope]);

  const applyGroupList = useCallback((list: CollectionGroupSummary[], account: string) => {
    // 小组只剩母本组：旧种公组 id 即使还在本地记忆里，也不能再被选中。
    const lastMother = readLastGroupId(account, 'mother');
    const mothers = list.filter((group) => group.groupType === 'mother');
    const target =
      mothers.find((group) => group.id === lastMother)?.id ??
      mothers[0]?.id ??
      null;
    if (groupRef.current !== target) groupEpochRef.current += 1;
    groupRef.current = target;
    setCurrentGroupId(target);
    if (target) saveLastGroupId(account, 'mother', target);
  }, []);

  useEffect(() => {
    if (!accountId) {
      setGroups([]);
      setGroupsLoaded(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const gen = generationRef.current;
    const request = ++listRequestRef.current;
    const active = () => !cancelled && gen === generationRef.current && request === listRequestRef.current;
    setLoading(true);
    void (async () => {
      try {
        const list = await listCollectionGroups();
        if (!active()) return;
        setGroups(list);
        setGroupsLoaded(true);
        saveCollectionGroupCacheGroups(accountId, list);
        if (modeRef.current === 'group' && groupRef.current == null) applyGroupList(list, accountId);
        setOffline(false);
        setError('');
      } catch (failure) {
        if (!active()) return;
        setError(messageOf(failure));
      } finally {
        if (active()) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId, applyGroupList]);

  /* ---------- 组详情 ---------- */
  const loadDetail = useCallback(
    async (groupId: string, options: { showLoading: boolean; gen: number }) => {
      const epoch = groupEpochRef.current;
      const request = ++detailRequestRef.current;
      const active = () =>
        options.gen === generationRef.current &&
        epoch === groupEpochRef.current &&
        request === detailRequestRef.current &&
        groupRef.current === groupId;
      if (options.showLoading) setLoading(true);
      try {
        const detail = await getCollectionGroup(groupId);
        if (!active()) return;
        detailRef.current = detail;
        setCurrentGroup(detail);
        saveCollectionGroupCacheDetail(accountRef.current, detail);
        setOffline(false);
        setError('');
        if (!dirtyRef.current) applySelection(detail);
        nextPollAtRef.current = null;
        setNextPollAt(null);
        void loadTasks(groupId);
        void loadDemands(groupId);
      } catch (failure) {
        if (!active()) return;
        if (isMotherGroupsApiError(failure) && (failure.status === 403 || failure.status === 404)) {
          groupRef.current = null;
          groupEpochRef.current += 1;
          detailRef.current = null;
          draftRef.current = [];
          dirtyRef.current = false;
          setDraftSelectionState([]);
          setDraftDirty(false);
          setCurrentGroupId(null);
          setCurrentGroup(null);
          clearTasks();
          clearCollectionGroupCacheDetail(accountRef.current, groupId);
          // 旧种公组 / 已被解散的组：静默丢掉本地记忆，自动落到另一个母本组或个人模式，
          // 不再进页面就弹「小组不存在」（2026-10-27）。
          saveLastGroupId(accountRef.current, 'mother', null);
          setError('');
          void refreshGroups()
            .then((list) => {
              if (!list) return;
              // 不要再选回刚才 404 的组，否则会反复请求同一个不存在的组。
              const next = list.find(
                (group) => group.groupType === 'mother' && group.id !== groupId,
              );
              if (next) {
                setPageMode('group');
                savePageMode(accountRef.current, 'group');
                applyGroupList([next], accountRef.current ?? '');
              } else {
                setPageMode('personal');
                savePageMode(accountRef.current, 'personal');
              }
            })
            .catch(() => {});
          return;
        }
        if (isMotherGroupsApiError(failure) && failure.status === 429) {
          const at = Date.now() + Math.max(60, failure.retryAfterSeconds ?? 60) * 1000;
          nextPollAtRef.current = at;
          setNextPollAt(at);
          setError(failure.message);
          return;
        }
        // 只有网络不可用 / 服务端 5xx 才沿用旧数据标「离线」；401、解析失败等要让用户看到真实错误
        const status = isMotherGroupsApiError(failure) ? failure.status : 0;
        if (detailRef.current && (status === 0 || status >= 500)) {
          setOffline(true);
          return;
        }
        setError(messageOf(failure));
      } finally {
        if (options.showLoading && options.gen === generationRef.current &&
          request === detailRequestRef.current) setLoading(false);
      }
    },
    [applyGroupList, applySelection, clearTasks, loadDemands, loadTasks, refreshGroups],
  );

  useEffect(() => {
    dirtyRef.current = false;
    setDraftDirty(false);
  }, [currentGroupId]);

  useEffect(() => {
    if (!accountId || !currentGroupId) {
      if (!currentGroupId) {
        detailRef.current = null;
        setCurrentGroup(null);
      }
      return;
    }
    const gen = generationRef.current;
    let cancelled = false;
    let inFlight = false;

    const tick = async (showLoading: boolean) => {
      if (cancelled || inFlight) return;
      if (nextPollAtRef.current != null && Date.now() < nextPollAtRef.current) return;
      inFlight = true;
      try {
        await loadDetail(currentGroupId, { showLoading, gen });
      } finally {
        inFlight = false;
      }
    };

    void tick(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick(false);
    }, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [accountId, currentGroupId, loadDetail]);

  const selectGroup = useCallback((groupId: string, groupTypeHint?: CollectionGroupType) => {
    const group = groups.find((item) => item.id === groupId);
    if (groupId === groupRef.current && modeRef.current === 'group') return;
    groupEpochRef.current += 1;
    groupRef.current = groupId;
    detailRef.current = null;
    setCurrentGroupId(groupId);
    setCurrentGroup(null);
    setPageMode('group');
    modeRef.current = 'group';
    savePageMode(accountRef.current, 'group');
    // 新建/加入后 groups 可能还没刷新到，用调用方传入的类型兜底
    const type = group?.groupType ?? groupTypeHint;
    if (type) saveLastGroupId(accountRef.current, type, groupId);
    draftRef.current = [];
    dirtyRef.current = false;
    setDraftSelectionState([]);
    setDraftDirty(false);
    setError('');
    setOffline(false);
    setLoading(true);
    nextPollAtRef.current = null;
    setNextPollAt(null);
    clearTasks();
  }, [groups, clearTasks]);

  const selectPersonal = useCallback(() => {
    groupEpochRef.current += 1;
    groupRef.current = null;
    detailRef.current = null;
    setCurrentGroupId(null);
    setCurrentGroup(null);
    setPageMode('personal');
    modeRef.current = 'personal';
    savePageMode(accountRef.current, 'personal');
    draftRef.current = [];
    dirtyRef.current = false;
    setDraftSelectionState([]);
    setDraftDirty(false);
    setError('');
    setOffline(false);
    setLoading(false);
    setNextPollAt(null);
    clearTasks();
  }, [clearTasks]);

  const setPersonalType = useCallback((type: CollectionGroupType) => {
    setPersonalTypeState(type);
    savePersonalType(accountRef.current, type);
  }, []);

  const setDraftSelection = useCallback((accountKeys: string[]) => {
    draftRevisionRef.current += 1;
    draftRef.current = accountKeys;
    dirtyRef.current = true;
    setDraftSelectionState(accountKeys);
    setDraftDirty(true);
  }, []);

  const reloadCurrent = useCallback(async () => {
    const groupId = groupRef.current;
    if (!groupId) return;
    await loadDetail(groupId, { showLoading: false, gen: generationRef.current });
  }, [loadDetail]);

  const refresh = useCallback(async () => {
    const account = accountRef.current;
    if (!account) return;
    const active = scope(true);
    setRefreshing(true);
    try {
      const list = await refreshGroups();
      if (!active() || list === null) return;
      if (modeRef.current === 'group' && groupRef.current === null) applyGroupList(list, account);
      setError('');
      await reloadCurrent();
    } catch (failure) {
      if (!active()) return;
      setError(messageOf(failure));
    } finally {
      // 刷新按钮的忙碌态只跟这一次点击有关；切组/切身份不应让它永久卡在「刷新中…」
      setRefreshing(false);
    }
  }, [applyGroupList, refreshGroups, reloadCurrent, scope]);

  const groupType = currentGroup?.group.groupType ?? null;
  const target = currentGroup?.group.target ?? null;
  const targetReady =
    groupType === 'stud' ? isTargetReady('stud', target) : groupType === 'mother';

  const myMember = useMemo(
    () => currentGroup?.members.find((member) => member.accountId === accountId) ?? null,
    [currentGroup, accountId],
  );

  const publishPreview = useMemo<CollectionPublishPreview>(() => {
    const { snapshots, species, catalogVersion } = inputRef.current;
    const localKeys = new Set(
      snapshots.map((snapshot) => snapshot.accountKey ?? accountKeyOf(snapshot)),
    );
    const missingAccountKeys = draftSelection.filter((key) => !localKeys.has(key));

    if (!currentGroup || groupType == null) {
      return { kind: 'none', resource: null, diff: null, missingAccountKeys: [], error: '' };
    }
    if (missingAccountKeys.length > 0) {
      return {
        kind: groupType,
        resource: null,
        diff: null,
        missingAccountKeys,
        error: '本机缺少这些账号的数据：先导入或云同步，或在选号里撤回',
      } as CollectionPublishPreview;
    }
    if (draftSelection.length === 0) {
      return {
        kind: groupType,
        resource: null,
        diff: null,
        missingAccountKeys: [],
        error: '',
      } as CollectionPublishPreview;
    }
    try {
      if (groupType === 'mother') {
        const motherTarget = target?.kind === 'mother' ? target : null;
        const resource = buildMotherResource({
          snapshots,
          selectedAccountKeys: draftSelection,
          species,
          catalogVersion,
          // 母本口径已去掉；模式决定产线档位，并编进 criteriaId。
          mode: motherTarget?.mode ?? 'perfect',
        });
        const base = myMember?.resource ?? emptyMotherDraft(catalogVersion, resource.criteriaId);
        return {
          kind: 'mother',
          resource,
          diff: diffMotherResources(base, resource),
          missingAccountKeys: [],
          error: '',
        };
      }
      if (!target || target.kind !== 'stud' || target.slots.length === 0) {
        return {
          kind: 'stud',
          resource: null,
          diff: null,
          missingAccountKeys: [],
          error: '本组目标还没确认，确认后才能发布',
        };
      }
      const resource = buildStudResource({
        snapshots,
        selectedAccountKeys: draftSelection,
        species,
        catalogVersion,
        target,
        targetRevision: currentGroup.group.targetRevision,
      });
      const base: StudResourceDraft = myMember?.studResource ?? {
        schemaVersion: 1,
        kind: 'stud',
        mode: target.mode,
        catalogVersion,
        targetId: studSlotSetIdOf(target),
        targetRevision: currentGroup.group.targetRevision,
        accounts: [],
      };
      return {
        kind: 'stud',
        resource,
        diff: diffStudResources(base, resource),
        missingAccountKeys: [],
        error: '',
      };
    } catch (failure) {
      return {
        kind: groupType,
        resource: null,
        diff: null,
        missingAccountKeys: [],
        error: messageOf(failure),
      } as CollectionPublishPreview;
    }
  }, [currentGroup, groupType, target, draftSelection, myMember, input.snapshots]);

  const publishResource = useCallback(
    async (resource: MotherResourceDraft | StudResourceDraft) => {
      const groupId = groupRef.current;
      const account = accountRef.current;
      const detail = detailRef.current;
      if (!groupId || !account || !detail) throw new Error('还没有打开小组');
      const mine = detail.members.find((member) => member.accountId === account);
      if (!mine) throw new Error('不是该组成员');
      const active = scope(true);
      const draftRevision = draftRevisionRef.current;

      await publishCollectionResources(groupId, {
        baseRevision: mine.resourceRevision,
        baseTargetRevision: detail.group.targetRevision,
        resource,
      });
      // 手动发布 = 恢复共享：清掉「主动停止共享」的本机记忆，导入后可以继续自动同步
      setGroupSharingOff(account, groupId, false);
      if (!active()) return;
      if (draftRevision === draftRevisionRef.current) {
        dirtyRef.current = false;
        setDraftDirty(false);
        const keys = 'accounts' in resource
          ? resource.accounts.map((entry) => entry.accountKey)
          : [];
        draftRef.current = keys;
        setDraftSelectionState(keys);
      }
      await reloadCurrent();
    },
    [reloadCurrent, scope],
  );

  const publish = useCallback(async () => {
    if (publishPreview.kind === 'none') throw new Error('个人模式没有可发布的小组资源');
    if (!publishPreview.resource) throw new Error(publishPreview.error || '还没有可发布的资源');
    await publishResource(publishPreview.resource);
  }, [publishPreview, publishResource]);

  const stopSharing = useCallback(async () => {
    const { catalogVersion } = inputRef.current;
    const groupId = groupRef.current;
    const account = accountRef.current;
    if (!groupId) throw new Error('还没有打开小组');
    if (groupType === 'stud') {
      const target = currentGroup?.group.target;
      if (!target || target.kind !== 'stud') throw new Error('本组目标还没确认');
      await publishResource({
        schemaVersion: 1,
        kind: 'stud',
        mode: target.mode,
        catalogVersion,
        targetId: studSlotSetIdOf(target),
        targetRevision: currentGroup?.group.targetRevision ?? 0,
        accounts: [],
      });
    } else {
      await publishResource(emptyMotherDraft(catalogVersion));
    }
    // 记住「主动停止共享」：之后导入触发的自动发布要跳过这个组
    setGroupSharingOff(account, groupId, true);
  }, [currentGroup, groupType, publishResource]);

  const claimTask = useCallback(
    async (targetKey: string) => {
      const groupId = groupRef.current;
      const account = accountRef.current;
      if (!groupId || !account) throw new Error('还没有打开小组');
      const current = tasksView.tasks.find((task) => task.targetKey === targetKey);
      // 服务器是唯一裁决方：等成功后再刷新，不在离线/失败时先显示「我认领了」
      const active = scope(true);
      try {
        await claimTaskApi(groupId, { targetKey, version: current?.version });
      } catch (failure) {
        if (active()) {
          setTasksError(messageOf(failure));
          // 竞争失败时立即拉一次当前负责人，而不是等 15 秒轮询
          void loadTasks(groupId);
        }
        throw failure;
      }
      if (active()) {
        setTasksError('');
        void loadTasks(groupId);
      }
    },
    [loadTasks, scope, tasksView.tasks],
  );

  const releaseTask = useCallback(
    async (targetKey: string) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const current = tasksView.tasks.find((task) => task.targetKey === targetKey);
      const active = scope(true);
      try {
        await releaseTaskApi(groupId, { targetKey, version: current?.version });
      } catch (failure) {
        if (active()) {
          setTasksError(messageOf(failure));
          void loadTasks(groupId);
        }
        throw failure;
      }
      if (active()) {
        setTasksError('');
        void loadTasks(groupId);
      }
    },
    [loadTasks, scope, tasksView.tasks],
  );

  const transferTask = useCallback(
    async (targetKey: string, toAccountId: string) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const current = tasksView.tasks.find((task) => task.targetKey === targetKey);
      const active = scope(true);
      try {
        await transferTaskApi(groupId, { targetKey, toAccountId, version: current?.version });
      } catch (failure) {
        if (active()) {
          setTasksError(messageOf(failure));
          void loadTasks(groupId);
        }
        throw failure;
      }
      if (active()) {
        setTasksError('');
        void loadTasks(groupId);
      }
    },
    [loadTasks, scope, tasksView.tasks],
  );

  const refreshTasks = useCallback(async () => {
    const groupId = groupRef.current;
    if (!groupId) return;
    await loadTasks(groupId);
  }, [loadTasks]);

  const createGroup = useCallback(
    async (
      name: string,
      displayName: string,
      groupType: CollectionGroupType,
      target?: GroupTargetConfig | null,
    ) => {
      const account = accountRef.current;
      if (!account) throw new Error('未登录');
      const active = scope(true);
      const created = await createCollectionGroupApi({
        name,
        displayName,
        groupType,
        target: target ?? undefined,
      });
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      saveCollectionInviteCode(account, created.group.id, created.inviteCode);
      await refreshGroups();
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      selectGroup(created.group.id, created.group.groupType);
      return { groupId: created.group.id, inviteCode: created.inviteCode };
    },
    [refreshGroups, scope, selectGroup],
  );

  const joinGroup = useCallback(
    async (inviteCode: string, displayName: string) => {
      const account = accountRef.current;
      const active = scope(true);
      const joined = await joinCollectionGroupApi({ inviteCode, displayName });
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      if (account) saveLastGroupId(account, joined.groupType, joined.groupId);
      await refreshGroups();
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      selectGroup(joined.groupId);
      return joined;
    },
    [refreshGroups, scope, selectGroup],
  );

  const preflightInvite = useCallback(async (inviteCode: string) => {
    return previewCollectionInvite(inviteCode);
  }, []);

  const updateTarget = useCallback(
    async (nextTarget: GroupTargetConfig) => {
      const groupId = groupRef.current;
      const detail = detailRef.current;
      if (!groupId || !detail) throw new Error('还没有打开小组');
      const active = scope(true);
      const result = await updateCollectionTargetApi(groupId, {
        baseTargetRevision: detail.group.targetRevision,
        target: nextTarget,
      });
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      await reloadCurrent();
      return result.targetRevision;
    },
    [reloadCurrent, scope],
  );

  const updateProfile = useCallback(
    async (displayName: string) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const active = scope(true);
      await updateCollectionGroupProfile(groupId, displayName);
      if (!active()) return;
      await reloadCurrent();
    },
    [reloadCurrent, scope],
  );

  const resetInvite = useCallback(async () => {
    const groupId = groupRef.current;
    const account = accountRef.current;
    if (!groupId) throw new Error('还没有打开小组');
    const active = scope(true);
    const code = await resetCollectionGroupInvite(groupId);
    if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
    if (account) saveCollectionInviteCode(account, groupId, code);
    return code;
  }, [scope]);

  const removeMember = useCallback(
    async (memberAccountId: string) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const active = scope(true);
      await removeMemberApi(groupId, memberAccountId);
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      await reloadCurrent();
      await refreshGroups().catch(() => {});
    },
    [reloadCurrent, refreshGroups, scope],
  );

  const leave = useCallback(async () => {
    const groupId = groupRef.current;
    const account = accountRef.current;
    if (!groupId) return;
    const active = scope(true);
    await leaveCollectionGroup(groupId);
    if (!active()) return;
    const group = groups.find((item) => item.id === groupId);
    if (account && group) saveLastGroupId(account, group.groupType, null);
    clearCollectionGroupCacheDetail(account, groupId);
    selectPersonal();
    await refreshGroups().catch(() => {});
  }, [groups, refreshGroups, scope, selectPersonal]);

  const dissolve = useCallback(async () => {
    const groupId = groupRef.current;
    const account = accountRef.current;
    if (!groupId) return;
    const active = scope(true);
    await dissolveCollectionGroup(groupId);
    if (!active()) return;
    const group = groups.find((item) => item.id === groupId);
    if (account && group) saveLastGroupId(account, group.groupType, null);
    clearCollectionGroupCacheDetail(account, groupId);
    selectPersonal();
    await refreshGroups().catch(() => {});
  }, [groups, refreshGroups, scope, selectPersonal]);

  return {
    accountId,
    pageMode,
    personalType,
    groups,
    groupsLoaded,
    currentGroupId,
    currentGroup,
    groupType,
    target,
    targetReady,
    loading,
    refreshing,
    error,
    offline,
    nextPollAt,
    draftSelection,
    draftDirty,
    publishPreview,
    myMember,
    tasks: tasksView.tasks,
    tasksConfirmed: tasksView.confirmed,
    tasksPendingMemberIds: tasksView.pendingMemberIds,
    tasksLoading,
    tasksError,
    refreshTasks,
    claimTask,
    releaseTask,
    transferTask,
    demands,
    demandsLoading,
    demandsError,
    refreshDemands,
    addDemand,
    withdrawDemand,
    claimDemand: (demand: CollectionDemand) => demandAction('claim', demand),
    releaseDemand: (demand: CollectionDemand) => demandAction('release', demand),
    completeDemand: (demand: CollectionDemand) => demandAction('complete', demand),
    selectGroup,
    selectPersonal,
    setPersonalType,
    setDraftSelection,
    refresh,
    createGroup,
    joinGroup,
    preflightInvite,
    publish,
    stopSharing,
    updateTarget,
    updateProfile,
    resetInvite,
    removeMember,
    leave,
    dissolve,
    clearError: () => setError(''),
  };
}

export { MotherGroupsApiError };
