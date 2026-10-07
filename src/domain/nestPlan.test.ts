import { describe, expect, test } from 'vitest';
import { averageVoice, buildNestPlans } from './nestPlan';
import { checkLayout, nestsConnect, nestsOverlap, type NestPosition } from './nestGeometry';
import type { CoverageCell, StudCoverageResult } from './studCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

/** 跨簇的所有窝对（用来验证「组间不串窝」） */
const crossPairs = (clusters: NestPosition[][]): Array<[NestPosition, NestPosition]> => {
  const pairs: Array<[NestPosition, NestPosition]> = [];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      for (const a of clusters[i]) for (const b of clusters[j]) pairs.push([a, b]);
    }
  }
  return pairs;
};

// 蛋组：巨灵组(2) / 妖精组(7)
const species: SpeciesEntry[] = [
  { key: 'a', gameId: 801, name: '母方兽', number: '801', eggGroups: [2], maleCapable: true },
  { key: 'b', gameId: 802, name: '七号兽', number: '802', eggGroups: [7], maleCapable: true },
  { key: 'c', gameId: 803, name: '双组兽', number: '803', eggGroups: [2, 7], maleCapable: true },
];

const mk = (
  gameId: number,
  name: string,
  gender: '公' | '母' | '未知',
  nature: string,
  account = '账号甲',
): OwnedPet => ({
  gameId,
  name,
  gender,
  nature,
  voiceDb: 100,
  medalBody: '大块头',
  account,
  isShiny: false,
});

const cell = (
  groupId: number,
  natureName: string,
  state: CoverageCell['state'] = 'breedable',
  grade: CoverageCell['grade'] = '大婉',
): CoverageCell => ({ groupId, natureId: 2, natureName, grade, state });

const coverage = (...cells: CoverageCell[]): StudCoverageResult => ({
  total: cells.length,
  covered: 0,
  cells,
  groupSummary: [],
  passedGroups: 0,
  groupCount: cells.length,
});

describe('averageVoice 声音遗传：父母均值向零取整', () => {
  test('双满分 → 满分', () => {
    expect(averageVoice(100, 100)).toBe(100);
  });

  test('100 + 99 只能得 99，而不是四舍五入到 100', () => {
    expect(averageVoice(100, 99)).toBe(99);
    expect(averageVoice(99, 100)).toBe(99);
  });
});

describe('buildNestPlans（第一期：可配建议 / 补齐种公，M1 多路径 + 编组式摆位）', () => {
  // 固执：一公一母都能凑 60%；认真：一只母带性格 + 一只非性格公 → 学院补差（100%）
  const fA = mk(801, '母方兽', '公', '固执');
  const mA = mk(801, '母方兽', '母', '固执');
  const mB = mk(801, '母方兽', '母', '认真');
  const fC = mk(801, '母方兽', '公', '胆小');
  const fE = mk(801, '母方兽', '公', '莽撞');

  test('学院簇单独成组（干净）；同一缺口不再叠第 2 条线（2026-10-06 口径）', () => {
    const [plan] = buildNestPlans({
      species,
      owned: [fA, mA, mB, fC, fE],
      coverage: coverage(cell(2, '固执'), cell(2, '认真')),
      mode: 'perfect',
    });

    // 固执用普通 60%（fA-mA）；认真由学院补差 —— 只留 1 条（fC/fE 是同一格，不再叠加）
    expect(plan.pairings).toHaveLength(2);
    const academy = plan.pairings.filter((p) => p.tier === 'academy');
    expect(academy).toHaveLength(1);
    expect(academy[0].academyParent?.nature).toBe('认真');
    expect(academy[0].natureChance).toBe(1);
    expect(plan.pairings.filter((p) => p.tier === 'normal60')).toHaveLength(1);

    // 摆位：学院那簇 2 个窝与普通那簇 2 个窝**分开**，互相 >17 单元（不串窝）
    expect(plan.clusters.map((cluster) => cluster.length)).toEqual([2, 2]);
    for (const [a, b] of crossPairs(plan.clusters)) {
      expect(nestsOverlap(a, b)).toBe(false);
      expect(nestsConnect(a, b)).toBe(false);
    }
    // 摆位自检：所有声称成立的配对边，都真的在可连范围内（B10 回归网）
    const report = checkLayout(
      plan.clusters,
      plan.pairings.map((pairing) => [pairing.fatherPosition, pairing.motherPosition]),
    );
    expect(report.ok).toBe(true);
    expect(plan.blockedLinks).toEqual([]);
    expect(plan.nestsUsed).toBe(4); // 普通 60% 一对 + 学院 1 条（旧实现会多挂 1 条 → 5 个窝）
    expect(plan.unfilled).toEqual([]);
    expect(plan.slots.filter((slot) => slot.academy)).toHaveLength(1);
  });

  test('学院那只的第 2 条名额给「还没覆盖的格」，不被同格的重复候选占掉（代码审查修）', () => {
    // 学院那只：双组兽(公,固执)；配对方：两只母方兽(g2) + 一只七号兽(g7)
    // → 学院能 100% 补 (2,固执) 和 (7,固执) 两个不同的格
    const academyPet = mk(803, '双组兽', '公', '固执');
    const [plan] = buildNestPlans({
      species,
      owned: [
        academyPet,
        mk(801, '母方兽', '母', '认真'),
        mk(801, '母方兽', '母', '认真'),
        mk(802, '七号兽', '母', '认真'),
      ],
      coverage: coverage(cell(2, '固执'), cell(7, '固执')),
      mode: 'perfect',
    });
    const academy = plan.pairings.filter((pairing) => pairing.tier === 'academy');
    expect(academy).toHaveLength(2);
    // 两条线落在两个**不同**的组上（同格的第 3 条候选不该把 g7 挤掉）
    expect(academy.flatMap((pairing) => pairing.groupIds).sort((a, b) => a - b)).toEqual([2, 7]);
    expect(plan.unfilled).toEqual([]);
  });

  test('学院只接 1 个目标；它的配对方被保留，不再参与别的配对（宁可牺牲也不弄错）', () => {
    const mC = mk(802, '七号兽', '母', '认真');
    const fD = mk(803, '双组兽', '公', '胆小');
    const [plan] = buildNestPlans({
      species,
      owned: [mB, mC, fD],
      coverage: coverage(cell(2, '认真'), cell(7, '认真')),
      mode: 'perfect',
    });
    expect(plan.pairings.filter((p) => p.tier === 'academy')).toHaveLength(1);
    expect(plan.pairings).toHaveLength(1);
    expect(plan.blockedLinks).toEqual([]);
    expect(plan.nestsUsed).toBe(2);
    // fD 已被学院簇保留 → 这格本来能配（有母 mC + 公 fD），但**这轮没排上**
    expect(plan.unfilled).toEqual([
      { groupId: 7, natureName: '认真', grade: '大婉', reason: 'no-room' },
    ]);
  });

  test('性别未知的精灵不能当选学院那只（它配不了，会谎报覆盖）', () => {
    const unknown = mk(801, '母方兽', '未知', '固执');
    const plainMother = mk(801, '母方兽', '母', '认真');
    const [plan] = buildNestPlans({
      species,
      owned: [unknown, plainMother],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
    });
    expect(plan.pairings).toEqual([]);
    expect(plan.slots).toEqual([]);
    // 未知性别既不算公也不算母 → 这格连一只带该性格的都没有 → 要去弄
    expect(plan.unfilled).toEqual([{ groupId: 2, natureName: '固执', grade: '大婉', reason: 'to-collect' }]);
  });

  test('双方都没有目标性格 → 不生成（概率 0，不去赌随机）', () => {
    const plainMother = mk(801, '母方兽', '母', '认真');
    const plainFather = mk(801, '母方兽', '公', '胆小');
    const [plan] = buildNestPlans({
      species,
      owned: [plainMother, plainFather],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
    });
    expect(plan.pairings).toEqual([]);
    expect(plan.nestsUsed).toBe(0);
    expect(plan.slots).toEqual([]);
    expect(plan.unfilled).toEqual([{ groupId: 2, natureName: '固执', grade: '大婉', reason: 'to-collect' }]);
  });

  test('窝位不够时先保普通 60%，剩下的缺口进 unfilled', () => {
    const [plan] = buildNestPlans({
      species,
      owned: [fA, mA, mB, fC],
      coverage: coverage(cell(2, '固执'), cell(2, '认真')),
      mode: 'perfect',
      nestCount: 2,
    });
    expect(plan.pairings).toHaveLength(1);
    expect(plan.pairings[0].tier).toBe('normal60');
    expect(plan.nestsUsed).toBe(2);
    expect(plan.unfilled).toEqual([{ groupId: 2, natureName: '认真', grade: '大婉', reason: 'no-room' }]);
  });

  test('两个账号分工：同一格只让一个账号补，不重复劳动', () => {
    const fA2 = mk(801, '母方兽', '公', '固执', '账号乙');
    const mA2 = mk(801, '母方兽', '母', '固执', '账号乙');
    const plans = buildNestPlans({
      species,
      owned: [fA, mA, fA2, mA2],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
    });
    expect(plans).toHaveLength(2);
    // 同一格只被一个账号接走
    expect(plans.flatMap((plan) => plan.pairings)).toHaveLength(1);
    expect(plans.filter((plan) => plan.pairings.length > 0)).toHaveLength(1);
    // 认领之后另一半也不用再报「没排上」
    expect(plans.flatMap((plan) => plan.unfilled)).toEqual([]);
  });

  test('孵蛋不能跨账号：另一个账号的精灵不参与', () => {
    const otherMother = mk(801, '母方兽', '母', '固执', '账号乙');
    const plans = buildNestPlans({
      species,
      owned: [otherMother, fC],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
    });
    expect(plans).toHaveLength(2);
    expect(plans.find((plan) => plan.account === '账号甲')?.pairings).toEqual([]);
  });

  test('同一缺口不再挂冗余线：补同一个目标的线不再加进来，省下的窝留给玩家', () => {
    const motherA = mk(801, '母方兽', '母', '固执');
    const motherB = mk(801, '母方兽', '母', '固执');
    const motherC = mk(801, '母方兽', '母', '固执');
    const fatherA = mk(801, '母方兽', '公', '固执');
    const fatherB = mk(801, '母方兽', '公', '固执');
    const [plan] = buildNestPlans({
      species,
      owned: [motherA, motherB, fatherA, motherC, fatherB],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
    });
    // 3 母 × 2 公都能配同 1 格 → 只留最先那条；其余不再叠（旧实现会挂满 6 条）
    expect(plan.pairings).toHaveLength(1);
    expect(plan.nestsUsed).toBe(2);
    expect(plan.unfilled).toEqual([]);
  });

  test('同名同性格的两只精灵仍是两个个体：候选里各自独立（不按内容指纹去重）', () => {
    const motherA = mk(801, '母方兽', '母', '固执');
    const twinMother = mk(801, '母方兽', '母', '固执');
    const father = mk(801, '母方兽', '公', '固执');
    const [plan] = buildNestPlans({
      species,
      owned: [motherA, twinMother, father],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
      // 只够 1 条线 → 另一只母本落进候选，两只个体各算一份
      nestCount: 1,
    });
    expect(plan.alternatives).toHaveLength(1);
    expect(plan.alternatives[0].count).toBe(2);
  });

  test('一条线同时补两个性格缺口（普通窝 30%+30%）时，两个缺口都算它补上', () => {
    // 学院被别的组占走（鸭吉吉 1:2 补两个「胆小」格，收益 2 最高）→ 巨灵组这两格只剩普通线。
    // 手里只有这一对能配（没有第二个公可选）→ 这两个缺口都由这对精灵补上。
    const speciesEx: SpeciesEntry[] = [
      { key: 'bird', gameId: 901, name: '噼啪鸟', number: '901', eggGroups: [2], maleCapable: true },
      { key: 'star', gameId: 902, name: '粉星仔', number: '902', eggGroups: [2], maleCapable: true },
      { key: 'duck', gameId: 904, name: '鸭吉吉', number: '904', eggGroups: [7, 8], maleCapable: true },
      { key: 'm7', gameId: 905, name: '七号兽母', number: '905', eggGroups: [7], maleCapable: true },
      { key: 'm8', gameId: 906, name: '八号兽母', number: '906', eggGroups: [8], maleCapable: true },
    ];
    const [plan] = buildNestPlans({
      species: speciesEx,
      owned: [
        mk(901, '噼啪鸟', '母', '平和'),
        mk(902, '粉星仔', '公', '开朗'),
        mk(904, '鸭吉吉', '公', '胆小'),
        mk(905, '七号兽母', '母', '认真'),
        mk(906, '八号兽母', '母', '认真'),
      ],
      coverage: coverage(cell(2, '开朗'), cell(2, '平和'), cell(7, '胆小'), cell(8, '胆小')),
      mode: 'perfect',
    });
    // 「噼啪鸟 ♀ 平和」× 「粉星仔 ♂ 开朗」：随母 30% 平和 + 随父 30% 开朗 → 一条线补两格
    const cross = plan.pairings.filter(
      (pairing) => pairing.mother.name === '噼啪鸟' && pairing.father.name === '粉星仔',
    );
    expect(new Set(cross.map((pairing) => pairing.natureName))).toEqual(new Set(['平和', '开朗']));
    expect(plan.unfilled).toEqual([]);
  });

  test('学院候选能服务多个蛋组：其中一组已有 60% 时，另一组不该被整条砍掉', () => {
    const academyFather = mk(803, '双组兽', '公', '固执');
    const partner = mk(803, '双组兽', '母', '认真');
    const plainMother = mk(801, '母方兽', '母', '固执');
    const plainFather = mk(801, '母方兽', '公', '固执');
    const [plan] = buildNestPlans({
      species,
      owned: [academyFather, partner, plainMother, plainFather],
      coverage: coverage(cell(2, '固执'), cell(7, '固执')),
      mode: 'perfect',
    });
    // 2 组有普通 60%（801 那对），7 组只有学院这条路 → 学院那只该同时补两组
    const academy = plan.pairings.filter((pairing) => pairing.tier === 'academy');
    expect(academy).toHaveLength(1);
    expect(academy[0].groupIds).toEqual([2, 7]);
    expect(plan.unfilled).toEqual([]);
  });

  test('「换这条」：点中的候选优先进来，原来那条让位（窝不够时尤其明显）', () => {
    const motherX = mk(801, '母方兽', '母', '固执');
    const fatherX = mk(801, '母方兽', '公', '固执');
    const motherY = mk(801, '母方兽', '母', '认真');
    const fatherY = mk(801, '母方兽', '公', '认真');
    const input = {
      species,
      owned: [motherX, fatherX, motherY, fatherY],
      coverage: coverage(cell(2, '固执'), cell(2, '认真')),
      mode: 'perfect' as const,
      nestCount: 2,
    };
    // 自动：只有 2 个窝，算法先保「固执」那条 60%
    const [auto] = buildNestPlans(input);
    expect(auto.pairings).toHaveLength(1);
    expect(auto.pairings[0].natureName).toBe('固执');

    // 用户改用候选里的「母方兽认真 × 母方兽认真」那条（学院档，点它就用它）
    const wanted = auto.alternatives.find(
      (option) => option.natureName === '认真' && option.pairKey === '母方兽|认真×母方兽|认真',
    )!;
    expect(wanted.newNests).toBe(2);
    const [pinned] = buildNestPlans({
      ...input,
      pinned: [{ account: '账号甲', natureName: '认真', grade: '大婉', pairKey: wanted.pairKey }],
    });
    expect(pinned.pairings).toHaveLength(1);
    expect(pinned.pairings[0].natureName).toBe('认真');
    expect(pinned.pairings[0].tier).toBe('academy');
    // 让位的那条回到「没排上」
    expect(pinned.unfilled.map((item) => item.natureName)).toEqual(['固执']);
  });

  test('候选配对会带上「用它要多占几个窝」和个体标识（供界面换用）', () => {
    const motherX = mk(801, '母方兽', '母', '固执');
    const fatherX = mk(801, '母方兽', '公', '固执');
    const motherY = mk(801, '母方兽', '母', '认真');
    const fatherY = mk(801, '母方兽', '公', '认真');
    const [plan] = buildNestPlans({
      species,
      owned: [motherX, fatherX, motherY, fatherY],
      coverage: coverage(cell(2, '固执'), cell(2, '认真')),
      mode: 'perfect',
      nestCount: 2,
    });
    const alternative = plan.alternatives.find(
      (option) => option.natureName === '认真' && option.pairKey === '母方兽|认真×母方兽|认真',
    )!;
    // 那两只都还没被方案用上 → 换它要多占 2 个窝
    expect(alternative.newNests).toBe(2);
    expect(alternative.pairKey).toBe('母方兽|认真×母方兽|认真');
  });

  test('候选配对不再列出「算法已经放弃的学院档」（否则候选全是学院小窝）', () => {
    const [plan] = buildNestPlans({
      species,
      owned: [
        mk(801, '母方兽', '母', '固执'),
        mk(801, '母方兽', '公', '固执'),
        mk(801, '母方兽', '母', '认真'),
        mk(801, '母方兽', '公', '认真'),
      ],
      coverage: coverage(cell(2, '固执'), cell(2, '认真')),
      mode: 'perfect',
      nestCount: 2,
    });
    // 这两个缺口的学院档都被「已有普通 60%」过滤掉了 → 候选里不该再出现学院档
    expect(plan.alternatives.length).toBeGreaterThan(0);
    expect(plan.alternatives.every((option) => option.tier !== 'academy')).toBe(true);
  });

  test('同名同性格同档位的两只个体：候选只列一条并记数量（不再铺重复行）', () => {
    const [plan] = buildNestPlans({
      species,
      owned: [
        mk(801, '母方兽', '母', '固执'),
        mk(801, '母方兽', '公', '固执'),
        mk(801, '母方兽', '公', '固执'),
      ],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
      // 窝位只够 1 个 → 两条等价候选都进候选列表，合并成 1 条
      nestCount: 1,
    });
    expect(plan.alternatives).toHaveLength(1);
    expect(plan.alternatives[0].count).toBe(2);
  });

  test('已被覆盖（covered）的性格：合法连线不误报为 blockedLinks（m1：判定用全量格）', () => {
    const mA = mk(801, '母方兽', '母', '认真');
    const fB = mk(801, '母方兽', '公', '认真');
    const mC = mk(801, '母方兽', '母', '固执');
    const fD = mk(801, '母方兽', '公', '固执');
    const [plan] = buildNestPlans({
      species,
      owned: [mA, fB, mC, fD],
      // 固执格已有种公（covered）→ 不进分工格，但 mC×fD 对它仍是 60% 的合法连线
      coverage: coverage(cell(2, '认真'), cell(2, '固执', 'covered')),
      mode: 'perfect',
    });
    expect(plan.blockedLinks).toEqual([]);
  });

  test('学院小窝该给「能一次吃掉两个缺口」的那只（1:2），而不是先到先得', () => {
    // 用户实测口径（测试丙账号的最小复现）：火花(开朗)在绿窝能 1:2 —— 开朗动物组 + 开朗昆虫组
    // 都 100%；鸭吉吉(胆小)只能补一个妖精组胆小。现在算法却先到先得把绿窝给了鸭吉吉，
    // 火花被丢去普通窝只跑 30% → 总期望 1.6 < 2.3
    const speciesEx: SpeciesEntry[] = [
      { key: 'fire', gameId: 901, name: '火花', number: '901', eggGroups: [2, 7], maleCapable: true },
      { key: 'crawler', gameId: 902, name: '矮脚爬爬', number: '902', eggGroups: [2], maleCapable: true },
      { key: 'unicorn', gameId: 903, name: '小独角兽', number: '903', eggGroups: [7], maleCapable: true },
      { key: 'duck', gameId: 904, name: '鸭吉吉', number: '904', eggGroups: [8], maleCapable: true },
      { key: 'star', gameId: 905, name: '粉星仔', number: '905', eggGroups: [8], maleCapable: true },
    ];
    const [plan] = buildNestPlans({
      species: speciesEx,
      owned: [
        mk(901, '火花', '公', '开朗'),
        mk(902, '矮脚爬爬', '母', '认真'),
        mk(903, '小独角兽', '母', '认真'),
        mk(904, '鸭吉吉', '公', '胆小'),
        mk(905, '粉星仔', '母', '认真'),
      ],
      coverage: coverage(cell(2, '开朗'), cell(7, '开朗'), cell(8, '胆小')),
      mode: 'perfect',
    });
    const academy = plan.pairings.filter((pairing) => pairing.tier === 'academy');
    expect(academy).toHaveLength(2); // 火花 1:2
    expect(academy.every((pairing) => pairing.academyParent?.nature === '开朗')).toBe(true);
    expect(new Set(academy.flatMap((pairing) => pairing.groupIds)).size).toBe(2); // 动物组 + 昆虫组
    // 鸭吉吉退到普通窝，30% 补妖精组胆小（100% + 100% + 30% = 2.3）
    const normal = plan.pairings.filter((pairing) => pairing.tier !== 'academy');
    expect(normal).toHaveLength(1);
    expect(normal[0].natureName).toBe('胆小');
    expect(normal[0].tier).toBe('normal30');
    expect(plan.unfilled).toEqual([]);
  });

  test('公母均衡：两格摊给两只母，各自配一只公（不把两格挂在同一只母上）', () => {
    // 「平和」「开朗」两格各有 2 只母可选（母A/母B）× 2 只公可选（公C 平和 / 公D 开朗）
    // → 应该摊成 母A×公C + 母B×公D；旧实现会把两格都挂在母A 上（母A×公C + 母A×公D）
    const [plan] = buildNestPlans({
      species,
      owned: [
        mk(801, '母方兽', '母', '认真'),
        mk(801, '母方兽', '母', '认真'),
        mk(803, '双组兽', '公', '认真'), // 学院的配对方（不承担别的缺口，避免占掉平和/开朗的载体）
        mk(801, '母方兽', '公', '平和'),
        mk(801, '母方兽', '公', '开朗'),
        mk(803, '双组兽', '母', '胆小'), // 学院那只：能 100% 补 (2,胆小)+(7,胆小)
      ],
      coverage: coverage(cell(2, '平和'), cell(2, '开朗'), cell(2, '胆小'), cell(7, '胆小')),
      mode: 'perfect',
    });
    const counts = plan.slots.reduce(
      (acc, slot) => {
        acc[slot.pet.gender] += 1;
        return acc;
      },
      { 公: 0, 母: 0 },
    );
    expect(counts).toEqual({ 公: 3, 母: 3 }); // 学院 1 母 + 1 公；两格摊给两只母（1:1）
    expect(plan.unfilled).toEqual([]);
  });

  test('公母尽量 1:1：有替代公本时，每只母配自己的公，而不是让一只公挂多只母', () => {
    // 「固执」格有普通 60%（母固执 × 公固执）；「认真」「胆小」两格只能 30%（配对方是非目标性格的公）。
    // 旧实现「母优先、公复用」会把这两格都挂到已放下的公固执上 → 1 公 3 母；
    // 新口径优先补齐公本 → 3 公 3 母（11 窝的最优是 5 公 6 母，公母比 1:1）。
    const [plan] = buildNestPlans({
      species,
      owned: [
        mk(801, '母方兽', '母', '固执'),
        mk(801, '母方兽', '公', '固执'),
        mk(801, '母方兽', '母', '认真'),
        mk(801, '母方兽', '母', '胆小'),
        mk(801, '母方兽', '公', '天真'), // 非目标性格，只能当配对方
        mk(801, '母方兽', '公', '调皮'), // 同上
      ],
      coverage: coverage(cell(2, '固执'), cell(2, '认真'), cell(2, '胆小')),
      mode: 'perfect',
    });
    const counts = plan.slots.reduce(
      (acc, slot) => {
        acc[slot.pet.gender] += 1;
        return acc;
      },
      { 公: 0, 母: 0 },
    );
    expect(counts).toEqual({ 公: 3, 母: 3 });
    expect(Math.abs(counts.公 - counts.母)).toBeLessThanOrEqual(1);
    expect(plan.unfilled).toEqual([]);
  });

  test('B10 回归：≥5 个窝挤在同一簇时，画出来的每条线都真的连得上、且互不重叠', () => {
    // 1 只公串起 4 只母、4 个不同缺口 → 5 个窝连成一簇
    const [plan] = buildNestPlans({
      species,
      owned: [
        mk(801, '母方兽', '母', '固执'),
        mk(801, '母方兽', '母', '认真'),
        mk(801, '母方兽', '母', '胆小'),
        mk(801, '母方兽', '母', '莽撞'),
        mk(801, '母方兽', '公', '固执'),
      ],
      coverage: coverage(cell(2, '固执'), cell(2, '认真'), cell(2, '胆小'), cell(2, '莽撞')),
      mode: 'perfect',
    });
    expect(plan.clusters).toHaveLength(1); // 1 只公同时配 4 只母 → 同一簇
    expect(plan.nestsUsed).toBeGreaterThanOrEqual(5);
    const positions = plan.slots.map((slot) => slot.position);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(nestsOverlap(positions[i], positions[j])).toBe(false);
      }
    }
    for (const pairing of plan.pairings) {
      expect(nestsConnect(pairing.fatherPosition, pairing.motherPosition)).toBe(true);
    }
    const report = checkLayout(
      plan.clusters,
      plan.pairings.map((pairing) => [pairing.fatherPosition, pairing.motherPosition]),
    );
    expect(report.ok).toBe(true);
    expect(plan.blockedLinks).toEqual([]);
  });

  test('母方物种出不了公 → 不生成注定孵不出种公的配对，缺口如实留成未排上', () => {
    const withPure: SpeciesEntry[] = [
      ...species,
      { key: 'd', gameId: 804, name: '纯母兽', number: '804', eggGroups: [2], maleCapable: false },
    ];
    // 纯母兽（出不了公）带目标性格 + 一只蛋组相容的公：旧实现会推出学院/普通配对，
    // 但后代随母方、永远不是公 → 该格其实补不上，必须留成「要去弄」
    const pureMother = mk(804, '纯母兽', '母', '固执');
    const father = mk(801, '母方兽', '公', '胆小');
    const [plan] = buildNestPlans({
      species: withPure,
      owned: [pureMother, father],
      coverage: coverage(cell(2, '固执')),
      mode: 'perfect',
    });
    expect(plan.pairings).toEqual([]);
    expect(plan.slots).toEqual([]);
    expect(plan.unfilled).toEqual([
      { groupId: 2, natureName: '固执', grade: '大婉', reason: 'to-collect' },
    ]);
  });
});
