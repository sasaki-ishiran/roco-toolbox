import { describe, expect, test } from 'vitest';
import { buildMotherNestSuggestions } from './motherNest';
import type { MotherCriteria } from './motherCriteria';
import type { CoverageCell, StudCoverageResult } from './studCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

const species: SpeciesEntry[] = [
  { key: 'a', gameId: 801, name: '喵喵', number: '801', eggGameId: 801, eggGroups: [6, 9], maleCapable: true, genderRatio: { male: 5, female: 5 } },
  { key: 'b', gameId: 802, name: '火苗', number: '802', eggGameId: 802, eggGroups: [12, 2], maleCapable: true, genderRatio: { male: 8, female: 2 } },
  { key: 'c', gameId: 803, name: '火神', number: '803', eggGameId: 802, eggGroups: [12, 2], maleCapable: true, genderRatio: { male: 8, female: 2 } },
  { key: 'd', gameId: 804, name: '云朵朵', number: '804', eggGameId: 804, eggGroups: [6, 9], maleCapable: false, genderRatio: { male: 0, female: 10 } },
];

const mk = (
  gameId: number,
  gender: '公' | '母',
  nature: string,
  account: string,
  overrides: Partial<OwnedPet> = {},
): OwnedPet => ({
  gameId,
  name: species.find((entry) => entry.gameId === gameId)!.name,
  gender,
  nature,
  voiceDb: 100,
  medalBody: '大块头',
  account,
  isShiny: false,
  ...overrides,
});

const cell = (
  groupId: number,
  natureName: string,
  state: CoverageCell['state'] = 'breedable',
): CoverageCell => ({ groupId, natureId: 2, natureName, grade: '大婉', state });

const coverage = (...cells: CoverageCell[]): StudCoverageResult => ({
  total: cells.length,
  covered: 0,
  cells,
  groupSummary: [],
  passedGroups: 0,
  groupCount: cells.length,
});

const criteria: MotherCriteria = {
  grades: ['大婉'],
  targetMode: 'perfect',
  recommendedNatures: true,
  bodies: [],
  voices: [],
};

const naturesOf = (gameId: number): readonly string[] =>
  gameId === 801 ? ['踏实'] : gameId === 802 ? ['固执'] : [];

const plan = (account: string, nestsUsed = 0, slots: Array<{ key: string }> = []) => ({
  account,
  slots: slots.map((slot) => ({ pet: slot })),
  nestsUsed,
  nestsTotal: 11,
});

describe('母本配窝建议', () => {
  test('本号只能 30%（公不同性格）→ 不占窝，改「向小组求助」', () => {
    // 母带开朗、公带踏实：推荐性格只能带 30%，不值得占窝（2026-11-19 用户口径）
    const mother = mk(801, '母', '开朗', '甲');
    const father = mk(801, '公', '踏实', '甲');
    const result = buildMotherNestSuggestions({
      species,
      owned: [mother, father],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf,
      coverageByAccount: new Map([['甲', coverage(cell(6, '踏实'))]]),
      plans: [plan('甲')],
    });
    const account = result.get('甲')!;
    expect(account.pairings).toEqual([]);
    expect(account.nestsUsed).toBe(0);
    expect(account.helps).toHaveLength(1);
    expect(account.helps[0].eggName).toBe('喵喵');
    // 性格 30% × 出母 50% = 15%：求助条目要带上公母比例，和卡头一个口径
    expect(account.helps[0].bestNatureChance).toBeCloseTo(0.3);
    expect(account.helps[0].femaleChance).toBeCloseTo(0.5);
  });

  test('母本体型不达标 → 本号内不给线（换公也补不回来）', () => {
    const smallMother = mk(801, '母', '开朗', '甲', { medalBody: '小不点', voiceDb: 60 });
    const father = mk(802, '公', '固执', '甲');
    const result = buildMotherNestSuggestions({
      species,
      owned: [smallMother, father],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf,
      coverageByAccount: new Map([['甲', coverage(cell(6, '踏实'))]]),
      plans: [plan('甲')],
    });
    expect(result.get('甲')!.pairings).toEqual([]);
  });

  test('本号已有达标母本 → 不再给这一颗蛋的母本线', () => {
    const qualifiedMother = mk(801, '母', '踏实', '甲');
    const father = mk(801, '公', '踏实', '甲');
    const result = buildMotherNestSuggestions({
      species,
      owned: [qualifiedMother, father],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf,
      coverageByAccount: new Map([['甲', coverage(cell(6, '踏实'))]]),
      plans: [plan('甲')],
    });
    expect(result.get('甲')!.pairings).toEqual([]);
  });

  test('别的号能到 30%（60% 性格 × 50% 出母）→ 传蛋；本号不占窝', () => {
    // 甲只有喵喵公（同种），没有喵喵母；乙有喵喵母（固执）+ 喵喵公（固执）→ 60% × 50% = 30%
    const receiver = mk(801, '公', '固执', '甲');
    const donorMother = mk(801, '母', '固执', '乙');
    const donorFather = mk(801, '公', '固执', '乙');
    const result = buildMotherNestSuggestions({
      species,
      owned: [receiver, donorMother, donorFather],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf: (gameId) => (gameId === 801 ? ['固执'] : []),
      coverageByAccount: new Map([
        ['甲', coverage(cell(6, '固执'))],
        ['乙', coverage()],
      ]),
      plans: [plan('甲'), plan('乙')],
    });
    const account = result.get('甲')!;
    expect(account.pairings).toEqual([]);
    const task = account.tasks.find((item) => item.eggGameId === 801)!;
    expect(task.sourceAccount).toBe('乙');
    expect(task.natureChance).toBeCloseTo(0.6);
    expect(task.femaleChance).toBeCloseTo(0.5);
    expect(task.chance).toBeCloseTo(0.3);
  });

  test('2:8 的蛋：性格 60% 也只有 12%（× 出母 20%）→ 不给传蛋，改求助', () => {
    const receiver = mk(802, '公', '固执', '甲');
    const donorMother = mk(802, '母', '固执', '乙');
    const donorFather = mk(802, '公', '固执', '乙');
    const result = buildMotherNestSuggestions({
      species,
      owned: [receiver, donorMother, donorFather],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf,
      coverageByAccount: new Map([['甲', coverage()], ['乙', coverage()]]),
      plans: [plan('甲'), plan('乙')],
    });
    const account = result.get('甲')!;
    expect(account.tasks).toEqual([]);
    const help = account.helps.find((item) => item.eggGameId === 802)!;
    expect(help.bestNatureChance).toBeCloseTo(0.6);
    expect(help.femaleChance).toBeCloseTo(0.2);
  });

  test('只出母的蛋（出母 100%）：性格 30% 也有 30% → 本号自己排', () => {
    const mother = mk(804, '母', '开朗', '甲');
    const father = mk(804, '公', '踏实', '甲');
    const result = buildMotherNestSuggestions({
      species,
      owned: [mother, father],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf: (gameId) => (gameId === 804 ? ['踏实'] : []),
      coverageByAccount: new Map([['甲', coverage()]]),
      plans: [plan('甲')],
    });
    const account = result.get('甲')!;
    expect(account.helps).toEqual([]);
    expect(account.pairings).toHaveLength(1);
    expect(account.pairings[0].motherGain).toBeCloseTo(0.3);
  });

  test('跨号只收真实概率 ≥ 30% 的那对：只能 15% 的源号不再进方案', () => {
    const receiver = mk(801, '公', '固执', '甲');
    const weakMother = mk(801, '母', '开朗', '乙');
    const weakFather = mk(801, '公', '固执', '乙');
    const strongMother = mk(801, '母', '固执', '丙');
    const strongFather = mk(801, '公', '固执', '丙');
    const result = buildMotherNestSuggestions({
      species,
      owned: [receiver, weakMother, weakFather, strongMother, strongFather],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf: (gameId) => (gameId === 801 ? ['固执'] : []),
      coverageByAccount: new Map([['甲', coverage()]]),
      plans: [plan('甲'), plan('乙'), plan('丙')],
    });
    const task = result.get('甲')!.tasks.find((item) => item.eggGameId === 801)!;
    expect(task.sourceAccount).toBe('丙');
    expect(task.natureChance).toBeCloseTo(0.6);
    expect(task.chance).toBeCloseTo(0.3);
  });

  test('跨号同等概率 → 优先带八大性格的公，不抓非八大', () => {
    // 推荐 [沉默, 忧郁]：源号母本沉默 × 公沉默 / 公忧郁都是 60%，必须挑八大的沉默
    const receiver = mk(801, '公', '固执', '甲');
    const donorMother = mk(801, '母', '沉默', '乙');
    const nonEightFather = mk(801, '公', '忧郁', '乙');
    const eightFather = mk(801, '公', '沉默', '乙');
    const result = buildMotherNestSuggestions({
      species,
      owned: [receiver, donorMother, nonEightFather, eightFather],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf: (gameId) => (gameId === 801 ? ['沉默', '忧郁'] : []),
      coverageByAccount: new Map([['甲', coverage()], ['乙', coverage()]]),
      plans: [plan('甲'), plan('乙')],
    });
    const task = result.get('甲')!.tasks.find((item) => item.eggGameId === 801)!;
    expect(task.father.nature).toBe('沉默');
    expect(task.natureChance).toBeCloseTo(0.6);
  });

  test('跨号只有非八大公能到 60% → 软门槛：仍是传蛋方案，不把缺口丢掉', () => {
    const receiver = mk(801, '公', '固执', '甲');
    const donorMother = mk(801, '母', '忧郁', '乙');
    const donorFather = mk(801, '公', '忧郁', '乙');
    const result = buildMotherNestSuggestions({
      species,
      owned: [receiver, donorMother, donorFather],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf: (gameId) => (gameId === 801 ? ['忧郁'] : []),
      coverageByAccount: new Map([['甲', coverage()], ['乙', coverage()]]),
      plans: [plan('甲'), plan('乙')],
    });
    const task = result.get('甲')!.tasks.find((item) => item.eggGameId === 801)!;
    expect(task.father.nature).toBe('忧郁');
    expect(task.natureChance).toBeCloseTo(0.6);
  });

  test('求助只列「手里已经有这只蛋母本」的蛋，不把没母本的蛋铺满', () => {
    // 甲只有一个火苗公：既没有 801 母本、别的号也没有 → 不产生求助条目
    const receiver = mk(802, '公', '固执', '甲');
    const result = buildMotherNestSuggestions({
      species,
      owned: [receiver],
      mode: 'perfect',
      grade: '大婉',
      criteria,
      naturesOf,
      coverageByAccount: new Map([['甲', coverage()]]),
      plans: [plan('甲')],
    });
    expect(result.get('甲')!.helps).toEqual([]);
  });

  test('不要求推荐性格 → 本号内不排母本线；2:8 的蛋按出母 20% 判，仍不到 30% → 求助', () => {
    const mother = mk(801, '母', '开朗', '甲');
    const father = mk(801, '公', '踏实', '甲');
    const receiver = mk(802, '公', '固执', '甲');
    const donorMother = mk(802, '母', '开朗', '乙');
    const donorFather = mk(802, '公', '固执', '乙');
    const result = buildMotherNestSuggestions({
      species,
      owned: [mother, father, receiver, donorMother, donorFather],
      mode: 'perfect',
      grade: '大婉',
      criteria: { ...criteria, recommendedNatures: false },
      naturesOf,
      coverageByAccount: new Map([['甲', coverage()]]),
      plans: [plan('甲'), plan('乙')],
    });
    const account = result.get('甲')!;
    expect(account.pairings).toEqual([]);
    // 不要求性格时性格概率按 100% 算，但 2:8 的蛋出母只有 20%，真实概率仍不到 30% → 求助
    const help = account.helps.find((item) => item.eggGameId === 802)!;
    expect(help.bestNatureChance).toBeCloseTo(1);
    expect(help.femaleChance).toBeCloseTo(0.2);
  });
});
