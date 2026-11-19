import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import {
  type NestPairing,
  type NestPet,
  type NestPlan,
  type NestTier,
} from '../domain/nestPlan';
import { NestPlanCard } from './NestPlanCard';

const nestPet = (key: string, name: string): NestPet => ({
  key,
  gameId: 3001,
  name,
  account: '账号甲',
  gender: '公',
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  box: '盒子1 第1位',
});

/** 手写一条配对（不经算法）：验卡片/摆位图的呈现规则时用 */
const pairingOf = (
  mother: NestPet,
  father: NestPet,
  over: Partial<NestPairing> = {},
): NestPairing => {
  const tier = over.tier ?? 'normal60';
  const groupIds = over.groupIds ?? [2];
  const natureChance =
    over.natureChance ?? (tier === 'academy' ? 1 : tier === 'normal60' ? 0.6 : 0.3);
  return {
    tier,
    groupIds,
    natureName: '固执',
    grade: '大婉',
    account: '账号甲',
    father,
    mother,
    academyParent: null,
    partner: father,
    natureChance,
    distance: 8,
    fatherPosition: { x: 8, y: 0 },
    motherPosition: { x: 0, y: 0 },
    expected: { species: mother.name, nature: '固执', body: '大块头', voice: '100' },
    expectedValue: natureChance * groupIds.length,
    ...over,
  };
};

/** 手写一份方案 */
const planOf = (pairings: NestPairing[], slots: NestPlan['slots'] = []): NestPlan => ({
  account: '账号甲',
  pairings,
  blockedLinks: [],
  slots,
  nestsUsed: slots.length,
  nestsTotal: 11,
  clusters: [slots.map((slot) => slot.position)],
  unfilled: [],
  delegated: [],
  alternatives: [],
});

describe('配对卡片颜色 / 位置', () => {
  const male = { ...nestPet('a', '甲兽'), gender: '公' as const };
  const femaleB = { ...nestPet('b', '乙兽'), gender: '母' as const };
  const femaleC = { ...nestPet('c', '丙兽'), gender: '母' as const };
  const pairingAt = (
    mother: NestPet,
    motherPosition: { x: number; y: number },
    tier: NestTier,
  ): NestPairing => ({
    tier,
    groupIds: [2],
    natureName: '固执',
    grade: '大婉',
    account: '账号甲',
    father: male,
    mother,
    academyParent: null,
    partner: male,
    natureChance: tier === 'academy' ? 1 : tier === 'normal60' ? 0.6 : 0.3,
    distance: 8,
    fatherPosition: { x: 0, y: 0 },
    motherPosition,
    expected: { species: mother.name, nature: '固执', body: '大块头', voice: '100' },
    expectedValue: 1.2,
  });
  const plan = planOf([
    pairingAt(femaleB, { x: 8, y: 0 }, 'normal60'),
    pairingAt(femaleC, { x: 0, y: 8 }, 'normal30'),
  ]);

  test('不同配对卡片用不同颜色区分', () => {
    render(<NestPlanCard plans={[plan]} />);
    const cards = screen.getAllByTestId('breed-suggestion');
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((card) => (card as HTMLElement).style.borderLeftColor)).size).toBe(2);
  });

  test('卡片里不再重复账号（账号已在分组标题），只写位置', () => {
    render(<NestPlanCard plans={[plan]} />);
    const cards = screen.getAllByTestId('breed-suggestion');
    expect(cards[0]).toHaveTextContent('盒子1 第1位');
    expect(cards[0]).not.toHaveTextContent('账号甲');
  });
});
describe('NestPlanCard（配窝建议的行合并规则）', () => {
  const male = (key: string, name: string): NestPet => ({ ...nestPet(key, name), gender: '公' });
  const female = (key: string, name: string): NestPet => ({ ...nestPet(key, name), gender: '母' });

  test('同名同性格的两只母本各占一行（按个体 key，不按名字合并）', () => {
    const father = male('f', '种公兽');
    render(
      <NestPlanCard
        plans={[planOf([pairingOf(female('a', '母方兽'), father), pairingOf(female('b', '母方兽'), father)])]}
      />,
    );
    expect(screen.getAllByTestId('breed-suggestion')).toHaveLength(2);
  });

  test('学院那只挂 2 个配对方时合并成一行', () => {
    const academy = male('ac', '鸭吉吉');
    const academyPairing = (partner: NestPet, natureName: string): NestPairing =>
      pairingOf(partner, academy, {
        tier: 'academy',
        academyParent: academy,
        partner,
        natureName,
        natureChance: 1,
      });
    render(
      <NestPlanCard
        plans={[planOf([academyPairing(female('p1', '粉星仔'), '固执'), academyPairing(female('p2', '水滴蛇'), '认真')])]}
      />,
    );
    const rows = screen.getAllByTestId('breed-suggestion');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('粉星仔');
    expect(rows[0]).toHaveTextContent('水滴蛇');
    // 学院小窝那只必须用绿边框（2026-11-19 用户反馈）
    const cards = within(rows[0]).getAllByTestId('breed-pet-card');
    expect(cards[0].className).toContain('border-emerald-500');
    expect(cards[1].className).not.toContain('border-emerald-500');
  });

  test('同一对精灵补两个性格时合并成一行，两个性格都列出来', () => {
    const mother = female('m', '噼啪鸟');
    const father = male('f', '粉星仔');
    render(
      <NestPlanCard
        plans={[
          planOf([
            pairingOf(mother, father, { tier: 'normal30', natureName: '平和', natureChance: 0.3 }),
            pairingOf(mother, father, { tier: 'normal30', natureName: '开朗', natureChance: 0.3 }),
          ]),
        ]}
      />,
    );
    const rows = screen.getAllByTestId('breed-suggestion');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('平和');
    expect(rows[0]).toHaveTextContent('开朗');
  });

  test('同一对精灵补两个性格（各 30%）→ 每个性格单独写「15%平和公」', () => {
    const mother = female('m', '噼啪鸟');
    const father = male('f', '粉星仔');
    render(
      <NestPlanCard
        plans={[
          planOf([
            pairingOf(mother, father, { tier: 'normal30', natureName: '平和', natureChance: 0.3 }),
            pairingOf(mother, father, { tier: 'normal30', natureName: '急躁', natureChance: 0.3 }),
          ]),
        ]}
      />,
    );
    const row = screen.getAllByTestId('breed-suggestion')[0];
    // 30% 性格 × 50% 出公 = 15% 拿到这个性格的公（性别用图标）
    expect(row).toHaveTextContent('15%平和♂');
    expect(row).toHaveTextContent('15%急躁♂');
    // 档位标签与拆开的「性格 / 出公」不再出现（2026-11-18）
    expect(row).not.toHaveTextContent('普通');
    expect(row).not.toHaveTextContent('性格 ');
    expect(row).not.toHaveTextContent('出公 ');
  });

  test('同一对精灵对不同性格分别是 60% / 30%：概率按性格各算，不按档位一刀切', () => {
    const mother = female('m', '噼啪鸟');
    const father = male('f', '粉星仔');
    render(
      <NestPlanCard
        plans={[
          planOf([
            pairingOf(mother, father, { tier: 'normal60', natureName: '固执', natureChance: 0.6 }),
            pairingOf(mother, father, { tier: 'normal30', natureName: '开朗', natureChance: 0.3 }),
          ]),
        ]}
      />,
    );
    const row = screen.getAllByTestId('breed-suggestion')[0];
    expect(row).toHaveTextContent('30%固执♂');
    expect(row).toHaveTextContent('15%开朗♂');
  });

  test('建议按「产出目标性格的概率」从高到低排：学院 50% → 普通 30% → 普通 15%', () => {
    const single = female('s', '三成母');
    const singleFather = male('sf', '三成公');
    const duo = female('d', '六成母');
    const duoFather = male('df', '六成公');
    const academy = male('ac', '金冠公');
    const academyPartner = female('ap', '配对母');

    render(
      <NestPlanCard
        plans={[
          planOf([
            // 故意倒着放，验证展示时会被重排
            pairingOf(single, singleFather, { tier: 'normal30', natureName: '平和', natureChance: 0.3 }),
            pairingOf(duo, duoFather, { tier: 'normal60', natureName: '急躁', natureChance: 0.6 }),
            pairingOf(academyPartner, academy, {
              tier: 'academy',
              academyParent: academy,
              partner: academyPartner,
              natureName: '固执',
              natureChance: 1,
            }),
          ]),
        ]}
      />,
    );

    const rows = screen.getAllByTestId('breed-suggestion');
    expect(rows).toHaveLength(3);
    // 绿窝 100% 性格 × 50% 出公 = 50%固执公；普通窝 60% / 30% 各再乘 50%
    expect(rows[0]).toHaveTextContent('50%固执♂');
    expect(rows[1]).toHaveTextContent('30%急躁♂');
    expect(rows[2]).toHaveTextContent('15%平和♂');
    for (const row of rows) {
      expect(row).not.toHaveTextContent('普通');
      expect(row).not.toHaveTextContent('学院小窝');
    }
  });
});

describe('NestPlanCard 补全计划（2026-11-18）', () => {
  const female = (key: string, name: string): NestPet => ({ ...nestPet(key, name), gender: '母' });
  const male = (key: string, name: string): NestPet => ({ ...nestPet(key, name), gender: '公' });
  const mother = female('m1', '母方兽');
  const father = male('f1', '种公兽');

  test('卡片头只写概率 + 性格，不再写蛋组（2026-11-19）', () => {
    render(
      <NestPlanCard
        plans={[
          planOf([
            pairingOf(mother, father, { groupIds: [2, 7] }),
            pairingOf(male('m2', '母方兽'), male('f2', '种公兽'), {
              groupIds: [8],
              natureName: '开朗',
            }),
          ]),
        ]}
      />,
    );
    const rows = screen.getAllByTestId('breed-suggestion');
    for (const row of rows) {
      const head = within(row).getByTestId('pairing-head');
      // 蛋组只在下面两张精灵卡里出现，卡头不再重复
      expect(within(head).queryAllByTestId('pairing-group-chip')).toHaveLength(0);
      expect(head).not.toHaveTextContent('组');
      expect(head).not.toHaveTextContent('双组');
      expect(head).not.toHaveTextContent('单组');
      expect(head).not.toHaveTextContent('补');
      expect(head).not.toHaveTextContent('种公');
    }
  });

  test('卡片不再标期望补格数（2026-11-18 用户口径）', () => {
    render(
      <NestPlanCard plans={[planOf([pairingOf(mother, father, { expectedValue: 2.4 })])]} />,
    );
    expect(screen.getByTestId('breed-suggestion')).not.toHaveTextContent('期望');
  });

  test('组别后面写公母平均声音，向下取整（97 / 100 → 98dB）', () => {
    const mother = { ...female('m', '母方兽'), voiceDb: 97 };
    const father = male('f', '种公兽');
    render(<NestPlanCard plans={[planOf([pairingOf(mother, father)])]} />);
    const head = within(screen.getByTestId('breed-suggestion')).getByTestId('pairing-head');
    expect(head).toHaveTextContent('98dB');
    expect(head).not.toHaveTextContent('99dB');
  });

  test('一条配窝 = 两张精灵背包卡，卡里有分贝 / 身高 / 体重', () => {
    const mother = { ...nestPet('m1', '母兽'), gender: '母' as const };
    const father = { ...nestPet('f1', '公兽'), heightPercent: 80, weightPercent: 40 };
    render(<NestPlanCard plans={[planOf([pairingOf(mother, father)])]} />);

    const cards = screen.getAllByTestId('breed-pet-card');
    expect(cards).toHaveLength(2);
    expect(cards[1]).toHaveTextContent('100dB');
    expect(cards[1]).toHaveTextContent('高80%');
    expect(cards[1]).toHaveTextContent('重40%');
  });

  test('卡片压成 86px 紧凑版：盒子位置在卡底，不再写编号', () => {
    const mother = { ...nestPet('m1', '母兽'), gender: '母' as const, box: '盒子8 第5位' };
    const father = { ...nestPet('f1', '公兽'), box: '盒子3 第1位' };
    render(<NestPlanCard plans={[planOf([pairingOf(mother, father)])]} />);

    const cards = screen.getAllByTestId('breed-pet-card');
    for (const card of cards) expect(card.className).toContain('h-[86px]');
    expect(cards[0]).toHaveTextContent('盒子8 第5位');
    expect(cards[1]).toHaveTextContent('盒子3 第1位');
    expect(cards[0]).not.toHaveTextContent('No.');
  });

  test('配窝卡保留完整形态名，长名字自动缩小字号', () => {
    const mother = { ...nestPet('m1', '蹦蹦种子_海神球形态'), gender: '母' as const };
    const father = { ...nestPet('f1', '公兽'), gender: '公' as const };
    render(<NestPlanCard plans={[planOf([pairingOf(mother, father)])]} />);

    const cards = screen.getAllByTestId('breed-pet-card');
    expect(cards[0]).toHaveTextContent('蹦蹦种子_海神球形态');
    expect(cards[0].querySelector('h4')?.className).toContain('text-[9px]');
    expect(cards[1]).toHaveTextContent('公兽');
    expect(cards[1].querySelector('h4')?.className).toContain('text-[11px]');
  });

  test('本号已收齐的蛋组标绿，没收齐的保持蓝色', () => {
    const mother = { ...nestPet('m1', '母兽'), gender: '母' as const };
    const father = { ...nestPet('f1', '公兽') };
    render(
      <NestPlanCard
        plans={[planOf([pairingOf(mother, father)])]}
        collectedGroupIdsByAccount={new Map([['账号甲', new Set([6])]])}
      />,
    );

    const firstCard = screen.getAllByTestId('breed-pet-card')[0];
    // 猫系测试精灵在动物组(6) + 拟人组(9)：6 已收齐 → 绿，9 还是缺口 → 原蓝色
    expect(firstCard.querySelector('[title="动物组（已收齐）"]')).not.toBeNull();
    expect(firstCard.querySelector('[title="拟人组"]')).not.toBeNull();
  });

  test('缺口清单与跨号兜底清单不再出现在配窝卡里（2026-11-19 用户口径）', () => {
    const plan: NestPlan = {
      ...planOf([]),
      unfilled: [{ groupId: 3, natureName: '认真', grade: '大婉', reason: 'has-mother' }],
      delegated: [
        { groupId: 2, natureName: '固执', grade: '大婉' as const, byAccount: '账号乙' },
      ],
    };
    render(<NestPlanCard plans={[plan]} />);

    expect(screen.queryByTestId('breed-unfilled')).toBeNull();
    expect(screen.queryByTestId('breed-delegated')).toBeNull();
    expect(screen.queryByText('缺带这个性格的公')).toBeNull();
    expect(screen.queryByText('由 账号乙 出蛋，孵好传过来')).toBeNull();
  });

  test('多账号用滑条切换；账号 tab 按实际占窝数写「窝」', () => {
    const breeder = { ...planOf([pairingOf(mother, father)]), account: '账号甲', nestsUsed: 2 };
    const receiver = {
      ...planOf([]),
      account: '账号乙',
      nestsUsed: 0,
      delegated: [
        { groupId: 2, natureName: '固执', grade: '大婉' as const, byAccount: '账号甲' },
      ],
    };
    render(<NestPlanCard plans={[breeder, receiver]} />);

    expect(screen.getByTestId('breed-account-tabs')).toBeTruthy();
    const tabs = screen.getAllByTestId('breed-account-tab');
    expect(tabs[0]).toHaveTextContent('账号甲2 窝');
    expect(tabs[1]).toHaveTextContent('账号乙待补');

    // 默认显示有配对的号，并写明这颗蛋还有谁在等
    expect(screen.getByTestId('breed-account-name')).toHaveTextContent('账号甲');
    expect(screen.getByTestId('breed-receivers')).toHaveTextContent('账号乙');

    fireEvent.click(tabs[1]);
    expect(screen.getByTestId('breed-account-name')).toHaveTextContent('账号乙');
    expect(screen.queryByTestId('breed-delegated')).toBeNull();
  });

  test('账号 tab 写窝数：11 个窝不能写成 11 对', () => {
    const a = { ...planOf([pairingOf(mother, father)]), account: '账号甲', nestsUsed: 11 };
    const b = { ...planOf([pairingOf(mother, father)]), account: '账号乙', nestsUsed: 2 };
    render(<NestPlanCard plans={[a, b]} />);

    const tabs = screen.getAllByTestId('breed-account-tab');
    expect(tabs[0]).toHaveTextContent('11 窝');
    expect(tabs[1]).toHaveTextContent('2 窝');
    expect(tabs[0]).not.toHaveTextContent('对');
  });

  test('账号标题写本号还差几个种公目标（按号各算）', () => {
    const plan = { ...planOf([pairingOf(mother, father)]), account: '账号甲' };
    render(
      <NestPlanCard plans={[plan]} gapsByAccount={new Map([['账号甲', 4]])} />,
    );
    expect(screen.getByTestId('breed-account-name')).toHaveTextContent('差 4 个种公目标');
  });

});

test('母本配窝：每条线写概率+性格+性别，跨号任务同样', () => {
    const mother = { ...nestPet('m', '喵喵'), gender: '母' as const, nature: '开朗', voiceDb: 97 };
    const father = { ...nestPet('f', '喵喵'), gender: '公' as const, nature: '踏实' };
    const studMother = { ...nestPet('sm', '火豆丁'), gender: '母' as const };
    const studFather = { ...nestPet('sf', '火花'), gender: '公' as const };
    const plan = planOf([pairingOf(studMother, studFather)], []);
    const motherSuggestions = new Map([
      [
        '账号甲',
        {
          gapCount: 1,
          pairings: [
            {
              account: '账号甲',
              grade: '大婉' as const,
              eggGameId: 3001,
              eggName: '喵喵',
              groupIds: [6, 9],
              recommendedNatures: ['踏实'],
              mother,
              father,
              natureChance: 0.3,
              femaleChance: 0.5,
              motherGain: 0.15,
              studGain: 0.6,
              expectedValue: 0.75,
              sameSpecies: true,
              nestsNeeded: 2,
            },
          ],
          tasks: [
            {
              account: '账号甲',
              grade: '大婉' as const,
              eggGameId: 3001,
              eggName: '喵喵',
              groupIds: [6, 9],
              recommendedNatures: ['踏实'],
              sourceAccount: '账号乙',
              mother: { ...mother, account: '账号乙' },
              father: { ...father, account: '账号乙' },
              natureChance: 0.3,
              femaleChance: 0.2,
              chance: 0.06,
              sameSpecies: true,
            },
          ],
          helps: [],
          nestsUsed: 2,
        },
      ],
    ]);
    render(<NestPlanCard plans={[plan]} motherSuggestions={motherSuggestions} />);
    expect(screen.getByTestId('mother-nest')).toHaveTextContent('母本配窝');
    // 2026-11-18：母本线写「概率+性格+性别」= 出母 50% × 性格 30%；不再标双收 / 占窝 / 期望
    const motherPairing = screen.getByTestId('mother-pairing');
    expect(motherPairing).toHaveTextContent('15%踏实♀');
    // 2026-11-19：卡头补齐母本自己的性格（不能只写推荐性格）
    expect(motherPairing).toHaveTextContent('15%开朗♀');
    expect(motherPairing).not.toHaveTextContent('推荐性格');
    expect(motherPairing).not.toHaveTextContent('同种 · 双收');
    expect(within(motherPairing).getByText('98dB')).toBeInTheDocument();
    expect(motherPairing).not.toHaveTextContent('母本 +');
    expect(motherPairing).not.toHaveTextContent('种公 +');
    expect(motherPairing).not.toHaveTextContent('占 2 个窝');
    expect(motherPairing).not.toHaveTextContent('期望');
    expect(screen.getByTestId('mother-task')).toHaveTextContent('6%踏实♀');
    expect(screen.getByTestId('mother-task')).toHaveTextContent('6%开朗♀');
    // 2026-11-19：卡头去掉「跨号 · 传蛋」和蛋组，只留性格 / 百分比 / 性别
    const taskHead = screen.getByTestId('mother-task-head');
    expect(taskHead).not.toHaveTextContent('跨号');
    expect(taskHead).not.toHaveTextContent('动物组');
    expect(within(motherPairing).getByTestId('mother-pairing-head')).not.toHaveTextContent('动物组');
    // 谁传给谁放在两张精灵卡下方正中
    expect(screen.getByTestId('mother-task-flow')).toHaveTextContent('账号乙 → 账号甲');
    // 2026-11-19：摆位图已移除，不再画母本黄线
    expect(screen.queryByTestId('nest-layout')).toBeNull();
    // 本号内的母本线要占窝：种公 0 + 母本 2 = 2/11
    expect(screen.getByTestId('breed-account-name')).toHaveTextContent('用 2/11 个窝');
});

/** 造一张只有跨号母本任务的方案，专门验卡头性格过滤 */
const renderMotherTask = (motherNature: string, fatherNature: string): void => {
  const mother = { ...nestPet('m', '喵喵'), gender: '母' as const, nature: motherNature };
  const father = { ...nestPet('f', '喵喵'), gender: '公' as const, nature: fatherNature };
  const motherSuggestions = new Map([
    [
      '账号甲',
      {
        gapCount: 1,
        pairings: [],
        tasks: [
          {
            account: '账号甲',
            grade: '大婉' as const,
            eggGameId: 3001,
            eggName: '喵喵',
            groupIds: [6],
            recommendedNatures: [],
            sourceAccount: '账号乙',
            mother: { ...mother, account: '账号乙' },
            father: { ...father, account: '账号乙' },
            natureChance: 1,
            femaleChance: 0.5,
            chance: 0.5,
            sameSpecies: false,
          },
        ],
        helps: [],
        nestsUsed: 0,
      },
    ],
  ]);
  render(<NestPlanCard plans={[planOf([])]} motherSuggestions={motherSuggestions} />);
};

test('只有双方都是非八大性格时，卡头才写非八大性格', () => {
  renderMotherTask('调皮', '偏执');
  const head = screen.getByTestId('mother-task-head');
  expect(head).toHaveTextContent('15%调皮♀');
  expect(head).toHaveTextContent('15%偏执♀');
  // 「加入传蛋待办」按钮已按用户口径移除
  expect(screen.queryByTestId('mother-task-add')).toBeNull();
});

test('一方是八大性格时，不展示另一方的非八大性格', () => {
  renderMotherTask('开朗', '偏执');
  const head = screen.getByTestId('mother-task-head');
  expect(head).toHaveTextContent('15%开朗♀');
  expect(head).not.toHaveTextContent('偏执');
});

test('公退到非八大时才标「非八大公」，八大公不标（2026-11-19 用户口径）', () => {
  renderMotherTask('开朗', '忧郁');
  expect(screen.getByTestId('mother-task-head')).toHaveTextContent('非八大公');
});

test('公是八大性格时不写「非八大公」', () => {
  renderMotherTask('开朗', '固执');
  expect(screen.queryByTestId('mother-non-eight-stud')).toBeNull();
});

test('内求的线旁边也有「问小组」：传蛋卡和本号内卡各一个，点了回调（2026-11-19 用户口径）', () => {
  const onSeekHelp = vi.fn();
  const mother = { ...nestPet('m', '喵喵'), gender: '母' as const, nature: '开朗' };
  const father = { ...nestPet('f', '喵喵'), gender: '公' as const, nature: '踏实' };
  const motherSuggestions = new Map([
    [
      '账号甲',
      {
        gapCount: 2,
        pairings: [
          {
            account: '账号甲',
            grade: '大婉' as const,
            eggGameId: 3001,
            eggName: '喵喵',
            groupIds: [6],
            recommendedNatures: ['踏实'],
            mother,
            father,
            natureChance: 0.6,
            femaleChance: 0.5,
            motherGain: 0.3,
            studGain: 0,
            expectedValue: 0.3,
            sameSpecies: true,
            nestsNeeded: 2,
          },
        ],
        tasks: [
          {
            account: '账号甲',
            grade: '大婉' as const,
            eggGameId: 3002,
            eggName: '火苗',
            groupIds: [12],
            recommendedNatures: ['固执'],
            sourceAccount: '账号乙',
            mother: { ...mother, account: '账号乙' },
            father: { ...father, account: '账号乙' },
            natureChance: 0.6,
            femaleChance: 0.5,
            chance: 0.3,
            sameSpecies: false,
          },
        ],
        helps: [],
        nestsUsed: 2,
      },
    ],
  ]);
  render(
    <NestPlanCard plans={[planOf([])]} motherSuggestions={motherSuggestions} onSeekHelp={onSeekHelp} />,
  );
  const buttons = screen.getAllByTestId('mother-seek-help');
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toHaveTextContent('问小组');
  fireEvent.click(buttons[0]);
  expect(onSeekHelp).toHaveBeenCalledTimes(1);
});

test('只能求助的蛋：写「最好 30%」，点「向小组求助」回调一次（2026-11-19 用户口径）', () => {
  const onSeekHelp = vi.fn();
  const motherSuggestions = new Map([
    [
      '账号甲',
      {
        gapCount: 1,
        pairings: [],
        tasks: [],
        helps: [
          {
            eggGameId: 3001,
            eggName: '喵喵',
            groupIds: [6, 9],
            recommendedNatures: ['踏实'],
            bestNatureChance: 0.6,
            femaleChance: 0.5,
          },
        ],
        nestsUsed: 0,
      },
    ],
  ]);
  render(
    <NestPlanCard
      plans={[planOf([])]}
      motherSuggestions={motherSuggestions}
      onSeekHelp={onSeekHelp}
    />,
  );
  expect(screen.getByTestId('mother-nest')).toHaveTextContent('求助 1');
  const card = screen.getByTestId('mother-help');
  expect(card).toHaveTextContent('喵喵');
  expect(card).toHaveTextContent('最好 30%');
  fireEvent.click(screen.getByTestId('mother-help-action'));
  expect(onSeekHelp).toHaveBeenCalledTimes(1);
});

describe('NestPlanCard 空方案提示', () => {
  test('页面给了提示语时用页面文案（目标全收齐不再让用户去覆盖度找缺口）', () => {
    render(<NestPlanCard plans={[planOf([])]} emptyNote="种公目标已全部收集，不用再配窝" />);
    expect(screen.getByTestId('breed-empty')).toHaveTextContent('种公目标已全部收集');
  });

  test('没给提示语时保留原来的排查提示', () => {
    render(<NestPlanCard plans={[planOf([])]} />);
    expect(screen.getByTestId('breed-empty')).toHaveTextContent('先到「覆盖度」');
  });
});
