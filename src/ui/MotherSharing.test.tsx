import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useSnapshots } from './useSnapshots';
import { useMotherGroups, type MotherGroupsHook } from './useMotherGroups';
import { MotherSharing } from './MotherSharing';
import {
  member,
  resourceWith,
  sharedAccount,
} from '../test/fixtures/motherSharing';
import type { MotherGroupDetail } from '../shared/motherGroups';

vi.mock('./useSnapshots', () => ({ useSnapshots: vi.fn() }));
vi.mock('./useMotherGroups', () => ({ useMotherGroups: vi.fn() }));

const detail: MotherGroupDetail = {
  group: { id: 'g1', name: '周末互换', ownerAccountId: 'A', createdAt: 1 },
  members: [member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })), member('B', null)],
};

const hookOf = (overrides: Partial<MotherGroupsHook> = {}): MotherGroupsHook => ({
  accountId: 'A',
  groups: [{ id: 'g1', name: '周末互换', ownerAccountId: 'A', memberCount: 2 }],
  groupsLoaded: true,
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
  vi.mocked(useSnapshots).mockReturnValue({ snapshots: [], loaded: true, refreshError: null, refreshedAt: null });
  vi.mocked(useMotherGroups).mockReturnValue(hookOf());
});

describe('MotherSharing 入口与状态', () => {
  test('切组时可继续编辑草稿，也可明确放弃后切组', async () => {
    const hook = hookOf({ draftDirty: true, groups: [
      { id: 'g1', name: '周末互换', ownerAccountId: 'A', memberCount: 2 },
      { id: 'g2', name: '另一组', ownerAccountId: 'A', memberCount: 1 },
    ] });
    vi.mocked(useMotherGroups).mockReturnValue(hook);
    render(<MotherSharing />);
    fireEvent.click(screen.getByTestId('mother-group-g2'));
    expect(hook.selectGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(hook.selectGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('mother-group-g2'));
    fireEvent.click(screen.getByRole('button', { name: '放弃并离开' }));
    await waitFor(() => expect(hook.selectGroup).toHaveBeenCalledWith('g2'));
  });

  test('已加入小组时保留顶部切组，将新建加入表单放在资源和成员之后', () => {
    render(<MotherSharing />);
    const setup = screen.getByTestId('mother-group-setup');
    const resources = screen.getByTestId('mother-resources');
    const members = screen.getByTestId('mother-members');
    expect(resources.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(members.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('mother-group-list').compareDocumentPosition(screen.getByTestId('mother-group-card')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('当前小组摘要和成员角色统一称为组长', () => {
    render(<MotherSharing />);
    expect(screen.getByTestId('mother-group-card')).toHaveTextContent('组长 A');
    expect(screen.getByTestId('mother-members')).toHaveTextContent('组长');
    expect(screen.queryByText(/组主/)).not.toBeInTheDocument();
  });

  test('切换身份时，新建加入表单不沿用旧身份的草稿', () => {
    const { rerender } = render(<MotherSharing />);
    fireEvent.change(screen.getByTestId('mother-setup-nickname'), { target: { value: '旧身份昵称' } });
    vi.mocked(useMotherGroups).mockReturnValue(hookOf({ accountId: 'B' }));
    rerender(<MotherSharing />);
    expect(screen.getByTestId('mother-setup-nickname')).toHaveValue('');
  });

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
    fireEvent.click(screen.getByTestId('mother-edit-resources'));
    expect(screen.getByTestId('mother-no-local-data')).toBeVisible();
    expect(screen.getByTestId('mother-resources')).toBeVisible();
    expect(screen.getByTestId('mother-members')).toBeVisible();
    expect(screen.getByTestId('mother-criteria')).toHaveTextContent('母 · 大块头 · +100dB');
  });

  test('日常浏览先显示发布状态，管理选号后才展开编辑器', () => {
    render(<MotherSharing />);
    expect(screen.getByTestId('mother-publication-status')).toHaveTextContent('已发布');
    expect(screen.queryByTestId('mother-resource-editor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mother-edit-resources'));
    expect(screen.getByTestId('mother-resource-editor')).toBeVisible();
  });

  test('选号编辑器可以再次点击收起；有草稿时收起会提示继续编辑', () => {
    vi.mocked(useMotherGroups).mockReturnValue(hookOf({ draftDirty: true }));
    render(<MotherSharing />);

    fireEvent.click(screen.getByTestId('mother-edit-resources'));
    fireEvent.click(screen.getByTestId('mother-edit-resources'));
    expect(screen.queryByTestId('mother-resource-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('mother-draft-collapsed')).toHaveTextContent('有未发布的修改');
    fireEvent.click(screen.getByTestId('mother-edit-resources'));
    expect(screen.getByTestId('mother-resource-editor')).toBeVisible();
  });

  test.each(['未发布', '需更新'])('%s状态能直接进入资源编辑', (status) => {
    vi.mocked(useMotherGroups).mockReturnValue(hookOf({
      myMember: status === '未发布' ? member('A', null) : member('A', {
        ...detail.members[0].resource!, catalogVersion: 'old-version',
      }),
    }));
    render(<MotherSharing />);
    expect(screen.getByTestId('mother-publication-status')).toHaveTextContent(status);
    fireEvent.click(screen.getByTestId('mother-edit-resources'));
    expect(screen.getByTestId('mother-resource-editor')).toBeVisible();
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

  test('首次进入仍在读取时显示「正在读取」，不要立刻说读不到', () => {
    vi.mocked(useMotherGroups).mockReturnValue(hookOf({
      groups: [],
      groupsLoaded: false,
      currentGroupId: null,
      currentGroup: null,
      loading: true,
    }));
    render(<MotherSharing onGoAccount={vi.fn()} />);

    expect(screen.getByTestId('mother-groups-loading')).toHaveTextContent('正在读取你加入的小组');
    expect(screen.queryByTestId('mother-groups-unavailable')).not.toBeInTheDocument();
  });

  test('组列表拉取失败时不能说「还没有加入任何小组」，要能重试', () => {
    const hook = hookOf({
      groups: [],
      groupsLoaded: false,
      currentGroupId: null,
      currentGroup: null,
      error: '网络连接失败，请检查网络后重试',
    });
    vi.mocked(useMotherGroups).mockReturnValue(hook);
    render(<MotherSharing onGoAccount={vi.fn()} />);

    expect(screen.queryByTestId('mother-no-groups')).not.toBeInTheDocument();
    expect(screen.getByTestId('mother-groups-unavailable')).toHaveTextContent('小组还在');
    fireEvent.click(screen.getByTestId('mother-groups-retry'));
    expect(hook.refresh).toHaveBeenCalledTimes(1);
  });
});
