import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearGroupListSession } from './listViewStore';
import { MotherGroupResources } from './MotherGroupResources';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  member,
  resourceWith,
  sharedAccount,
} from '../test/fixtures/motherSharing';
import type { MotherGroupDetail } from '../shared/motherGroups';

const group: MotherGroupDetail = {
  group: { id: 'g1', name: '组', ownerAccountId: 'A', createdAt: 1 },
  members: [
    member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
    member('B', resourceWith([], { accounts: [sharedAccount(1002, [])] })),
    member('C', null),
  ],
};

const renderResources = () =>
  render(
    <MotherGroupResources
      group={group}
      viewerAccountId="A"
      species={catalog}
      catalogVersion={FIXTURE_CATALOG_VERSION}
    />,
  );

beforeEach(() => {
  clearGroupListSession();
});

describe('MotherGroupResources 三视图', () => {
  test('成员筛选在我缺的中只展示该成员拥有的资源，并使用页内下拉栏', () => {
    render(<MotherGroupResources group={{ ...group, members: [member('A', resourceWith([])), member('B', resourceWith([101])), member('C', resourceWith([201]))] }} viewerAccountId="A" species={catalog} catalogVersion={FIXTURE_CATALOG_VERSION} />);
    const filter = screen.getByTestId('mother-member-filter');
    expect(filter.tagName).toBe('BUTTON');
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(1);
    expect(screen.getByTestId('mother-resource-row')).toHaveTextContent('火花');
    expect(filter).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByTestId('mother-view-all'));
    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(1);
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole('radio', { name: '全部成员' }));
    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(3);
  });

  test('全部资源按成员筛选：只展示该成员拥有的资源', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-all'));
    fireEvent.click(screen.getByTestId('mother-member-filter'));
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    const rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
    fireEvent.click(screen.getByTestId('mother-member-filter'));
    fireEvent.click(screen.getByRole('radio', { name: 'C' }));
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
  });

  test('共同寻找：全员确认后可认领，已认领显示负责人并可释放', async () => {
    const claim = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="B"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        tasksConfirmed
        tasks={[
          {
            groupId: 'g1',
            targetRevision: 0,
            targetKey: 'mother:201',
            round: 0,
            status: 'claimed',
            ownerAccountId: 'A',
            version: 1,
            updatedAt: 1,
            closedAt: null,
          },
        ]}
        isOwner={false}
        onClaimTask={claim}
        onReleaseTask={release}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-seeking'));
    // 201 已被 A 认领 → 显示负责人；101 无人认领 → 可以认领
    expect(screen.getByText('负责人：A')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mother-task-claim'));
    await waitFor(() => expect(claim).toHaveBeenCalled());
  });

  test('共同寻找：有成员未发布时显示待确认，不能认领', () => {
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        tasksConfirmed={false}
        tasksPendingMemberIds={['C']}
        onClaimTask={vi.fn()}
        onReleaseTask={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-seeking'));
    expect(screen.queryAllByTestId('mother-task-claim')).toHaveLength(0);
    expect(screen.getAllByText(/待确认/).length).toBeGreaterThan(0);
  });

  test('我缺的：已有人拥有的在前，无人拥有的要限定「已发布成员均无」', () => {
    renderResources();
    const rows = screen.getAllByTestId('mother-resource-row');
    const text = rows.map((row) => row.textContent).join('\n');
    expect(text).toContain('水蓝蓝');
    expect(text).toContain('纯母种');
    expect(text).toContain('已发布成员均无，另 1 人待发布/更新');
    expect(text).not.toContain('火花');
  });

  test('小组资源：显示拥有者与来源账号、缺口和未知人数', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-all'));

    const fire = screen
      .getAllByTestId('mother-resource-row')
      .find((row) => row.textContent?.includes('火花'));
    expect(fire).toBeTruthy();
    expect(fire).toHaveTextContent('有：A（账号1001）');
    expect(fire).toHaveTextContent('缺：B，另 1 人待发布/更新');
  });

  test('搜索按蛋聚合：搜「火神」能命中「火花」那颗蛋', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-all'));
    fireEvent.change(screen.getByTestId('mother-search'), { target: { value: '火神' } });

    const rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
  });

  test('固定口径始终显示，不受全局筛选影响', () => {
    renderResources();
    expect(screen.getByTestId('mother-criteria')).toHaveTextContent('母 · 大块头 · +100dB');
  });
});
