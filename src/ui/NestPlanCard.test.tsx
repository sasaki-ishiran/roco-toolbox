import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import {
  type NestPairing,
  type NestPet,
  type NestPlan,
  type NestTier,
} from '../domain/nestPlan';
import { NestPlanCard } from './NestPlanCard';

const nestPet = (key: string, name: string): NestPet => ({
  key,
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
): NestPairing => ({
  tier: 'normal60',
  groupIds: [2],
  natureName: '固执',
  grade: '大婉',
  account: '账号甲',
  father,
  mother,
  academyParent: null,
  partner: father,
  natureChance: 0.6,
  distance: 8,
  fatherPosition: { x: 8, y: 0 },
  motherPosition: { x: 0, y: 0 },
  expected: { species: mother.name, nature: '固执', body: '大块头', voice: '100' },
  ...over,
});

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
  alternatives: [],
});

describe('LayoutMap 摆位图（单位换算）', () => {
  test('相邻两窝在图上必须相切：1 窝 = 8 单元，不能凭空多出一倍空隙', () => {
    const a = nestPet('a', '甲兽');
    const b = nestPet('b', '乙兽');
    const plan: NestPlan = {
      account: '账号甲',
      pairings: [
        {
          tier: 'normal60',
          groupIds: [2],
          natureName: '固执',
          grade: '大婉',
          account: '账号甲',
          father: a,
          mother: b,
          academyParent: null,
          partner: b,
          natureChance: 0.6,
          distance: 8,
          fatherPosition: { x: 0, y: 0 },
          motherPosition: { x: 8, y: 0 }, // 相隔 1 窝（8 单元）
          expected: { species: '乙兽', nature: '固执', body: '大块头', voice: '100' },
        },
      ],
      blockedLinks: [],
      slots: [
        { position: { x: 0, y: 0 }, pet: a, cluster: 0, academy: false },
        { position: { x: 8, y: 0 }, pet: b, cluster: 0, academy: false },
      ],
      nestsUsed: 2,
      nestsTotal: 11,
      clusters: [[{ x: 0, y: 0 }, { x: 8, y: 0 }]],
      unfilled: [],
      alternatives: [],
    };
    render(<NestPlanCard plans={[plan]} />);
    const rects = [...screen.getByTestId('nest-layout').querySelectorAll('rect')];
    expect(rects).toHaveLength(2);
    const side = Number(rects[0].getAttribute('width'));
    const centerX = (rect: Element): number => Number(rect.getAttribute('x')) + side / 2;
    // 真实小窝是 8×8、紧密并排可以相贴 → 图上相邻两窝中心距应等于窝边长
    expect(centerX(rects[1]) - centerX(rects[0])).toBeCloseTo(side);
    // 四周留了边距：最外圈不贴 viewBox 边缘（描边不会被裁）
    const viewBoxWidth = Number((screen.getByTestId('nest-layout').getAttribute('viewBox') ?? '').split(' ')[2]);
    expect(Number(rects[0].getAttribute('x'))).toBeGreaterThan(0);
    expect(centerX(rects[1]) + side / 2).toBeLessThan(viewBoxWidth);
  });
});

describe('LayoutMap 连线：图层 / 配色 / 公母标注', () => {
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
  });
  const plan: NestPlan = {
    account: '账号甲',
    pairings: [pairingAt(femaleB, { x: 8, y: 0 }, 'normal60'), pairingAt(femaleC, { x: 0, y: 8 }, 'normal30')],
    blockedLinks: [],
    slots: [
      { position: { x: 0, y: 0 }, pet: male, cluster: 0, academy: false },
      { position: { x: 8, y: 0 }, pet: femaleB, cluster: 0, academy: false },
      { position: { x: 0, y: 8 }, pet: femaleC, cluster: 0, academy: false },
    ],
    nestsUsed: 3,
    nestsTotal: 11,
    clusters: [[{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }]],
    unfilled: [],
    alternatives: [],
  };

  test('连线画在窝块之后 → 不会被方块盖住', () => {
    render(<NestPlanCard plans={[plan]} />);
    const tags = [...screen.getByTestId('nest-layout').children].map((el) => el.tagName);
    const lastRect = tags.lastIndexOf('rect');
    const firstLine = tags.indexOf('line');
    expect(lastRect).toBeGreaterThanOrEqual(0);
    expect(firstLine).toBeGreaterThan(lastRect);
  });

  test('不同配对用不同颜色的线；下面的卡片用同色区分', () => {
    render(<NestPlanCard plans={[plan]} />);
    const lines = [...screen.getByTestId('nest-layout').querySelectorAll('line')];
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((line) => line.getAttribute('stroke'))).size).toBe(2);
    const cards = screen.getAllByTestId('breed-suggestion');
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((card) => (card as HTMLElement).style.borderLeftColor)).size).toBe(2);
  });

  test('摆位图里名字下面标出公母', () => {
    render(<NestPlanCard plans={[plan]} />);
    const svg = screen.getByTestId('nest-layout');
    expect(svg.textContent).toContain('♂');
    expect(svg.textContent).toContain('♀');
  });

  test('窝里的名字截到 4 个字，形态名（下划线后）先去掉', () => {
    const mother = { ...nestPet('m', '母方兽'), gender: '母' as const };
    const formed = { ...nestPet('f', '鸭吉吉_起来鸭'), gender: '公' as const };
    render(
      <NestPlanCard
        plans={[
          planOf([pairingOf(mother, formed)], [
            { position: { x: 0, y: 0 }, pet: mother, cluster: 0, academy: false },
            { position: { x: 8, y: 0 }, pet: formed, cluster: 0, academy: false },
          ]),
        ]}
      />,
    );
    const svg = screen.getByTestId('nest-layout');
    expect(svg.textContent).toContain('鸭吉吉');
    expect(svg.textContent).not.toContain('起来鸭');
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

  test('同一对精灵补两个性格（各 30%）→ 百分比显示合计 60%', () => {
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
    expect(row).toHaveTextContent('普通 60%');
    expect(row).not.toHaveTextContent('普通 30%');
  });

  test('建议按「产出目标性格的概率」从高到低排：学院 100% → 60% → 30%', () => {
    const single = female('s', '三成母');
    const singleFather = male('sf', '三成公');
    const duo = female('d', '双成母');
    const duoFather = male('df', '双成公');
    const academy = male('ac', '学院公');
    const academyPartner = female('ap', '配对母');

    render(
      <NestPlanCard
        plans={[
          planOf([
            // 故意倒着放，验证展示时会被重排
            pairingOf(single, singleFather, { tier: 'normal30', natureName: '平和', natureChance: 0.3 }),
            pairingOf(duo, duoFather, { tier: 'normal30', natureName: '急躁', natureChance: 0.3 }),
            pairingOf(duo, duoFather, { tier: 'normal30', natureName: '开朗', natureChance: 0.3 }),
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
    expect(rows[0]).toHaveTextContent('学院 100%');
    expect(rows[1]).toHaveTextContent('普通 60%');
    expect(rows[2]).toHaveTextContent('普通 30%');
  });
});
