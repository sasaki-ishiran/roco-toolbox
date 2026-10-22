import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useSnapshots } from './useSnapshots';
import { useSwapChecklist } from './swapChecklistStore';
import { useMotherGroups, type MotherGroupsHook } from './useMotherGroups';
import { MotherSharing } from './MotherSharing';
import {
  member,
  resourceWith,
  sharedAccount,
} from '../test/fixtures/motherSharing';
import type { MotherGroupDetail } from '../shared/motherGroups';

vi.mock('./useSnapshots', () => ({ useSnapshots: vi.fn() }));
vi.mock('./swapChecklistStore', () => ({ useSwapChecklist: vi.fn() }));
vi.mock('./useMotherGroups', () => ({ useMotherGroups: vi.fn() }));

const detail: MotherGroupDetail = {
  group: { id: 'g1', name: '周末互换', ownerAccountId: 'A', createdAt: 1 },
  members: [member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })), member('B', null)],
};

const hookOf = (overrides: Partial<MotherGroupsHook> = {}): MotherGroupsHook => ({
  accountId: 'A',
  groups: [{ id: 'g1', name: '周末互换', ownerAccountId: 'A', memberCount: 2 }],
  currentGroupId: 'g1',
  currentGroup: detail,
  loading: false,
  error: '',
  offline: false,
  nextPollAt: null,
  draftSelection: ['uid:1001'],
  draftDirty: false,
  publishPreview: { resource: null, diff: null, missingAccountKeys: [], error: '' },
  myMember: detail.members[0],
  selectGroup: vi.fn(),
  setDraftSelection: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  createGroup: vi.fn().mockResolvedValue({ groupId: 'g1', inviteCode: 'ABCD2345' }),
  joinGroup: vi.fn().mockResolvedValue('g1'),
  publish: vi.fn().mockResolvedValue(undefined),
  stopSharing: vi.fn().mockResolvedValue(undefined),
  updateProfile: vi.fn().mockResolvedValue(undefined),
  resetInvite: vi.fn().mockResolvedValue('NEWC2345'),
  leave: vi.fn().mockResolvedValue(undefined),
  dissolve: vi.fn().mockResolvedValue(undefined),
  clearError: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(useSnapshots).mockReturnValue({ snapshots: [], loaded: true });
  vi.mocked(useSwapChecklist).mockReturnValue({ code: '' } as ReturnType<typeof useSwapChecklist>);
  vi.mocked(useMotherGroups).mockReturnValue(hookOf());
});

describe('MotherSharing 入口与状态', () => {
  test('没有本地账号也能进入；未登录可跳到账号面板，待加入码保留', () => {
    vi.mocked(useMotherGroups).mockReturnValue(hookOf({ accountId: null, groups: [], currentGroupId: null, currentGroup: null }));
    const onGoAccount = vi.fn();
    render(<MotherSharing onGoAccount={onGoAccount} />);

    expect(screen.getByTestId('mother-sharing')).toBeVisible();
    fireEvent.change(screen.getByTestId('mother-pending-invite'), { target: { value: 'abcd2345' } });
    expect(window.localStorage.getItem('roco.motherGroups.pendingInvite')).toBe('ABCD2345');

    fireEvent.click(screen.getByTestId('mother-login'));
    expect(onGoAccount).toHaveBeenCalledTimes(1);
  });

  test('已登录：显示小组、发布面板、三视图与成员；本机无数据时不能发布', () => {
    render(<MotherSharing onGoAccount={vi.fn()} />);

    expect(screen.getByTestId('mother-group-card')).toHaveTextContent('周末互换');
    expect(screen.getByTestId('mother-no-local-data')).toBeVisible();
    expect(screen.getByTestId('mother-resources')).toBeVisible();
    expect(screen.getByTestId('mother-members')).toBeVisible();
    expect(screen.getByTestId('mother-criteria')).toHaveTextContent('母 · 大块头 · +100dB');
  });

  test('本机有旧版双人清单时显示兼容入口', () => {
    vi.mocked(useSwapChecklist).mockReturnValue({ code: 'OLD12345' } as ReturnType<typeof useSwapChecklist>);
    const onOpenLegacy = vi.fn();
    render(<MotherSharing onGoAccount={vi.fn()} onOpenLegacy={onOpenLegacy} />);
    fireEvent.click(screen.getByTestId('mother-legacy-link'));
    expect(onOpenLegacy).toHaveBeenCalledTimes(1);
  });

  test('登录后未加入任何组时给出新建/加入提示', () => {
    vi.mocked(useMotherGroups).mockReturnValue(
      hookOf({ groups: [], currentGroupId: null, currentGroup: null }),
    );
    render(<MotherSharing onGoAccount={vi.fn()} />);
    expect(screen.getByTestId('mother-no-groups')).toBeVisible();
    expect(screen.getByTestId('mother-group-setup')).toBeVisible();
    expect(screen.queryByTestId('mother-criteria')).not.toBeInTheDocument();
  });
});
