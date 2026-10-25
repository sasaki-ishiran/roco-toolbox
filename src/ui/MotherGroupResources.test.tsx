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
  test('小组口径显示本组真实目标，不再写死大块头 +100', () => {
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        target={{
          kind: 'mother',
          criteriaId: 'mother-v2-test',
          mode: 'medal',
          bodies: ['大块头'],
          voices: ['婉转声'],
          catalogVersion: FIXTURE_CATALOG_VERSION,
          requireRecommendedNatures: true,
        }}
      />,
    );
    expect(screen.getByTestId('mother-criteria')).toHaveTextContent(
      '母 · 大块头 · 婉转声 · 追双牌 · 推荐性格',
    );
  });

  test('三视图顺序：我缺的 / 我能补的 / 共同寻找', () => {
    renderResources();
    const groupControl = screen.getByRole('group', { name: '小组资源视图' });
    const labels = Array.from(groupControl.querySelectorAll('button')).map((item) => item.textContent);
    expect(labels).toEqual(['我缺的', '我能补的', '共同寻找']);
  });

  test('成员筛选在我缺的中只展示该成员拥有的资源，并使用页内下拉栏', () => {
    render(<MotherGroupResources group={{ ...group, members: [member('A', resourceWith([])), member('B', resourceWith([101])), member('C', resourceWith([201]))] }} viewerAccountId="A" species={catalog} catalogVersion={FIXTURE_CATALOG_VERSION} />);
    const filter = screen.getByTestId('mother-member-filter');
    expect(filter.tagName).toBe('BUTTON');
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(1);
    expect(screen.getByTestId('mother-resource-row')).toHaveTextContent('火花');
    expect(filter).toHaveAttribute('aria-expanded', 'false');
    // 我没发布过会补的母本 → 「我能补的」为空，不会把别人的东西算成我能补
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
    expect(screen.getByText('组员暂时没有需要你补的母本')).toBeTruthy();
  });

  test('我能补的：按「缺这只的人」筛选成员', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    // A 是拥有者，不是缺口 → 选 A 看不到东西
    fireEvent.click(screen.getByTestId('mother-member-filter'));
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
    // B 缺火花 → 选 B 看到我能补给他的火花
    fireEvent.click(screen.getByTestId('mother-member-filter'));
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    const rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
    // C 未发布（未知）→ 不算缺口
    fireEvent.click(screen.getByTestId('mother-member-filter'));
    fireEvent.click(screen.getByRole('radio', { name: 'C' }));
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
  });

  test('我能补的：选谁就只看他缺的（B 缺火花、D 缺水蓝蓝）', () => {
    const groupWithTwo: MotherGroupDetail = {
      group: group.group,
      members: [
        member('A', resourceWith([101, 201], { accounts: [sharedAccount(1001, [101, 201])] })),
        member('B', resourceWith([201], { accounts: [sharedAccount(1002, [201])] })),
        member('D', resourceWith([101], { accounts: [sharedAccount(1004, [101])] })),
      ],
    };
    render(
      <MotherGroupResources
        group={groupWithTwo}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('mother-member-filter'));
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(1);
    expect(screen.getByTestId('mother-resource-row')).toHaveTextContent('火花');

    fireEvent.click(screen.getByTestId('mother-member-filter'));
    fireEvent.click(screen.getByRole('radio', { name: 'D' }));
    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(1);
    expect(screen.getByTestId('mother-resource-row')).toHaveTextContent('水蓝蓝');
  });

  test('共同寻找：多选成员只看他们共同缺的，并记住选择', () => {
    // E 几乎全收集：默认「全组」范围下共同寻找会被他一个人补齐，看不出我们真正缺什么
    const withCollector: MotherGroupDetail = {
      group: group.group,
      members: [
        member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
        member('B', resourceWith([101], { accounts: [sharedAccount(1002, [101])] })),
        member('E', resourceWith([101, 201], { accounts: [sharedAccount(1005, [101, 201])] })),
        member('C', null),
      ],
    };
    render(
      <MotherGroupResources
        group={withCollector}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    const names = (): string[] =>
      screen.queryAllByTestId('mother-resource-row').map((row) => row.textContent ?? '');

    fireEvent.click(screen.getByTestId('mother-view-seeking'));
    // 全组范围：水蓝蓝被 E 补齐，不算共同缺口
    expect(names().some((text) => text.includes('水蓝蓝'))).toBe(false);

    // 只选 A、B：水蓝蓝是两人共同缺的（E 有也不影响他们的缺口）
    fireEvent.click(screen.getByTestId('mother-seeking-members'));
    fireEvent.click(screen.getByTestId('mother-seeking-member-A'));
    fireEvent.click(screen.getByTestId('mother-seeking-member-B'));
    expect(names().some((text) => text.includes('水蓝蓝'))).toBe(true);

    // 切视图再回来，选择还在
    fireEvent.click(screen.getByTestId('mother-view-missing'));
    fireEvent.click(screen.getByTestId('mother-view-seeking'));
    expect(names().some((text) => text.includes('水蓝蓝'))).toBe(true);
    expect(screen.getByTestId('mother-seeking-members')).toHaveTextContent('A、B');
    // 清空 = 回到全组范围
    fireEvent.click(screen.getByTestId('mother-seeking-members'));
    fireEvent.click(screen.getByTestId('mother-seeking-member-all'));
    expect(names().some((text) => text.includes('水蓝蓝'))).toBe(false);
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

  test('我能补的：只显示拥有者昵称（不显示来源账号）、缺口和未知人数', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-mine'));

    const fire = screen
      .getAllByTestId('mother-resource-row')
      .find((row) => row.textContent?.includes('火花'));
    expect(fire).toBeTruthy();
    expect(fire).toHaveTextContent('有：A');
    expect(fire).not.toHaveTextContent('账号1001');
    expect(fire).toHaveTextContent('缺：B，另 1 人待发布/更新');
  });

  test('搜索按蛋聚合：搜「火神」能命中「火花」那颗蛋', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-mine'));
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
