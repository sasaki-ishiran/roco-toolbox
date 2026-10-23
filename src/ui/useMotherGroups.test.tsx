import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/motherGroups';
import { MotherGroupsApiError } from '../api/motherGroups';
import { clearSession, markSynced } from '../api/session';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  member,
  mother,
  resourceWith,
  sharedAccount,
  snapshot,
} from '../test/fixtures/motherSharing';
import type { MotherGroupDetail, SharedMotherAccount } from '../shared/motherGroups';
import { saveCurrentGroupId } from './motherGroupStore';
import { POLL_INTERVAL_MS, useMotherGroups } from './useMotherGroups';

vi.mock('../api/motherGroups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/motherGroups')>();
  return {
    ...actual,
    listMotherGroups: vi.fn(),
    getMotherGroup: vi.fn(),
    createMotherGroup: vi.fn(),
    joinMotherGroup: vi.fn(),
    publishMotherResources: vi.fn(),
    updateMotherGroupProfile: vi.fn(),
    resetMotherGroupInvite: vi.fn(),
    leaveMotherGroup: vi.fn(),
    dissolveMotherGroup: vi.fn(),
  };
});

const summary = { id: 'g1', name: '测试组', ownerAccountId: 'A', memberCount: 2 };

const detailOf = (accounts: SharedMotherAccount[] = [sharedAccount(1001, [101])]): MotherGroupDetail => ({
  group: { id: 'g1', name: '测试组', ownerAccountId: 'A', createdAt: 1 },
  members: [member('A', resourceWith([], { accounts })), member('B', null)],
});

const input = {
  snapshots: [snapshot(1001, '甲', [mother(101)])],
  species: catalog,
  catalogVersion: FIXTURE_CATALOG_VERSION,
};

/** 把当前微任务队列跑完（配合 fake timers，不用 waitFor）。 */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const switchToB = () => {
  window.localStorage.setItem('roco.accountId', 'B');
  window.localStorage.setItem('roco.deviceToken', 'token-B');
  markSynced(0);
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem('roco.accountId', 'A');
  window.localStorage.setItem('roco.deviceToken', 'token-1');
  vi.mocked(api.listMotherGroups).mockResolvedValue([summary]);
  vi.mocked(api.getMotherGroup).mockResolvedValue(detailOf());
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('useMotherGroups：会话、轮询与草稿', () => {
  test('同身份并发刷新中，旧列表失败不能覆盖较新成功结果', async () => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    const old = deferred<Awaited<ReturnType<typeof api.listMotherGroups>>>();
    vi.mocked(api.listMotherGroups).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    await act(async () => { await result.current.refresh(); });
    vi.mocked(api.getMotherGroup).mockRejectedValueOnce(new Error('Failed to fetch'));
    await act(async () => { old.reject(new Error('过时的错误')); await pending; });
    expect(result.current.error).toBe('');
  });

  test('发布过程中修改同组草稿，成功响应也不能覆盖新选号', async () => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    const old = deferred<Awaited<ReturnType<typeof api.publishMotherResources>>>();
    vi.mocked(api.publishMotherResources).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.publish(); });
    act(() => result.current.setDraftSelection([]));
    await act(async () => { old.resolve({ resourceRevision: 2, publishedAt: 1 }); await pending; });
    expect(result.current.draftSelection).toEqual([]);
    expect(result.current.draftDirty).toBe(true);
  });

  test.each(['leave', 'dissolve'] as const)('%s晚到不能退出后来选中的小组', async (action) => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    const old = deferred<void>();
    const mutation = action === 'leave' ? api.leaveMotherGroup : api.dissolveMotherGroup;
    vi.mocked(mutation).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current[action](); });
    act(() => result.current.selectGroup('g2'));
    await flush();
    await act(async () => { old.resolve(); await pending; });
    expect(result.current.currentGroupId).toBe('g2');
  });

  test('无权限后的补拉列表也必须丢弃旧身份响应', async () => {
    const old = deferred<Awaited<ReturnType<typeof api.listMotherGroups>>>();
    vi.mocked(api.listMotherGroups).mockResolvedValueOnce([summary]).mockReturnValueOnce(old.promise);
    vi.mocked(api.getMotherGroup).mockRejectedValueOnce(new MotherGroupsApiError(403, 'NOT_MEMBER', '不是成员'));
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    vi.mocked(api.listMotherGroups).mockResolvedValue([]);
    act(switchToB);
    await flush();
    await act(async () => { old.resolve([summary]); });
    expect(result.current.groups).toEqual([]);
    expect(result.current.accountId).toBe('B');
  });

  test('手动刷新晚到不能覆盖新身份列表，即使中间退出后又登录', async () => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    const old = deferred<Awaited<ReturnType<typeof api.listMotherGroups>>>();
    vi.mocked(api.listMotherGroups).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    const b = { ...summary, id: 'gB', ownerAccountId: 'B' };
    vi.mocked(api.listMotherGroups).mockResolvedValue([b]);
    act(() => { clearSession(); switchToB(); });
    await flush();
    await act(async () => { old.resolve([summary]); await pending; });
    expect(result.current.accountId).toBe('B');
    expect(result.current.groups).toEqual([b]);
    expect(result.current.currentGroupId).toBe('gB');
  });

  test('旧身份刷新失败不能把错误写进新身份', async () => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    const old = deferred<Awaited<ReturnType<typeof api.listMotherGroups>>>();
    vi.mocked(api.listMotherGroups).mockReturnValueOnce(old.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    act(switchToB);
    await flush();
    await act(async () => { old.reject(new Error('A 的旧错误')); await pending; });
    expect(result.current.error).toBe('');
  });

  test('旧身份创建小组响应不能选中新身份无权访问的组', async () => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    const old = deferred<Awaited<ReturnType<typeof api.createMotherGroup>>>();
    vi.mocked(api.createMotherGroup).mockReturnValueOnce(old.promise);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.createGroup('旧组', '甲').catch((e: unknown) => e); });
    const b = { ...summary, id: 'gB', ownerAccountId: 'B' };
    vi.mocked(api.listMotherGroups).mockResolvedValue([b]);
    act(switchToB);
    await flush();
    await act(async () => { old.resolve({ group: { id: 'oldCreated', name: '旧组', ownerAccountId: 'A', createdAt: 1 }, inviteCode: 'ABCD2345' }); await pending; });
    expect(result.current.currentGroupId).toBe('gB');
    expect(window.localStorage.getItem('roco.motherGroups:B')).not.toContain('oldCreated');
  });

  test('旧组发布晚到不能清掉新组的选号草稿', async () => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    const old = deferred<Awaited<ReturnType<typeof api.publishMotherResources>>>();
    vi.mocked(api.publishMotherResources).mockReturnValueOnce(old.promise);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.publish().catch((e: unknown) => e); });
    vi.mocked(api.getMotherGroup).mockResolvedValue({ ...detailOf(), group: { ...detailOf().group, id: 'g2' } });
    act(() => result.current.selectGroup('g2'));
    await flush();
    act(() => result.current.setDraftSelection(['uid:2002']));
    await act(async () => { old.resolve({ resourceRevision: 2, publishedAt: 1 }); await pending; });
    expect(result.current.currentGroupId).toBe('g2');
    expect(result.current.draftDirty).toBe(true);
    expect(result.current.draftSelection).toEqual(['uid:2002']);
  });

  test('切组后再切回，第一次的旧详情不能覆盖较新详情', async () => {
    const old = deferred<MotherGroupDetail>();
    vi.mocked(api.getMotherGroup).mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    act(() => result.current.selectGroup('g2'));
    await flush();
    act(() => result.current.selectGroup('g1'));
    await flush();
    const current = result.current.currentGroup;
    await act(async () => { old.resolve({ ...detailOf(), group: { ...detailOf().group, name: '旧详情' } }); });
    expect(result.current.currentGroup).toEqual(current);
  });

  test('缺失账号明确撤回后可发布剩余账号，全部撤回使用停止共享', async () => {
    vi.mocked(api.getMotherGroup).mockResolvedValue(detailOf([sharedAccount(1001, [101]), sharedAccount(2002, [201])]));
    vi.mocked(api.publishMotherResources).mockResolvedValue({ resourceRevision: 2, publishedAt: 1 });
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    act(() => result.current.setDraftSelection(['uid:1001']));
    expect(result.current.publishPreview.error).toBe('');
    await act(async () => { await result.current.publish(); });
    expect(api.publishMotherResources).toHaveBeenLastCalledWith('g1', expect.objectContaining({ resource: expect.objectContaining({ accounts: [expect.objectContaining({ accountKey: 'uid:1001' })] }) }));
    await act(async () => { await result.current.stopSharing(); });
    expect(api.publishMotherResources).toHaveBeenLastCalledWith('g1', expect.objectContaining({ resource: expect.objectContaining({ accounts: [] }) }));
  });

  test('打开时恢复上次的组，并把服务器选号带进草稿', async () => {
    saveCurrentGroupId('A', 'g1');
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();

    expect(result.current.currentGroupId).toBe('g1');
    expect(result.current.currentGroup?.group.name).toBe('测试组');
    expect(result.current.draftSelection).toEqual(['uid:1001']);
    expect(result.current.publishPreview.missingAccountKeys).toEqual([]);
  });

  test('可见时每 15 秒拉一次；隐藏时不拉；恢复可见立即拉', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    renderHook(() => useMotherGroups(input));
    await flush();
    expect(api.getMotherGroup).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    await flush();
    expect(api.getMotherGroup).toHaveBeenCalledTimes(2);

    visibility.mockReturnValue('hidden');
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    await flush();
    expect(api.getMotherGroup).toHaveBeenCalledTimes(2);

    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(api.getMotherGroup).toHaveBeenCalledTimes(3);
  });

  test('退出登录后晚到的详情不能恢复旧组', async () => {
    let resolveDetail: ((value: MotherGroupDetail) => void) | null = null;
    vi.mocked(api.getMotherGroup).mockReturnValueOnce(
      new Promise<MotherGroupDetail>((resolve) => {
        resolveDetail = resolve;
      }),
    );

    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    expect(result.current.currentGroup).toBeNull();

    act(() => {
      clearSession();
    });
    await flush();
    expect(result.current.accountId).toBeNull();

    await act(async () => {
      resolveDetail?.(detailOf());
      await Promise.resolve();
    });
    await flush();
    expect(result.current.currentGroup).toBeNull();
    expect(result.current.groups).toEqual([]);
  });

  test('429 按 Retry-After 退避，不在 15 秒内继续撞限流', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getMotherGroup)
      .mockRejectedValueOnce(new MotherGroupsApiError(429, 'RATE_LIMITED', '太频繁', 60))
      .mockResolvedValue(detailOf());

    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    expect(result.current.nextPollAt).not.toBeNull();
    expect(api.getMotherGroup).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    await flush();
    expect(api.getMotherGroup).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });
    await flush();
    expect(api.getMotherGroup).toHaveBeenCalledTimes(2);
  });

  test('发布冲突保留草稿，不自动用旧草稿套新版本重试', async () => {
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();

    act(() => {
      result.current.setDraftSelection(['uid:1001']);
    });
    expect(result.current.draftDirty).toBe(true);

    vi.mocked(api.publishMotherResources).mockRejectedValueOnce(
      new MotherGroupsApiError(409, 'REVISION_CONFLICT', '版本冲突'),
    );
    await act(async () => {
      await expect(result.current.publish()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    });

    expect(result.current.draftSelection).toEqual(['uid:1001']);
    expect(result.current.draftDirty).toBe(true);
    expect(api.publishMotherResources).toHaveBeenCalledTimes(1);
  });

  test('服务器记录过、本机没有的账号会阻止发布', async () => {
    vi.mocked(api.getMotherGroup).mockResolvedValue(detailOf([sharedAccount(2002, [201])]));
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();

    expect(result.current.draftSelection).toEqual(['uid:2002']);
    expect(result.current.publishPreview.missingAccountKeys).toEqual(['uid:2002']);
    expect(result.current.publishPreview.resource).toBeNull();
  });

  test('首次读取失败时不计算缺口（currentGroup 为 null）', async () => {
    vi.mocked(api.listMotherGroups).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();

    expect(result.current.error).toBe('网络连接失败，请检查网络后重试');
    expect(result.current.currentGroup).toBeNull();
    expect(result.current.groups).toEqual([]);
    expect(result.current.groupsLoaded).toBe(false);
  });

  test('业务错误文案原样透出（不把所有失败都说成网络问题）', async () => {
    vi.mocked(api.listMotherGroups).mockRejectedValueOnce(new Error('太频繁了，稍后再试'));
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    expect(result.current.error).toBe('太频繁了，稍后再试');
  });

  test('冷启动拉不到组列表时，保留本机记住的组并继续拉详情', async () => {
    saveCurrentGroupId('A', 'g1');
    vi.mocked(api.listMotherGroups).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();

    expect(result.current.groupsLoaded).toBe(false);
    expect(result.current.currentGroupId).toBe('g1');
    expect(result.current.currentGroup?.group.name).toBe('测试组');
    expect(result.current.draftSelection).toEqual(['uid:1001']);
  });

  test('重试会重新拉组列表并补齐 groupsLoaded', async () => {
    vi.mocked(api.listMotherGroups).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useMotherGroups(input));
    await flush();
    expect(result.current.groupsLoaded).toBe(false);

    await act(async () => {
      await result.current.refresh();
    });
    await flush();

    expect(result.current.groupsLoaded).toBe(true);
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.currentGroupId).toBe('g1');
  });
});
