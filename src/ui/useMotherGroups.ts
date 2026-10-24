import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MotherGroupsApiError,
  createMotherGroup,
  dissolveMotherGroup,
  getMotherGroup,
  isMotherGroupsApiError,
  joinMotherGroup,
  leaveMotherGroup,
  listMotherGroups,
  publishMotherResources,
  resetMotherGroupInvite,
  updateMotherGroupProfile,
} from '../api/motherGroups';
import { readAccountId, subscribeSession } from '../api/session';
import { motherResourceSignature, buildMotherResource, diffMotherResources } from '../domain/motherResource';
import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import type { SpeciesEntry } from '../domain/types';
import {
  MOTHER_CRITERIA_ID,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  type MotherGroupDetail,
  type MotherGroupMember,
  type MotherGroupSummary,
  type MotherResourceDraft,
} from '../shared/motherGroups';
import {
  readCurrentGroupId,
  saveCurrentGroupId,
  saveInviteCode,
} from './motherGroupStore';
import {
  clearMotherGroupCacheDetail,
  readMotherGroupCache,
  saveMotherGroupCacheDetail,
  saveMotherGroupCacheGroups,
} from './motherGroupCache';

/** 页面可见且打开着小组时，每 15 秒拉一次。 */
export const POLL_INTERVAL_MS = 15_000;

export interface UseMotherGroupsInput {
  snapshots: AccountSnapshot[];
  species: SpeciesEntry[];
  catalogVersion: string;
}

export interface MotherPublishPreview {
  /** null = 当前选号不是有效摘要（缺本地账号、导出时间无效或选择为空）。 */
  resource: MotherResourceDraft | null;
  diff: ReturnType<typeof diffMotherResources> | null;
  /** 服务器记录过、但本机没有快照的账号键：发布按钮必须禁用。 */
  missingAccountKeys: string[];
  error: string;
}

export interface MotherGroupsHook {
  accountId: string | null;
  groups: MotherGroupSummary[];
  /** 组列表是否成功拉取过；false + groups 为空 ≠ 没有小组（可能只是网络失败） */
  groupsLoaded: boolean;
  currentGroupId: string | null;
  currentGroup: MotherGroupDetail | null;
  loading: boolean;
  error: string;
  offline: boolean;
  nextPollAt: number | null;
  draftSelection: string[];
  draftDirty: boolean;
  publishPreview: MotherPublishPreview;
  myMember: MotherGroupMember | null;
  selectGroup: (groupId: string | null) => void;
  setDraftSelection: (accountKeys: string[]) => void;
  refresh: () => Promise<void>;
  createGroup: (name: string, displayName: string) => Promise<{ groupId: string; inviteCode: string }>;
  joinGroup: (inviteCode: string, displayName: string) => Promise<string>;
  publish: () => Promise<void>;
  stopSharing: () => Promise<void>;
  updateProfile: (displayName: string) => Promise<void>;
  resetInvite: () => Promise<string>;
  leave: () => Promise<void>;
  dissolve: () => Promise<void>;
  clearError: () => void;
}

const messageOf = (error: unknown): string => {
  if (error instanceof Error) {
    // fetch 断网时浏览器抛的是英文 TypeError: Failed to fetch / Load failed
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(error.message)) {
      return '网络连接失败，请检查网络后重试';
    }
    return error.message;
  }
  return '操作失败，请稍后再试';
};

const selectionOf = (detail: MotherGroupDetail | null, accountId: string | null): string[] => {
  if (!detail || !accountId) return [];
  const mine = detail.members.find((member) => member.accountId === accountId);
  return mine?.resource?.accounts.map((account) => account.accountKey) ?? [];
};

const emptyDraft = (catalogVersion: string): MotherResourceDraft => ({
  schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
  criteriaId: MOTHER_CRITERIA_ID,
  catalogVersion,
  accounts: [],
});

interface MotherGroupsBoot {
  accountId: string | null;
  groups: MotherGroupSummary[];
  groupsLoaded: boolean;
  currentGroupId: string | null;
  currentGroup: MotherGroupDetail | null;
  loading: boolean;
}

/**
 * 首屏先读本机缓存（2026-10-25 用户要求）：有上次成功拉到的组列表/详情就直接显示，
 * 再让下面的 effect 后台刷新。没有缓存时才显示「正在读取」，不要立刻说「读不到」。
 */
const bootState = (): MotherGroupsBoot => {
  const accountId = readAccountId();
  const cache = readMotherGroupCache(accountId);
  const stored = readCurrentGroupId(accountId);
  const cachedDetail = cache?.detail && (stored == null || cache.detail.group.id === stored)
    ? cache.detail
    : null;
  return {
    accountId,
    groups: cache?.groups ?? [],
    groupsLoaded: cache != null,
    currentGroupId: cachedDetail?.group.id ?? stored ?? cache?.groups[0]?.id ?? null,
    currentGroup: cachedDetail,
    loading: accountId != null && cachedDetail == null,
  };
};

/**
 * 多人母本共享的会话作用域状态与轮询。
 *
 * 身份 → 组列表 → 当前组详情都从服务器取；退出/换身份会清掉全部内容与草稿，
 * 晚到的旧请求按「身份代数 + 当前组」丢弃。草稿选号只在本机，发布前必须预览。
 */
export function useMotherGroups(input: UseMotherGroupsInput): MotherGroupsHook {
  const [boot] = useState(bootState);
  const [accountId, setAccountId] = useState<string | null>(boot.accountId);
  const [groups, setGroups] = useState<MotherGroupSummary[]>(boot.groups);
  const [groupsLoaded, setGroupsLoaded] = useState(boot.groupsLoaded);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(boot.currentGroupId);
  const [currentGroup, setCurrentGroup] = useState<MotherGroupDetail | null>(boot.currentGroup);
  const [loading, setLoading] = useState(boot.loading);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);
  const [draftSelection, setDraftSelectionState] = useState<string[]>(
    () => selectionOf(boot.currentGroup, boot.accountId),
  );
  const [draftDirty, setDraftDirty] = useState(false);

  const accountRef = useRef(accountId);
  const groupRef = useRef<string | null>(boot.currentGroupId);
  const detailRef = useRef<MotherGroupDetail | null>(boot.currentGroup);
  const draftRef = useRef<string[]>(selectionOf(boot.currentGroup, boot.accountId));
  const dirtyRef = useRef(false);
  const generationRef = useRef(0);
  const groupEpochRef = useRef(0);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const nextPollAtRef = useRef<number | null>(null);
  const inputRef = useRef(input);

  inputRef.current = input;
  accountRef.current = accountId;

  // 每个异步操作只可写回发起它的会话/小组；切走再切回来也不复用旧作用域。
  const scope = useCallback((includeGroup = false) => {
    const generation = generationRef.current;
    const epoch = groupEpochRef.current;
    return () => generation === generationRef.current &&
      (!includeGroup || epoch === groupEpochRef.current);
  }, []);

  useEffect(() => () => { generationRef.current += 1; }, []);

  const applySelection = useCallback((detail: MotherGroupDetail | null) => {
    const keys = selectionOf(detail, accountRef.current);
    draftRef.current = keys;
    setDraftSelectionState(keys);
  }, []);

  /* ---------- 会话切换：清掉上一个人的全部内容 ---------- */
  useEffect(
    () =>
      subscribeSession(() => {
        const next = readAccountId();
        if (next === accountRef.current) return;
        generationRef.current += 1;
        groupEpochRef.current += 1;
        accountRef.current = next;
        // 新身份也先读它自己的缓存；没有缓存才回到空态等网络
        const cache = readMotherGroupCache(next);
        const stored = readCurrentGroupId(next);
        const cachedDetail = cache?.detail && (stored == null || cache.detail.group.id === stored)
          ? cache.detail
          : null;
        const nextGroupId = cachedDetail?.group.id ?? stored ?? cache?.groups[0]?.id ?? null;
        const nextSelection = selectionOf(cachedDetail, next);
        groupRef.current = nextGroupId;
        detailRef.current = cachedDetail;
        draftRef.current = nextSelection;
        dirtyRef.current = false;
        nextPollAtRef.current = null;
        setAccountId(next);
        setGroups(cache?.groups ?? []);
        setGroupsLoaded(cache != null);
        setCurrentGroupId(nextGroupId);
        setCurrentGroup(cachedDetail);
        setDraftSelectionState(nextSelection);
        setDraftDirty(false);
        setError('');
        setOffline(false);
        setNextPollAt(null);
        setLoading(next != null && cachedDetail == null);
      }),
    [],
  );

  /* ---------- 组列表 ---------- */
  const refreshGroups = useCallback(async (): Promise<MotherGroupSummary[] | null> => {
    if (!accountRef.current) return null;
    const active = scope();
    const request = ++listRequestRef.current;
    try {
      const list = await listMotherGroups();
      if (!active() || request !== listRequestRef.current) return null;
      setGroups(list);
      setGroupsLoaded(true);
      saveMotherGroupCacheGroups(accountRef.current, list);
      return list;
    } catch (failure) {
      if (!active() || request !== listRequestRef.current) return null;
      throw failure;
    }
  }, [scope]);

  /** 从「我加入的组」里挑当前组：优先本机记住的，其次第一个。 */
  const applyGroupList = useCallback((list: MotherGroupSummary[], account: string) => {
    const stored = readCurrentGroupId(account);
    const target = list.find((group) => group.id === stored)?.id ?? list[0]?.id ?? null;
    if (groupRef.current !== target) groupEpochRef.current += 1;
    groupRef.current = target;
    setCurrentGroupId(target);
    if (target) saveCurrentGroupId(account, target);
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
    const epoch = groupEpochRef.current;
    const request = ++listRequestRef.current;
    const active = () => !cancelled && gen === generationRef.current && request === listRequestRef.current;
    setLoading(true);
    void (async () => {
      try {
        const list = await listMotherGroups();
        if (!active()) return;
        setGroups(list);
        setGroupsLoaded(true);
        saveMotherGroupCacheGroups(accountId, list);
        if (epoch === groupEpochRef.current) applyGroupList(list, accountId);
        setOffline(false);
        setError('');
      } catch (failure) {
        if (!active()) return;
        // 拉列表失败 ≠ 没有小组：别清掉本机记住的组，直接用记住的组去拉详情
        // （「关后台再回来」时网络常常还没恢复，这里最容易误报「小组不见了」）
        const stored = readCurrentGroupId(accountId);
        if (epoch === groupEpochRef.current) {
          if (groupRef.current !== stored) groupEpochRef.current += 1;
          groupRef.current = stored;
          setCurrentGroupId(stored);
        }
        setError(messageOf(failure));
      } finally {
        if (active()) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, applyGroupList]);

  /* ---------- 组详情：首次加载 + 可见时 15 秒轮询 ---------- */
  const loadDetail = useCallback(
    async (groupId: string, options: { showLoading: boolean; gen: number }) => {
      const epoch = groupEpochRef.current;
      const request = ++detailRequestRef.current;
      const active = () => options.gen === generationRef.current &&
        epoch === groupEpochRef.current && request === detailRequestRef.current && groupRef.current === groupId;
      if (options.showLoading) setLoading(true);
      try {
        const detail = await getMotherGroup(groupId);
        if (!active()) return;
        detailRef.current = detail;
        setCurrentGroup(detail);
        saveMotherGroupCacheDetail(accountRef.current, detail);
        setOffline(false);
        setError('');
        if (!dirtyRef.current) applySelection(detail);
        nextPollAtRef.current = null;
        setNextPollAt(null);
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
          saveCurrentGroupId(accountRef.current, null);
          clearMotherGroupCacheDetail(accountRef.current, groupId);
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
    [applySelection, refreshGroups],
  );

  useEffect(() => {
    dirtyRef.current = false;
    setDraftDirty(false);
  }, [currentGroupId]);

  useEffect(() => {
    if (!accountId || !currentGroupId) {
      detailRef.current = null;
      setCurrentGroup(null);
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

  const selectGroup = useCallback((groupId: string | null) => {
    if (groupId === groupRef.current) return;
    groupEpochRef.current += 1;
    groupRef.current = groupId;
    detailRef.current = null;
    setCurrentGroupId(groupId);
    setCurrentGroup(null);
    draftRef.current = [];
    dirtyRef.current = false;
    setDraftSelectionState([]);
    setDraftDirty(false);
    setError('');
    setOffline(false);
    setLoading(false);
    saveCurrentGroupId(accountRef.current, groupId);
    nextPollAtRef.current = null;
    setNextPollAt(null);
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

  /** 「刷新 / 重试」：重新拉组列表（失败过就补上），再拉当前组详情。 */
  const refresh = useCallback(async () => {
    const account = accountRef.current;
    if (!account) return;
    const active = scope(true);
    try {
      const list = await refreshGroups();
      if (!active() || list === null) return;
      if (groupRef.current === null) applyGroupList(list, account);
      setError('');
    } catch (failure) {
      if (!active()) return;
      setError(messageOf(failure));
    }
    await reloadCurrent();
  }, [applyGroupList, refreshGroups, reloadCurrent, scope]);

  const buildDraftFor = useCallback((keys: string[]): MotherResourceDraft => {
    const { snapshots, species, catalogVersion } = inputRef.current;
    return buildMotherResource({
      snapshots,
      selectedAccountKeys: keys,
      species,
      catalogVersion,
    });
  }, []);

  const publishResource = useCallback(
    async (resource: MotherResourceDraft) => {
      const groupId = groupRef.current;
      const account = accountRef.current;
      const detail = detailRef.current;
      if (!groupId || !account || !detail) throw new Error('还没有打开小组');
      const mine = detail.members.find((member) => member.accountId === account);
      if (!mine) throw new Error('不是该组成员');
      const active = scope(true);
      const draftRevision = draftRevisionRef.current;

      await publishMotherResources(groupId, {
        baseRevision: mine.resourceRevision,
        resource,
      });
      if (!active()) return;
      if (draftRevision === draftRevisionRef.current) {
        dirtyRef.current = false;
        setDraftDirty(false);
        draftRef.current = resource.accounts.map((entry) => entry.accountKey);
        setDraftSelectionState(draftRef.current);
      }
      await reloadCurrent();
    },
    [reloadCurrent, scope],
  );

  const publish = useCallback(async () => {
    const resource = buildDraftFor(draftRef.current);
    await publishResource(resource);
  }, [buildDraftFor, publishResource]);

  const stopSharing = useCallback(async () => {
    const resource = emptyDraft(inputRef.current.catalogVersion);
    await publishResource(resource);
  }, [publishResource]);

  const createGroup = useCallback(
    async (name: string, displayName: string) => {
      const account = accountRef.current;
      if (!account) throw new Error('未登录');
      const active = scope(true);
      const created = await createMotherGroup({ name, displayName });
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      saveInviteCode(account, created.group.id, created.inviteCode);
      await refreshGroups();
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      selectGroup(created.group.id);
      return { groupId: created.group.id, inviteCode: created.inviteCode };
    },
    [refreshGroups, selectGroup, scope],
  );

  const joinGroup = useCallback(
    async (inviteCode: string, displayName: string) => {
      const active = scope(true);
      const groupId = await joinMotherGroup({ inviteCode, displayName });
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      await refreshGroups();
      if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
      selectGroup(groupId);
      return groupId;
    },
    [refreshGroups, selectGroup, scope],
  );

  const updateProfile = useCallback(
    async (displayName: string) => {
      const groupId = groupRef.current;
      if (!groupId) throw new Error('还没有打开小组');
      const active = scope(true);
      await updateMotherGroupProfile(groupId, displayName);
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
    const code = await resetMotherGroupInvite(groupId);
    if (!active()) throw new Error('身份或小组已切换，请在原身份中查看操作结果');
    if (account) saveInviteCode(account, groupId, code);
    return code;
  }, [scope]);

  const leave = useCallback(async () => {
    const groupId = groupRef.current;
    const account = accountRef.current;
    if (!groupId) return;
    const active = scope(true);
    await leaveMotherGroup(groupId);
    if (!active()) return;
    if (account) saveCurrentGroupId(account, null);
    clearMotherGroupCacheDetail(account, groupId);
    selectGroup(null);
    await refreshGroups().catch(() => {});
  }, [refreshGroups, selectGroup, scope]);

  const dissolve = useCallback(async () => {
    const groupId = groupRef.current;
    const account = accountRef.current;
    if (!groupId) return;
    const active = scope(true);
    await dissolveMotherGroup(groupId);
    if (!active()) return;
    if (account) saveCurrentGroupId(account, null);
    clearMotherGroupCacheDetail(account, groupId);
    selectGroup(null);
    await refreshGroups().catch(() => {});
  }, [refreshGroups, selectGroup, scope]);

  const myMember = useMemo(
    () =>
      currentGroup?.members.find((member) => member.accountId === accountId) ?? null,
    [currentGroup, accountId],
  );

  const publishPreview = useMemo<MotherPublishPreview>(() => {
    const { snapshots, species, catalogVersion } = input;
    const localKeys = new Set(
      snapshots.map((snapshot) => snapshot.accountKey ?? accountKeyOf(snapshot)),
    );
    const missingAccountKeys = draftSelection.filter((key) => !localKeys.has(key));

    if (missingAccountKeys.length > 0) {
      return {
        resource: null,
        diff: null,
        missingAccountKeys,
        error: '本机缺少这些账号的数据：先导入或云同步，或在选号里撤回',
      };
    }
    if (draftSelection.length === 0) {
      return { resource: null, diff: null, missingAccountKeys: [], error: '' };
    }
    try {
      const resource = buildMotherResource({
        snapshots,
        selectedAccountKeys: draftSelection,
        species,
        catalogVersion,
      });
      const base = myMember?.resource ?? emptyDraft(catalogVersion);
      return {
        resource,
        diff: diffMotherResources(base, resource),
        missingAccountKeys: [],
        error: '',
      };
    } catch (failure) {
      return {
        resource: null,
        diff: null,
        missingAccountKeys: [],
        error: messageOf(failure),
      };
    }
  }, [input, draftSelection, myMember]);

  return {
    accountId,
    groups,
    groupsLoaded,
    currentGroupId,
    currentGroup,
    loading,
    error,
    offline,
    nextPollAt,
    draftSelection,
    draftDirty,
    publishPreview,
    myMember,
    selectGroup,
    setDraftSelection,
    refresh,
    createGroup,
    joinGroup,
    publish,
    stopSharing,
    updateProfile,
    resetInvite,
    leave,
    dissolve,
    clearError: () => setError(''),
  };
}

/** 供 UI 判断「这份草稿和服务器上的摘要是否同一份覆盖」。 */
export const sameCoverage = (a: MotherResourceDraft | null, b: MotherResourceDraft | null): boolean =>
  a != null && b != null && motherResourceSignature(a) === motherResourceSignature(b);

export { MotherGroupsApiError };
