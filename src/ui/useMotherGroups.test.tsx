import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as api from '../api/motherGroups';
import { MotherGroupsApiError } from '../api/motherGroups';
import { clearSession } from '../api/session';
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

beforeEach(() => {
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
