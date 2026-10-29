import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearGroupListSession, setGroupList } from './listViewStore';
import { MotherGroupResources } from './MotherGroupResources';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  member,
  mother,
  resourceWith,
  sharedAccount,
  snapshot,
} from '../test/fixtures/motherSharing';
import type { MotherGroupDetail } from '../shared/motherGroups';
import type { CollectionDemand } from '../shared/collectionGroups';
import type { SpeciesEntry } from '../domain/types';

/** C 还没发布：所有「组内没人有」的行都只能判成「数据不全」，不能判死。 */
const group: MotherGroupDetail = {
  group: { id: 'g1', name: '组', ownerAccountId: 'A', createdAt: 1 },
  members: [
    member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
    member('B', resourceWith([], { accounts: [sharedAccount(1002, [])] })),
    member('C', null),
  ],
};

/** 全员都发布过：B 有水蓝蓝（可发）；纯母种确认没人有（红边沉底）。 */
const groupAllPublished: MotherGroupDetail = {
  ...group,
  members: [
    member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
    member('B', resourceWith([201], { accounts: [sharedAccount(1002, [201])] })),
    member('C', resourceWith([], { accounts: [sharedAccount(1003, [])] })),
  ],
};

/** 一条默认口径的组内需求：母 / 大块头 / +100。 */
const demandOf = (patch: Partial<CollectionDemand>): CollectionDemand => ({
  groupId: 'g1',
  demanderAccountId: 'A',
  eggGameId: 201,
  nature: '胆小',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'open',
  claimerAccountId: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

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
    // 2026-10-28：全部展示、不收起（不再有 +N / 收起）
    expect(naturesOf()).toHaveTextContent('固执');
    expect(naturesOf()).toHaveTextContent('开朗');
    expect(naturesOf()).toHaveTextContent('胆小');
    expect(within(naturesOf()).queryByTestId('mother-nature-more')).toBeNull();

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

  test('自己能产的蛋仍然展示，但不能勾选发需求', () => {
    setGroupList('B', 'g1', { targetNature: '固执' });
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="B"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        snapshots={[
          snapshot(2002, 'B', [
            mother(101, { nature: '开朗' }),
            mother(101, { gender: '公', nature: '固执' }),
          ]),
        ]}
      />,
    );
    const fireRow = screen
      .getAllByTestId('mother-resource-row')
      .find((row) => row.textContent?.includes('火花'));
    expect(fireRow).toBeTruthy();
    // 2026-10-27：卡片不再写「自己能产」提示，只靠边框（data-self-breedable）区分
    expect(within(fireRow!).queryByTestId('mother-self-breedable')).toBeNull();
    expect(fireRow).toHaveAttribute('data-self-breedable', 'true');
    expect(fireRow).toHaveAttribute('aria-disabled', 'true');
  });

  test('种公页：推荐卡显示组内产线，发需求用负数蛋组 id', async () => {
    const speciesWithMale = catalog.map((entry) =>
      entry.gameId === 101 ? { ...entry, maleCapable: true } : entry,
    );
    const withLine: MotherGroupDetail = {
      ...group,
      members: [
        group.members[0],
        member(
          'B',
          resourceWith([], {
            accounts: [
              sharedAccount(1002, [], {
                lines: [{ eggGameId: 101, grade: '大婉', natures: ['固执'] }],
              }),
            ],
          }),
        ),
        group.members[2],
      ],
    };
    const onPublishDemand = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={withLine}
        viewerAccountId="A"
        species={speciesWithMale}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        recommendations={[
          {
            id: 'r1',
            natureName: '固执',
            displayName: '火花',
            groupIds: [2],
            groupLabels: ['巨灵组'],
            grade: '大婉',
            gameId: 101,
          },
        ]}
        studGroupCount={1}
        onPublishDemand={onPublishDemand}
      />,
    );
    fireEvent.click(screen.getByTestId('missing-kind-stud'));
    expect(screen.getByTestId('stud-supply-status')).toHaveTextContent('组内有人能产');
    fireEvent.click(screen.getByTestId('stud-publish-2'));
    await waitFor(() =>
      expect(onPublishDemand).toHaveBeenCalledWith(
        -2,
        ['固执'],
        { gender: '公', body: '大块头', voice: '+100' },
      ),
    );
  });

  test('种公页：有未发布成员时先提示再发布', async () => {
    const groupOneUnknown: MotherGroupDetail = {
      ...group,
      members: [
        group.members[0],
        member(
          'B',
          resourceWith([], {
            accounts: [sharedAccount(1002, [], { lines: [] })],
          }),
        ),
        member('C', null),
      ],
    };
    const onPublishDemand = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={groupOneUnknown}
        viewerAccountId="A"
        species={catalog.map((entry) =>
          entry.gameId === 101 ? { ...entry, maleCapable: true } : entry,
        )}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        recommendations={[
          {
            id: 'r1',
            natureName: '固执',
            displayName: '火花',
            groupIds: [2],
            groupLabels: ['巨灵组'],
            grade: '大婉',
            gameId: 101,
          },
        ]}
        studGroupCount={1}
        onPublishDemand={onPublishDemand}
      />,
    );
    fireEvent.click(screen.getByTestId('missing-kind-stud'));
    expect(screen.getByTestId('stud-supply-status')).toHaveTextContent('另有 1 人未发布');
    fireEvent.click(screen.getByTestId('stud-publish-2'));
    expect(screen.getByTestId('stud-publish-warning')).toHaveTextContent(
      '组内还有 1 人未发布，当前已发布组员不能满足你的需求，是否还要发布需求？',
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('stud-publish-confirm'));
    });
    expect(onPublishDemand).toHaveBeenCalled();
  });

  test('需求中心：需求卡只留 名称 + 性格 + 动作（不再写怎么配/谁想要）', () => {
    render(
      <MotherGroupResources
        group={groupAllPublished}
        viewerAccountId="B"
        species={catalog.map((entry) =>
          entry.gameId === 101 ? { ...entry, maleCapable: true } : entry,
        )}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        snapshots={[
          snapshot(2002, 'B', [
            mother(101, { nature: '固执' }),
            mother(101, { gender: '公', nature: '开朗' }),
          ]),
        ]}
        demands={[
          demandOf({
            demanderAccountId: 'A',
            eggGameId: -2,
            nature: '固执',
            gender: '公',
            body: '大块头',
            voice: '+100',
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    const card = within(screen.getByTestId('demand-section-can-claim')).getByTestId('mother-demand-row');
    expect(card).toHaveTextContent('巨灵组');
    expect(card).toHaveTextContent('固执');
    expect(card).not.toHaveTextContent('怎么配');
    expect(within(card).getByTestId('mother-demand-claim')).toBeTruthy();
    // 左上角奖牌（公 · 大块头 · +100 → 体型 + 声音两张图）
    expect(within(card).getByTestId('mother-demand-medals').querySelectorAll('img')).toHaveLength(2);
  });

  test('三视图顺序：我缺的 / 需求中心 / 共同寻找', () => {
    renderResources();
    const groupControl = screen.getByRole('group', { name: '小组资源视图' });
    const labels = Array.from(groupControl.querySelectorAll('button')).map((item) => item.textContent);
    expect(labels).toEqual(['我缺的', '需求中心', '共同寻找']);
  });

  test('成员筛选在我缺的里改成复选框，可多选并展示他们能补的并集', () => {
    render(<MotherGroupResources group={{ ...group, members: [member('A', resourceWith([])), member('B', resourceWith([101])), member('C', resourceWith([201]))] }} viewerAccountId="A" species={catalog} catalogVersion={FIXTURE_CATALOG_VERSION} />);
    const filter = screen.getByTestId('mother-member-filter');
    expect(filter.tagName).toBe('BUTTON');
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    // 复选：选完不收起，方便接着勾第二个人
    expect(filter).toHaveAttribute('aria-expanded', 'true');
    let rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
    // 主卡保持简洁：「谁有 / 谁能补」只在点头像的二级页展示
    expect(within(rows[0]).queryByTestId('mother-resource-suppliers')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }));
    expect(filter).toHaveTextContent('B、C');
    rows = screen.getAllByTestId('mother-resource-row');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('火花'), expect.stringContaining('水蓝蓝')]),
    );

    // 「全部成员」= 清空筛选
    fireEvent.click(screen.getByRole('checkbox', { name: '全部成员' }));
    expect(filter).toHaveTextContent('全部成员');

    // 没人发需求 → 需求中心是空态
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
    expect(screen.getByTestId('mother-intake-empty')).toHaveTextContent('当前没有组员发布需求');
  });

  test('我缺的：类型与目标筛选放在同一行', () => {
    renderResources();
    const row = screen.getByTestId('missing-kind-filter');
    expect(row.className).toContain('flex-nowrap');
    expect(within(row).getByTestId('missing-kind-mother')).toBeTruthy();
    expect(within(row).getByTestId('mother-target-filter')).toBeTruthy();
  });

  test('发需求弹层：精灵带头像，常用性格按 3 列排', async () => {
    render(
      <MotherGroupResources
        group={groupAllPublished}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        onPublishDemand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-select-action'));
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('水蓝蓝'));
    fireEvent.click(row!);
    fireEvent.click(screen.getByTestId('mother-select-action'));

    const sheet = await screen.findByTestId('demand-publish');
    const item = within(sheet).getByTestId('demand-publish-item');
    expect(within(item).getByTestId('pet-avatar')).toBeTruthy();
    expect(item.parentElement?.className).toContain('grid-cols-3');
    const natures = within(item).getByTestId('demand-publish-natures');
    expect(natures.className).toContain('grid-cols-3');
    // 常用性格 8 个：3 列 × 3 行
    expect(natures.children).toHaveLength(8);
  });

  test('发需求弹层：更多性格只展开点击的那一只精灵', async () => {
    const twoMissing: MotherGroupDetail = {
      ...groupAllPublished,
      members: [
        member('A', resourceWith([101])),
        member('B', resourceWith([201, 301], { accounts: [sharedAccount(1002, [201, 301])] })),
        member('C', resourceWith([])),
      ],
    };
    render(
      <MotherGroupResources
        group={twoMissing}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        onPublishDemand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-select-action'));
    const rows = screen.getAllByTestId('mother-resource-row');
    fireEvent.click(rows.find((item) => item.textContent?.includes('水蓝蓝'))!);
    fireEvent.click(rows.find((item) => item.textContent?.includes('纯母种'))!);
    fireEvent.click(screen.getByTestId('mother-select-action'));

    const sheet = await screen.findByTestId('demand-publish');
    const firstToggle = within(sheet).getByTestId('demand-nature-toggle-201');
    const firstCard = firstToggle.closest('[data-testid="demand-publish-item"]') as HTMLElement;
    const secondCard = within(sheet)
      .getByTestId('demand-nature-toggle-301')
      .closest('[data-testid="demand-publish-item"]') as HTMLElement;
    expect(within(firstCard).getByTestId('demand-publish-natures').children).toHaveLength(8);
    expect(within(secondCard).getByTestId('demand-publish-natures').children).toHaveLength(8);

    fireEvent.click(firstToggle);
    expect(
      within(firstCard).getByTestId('demand-publish-natures').children.length,
    ).toBeGreaterThan(8);
    // 另一只保持收起
    expect(within(secondCard).getByTestId('demand-publish-natures').children).toHaveLength(8);
  });

  test('需求中心：父母双方都没有目标性格时，不会进「我能接的」', () => {
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        snapshots={[
          snapshot(1001, '甲', [
            mother(101, { nature: '急躁' }),
            mother(102, { gender: '公', nature: '踏实' }),
          ]),
        ]}
        demands={[demandOf({ demanderAccountId: 'B', eggGameId: 101, nature: '开朗' })]}
        onClaimDemand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    // 急躁母 × 踏实公孵不出开朗，不能显示「接单」
    expect(screen.queryByTestId('demand-section-can-claim')).toBeNull();
    expect(screen.queryByTestId('mother-demand-claim')).toBeNull();
  });

  test('需求中心：我能接的只列别人已发布、我能孵的需求，可直接接单', async () => {
    const claim = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          demandOf({ demanderAccountId: 'B', eggGameId: 101, nature: '固执' }),
          // 我没有的蛋 → 落到「发布了没人接的」
          demandOf({ demanderAccountId: 'B', eggGameId: 201, nature: '' }),
        ]}
        onClaimDemand={claim}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    const canClaim = screen.getByTestId('demand-section-can-claim');
    const rows = within(canClaim).getAllByTestId('mother-demand-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('火花');
    expect(rows[0]).toHaveTextContent('固执');

    const unclaimed = screen.getByTestId('demand-section-unclaimed');
    expect(within(unclaimed).getAllByTestId('mother-demand-row')).toHaveLength(1);

    fireEvent.click(within(canClaim).getByTestId('mother-demand-claim'));
    await waitFor(() =>
      expect(claim).toHaveBeenCalledWith(
        expect.objectContaining({ eggGameId: 101, demanderAccountId: 'B', nature: '固执' }),
      ),
    );
  });

  test('需求中心：点「查看」能看到需求方是谁，并给出怎么配对', () => {
    // 带形态的官方名：需求中心只写名字，形态交给头像区分（2026-10-29 用户口径）
    const speciesWithForm = catalog.map((entry) =>
      entry.gameId === 101 ? { ...entry, officialName: '火花_秋天的样子' } : entry,
    );
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={speciesWithForm}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        // 本机有一对同账号、同档位的火花：母 101（开朗）+ 公的进化形态 102 火神（固执）
        snapshots={[
          snapshot(1001, '甲', [
            mother(101, {
              nature: '开朗',
              account: '石岚',
              boxGroup: '盒子03',
              slotOrder: 5,
            }),
            mother(102, {
              gender: '公',
              nature: '固执',
              account: '石岚',
              boxGroup: '盒子04',
              slotOrder: 7,
            }),
          ]),
        ]}
        demands={[demandOf({ demanderAccountId: 'B', eggGameId: 101, nature: '固执' })]}
        onClaimDemand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    fireEvent.click(within(screen.getByTestId('demand-section-can-claim')).getByTestId('mother-demand-open'));

    const detail = screen.getByTestId('mother-demand-detail');
    expect(within(detail).getByTestId('mother-demand-detail-demander')).toHaveTextContent('需求方：B');
    const pairing = within(detail).getByTestId('mother-demand-detail-pairing');
    expect(within(detail).getByText('推荐配对')).toBeTruthy();
    // 需求中心改用家园同款精灵卡：一公一母并排，角色 + 名字 + 性别 + 位置都要在
    const cards = within(pairing).getAllByTestId('mother-demand-pair-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('母本');
    expect(cards[0]).toHaveTextContent('火花');
    expect(cards[0]).not.toHaveTextContent('秋天的样子');
    expect(cards[0]).toHaveTextContent('♀');
    expect(cards[0]).toHaveTextContent('开朗');
    expect(cards[0]).toHaveTextContent('石岚 · 盒子03 第5位');
    expect(cards[1]).toHaveTextContent('种公');
    expect(cards[1]).toHaveTextContent('火神');
    expect(cards[1]).toHaveTextContent('♂');
    expect(cards[1]).toHaveTextContent('固执');
    expect(cards[1]).toHaveTextContent('石岚 · 盒子04 第7位');
  });

  test('需求中心：我接的单，点「查看」也能看到是谁发的', () => {
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          demandOf({
            demanderAccountId: 'B',
            eggGameId: 101,
            nature: '固执',
            status: 'claimed',
            claimerAccountId: 'A',
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    fireEvent.click(within(screen.getByTestId('demand-section-mine-claimed')).getByTestId('mother-demand-open'));

    const detail = screen.getByTestId('mother-demand-detail');
    expect(within(detail).getByTestId('mother-demand-detail-demander')).toHaveTextContent('需求方：B');
    expect(within(detail).getByTestId('mother-demand-detail-status')).toHaveTextContent('我接了');
    // 没导入本机数据时，配对区给出明确提示，而不是空白
    expect(within(detail).getByTestId('mother-demand-detail-pairing')).toHaveTextContent(
      '本机还没导入数据',
    );
  });

  test('需求中心：需求卡不再写性别/体型/声音与承接人数据提示', () => {
    const stale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    render(
      <MotherGroupResources
        group={{
          ...group,
          members: [
            member('A', resourceWith([101])),
            member('B', resourceWith([], { accounts: [sharedAccount(1002, [], { sourceExportedAt: stale })] })),
            member('C', resourceWith([])),
          ],
        }}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          demandOf({
            demanderAccountId: 'B',
            eggGameId: 101,
            nature: '抓狂',
            gender: '公',
            body: '',
            voice: '',
            status: 'claimed',
            claimerAccountId: 'B',
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    const card = within(screen.getByTestId('demand-section-others-claimed')).getByTestId(
      'mother-demand-row',
    );
    expect(card).toHaveTextContent('抓狂');
    expect(card).not.toHaveTextContent('公 · 体型不限 · 声音不限');
    expect(card).not.toHaveTextContent('天未更新');
  });

  test('承接中心：没有组员发需求时给出空态提示，不再回落到旧缺口', () => {
    renderResources();
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    expect(screen.getByTestId('mother-intake-empty')).toHaveTextContent('当前没有组员发布需求');
    expect(screen.queryAllByTestId('mother-resource-row')).toHaveLength(0);
  });

  test('需求中心：背包里没匹配个体时先确认，确认后仍可结单', async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        // 背包里只有开朗水蓝蓝，需求要的是胆小 → 本地校验不通过，但用户可以手动确认完成
        snapshots={[snapshot(1001, '甲', [mother(201)])]}
        demands={[
          demandOf({
            eggGameId: 201,
            nature: '胆小',
            status: 'claimed',
            claimerAccountId: 'B',
          }),
        ]}
        onCompleteDemand={complete}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    const section = screen.getByTestId('demand-section-others-claimed');
    fireEvent.click(within(section).getByTestId('mother-demand-complete'));
    // 不再直接报错，先问一句；此时还没结单
    expect(complete).not.toHaveBeenCalled();
    expect(within(section).getByTestId('mother-demand-complete-confirm')).toHaveTextContent(
      '背包里未检测到',
    );

    // 取消 = 不结单
    fireEvent.click(within(section).getByTestId('mother-demand-complete-cancel'));
    expect(complete).not.toHaveBeenCalled();

    // 确认「已完成」→ 跳过本地校验直接结单（用户已拿到蛋、还没重新导入）
    fireEvent.click(within(section).getByTestId('mother-demand-complete'));
    fireEvent.click(within(section).getByTestId('mother-demand-complete-confirm-yes'));
    await waitFor(() => expect(complete).toHaveBeenCalled());
  });

  test('需求中心：背包里有完全匹配的个体时可以结单', async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        snapshots={[snapshot(1001, '甲', [mother(201, { nature: '胆小' })])]}
        demands={[
          demandOf({
            eggGameId: 201,
            nature: '胆小',
            status: 'claimed',
            claimerAccountId: 'B',
          }),
        ]}
        onCompleteDemand={complete}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    fireEvent.click(
      within(screen.getByTestId('demand-section-others-claimed')).getByTestId(
        'mother-demand-complete',
      ),
    );
    await waitFor(() => expect(complete).toHaveBeenCalled());
  });

  test('我缺的：批量选中后先选性格，再按目标口径发布需求', async () => {
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
        group={groupAllPublished}
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

    // 弹层：默认带上本组口径的性格与目标口径（母 / 大块头 / +100），可以再改
    const sheet = await screen.findByTestId('demand-publish');
    expect(sheet).toHaveTextContent('水蓝蓝');
    expect(within(sheet).getByTestId('demand-nature-201-胆小')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByTestId('demand-gender-母')).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByTestId('demand-body-大块头')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByTestId('demand-voice-+100')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(sheet).getByTestId('demand-nature-201-固执'));
    fireEvent.click(within(sheet).getByTestId('demand-publish-confirm'));
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(201, ['胆小', '固执'], {
        gender: '母',
        body: '大块头',
        voice: '+100',
      }),
    );
  });

  test('我缺的：多颗蛋同时发布，不逐条等上一颗完成', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const publish = vi.fn(async () => {
      // 第一颗故意挂住：串行实现会卡在这里，第二颗永远不会发出
      if (publish.mock.calls.length === 1) await firstGate;
    });
    // B 同时有 201 / 301：对 A 来说两颗都是「有来源但自己没有」的可发需求
    const twoMissing: MotherGroupDetail = {
      ...groupAllPublished,
      members: [
        member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
        member('B', resourceWith([201, 301], { accounts: [sharedAccount(1002, [201, 301])] })),
        member('C', resourceWith([], { accounts: [sharedAccount(1003, [])] })),
      ],
    };
    render(
      <MotherGroupResources
        group={twoMissing}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        onPublishDemand={publish}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-select-action'));
    const rowOf = (name: string) =>
      screen.getAllByTestId('mother-resource-row').find((item) => item.textContent?.includes(name));
    fireEvent.click(rowOf('水蓝蓝')!);
    fireEvent.click(rowOf('纯母种')!);
    fireEvent.click(screen.getByTestId('mother-select-action'));
    fireEvent.click(await screen.findByTestId('demand-publish-confirm'));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    releaseFirst();
    await waitFor(() => expect(screen.queryByTestId('demand-publish')).toBeNull());
  });

  test('我缺的：先出 24 项，点「加载更多」追加（瀑布流）', () => {
    const extraIds = Array.from({ length: 30 }, (_, index) => 601 + index);
    const manySpecies: SpeciesEntry[] = [
      // 只留火花这一颗蛋，避免其它图鉴蛋变成「组内暂时孵不了」把总数算乱
      ...catalog.filter((entry) => entry.eggGameId === 101),
      ...extraIds.map((eggGameId, index) => ({
        key: `extra-${eggGameId}`,
        gameId: eggGameId,
        name: `测试蛋${index + 1}`,
        number: String(100 + index),
        eggGameId,
        eggGroups: [2],
        stage: 1,
      })),
    ];
    const manyMissing: MotherGroupDetail = {
      ...groupAllPublished,
      members: [
        member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })),
        member('B', resourceWith(extraIds, { accounts: [sharedAccount(1002, extraIds)] })),
        member('C', resourceWith([], { accounts: [sharedAccount(1003, [])] })),
      ],
    };
    render(
      <MotherGroupResources
        group={manyMissing}
        viewerAccountId="A"
        species={manySpecies}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );

    expect(screen.getAllByTestId('mother-resource-row')).toHaveLength(24);
    expect(screen.getByTestId('mother-load-more')).toHaveTextContent('已显示 24');

    fireEvent.click(screen.getByTestId('mother-load-more-button'));
    expect(screen.getAllByTestId('mother-resource-row').length).toBeGreaterThan(24);
  });

  test('我缺的：体型可选小不点，声音可选 -100 / 婉转声 / 粗嗓门', () => {
    renderResources();

    fireEvent.click(screen.getByTestId('mother-target-body'));
    expect(screen.getByTestId('mother-target-body-option-大块头')).toBeInTheDocument();
    expect(screen.getByTestId('mother-target-body-option-小不点')).toBeInTheDocument();
    expect(screen.getByTestId('mother-target-body-option-any')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mother-target-body-option-小不点'));
    expect(screen.getByTestId('mother-target-body')).toHaveTextContent('小不点');

    fireEvent.click(screen.getByTestId('mother-target-voice'));
    expect(screen.getByTestId('mother-target-voice-option-+100')).toBeInTheDocument();
    expect(screen.getByTestId('mother-target-voice-option--100')).toBeInTheDocument();
    expect(screen.getByTestId('mother-target-voice-option-婉转声')).toBeInTheDocument();
    expect(screen.getByTestId('mother-target-voice-option-粗嗓门')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mother-target-voice-option--100'));
    expect(screen.getByTestId('mother-target-voice')).toHaveTextContent('-100');
  });

  test('我缺的：组内其他人按产线档位判断，切目标后结果跟着变', () => {
    const lineGroup: MotherGroupDetail = {
      ...group,
      members: [
        member(
          'A',
          resourceWith([101], {
            accounts: [
              sharedAccount(1001, [101], {
                lines: [{ eggGameId: 101, grade: '大婉', natures: ['固执'] }],
              }),
            ],
          }),
        ),
        member(
          'B',
          resourceWith([201, 301], {
            accounts: [
              sharedAccount(1002, [201, 301], {
                lines: [
                  { eggGameId: 201, grade: '大婉', natures: ['固执'] },
                  // 301 只有小婉产线，默认大块头 +100 不算有
                  { eggGameId: 301, grade: '小婉', natures: ['固执'] },
                ],
              }),
            ],
          }),
        ),
        member('C', resourceWith([], { accounts: [sharedAccount(1003, [], { lines: [] })] })),
      ],
    };
    render(
      <MotherGroupResources
        group={lineGroup}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    const rowOf = (name: string) =>
      screen.getAllByTestId('mother-resource-row').find((item) => item.textContent?.includes(name));
    expect(rowOf('水蓝蓝')).not.toHaveAttribute('data-blocked');
    expect(rowOf('纯母种')).toHaveAttribute('data-blocked', 'true');

    fireEvent.click(screen.getByTestId('mother-target-body'));
    fireEvent.click(screen.getByTestId('mother-target-body-option-小不点'));
    expect(rowOf('纯母种')).not.toHaveAttribute('data-blocked');
  });

  test('共同寻找：同样按目标档位判断，不是任意母本', () => {
    setGroupList('A', 'g1', { view: 'seeking', seekingMembers: ['A', 'B'] });
    const lineGroup: MotherGroupDetail = {
      ...group,
      members: [
        member(
          'A',
          resourceWith([101], {
            accounts: [
              sharedAccount(1001, [101], {
                lines: [{ eggGameId: 101, grade: '大婉', natures: ['固执'] }],
              }),
            ],
          }),
        ),
        member(
          'B',
          resourceWith([201, 301], {
            accounts: [
              sharedAccount(1002, [201, 301], {
                lines: [
                  { eggGameId: 201, grade: '大婉', natures: ['固执'] },
                  { eggGameId: 301, grade: '小婉', natures: ['固执'] },
                ],
              }),
            ],
          }),
        ),
        member('C', resourceWith([], { accounts: [sharedAccount(1003, [], { lines: [] })] })),
      ],
    };
    render(
      <MotherGroupResources
        group={lineGroup}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    const rows = screen.getAllByTestId('mother-resource-row');
    // 201：B 有大婉产线 → 不算共同缺；301：B 只有小婉，默认大块头 +100 下仍算缺
    expect(rows.some((row) => row.textContent?.includes('水蓝蓝'))).toBe(false);
    expect(rows.some((row) => row.textContent?.includes('纯母种'))).toBe(true);
  });

  test('我缺的：没有公母筛选；母本需求默认要母', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={groupAllPublished}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        onPublishDemand={publish}
      />,
    );
    expect(screen.queryByTestId('mother-target-gender')).toBeNull();

    fireEvent.click(screen.getByTestId('mother-select-action'));
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('水蓝蓝'));
    fireEvent.click(row!);
    fireEvent.click(screen.getByTestId('mother-select-action'));
    const sheet = await screen.findByTestId('demand-publish');
    expect(within(sheet).getByTestId('demand-gender-母')).toHaveAttribute('aria-pressed', 'true');
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByTestId('demand-publish-cancel'));
  });

  test('我缺的：发需求弹层里取消不会发布', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={groupAllPublished}
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
          demandOf({ eggGameId: 201, nature: '胆小' }),
          // 同一颗蛋的另一个性格：独立一条，已被别人接
          demandOf({
            eggGameId: 201,
            nature: '固执',
            status: 'claimed',
            claimerAccountId: 'B',
          }),
        ]}
        onWithdrawDemand={withdraw}
      />,
    );
    const demanded = screen.getByTestId('mother-demanded');
    expect(demanded).toHaveTextContent('已发 2 条');

    // 2026-10-28：卡片上的小按钮挪进点头像的二级页面，避免多性格时点错
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('水蓝蓝'))!;
    fireEvent.click(within(row).getByTestId('mother-resource-open'));
    const detail = screen.getByTestId('mother-resource-detail');
    expect(within(detail).getAllByTestId('mother-resource-detail-demand')).toHaveLength(2);

    // 撤回要二次确认，且按性格单独撤（2026-10-27 卡片里不再写需求条件与承接人）
    const withdrawButtons = within(detail).getAllByTestId('mother-demand-withdraw');
    expect(withdrawButtons).toHaveLength(2);
    fireEvent.click(withdrawButtons[0]);
    expect(screen.queryByTestId('mother-demand-withdraw-hint')).toBeNull();
    expect(withdraw).not.toHaveBeenCalled();
    fireEvent.click(within(detail).getByTestId('mother-demand-withdraw-cancel'));
    expect(within(detail).queryByTestId('mother-demand-withdraw-confirm')).toBeNull();

    fireEvent.click(within(detail).getAllByTestId('mother-demand-withdraw')[0]);
    fireEvent.click(within(detail).getByTestId('mother-demand-withdraw-confirm'));
    await waitFor(() =>
      expect(withdraw).toHaveBeenCalledWith(
        201,
        expect.objectContaining({
          eggGameId: 201,
          nature: '胆小',
          gender: '母',
          body: '大块头',
          voice: '+100',
        }),
      ),
    );
  });

  test('我缺的：自己已获得的蛋仍保留未结束的需求，可撤回', () => {
    const withdraw = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[demandOf({ eggGameId: 101, nature: '胆小' })]}
        onWithdrawDemand={withdraw}
      />,
    );
    // A 自己已经有火花（不在「我缺的」里），但需求未结束，卡片必须保留
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('火花'));
    expect(row).toBeTruthy();
    expect(within(row!).getByTestId('mother-demanded')).toBeTruthy();
    fireEvent.click(within(row!).getByTestId('mother-resource-open'));
    const detail = screen.getByTestId('mother-resource-detail');
    fireEvent.click(within(detail).getByTestId('mother-demand-withdraw'));
    expect(within(detail).getByTestId('mother-demand-withdraw-confirm')).toBeTruthy();
  });

  test('我缺的：点头像进入二级页面，能看谁能补并直接发需求', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    render(
      <MotherGroupResources
        group={groupAllPublished}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        onPublishDemand={publish}
      />,
    );
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('水蓝蓝'))!;
    fireEvent.click(within(row).getByTestId('mother-resource-open'));

    const detail = screen.getByTestId('mother-resource-detail');
    expect(within(detail).getByTestId('mother-resource-detail-suppliers')).toHaveTextContent('B 能补');

    fireEvent.click(within(detail).getByTestId('mother-resource-publish'));
    const sheet = await screen.findByTestId('demand-publish');
    fireEvent.click(within(sheet).getByTestId('demand-publish-confirm'));
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        201,
        expect.any(Array),
        expect.objectContaining({ gender: '母', body: '大块头', voice: '+100' }),
      ),
    );
  });

  test('只看我发的需求：只留我发过需求的那颗蛋', () => {
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[demandOf({ eggGameId: 201, nature: '胆小' })]}
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

  test('我缺的：有人还没发布时，组内没人有的行标成「数据不全」而不是判死', () => {
    renderResources();
    const incompleteSection = screen.getByTestId('mother-incomplete-section');
    expect(incompleteSection).toHaveTextContent('数据不全');
    const rows = screen.getAllByTestId('mother-resource-row');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row).toHaveAttribute('data-incomplete', 'true');
      expect(row.className).toContain('ring-amber-300');
      expect(row).not.toHaveAttribute('data-blocked');
    }
    const text = rows.map((row) => row.textContent).join('\n');
    expect(text).toContain('水蓝蓝');
    expect(text).toContain('纯母种');
    // 数据不全仍然可以发需求（软校验）；也不会出现「确认没有」的红边分区
    expect(screen.getByTestId('mother-select-action')).not.toBeDisabled();
    expect(screen.queryByTestId('mother-blocked-section')).toBeNull();
  });

  test('我缺的：全员新鲜且确实没人有 → 红边沉底，不能发需求', () => {
    render(
      <MotherGroupResources
        group={groupAllPublished}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
      />,
    );
    const rows = screen.getAllByTestId('mother-resource-row');
    // 水蓝蓝 B 有（可发），纯母种没人有（沉底）
    expect(rows[0]).toHaveTextContent('水蓝蓝');
    expect(rows[0]).not.toHaveAttribute('data-blocked');
    const last = rows[rows.length - 1];
    expect(last).toHaveAttribute('data-blocked', 'true');
    expect(last.className).toContain('ring-rose-300');
    expect(last).not.toHaveTextContent('组内无');
    expect(screen.getByTestId('mother-resource-count')).toHaveTextContent('可发需求 1 项');
    expect(screen.getByTestId('mother-blocked-section')).toHaveTextContent('组内暂时补不了 · 1');
  });

  test('需求中心：四段顺序固定，其他人接的按成员分组并显示已结单数', () => {
    const demands: CollectionDemand[] = [
      demandOf({
        demanderAccountId: 'B',
        eggGameId: 101,
        nature: '固执',
        status: 'claimed',
        claimerAccountId: 'A',
        updatedAt: 5,
      }),
      demandOf({
        demanderAccountId: 'B',
        eggGameId: 101,
        nature: '开朗',
        status: 'open',
        updatedAt: 4,
      }),
      demandOf({
        eggGameId: 201,
        nature: '胆小',
        status: 'claimed',
        claimerAccountId: 'B',
        updatedAt: 3,
      }),
      demandOf({
        eggGameId: 201,
        nature: '平和',
        status: 'open',
        updatedAt: 2,
      }),
      demandOf({
        eggGameId: 101,
        nature: '淘气',
        status: 'done',
        claimerAccountId: 'B',
        version: 2,
      }),
    ];
    render(
      <MotherGroupResources
        group={group}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={demands}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));

    const ids = ['mine-claimed', 'can-claim', 'others-claimed', 'unclaimed'];
    const sections = ids.map((id) => screen.getByTestId(`demand-section-${id}`));
    for (let index = 0; index < sections.length - 1; index += 1) {
      expect(
        sections[index].compareDocumentPosition(sections[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    expect(within(sections[0]).getAllByTestId('mother-demand-row')).toHaveLength(1);
    expect(within(sections[1]).getAllByTestId('mother-demand-row')).toHaveLength(1);
    expect(sections[2]).toHaveTextContent('B');
    expect(within(sections[2]).getByTestId('mother-completed-count')).toHaveTextContent(
      '已结 1 单',
    );
    expect(within(sections[2]).getAllByTestId('mother-demand-row')).toHaveLength(1);
    expect(within(sections[3]).getAllByTestId('mother-demand-row')).toHaveLength(1);
    expect(screen.getByTestId('mother-resource-count')).toHaveTextContent('共 4 条');
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

  test('固定卡片：我缺的与共同寻找都四列，长名字与卡片内部对齐', () => {
    renderResources();
    const rows = screen.getAllByTestId('mother-resource-row');
    const list = rows[0].parentElement;
    expect(list?.className).toContain('grid-cols-4');
    expect(list?.className).toContain('items-stretch');
    for (const row of rows) {
      expect(row.className).toContain('h-full');
      expect(row.className).toContain('flex-col');
      expect(row.className).toContain('items-center');
      expect(row.querySelector('.truncate')).toBeNull();
      expect(row.firstElementChild?.className).toContain('justify-center');
    }

    fireEvent.click(screen.getByTestId('mother-view-seeking'));
    expect(screen.getAllByTestId('mother-resource-row')[0].parentElement?.className).toContain(
      'grid-cols-4',
    );
  });

  test('小组卡片：左上角奖牌竖排、头像居中、名字在头像下面、性格在名字下面', () => {
    // 给一颗蛋配 3 个目标性格，才会渲染右上角性格列
    const target = {
      kind: 'mother' as const,
      criteriaId: 'mother-v2-layout',
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
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('火花'))!;
    expect(row).toBeTruthy();
    // 默认目标 = 大块头 + 100dB → 左上角两个奖牌图标
    expect(within(row).getByTestId('mother-resource-medals').querySelectorAll('img')).toHaveLength(2);
    expect(within(row).getByTestId('mother-resource-natures')).toBeTruthy();
    const avatar = within(row).getByTestId('pet-avatar');
    const name = within(row).getByTestId('mother-resource-name');
    // 头像在前、名字在头像之后（用户要求：头像居中，名字放头像下面）
    expect(avatar.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('长名字只显示基础名，不显示形态', () => {
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
    expect(row).toHaveTextContent('蹦蹦种子');
    expect(row).not.toHaveTextContent('海神球');
    expect(screen.queryByTestId('mother-resource-form')).toBeNull();
  });

  test('性格全部展示，且排在名字之后（不会把头像顶下去）', () => {
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
    const name = within(fireRow).getByTestId('mother-resource-name');
    const natures = within(fireRow).getByTestId('mother-resource-natures');
    // 3 个性格全部展示
    expect(natures.children).toHaveLength(3);
    // 性格在名字之后 = 不影响头像纵向位置
    expect(name.compareDocumentPosition(natures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('我缺的：已有非目标性格的母本，仍按自己设定的收集性格判定缺口', async () => {
    render(
      <MotherGroupResources
        group={{
          ...group,
          members: [
            member('A', resourceWith([101])),
            member('B', resourceWith([101])),
            member('C', resourceWith([])),
          ],
        }}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        // 我自己收集的是「固执」，但背包里只有一只 天真 的火花：它不算这个性格已收集
        natureOverrides={{ '101': ['固执'] }}
        snapshots={[snapshot(1001, '甲', [mother(101, { nature: '天真' })])]}
        onPublishDemand={vi.fn()}
      />,
    );
    const row = screen
      .getAllByTestId('mother-resource-row')
      .find((item) => item.textContent?.includes('火花'));
    expect(row).toBeTruthy();
    // 主卡只把没收集到的性格标红，不再多写一行「还缺 …」
    expect(within(row!).queryByTestId('mother-resource-missing-natures')).toBeNull();
    const chips = within(row!).getByTestId('mother-resource-natures');
    expect(chips.querySelector('.text-rose-600')).toHaveTextContent('固执');
    // 主卡也不展示「谁有 / 谁能补」
    expect(within(row!).queryByTestId('mother-resource-suppliers')).toBeNull();

    // 二级页里才展示：还缺哪个性格、每个性格谁能补
    fireEvent.click(within(row!).getByTestId('mother-resource-open'));
    const detail = screen.getByTestId('mother-resource-detail');
    expect(within(detail).getByTestId('mother-resource-detail-missing-natures')).toHaveTextContent(
      '还缺：固执',
    );
    expect(within(detail).getByTestId('mother-resource-detail-suppliers')).toHaveTextContent(
      '固执：B',
    );
    fireEvent.click(within(detail).getByTestId('mother-resource-publish'));
    const sheet = await screen.findByTestId('demand-publish');
    expect(within(sheet).getByTestId('demand-nature-101-固执')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByTestId('demand-nature-101-开朗')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('我缺的：目标性格都收齐后，这颗蛋不再出现在缺口里', () => {
    render(
      <MotherGroupResources
        group={{
          ...group,
          members: [
            member('A', resourceWith([101])),
            member('B', resourceWith([101])),
            member('C', resourceWith([])),
          ],
        }}
        viewerAccountId="A"
        species={catalog}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        natureOverrides={{ '101': ['固执'] }}
        snapshots={[snapshot(1001, '甲', [mother(101, { nature: '固执' })])]}
      />,
    );
    expect(
      screen
        .getAllByTestId('mother-resource-row')
        .some((item) => item.textContent?.includes('火花')),
    ).toBe(false);
  });

  test('需求中心：没导入本机数据时，用已发布产线判断能接的母本单与种公单', async () => {
    const claim = vi.fn().mockResolvedValue(undefined);
    const male201 = { ...catalog.find((entry) => entry.gameId === 201)!, maleCapable: true };
    render(
      <MotherGroupResources
        group={{
          ...group,
          members: [
            member(
              'A',
              resourceWith([101], {
                accounts: [
                  sharedAccount(1001, [101], {
                    lines: [{ eggGameId: 201, grade: '大婉', natures: ['固执'] }],
                  }),
                ],
              }),
            ),
            member('B', resourceWith([], { accounts: [sharedAccount(1002, [])] })),
            member('C', resourceWith([], { accounts: [sharedAccount(1003, [])] })),
          ],
        }}
        viewerAccountId="A"
        species={[...catalog, male201]}
        catalogVersion={FIXTURE_CATALOG_VERSION}
        demands={[
          demandOf({ demanderAccountId: 'B', eggGameId: 201, nature: '固执' }),
          demandOf({ demanderAccountId: 'B', eggGameId: -3, nature: '固执', gender: '公' }),
        ]}
        onClaimDemand={claim}
      />,
    );
    fireEvent.click(screen.getByTestId('mother-view-mine'));
    const canClaim = screen.getByTestId('demand-section-can-claim');
    expect(within(canClaim).getAllByTestId('mother-demand-row')).toHaveLength(2);

    // 一次只处理一条：接单期间按钮会禁用，逐条点
    fireEvent.click(within(canClaim).getAllByTestId('mother-demand-claim')[0]);
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    fireEvent.click(within(canClaim).getAllByTestId('mother-demand-claim')[1]);
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    expect(claim.mock.calls.map((call) => call[0].eggGameId)).toEqual(
      expect.arrayContaining([201, -3]),
    );
  });
});
