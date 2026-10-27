import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MotherGroupMembers } from './MotherGroupMembers';
import {
  FIXTURE_CATALOG_VERSION,
  member,
  resourceWith,
  sharedAccount,
} from '../test/fixtures/motherSharing';
import type { CollectionDemand } from '../shared/collectionGroups';
import type { MotherGroupDetail } from '../shared/motherGroups';

const DAY_MS = 86_400_000;

/** C 的账号导出时间是 10 天前：新鲜度按导出时间算，不是发布时间。 */
const STALE_EXPORT = new Date(Date.now() - 10 * DAY_MS).toISOString();

const group: MotherGroupDetail = {
  group: { id: 'g1', name: '组', ownerAccountId: 'A', createdAt: 1 },
  members: [
    member('A', resourceWith([101])),
    member('B', resourceWith([101])),
    member('C', resourceWith([101], { accounts: [sharedAccount(9001, [101], { sourceExportedAt: STALE_EXPORT })] })),
  ],
};

const demand = (over: Partial<CollectionDemand>): CollectionDemand => ({
  groupId: 'g1',
  demanderAccountId: 'A',
  eggGameId: 101,
  nature: '固执',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'open',
  claimerAccountId: null,
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const renderMembers = (props: Partial<ComponentProps<typeof MotherGroupMembers>> = {}) =>
  render(
    <MotherGroupMembers
      group={group}
      accountId="A"
      catalogVersion={FIXTURE_CATALOG_VERSION}
      inviteCode={null}
      demands={[
        demand({ status: 'done', claimerAccountId: 'B' }),
        demand({ status: 'done', claimerAccountId: 'B', eggGameId: 102 }),
        demand({ status: 'claimed', claimerAccountId: 'C' }),
      ]}
      onRename={vi.fn().mockResolvedValue(undefined)}
      onResetInvite={vi.fn().mockResolvedValue('NEWCODE1')}
      onRemove={vi.fn().mockResolvedValue(undefined)}
      onLeave={vi.fn().mockResolvedValue(undefined)}
      onDissolve={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );

const expand = () => fireEvent.click(screen.getByTestId('mother-members-toggle'));

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MotherGroupMembers 已结单与移除', () => {
  test('默认收起，点标题才展开成员列表', () => {
    renderMembers();
    expect(screen.queryByTestId('mother-member-completed')).toBeNull();
    expand();
    expect(screen.getAllByTestId('mother-member-completed').length).toBeGreaterThan(0);
  });

  test('右侧「邀请码 · 管理」也能展开成员', () => {
    renderMembers();
    expect(screen.queryByTestId('mother-member-completed')).toBeNull();
    fireEvent.click(screen.getByTestId('mother-members-toggle-side'));
    expect(screen.getAllByTestId('mother-member-completed').length).toBeGreaterThan(0);
  });

  test('组长能看到每个人的已结单数，并能移除组员（不能移除自己和组长）', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    renderMembers({ onRemove });
    expand();

    const rowOf = (id: string) =>
      screen.getByTestId(`mother-member-remove-${id}`).closest('li') as HTMLElement;

    const bRow = rowOf('B');
    expect(within(bRow).getByTestId('mother-member-completed')).toHaveTextContent('已结 2 单');
    expect(within(bRow).getByTestId('mother-member-updated')).toHaveTextContent('更新于');

    fireEvent.click(screen.getByTestId('mother-member-remove-B'));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('B'));
    expect(window.confirm).toHaveBeenCalled();

    expect(screen.queryByTestId('mother-member-remove-A')).toBeNull();
  });

  test('非组长看不到移除入口，但能看到已结单数', () => {
    renderMembers({ accountId: 'B' });
    expand();
    expect(screen.queryByTestId('mother-member-remove-A')).toBeNull();
    expect(screen.queryByTestId('mother-member-remove-C')).toBeNull();
    const bRow = screen
      .getAllByTestId('mother-member-row')
      .find((row) => row.textContent?.includes('B'))!
      .closest('li') as HTMLElement;
    expect(within(bRow).getByTestId('mother-member-completed')).toHaveTextContent('已结 2 单');
  });

  test('超过 7 天没更新的成员标红显示「N 天未更新」', () => {
    renderMembers();
    expand();
    const cRow = screen.getByTestId('mother-member-remove-C').closest('li') as HTMLElement;
    const updated = within(cRow).getByTestId('mother-member-updated');
    expect(updated).toHaveTextContent('10 天未更新');
    expect(updated.className).toContain('text-rose-600');
  });

  test('成员发布时间缺失时只显示发布状态', () => {
    render(
      <MotherGroupMembers
        group={{
          group: group.group,
          members: [member('A', resourceWith([101])), member('B', null)],
        }}
        accountId="A"
        catalogVersion={FIXTURE_CATALOG_VERSION}
        inviteCode={null}
        onRename={vi.fn()}
        onResetInvite={vi.fn()}
        onRemove={vi.fn()}
        onLeave={vi.fn()}
        onDissolve={vi.fn()}
      />,
    );
    expand();
    expect(screen.getByText('尚未发布')).toBeTruthy();
    expect(screen.queryAllByTestId('mother-member-updated')).toHaveLength(1);
  });
});
