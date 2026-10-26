import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import type { SpeciesEntry } from '../domain/types';

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

  test('要求推荐性格时，每个蛋条目在右上角竖排标出本组要的性格（最多 2 个 + N）', () => {
    const target = {
      kind: 'mother' as const,
      criteriaId: 'mother-v2-test',
      mode: 'perfect' as const,
      bodies: ['大块头'],
      voices: ['+100'],
      catalogVersion: FIXTURE_CATALOG_VERSION,
      requireRecommendedNatures: true,
      natureOverrides: { '101': ['固执', '开朗', '胆小'] },
    };
    const { rerender } = render(
      <MotherGroupResources
        group={group}
        viewerAccountId="B"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        target={target}
      />,
    );
    const fireRow = () =>
      screen
        .getAllByTestId('mother-resource-row')
        .find((row) => row.textContent?.includes('火花'));
    expect(fireRow()).toBeTruthy();
    const naturesOf = () => within(fireRow()!).getByTestId('mother-resource-natures');
    // 竖排：最多展示 2 个，其余做成绿色小卡片 +N ▾
    expect(naturesOf()).toHaveTextContent('固执');
    expect(naturesOf()).toHaveTextContent('开朗');
    expect(naturesOf()).not.toHaveTextContent('胆小');
    const more = within(naturesOf()).getByTestId('mother-nature-more');
    expect(more).toHaveTextContent('+1');

    // 点开看全部，再收起恢复
    fireEvent.click(more);
    expect(naturesOf()).toHaveTextContent('胆小');
    expect(within(naturesOf()).queryByTestId('mother-nature-more')).toBeNull();
    fireEvent.click(within(naturesOf()).getByTestId('mother-nature-collapse'));
    expect(naturesOf()).not.toHaveTextContent('胆小');

    // 不开该口径 → 条目上不显示性格
    rerender(
      <MotherGroupResources
        group={group}
        viewerAccountId="B"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        target={{ ...target, requireRecommendedNatures: false }}
      />,
    );
    expect(fireRow()).toBeTruthy();
    expect(within(fireRow()!).queryByTestId('mother-resource-natures')).toBeNull();
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
    // 我没发布过会补的母本 / 没人发需求 → 承接中心是空态
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
    expect(screen.getByTestId('mother-intake-empty')).toHaveTextContent('当前没有组员发布需求');
  });

  test('承接中心：只列别人已发布、我能孵的需求，可直接接单', async () => {
    const claim = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          {
            groupId: 'g1',
            demanderAccountId: 'B',
            eggGameId: 101,
            nature: '固执',
            status: 'open',
            claimerAccountId: null,
            version: 0,
            createdAt: 1,
            updatedAt: 1,
          },
          // 我没有的蛋 → 不出现在承接中心
          {
            groupId: 'g1',
            demanderAccountId: 'B',
            eggGameId: 201,
            nature: '',
            status: 'open',
            claimerAccountId: null,
            version: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        onClaimDemand={claim}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    const rows = screen.getAllByTestId('mother-demand-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
    expect(rows[0]).toHaveTextContent('B 想要');
    expect(rows[0]).toHaveTextContent('固执');

    fireEvent.click(screen.getByTestId('mother-demand-claim'));
    await waitFor(() =>
      expect(claim).toHaveBeenCalledWith(
        expect.objectContaining({ eggGameId: 101, demanderAccountId: 'B', nature: '固执' }),
      ),
    );
  });

  test('承接中心：没有组员发需求时给出空态提示，不再回落到旧缺口', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    expect(screen.getByTestId('mother-intake-empty')).toHaveTextContent('当前没有组员发布需求');
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
  });

  test('我缺的：批量选中后先选性格，再发布需求', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const target = {
      kind: 'mother' as const,
      criteriaId: 'mother-v2-test',
      mode: 'perfect' as const,
      bodies: ['大块头'],
      voices: ['+100'],
      catalogVersion: FIXTURE_CATALOG_VERSION,
      requireRecommendedNatures: true,
      natureOverrides: { '201': ['胆小'] },
    };
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        target={target}
        onPublishDemand={publish}
      />,
    );
    expect(screen.getByTestId('mother-select-action')).toHaveTextContent('发需求');
    fireEvent.click(screen.getByTestId('mother-select-action'));
    expect(screen.getByTestId('mother-select-action')).toHaveTextContent('取消');
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('水蓝蓝'));
    fireEvent.click(row!);
    expect(screen.getByTestId('mother-select-action')).toHaveTextContent('发需求 1 项');
    fireEvent.click(screen.getByTestId('mother-select-action'));

    // 弹层：默认带上本组口径的性格，可以再改
    const sheet = await screen.findByTestId('demand-publish');
    expect(sheet).toHaveTextContent('水蓝蓝');
    expect(within(sheet).getByTestId('demand-nature-201-胆小')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(sheet).getByTestId('demand-nature-201-固执'));
    fireEvent.click(within(sheet).getByTestId('demand-publish-confirm'));
    await waitFor(() => expect(publish).toHaveBeenCalledWith(201, ['胆小', '固执']));
  });

  test('我缺的：发需求弹层里取消不会发布', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        onPublishDemand={publish}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-select-action'));
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('水蓝蓝'));
    fireEvent.click(row!);
    fireEvent.click(screen.getByTestId('mother-select-action'));
    const sheet = await screen.findByTestId('demand-publish');
    fireEvent.click(within(sheet).getByTestId('demand-publish-cancel'));
    await waitFor(() => expect(screen.queryByTestId('demand-publish')).toBeNull());
    expect(publish).not.toHaveBeenCalled();
  });

  test('我缺的：已发过的需求显示「已发需求」并可撤回', async () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          {
            groupId: 'g1',
            demanderAccountId: 'A',
            eggGameId: 201,
            nature: '胆小',
            status: 'open',
            claimerAccountId: null,
            version: 1,
            createdAt: 1,
            updatedAt: 1,
          },
          // 同一颗蛋的另一个性格：独立一条，已被别人接
          {
            groupId: 'g1',
            demanderAccountId: 'A',
            eggGameId: 201,
            nature: '固执',
            status: 'claimed',
            claimerAccountId: 'B',
            version: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        onWithdrawDemand={withdraw}
      />,
    );
    const demanded = screen.getByTestId('mother-demanded');
    expect(demanded).toHaveTextContent('胆小');
    expect(demanded).toHaveTextContent('待承接');
    expect(demanded).toHaveTextContent('固执');
    expect(demanded).toHaveTextContent('B接了');

    // 撤回要二次确认，且按性格单独撤
    const withdrawButtons = screen.getAllByTestId('mother-demand-withdraw');
    expect(withdrawButtons).toHaveLength(2);
    fireEvent.click(withdrawButtons[0]);
    expect(screen.getByTestId('mother-demand-withdraw-hint')).toHaveTextContent('确认撤回？');
    expect(withdraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('mother-demand-withdraw-cancel'));
    expect(screen.queryByTestId('mother-demand-withdraw-hint')).toBeNull();

    fireEvent.click(screen.getAllByTestId('mother-demand-withdraw')[0]);
    fireEvent.click(screen.getByTestId('mother-demand-withdraw-confirm'));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(201, '胆小'));
  });

  test('我缺的：自己已获得的蛋仍保留未结束的需求，可撤回', () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          {
            groupId: 'g1',
            demanderAccountId: 'A',
            eggGameId: 101,
            nature: '胆小',
            status: 'open',
            claimerAccountId: null,
            version: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        onWithdrawDemand={withdraw}
      />,
    );
    // A 自己已经有火花（不在「我缺的」里），但需求未结束，卡片必须保留
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('火花'));
    expect(row).toBeTruthy();
    expect(within(row!).getByTestId('mother-demanded')).toHaveTextContent('胆小');
    fireEvent.click(within(row!).getByTestId('mother-demand-withdraw'));
    expect(within(row!).getByTestId('mother-demand-withdraw-hint')).toHaveTextContent('确认撤回？');
  });

  test('只看我发的需求：只留我发过需求的那颗蛋', () => {
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          {
            groupId: 'g1',
            demanderAccountId: 'A',
            eggGameId: 201,
            nature: '胆小',
            status: 'open',
            claimerAccountId: null,
            version: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId('mother-resource-row').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByTestId('mother-only-demanded'));
    const rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('水蓝蓝');
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

  test('我缺的：已有人拥有的在前，无人拥有的要限定「组内无」', () => {
    renderResources();
    const rows = screen.getAllByTestId('mother-resource-row');
    const text = rows.map((row) => row.textContent).join('\n');
    expect(text).toContain('水蓝蓝');
    expect(text).toContain('纯母种');
    expect(text).toContain('组内无，另 1 人待发布');
    expect(text).not.toContain('火花');
  });

  test('搜索按蛋聚合：搜「火神」能命中「火花」那颗蛋', () => {
    // 换成 B 看「我缺的」：火花才会出现在缺口里
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="B"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    fireEvent.change(screen.getByTestId('mother-search'), { target: { value: '火神' } });

    const rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
  });

  test('固定卡片：我缺的三列、共同寻找两列，长名字与卡片内部对齐', () => {
    renderResources();
    const rows = screen.getAllByTestId('mother-resource-row');
    const list = rows[0].parentElement;
    expect(list?.className).toContain('grid-cols-3');
    expect(list?.className).toContain('items-stretch');
    for (const row of rows) {
      expect(row.className).toContain('h-full');
      expect(row.className).toContain('flex-col');
      expect(row.querySelector('.truncate')).toBeNull();
      expect(row.firstElementChild?.className).toContain('justify-between');
    }

    fireEvent.click(screen.getByTestId('mother-view-seeking'));
    expect(screen.getAllByTestId('mother-resource-row')[0].parentElement?.className).toContain(
      'grid-cols-2',
    );
  });

  test('多个成员拥有同一颗蛋时，名字各占一行（不再用「、」挤在一起）', () => {
    render(
      <MotherGroupResources
        group={{
          ...group,
          members: [
            member('A', resourceWith([])),
            member('B', resourceWith([101])),
            member('C', resourceWith([101])),
          ],
        }}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    const fireRow = screen
      .getAllByTestId('mother-resource-row')
      .find((row) => row.textContent?.includes('火花'));
    expect(fireRow).toBeTruthy();
    const holders = within(fireRow!).getByTestId('mother-resource-holders');
    expect(holders).not.toHaveTextContent('、');
    expect(holders.className).toContain('flex-col');
    expect(Array.from(holders.children).map((node) => node.textContent)).toEqual(['B', 'C']);
  });

  test('长名字缩略：基础名正常显示，形态去掉「形态 / 的样子」后小字跟在后面', () => {
    const bang: SpeciesEntry = {
      key: 'bang',
      gameId: 601,
      name: '蹦蹦种子',
      form: '海神球形态',
      number: '007',
      eggGameId: 601,
      eggGroups: [2],
      stage: 1,
    };
    render(
      <MotherGroupResources
        group={{
          group: { id: 'g1', name: '组', ownerAccountId: 'A', createdAt: 1 },
          members: [member('A', resourceWith([])), member('B', resourceWith([]))],
        }}
        viewerAccountId="A"
        species={[...catalog, bang]}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('蹦蹦种子'));
    expect(row).toBeTruthy();
    expect(screen.getByTestId('mother-resource-form')).toHaveTextContent('海神球');
    expect(row).not.toHaveTextContent('海神球形态');
  });

  test('+N 单独占一行：是性格竖排里的独立一行，而不是紧跟性格的小尾巴', () => {
    const target = {
      kind: 'mother' as const,
      criteriaId: 'mother-v2-test',
      mode: 'perfect' as const,
      bodies: ['大块头'],
      voices: ['+100'],
      catalogVersion: FIXTURE_CATALOG_VERSION,
      requireRecommendedNatures: true,
      natureOverrides: { '101': ['固执', '开朗', '胆小'] },
    };
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="B"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        target={target}
      />,
    );
    const fireRow = screen
      .getAllByTestId('mother-resource-row')
      .find((row) => row.textContent?.includes('火花'))!;
    const stack = within(fireRow).getByTestId('mother-resource-natures');
    const more = within(fireRow).getByTestId('mother-nature-more');
    // 直接挂在竖排容器下 = 自己占一行
    expect(more.parentElement).toBe(stack);
  });

  test('卡片里的长昵称会截断，避免把卡片撑丑', () => {
    render(
      <MotherGroupResources
        group={{
          group: group.group,
          members: [
            { ...member('A', resourceWith([101])), displayName: '非常非常长的昵称' },
            member('B', resourceWith([])),
          ],
        }}
        viewerAccountId="B"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    const fire = screen
      .getAllByTestId('mother-resource-row')
      .find((row) => row.textContent?.includes('火花'))!;
    expect(fire).toHaveTextContent('非常非常长的…');
    expect(fire).not.toHaveTextContent('非常非常长的昵称');
  });

  test('固定口径始终显示，不受全局筛选影响', () => {
    renderResources();
    expect(screen.getByTestId('mother-criteria')).toHaveTextContent('母 · 大块头 · +100dB');
  });
});
