import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MotherGroupsApiError,
  isMotherGroupsApiError,
} from '../api/motherGroups';
import {
  claimCollectionTask as claimTaskApi,
  createCollectionGroup as createCollectionGroupApi,
  dissolveCollectionGroup,
  getCollectionGroup,
  getCollectionTasks,
  joinCollectionGroup as joinCollectionGroupApi,
  leaveCollectionGroup,
  listCollectionGroups,
  previewCollectionInvite,
  publishCollectionResources,
  releaseCollectionTask as releaseTaskApi,
  resetCollectionGroupInvite,
  transferCollectionTask as transferTaskApi,
  updateCollectionGroupProfile,
  updateCollectionTarget as updateCollectionTargetApi,
  type CollectionTasksResponse,
  type InvitePreview,
} from '../api/collectionGroups';
import { readAccountId, subscribeSession } from '../api/session';
import { diffMotherResources, motherResourceSignature, buildMotherResource } from '../domain/motherResource';
import type { MotherBody, MotherVoice } from '../domain/motherCriteria';
import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import { buildStudResource, diffStudResources, studResourceSignature } from '../domain/studResource';
import type { SpeciesEntry } from '../domain/types';
import {
  MOTHER_CRITERIA_ID,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  type MotherResourceDraft,
} from '../shared/motherGroups';
import {
  isTargetReady,
  studSlotSetIdOf,
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
  selectGroup: (groupId: string) => void;
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
  return mine?.resource?.accounts.map((account) => account.accountKey) ?? [];
};

const emptyMotherDraft = (
  catalogVersion: string,
  criteriaId: string = MOTHER_CRITERIA_ID,
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
  const groups = cache?.groups ?? [];
  const stored = prefs.mode === 'group'
    ? readLastGroupId(accountId, prefs.personalType) ??
      groups.find((group) => group.groupType === prefs.personalType)?.id ??
      groups[0]?.id ??
      null
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
  }, []);

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
        const nextGroupId = prefs.mode === 'group'
          ? readLastGroupId(next, prefs.personalType) ?? cache?.groups[0]?.id ?? null
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
        setGroups(cache?.groups ?? []);
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
    const prefs = readCollectionGroupPrefs(account);
    const preferredType = prefs.personalType;
    const stored = readLastGroupId(account, preferredType);
    const target =
      list.find((group) => group.id === stored)?.id ??
      list.find((group) => group.groupType === preferredType)?.id ??
      list[0]?.id ??
      null;
    if (groupRef.current !== target) groupEpochRef.current += 1;
    groupRef.current = target;
    setCurrentGroupId(target);
    if (target) saveLastGroupId(account, preferredType, target);
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
          setPageMode('personal');
          savePageMode(accountRef.current, 'personal');
          clearTasks();
          clearCollectionGroupCacheDetail(accountRef.current, groupId);
          setError(failure.message);
          void refreshGroups().catch(() => {});
          return;
        }
        if (isMotherGroupsApiError(failure) && failure.status === 429) {
          const at = Date.now() + Math.max(60, failure.retryAfterSeconds ?? 60) * 1000;
          nextPollAtRef.current = at;
          setNextPollAt(at);
          setError(failure.message);
          return;
        }
        if (detailRef.current) {
          setOffline(true);
          return;
        }
        setError(messageOf(failure));
      } finally {
        if (options.showLoading && options.gen === generationRef.current &&
          request === detailRequestRef.current) setLoading(false);
      }
    },
    [applySelection, clearTasks, loadTasks, refreshGroups],
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

  const selectGroup = useCallback((groupId: string) => {
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
    if (group) saveLastGroupId(accountRef.current, group.groupType, group.id);
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
      if (active()) setRefreshing(false);
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
        if (motherTarget?.catalogVersion && motherTarget.catalogVersion !== catalogVersion) {
          return {
            kind: 'mother',
            resource: null,
            diff: null,
            missingAccountKeys: [],
            error: '图鉴已更新，请先在「本组目标」里更新口径',
          };
        }
        const resource = buildMotherResource({
          snapshots,
          selectedAccountKeys: draftSelection,
          species,
          catalogVersion,
          criteria: motherTarget
            ? {
                bodies: motherTarget.bodies as MotherBody[],
                voices: motherTarget.voices as MotherVoice[],
              }
            : undefined,
          criteriaId: motherTarget?.criteriaId ?? MOTHER_CRITERIA_ID,
        });
        const base = myMember?.resource ?? emptyMotherDraft(catalogVersion);
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
  }, [currentGroup, groupType, target, draftSelection, myMember]);

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
      return;
    }
    if (groupType === 'mother') {
      const criteriaId = currentGroup?.group.target?.kind === 'mother'
        ? currentGroup.group.target.criteriaId
        : MOTHER_CRITERIA_ID;
      await publishResource(emptyMotherDraft(catalogVersion, criteriaId));
      return;
    }
    await publishResource(emptyMotherDraft(catalogVersion));
  }, [currentGroup, groupType, publishResource]);

  const claimTask = useCallback(
    async (targetKey: string) => {
      const groupId = groupRef.current;
      const account = accountRef.current;
      if (!groupId || !account) throw new Error('还没有打开小组');
      const current = tasksView.tasks.find((task) => task.targetKey === targetKey);
      const optimistic: CollectionTaskRecord = {
        groupId,
        targetRevision: tasksView.targetRevision,
        targetKey,
        round: current?.round ?? 0,
        status: 'claimed',
        ownerAccountId: account,
        version: (current?.version ?? 0) + 1,
        updatedAt: Date.now(),
        closedAt: null,
      };
      // 先就地更新，点击立即有反馈；服务器确认失败再回滚
      setTasksView((view) => ({
        ...view,
        tasks: [...view.tasks.filter((task) => task.targetKey !== targetKey), optimistic],
      }));
      try {
        await claimTaskApi(groupId, { targetKey, version: current?.version });
      } catch (failure) {
        setTasksView((view) => ({
          ...view,
          tasks: current
            ? [...view.tasks.filter((task) => task.targetKey !== targetKey), current]
            : view.tasks.filter((task) => task.targetKey !== targetKey),
        }));
        setTasksError(messageOf(failure));
        throw failure;
      }
      void loadTasks(groupId);
    },
    [loadTasks, tasksView.targetRevision, tasksView.tasks],
  );

  const releaseTask = useCallback(
    async (targetKey: string) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const current = tasksView.tasks.find((task) => task.targetKey === targetKey);
      const optimistic: CollectionTaskRecord = {
        groupId,
        targetRevision: tasksView.targetRevision,
        targetKey,
        round: current?.round ?? 0,
        status: 'open',
        ownerAccountId: null,
        version: (current?.version ?? 0) + 1,
        updatedAt: Date.now(),
        closedAt: null,
      };
      setTasksView((view) => ({
        ...view,
        tasks: [...view.tasks.filter((task) => task.targetKey !== targetKey), optimistic],
      }));
      try {
        await releaseTaskApi(groupId, { targetKey, version: current?.version });
      } catch (failure) {
        setTasksView((view) => ({
          ...view,
          tasks: current
            ? [...view.tasks.filter((task) => task.targetKey !== targetKey), current]
            : view.tasks.filter((task) => task.targetKey !== targetKey),
        }));
        setTasksError(messageOf(failure));
        throw failure;
      }
      void loadTasks(groupId);
    },
    [loadTasks, tasksView.targetRevision, tasksView.tasks],
  );

  const transferTask = useCallback(
    async (targetKey: string, toAccountId: string) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const current = tasksView.tasks.find((task) => task.targetKey === targetKey);
      const optimistic: CollectionTaskRecord = {
        groupId,
        targetRevision: tasksView.targetRevision,
        targetKey,
        round: current?.round ?? 0,
        status: 'claimed',
        ownerAccountId: toAccountId,
        version: (current?.version ?? 0) + 1,
        updatedAt: Date.now(),
        closedAt: null,
      };
      setTasksView((view) => ({
        ...view,
        tasks: [...view.tasks.filter((task) => task.targetKey !== targetKey), optimistic],
      }));
      try {
        await transferTaskApi(groupId, { targetKey, toAccountId, version: current?.version });
      } catch (failure) {
        setTasksView((view) => ({
          ...view,
          tasks: current
            ? [...view.tasks.filter((task) => task.targetKey !== targetKey), current]
            : view.tasks.filter((task) => task.targetKey !== targetKey),
        }));
        setTasksError(messageOf(failure));
        throw failure;
      }
      void loadTasks(groupId);
    },
    [loadTasks, tasksView.targetRevision, tasksView.tasks],
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
      selectGroup(created.group.id);
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
    leave,
    dissolve,
    clearError: () => setError(''),
  };
}

/** 供 UI 判断「这份草稿和服务器上的摘要是否同一份覆盖」。 */
export const sameCollectionCoverage = (
  a: MotherResourceDraft | StudResourceDraft | null,
  b: MotherResourceDraft | StudResourceDraft | null,
): boolean => {
  if (a == null || b == null) return false;
  const aStud = 'kind' in a && a.kind === 'stud';
  const bStud = 'kind' in b && b.kind === 'stud';
  if (aStud || bStud) {
    if (!aStud || !bStud) return false;
    return studResourceSignature(a as StudResourceDraft) === studResourceSignature(b as StudResourceDraft);
  }
  return (
    motherResourceSignature(a as MotherResourceDraft) ===
    motherResourceSignature(b as MotherResourceDraft)
  );
};

export { MotherGroupsApiError };
