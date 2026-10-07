import { describe, expect, test } from 'vitest';
import { formatSwapWish, formatSwapWishes, rankSwapWishes } from './swapPlan';
import { chainTopNaturesByGameId, species, targetNaturePool } from '../data/catalog';
import type { CoverageCell, CoverageState, StudCoverageResult } from './studCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

const entry = (over: Partial<SpeciesEntry> & { gameId: number }): SpeciesEntry => ({
  key: `pet_${over.gameId}`,
  name: `精灵${over.gameId}`,
  number: String(over.gameId).padStart(3, '0'),
  eggGroups: [2],
  maleCapable: true,
  // 换蛋候选默认本身就是一颗蛋（eggGameId === gameId）；进化形态要显式覆盖成其基础形态
  stage: 1,
  eggGameId: over.gameId,
  // 默认"这只精灵自己能孵出的性格"给全四个，需要收窄的用例自己覆盖
  recommendedNatures: ['固执', '平和', '沉默', '开朗'],
  ...over,
});

const cell = (
  groupId: number,
  natureName: string,
  state: CoverageState,
  grade: CoverageCell['grade'] = '大婉',
): CoverageCell => ({ groupId, natureId: 1, natureName, grade, state });

const mkCoverage = (cells: CoverageCell[]): StudCoverageResult => ({
  total: cells.length,
  covered: cells.filter((item) => item.state === 'covered').length,
  cells,
  groupSummary: [],
  passedGroups: 0,
  groupCount: 0,
});

const eggGroupNames: Record<number, string> = { 2: '巨灵组', 6: '动物组', 9: '拟人组' };

const base = {
  ownedEggGameIds: new Set<number>(),
  maleCapableGameIds: new Set<number>(),
  eggGroupNames,
  owned: [] as OwnedPet[],
  mode: 'perfect' as const,
};

describe('rankSwapWishes 换蛋目标', () => {
  test('双组共同性格两侧都缺 → 一条，score 2，补两个组', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [entry({ gameId: 1, eggGroups: [9, 2] })],
      coverage: mkCoverage([cell(2, '固执', 'empty'), cell(9, '固执', 'empty')]),
      maleCapableGameIds: new Set([1]),
    });

    expect(wishes).toHaveLength(1);
    expect(wishes[0].score).toBe(2);
    expect(wishes[0].fillGroups).toEqual([2, 9]);
    expect(wishes[0].groupLabels).toEqual(['巨灵组', '拟人组']);
    expect(wishes[0].suggested.displayName).toBe('精灵1');
  });

  test('只有一侧缺 → score 1，且单组物种也能进同一条的候选池', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, eggGroups: [2, 9] }),
        entry({ gameId: 2, eggGroups: [2] }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty'), cell(9, '固执', 'covered')]),
      maleCapableGameIds: new Set([1, 2]),
    });

    expect(wishes).toHaveLength(1);
    expect(wishes[0].fillGroups).toEqual([2]);
    // 双组与单组物种都能补「巨灵组」，所以聚合在同一条里
    expect(wishes[0].optionCount).toBe(2);
  });

  test('已覆盖与可自孵的槽位都不算换蛋目标（可自孵自己配窝即可）', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [entry({ gameId: 1, eggGroups: [2] })],
      coverage: mkCoverage([cell(2, '固执', 'covered'), cell(2, '平和', 'breedable')]),
      maleCapableGameIds: new Set([1]),
    });

    expect(wishes).toHaveLength(0);
  });

  test('有满分缺种公要换（差一只带目标性格的），算换蛋目标', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [entry({ gameId: 1, eggGroups: [2] })],
      coverage: mkCoverage([cell(2, '沉默', 'missingStud')]),
      maleCapableGameIds: new Set([1]),
    });

    expect(wishes).toHaveLength(1);
    expect(wishes[0].natureName).toBe('沉默');
  });

  test('不能出公的物种不进候选', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [entry({ gameId: 1, eggGroups: [2], maleCapable: false })],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      maleCapableGameIds: new Set(),
    });

    expect(wishes).toHaveLength(0);
  });

  test('进化形态不进候选：它的蛋归属基础形态，换不到它自己的蛋', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, name: '火花', number: '005', stage: 1 }),
        // 火神是进化形态，eggGameId 指向火花（1）→ 不该成为候选
        entry({ gameId: 2, name: '火神', number: '007', stage: 3, eggGameId: 1 }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      maleCapableGameIds: new Set([1, 2]),
    });

    expect(wishes[0].optionCount).toBe(1);
    expect(wishes[0].suggested.name).toBe('火花');
  });

  test('没有自己的蛋的基础形态也不进候选（海盔虫_磨损的样子这类）', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        // 与基础形态同为 stage1，但 eggGameId 指向另一颗蛋 → 换不到它自己的蛋
        entry({ gameId: 9475, name: '海盔虫_磨损的样子', stage: 1, eggGameId: 9330 }),
        entry({ gameId: 9330, name: '海盔虫_本来的样子', stage: 1 }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      maleCapableGameIds: new Set([9475, 9330]),
    });

    expect(wishes[0].optionCount).toBe(1);
    expect(wishes[0].suggested.name).toBe('海盔虫_本来的样子');
  });

  test('孵不出缺口性格的物种不进候选（显示的性格就是缺口性格）', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 10, recommendedNatures: ['平和'] }), // 只能孵平和
        entry({ gameId: 11, recommendedNatures: ['固执'] }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      maleCapableGameIds: new Set([10, 11]),
    });

    expect(wishes).toHaveLength(1);
    expect(wishes[0].natureName).toBe('固执'); // 性格 = 缺口要的
    expect(wishes[0].optionCount).toBe(1);
    expect(wishes[0].suggested.gameId).toBe(11); // 只留能孵固执的那只
  });

  test('建议物种优先选「未拥有」里图鉴号最小的', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, number: '001' }),
        entry({ gameId: 2, number: '002' }),
        entry({ gameId: 3, number: '003' }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      ownedEggGameIds: new Set([1]),
      maleCapableGameIds: new Set([1, 2, 3]),
    });

    expect(wishes[0].suggested.gameId).toBe(2);
    expect(wishes[0].suggested.owned).toBe(false);
    expect(wishes[0].unownedOptionCount).toBe(2);
    expect(wishes[0].optionCount).toBe(3);
  });

  test('「未拥有」按蛋判：拥有同物种另一形态也算这颗蛋已拥有（回归：有石冠王蜥却推石肤蜥_球球尾巴）', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        // 3106 石肤蜥_本来的样子（本身就是蛋）；3500 石肤蜥_球球尾巴（同物种另一形态，归到 3106）
        entry({ gameId: 3106, name: '石肤蜥_本来的样子', number: '024' }),
        entry({ gameId: 3500, name: '石肤蜥_球球尾巴的样子', number: '024', eggGameId: 3106 }),
        entry({ gameId: 3508, name: '波波螺', number: '171' }),
      ],
      coverage: mkCoverage([cell(2, '平和', 'empty')]),
      // 手里有 3500（同物种另一形态）→ 3106 这颗蛋算已拥有 → 应改推未拥有的 3508
      ownedEggGameIds: new Set([3106]),
      maleCapableGameIds: new Set([3106, 3500, 3508]),
    });

    expect(wishes[0].optionCount).toBe(2); // 3106 与 3508（3500 不是蛋物种，不进候选）
    expect(wishes[0].suggested.gameId).toBe(3508); // 跳过已拥有的 3106
    expect(wishes[0].unownedOptionCount).toBe(1);
  });

  test('同物种同显示名的多只只算一种', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, name: '丢丢', number: '100' }),
        entry({ gameId: 2, name: '丢丢', number: '100' }),
        entry({ gameId: 3, name: '丢丢', number: '100' }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      maleCapableGameIds: new Set([1, 2, 3]),
    });

    expect(wishes[0].optionCount).toBe(1);
    expect(wishes[0].suggested.displayName).toBe('丢丢');
  });

  test('去重按 displayName：同物种不同形态是不同目标，各留一只代表', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, name: '雪绒鸟', form: '春天的样子', number: '100' }),
        entry({ gameId: 2, name: '雪绒鸟', form: '夏天的样子', number: '101' }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      maleCapableGameIds: new Set([1, 2]),
    });

    expect(wishes[0].optionCount).toBe(2);
    expect(wishes[0].suggested.displayName).toBe('雪绒鸟_春天的样子');
  });

  test('displayName 有 officialName 时优先用官方名', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, name: '地鼠', form: '储水时的样子', officialName: '地鼠_储水期的样子' }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty')]),
      maleCapableGameIds: new Set([1]),
    });

    expect(wishes[0].suggested.name).toBe('地鼠');
    expect(wishes[0].suggested.displayName).toBe('地鼠_储水期的样子');
  });

  test('排序：补得多的在前，其次未拥有候选多的在前', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, eggGroups: [2, 9] }),
        entry({ gameId: 2, eggGroups: [6] }),
      ],
      coverage: mkCoverage([
        cell(2, '固执', 'empty'),
        cell(9, '固执', 'empty'),
        cell(6, '开朗', 'empty'),
      ]),
      maleCapableGameIds: new Set([1, 2]),
    });

    expect(wishes.map((wish) => wish.score)).toEqual([2, 1]);
  });

  test('单条复制文本：窝前缀 + 档位 + 性格 + 显示名', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [entry({ gameId: 1, name: '白发懒人' })],
      coverage: mkCoverage([cell(2, '平和', 'empty')]),
      maleCapableGameIds: new Set([1]),
    });

    expect(formatSwapWish(wishes[0], 'perfect')).toBe('满分大婉平和白发懒人');
    expect(formatSwapWish(wishes[0], 'perfect', 'green')).toBe('绿窝满分大婉平和白发懒人');
    expect(formatSwapWish(wishes[0], 'medal', 'plain')).toBe('普通窝大婉平和白发懒人');
  });
});

describe('真实数据：候选只能补「它进化链最高形态能孵出的性格」', () => {
  test('白发懒人 → 瞌睡王 top2（平和/固执）能补；链上孵不出的性格不补', () => {
    const lazy = species.find((s) => s.name === '白发懒人');
    expect(lazy).toBeDefined();
    const top = chainTopNaturesByGameId.get(lazy!.gameId) ?? [];
    expect(top.length).toBeGreaterThan(0);
    const groupId = lazy!.eggGroups.find((g) => g >= 2 && g <= 15)!;

    for (const natureName of top) {
      const wishes = rankSwapWishes({
        ...base,
        species: [lazy!],
        coverage: mkCoverage([cell(groupId, natureName, 'empty')]),
        maleCapableGameIds: new Set([lazy!.gameId]),
      });
      expect(wishes.some((w) => w.natureName === natureName)).toBe(true);
    }

    const outside = targetNaturePool.map((e) => e.name).find((n) => !top.includes(n))!;
    const none = rankSwapWishes({
      ...base,
      species: [lazy!],
      coverage: mkCoverage([cell(groupId, outside, 'empty')]),
      maleCapableGameIds: new Set([lazy!.gameId]),
    });
    expect(none).toHaveLength(0);
  });

  test('换上能救「缺配对方」的格 → 算作马上能配（换上就补 1 格）', () => {
    const mother: OwnedPet = {
      gameId: 1,
      name: '精灵1',
      gender: '母',
      nature: '固执',
      voiceDb: 100,
      medalBody: '大块头',
      isShiny: false,
      account: '账号甲',
    };
    const wishes = rankSwapWishes({
      ...base,
      owned: [mother],
      species: [entry({ gameId: 2, eggGroups: [2] })],
      coverage: mkCoverage([cell(2, '固执', 'missingStud')]),
      maleCapableGameIds: new Set([2]),
    });
    expect(wishes).toHaveLength(1);
    expect(wishes[0].unlockedCells).toBe(1);
    expect(wishes[0].unlockedCellKeys).toEqual(['2|固执|大婉']);
  });

  test('聚合（数据层）：组范围被完全包住的建议不再单独返回', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [
        entry({ gameId: 1, eggGroups: [2] }),
        entry({ gameId: 2, eggGroups: [2, 6] }),
      ],
      coverage: mkCoverage([cell(2, '固执', 'empty'), cell(6, '固执', 'empty')]),
      maleCapableGameIds: new Set([1, 2]),
    });
    // 物种2 一次补 2+6 两组；物种1 只补 2 组 → 只留「2+6」那条
    expect(wishes).toHaveLength(1);
    expect(wishes[0].fillGroups).toEqual([2, 6]);
  });

  test('换上就能补上它自己那一格（另一格没人带该性格 → 补不了）', () => {
    const wishes = rankSwapWishes({
      ...base,
      species: [entry({ gameId: 2, eggGroups: [2] })],
      coverage: mkCoverage([cell(2, '固执', 'empty'), cell(2, '沉默', 'empty')]),
      maleCapableGameIds: new Set([2]),
    });
    // 两个性格各一条，各自换上就补上自己那格（性格不对的那格不受影响）
    expect(wishes).toHaveLength(2);
    expect(wishes.every((wish) => wish.unlockedCells === 1)).toBe(true);
  });
});

describe('formatSwapWishes 整段复制：按档位分块、块间空行', () => {
  const wish = (natureName: string, displayName: string, grade = '大婉') => ({
    fillGroups: [2],
    groupLabels: ['巨灵组'],
    natureName,
    grade: grade as never,
    score: 1,
    suggested: { gameId: 1, name: displayName, displayName, number: '001', owned: false },
    optionCount: 1,
    unownedOptionCount: 1,
    unlockedCells: 0,
    unlockedCellKeys: [],
  });

  test('每块首行是「窝前缀 + 档位」，随后每行「性格 + 显示名」', () => {
    const text = formatSwapWishes(
      [wish('平和', '白发懒人'), wish('固执', '雪绒鸟_夏天的样子')],
      'perfect',
      'green',
    );
    expect(text).toBe('绿窝满分大婉\n平和白发懒人\n固执雪绒鸟_夏天的样子');
  });

  test('不同档位分块，块与块之间空一行', () => {
    const text = formatSwapWishes(
      [wish('平和', '白发懒人'), wish('固执', '雪绒鸟_夏天的样子', '小婉')],
      'perfect',
      'plain',
    );
    expect(text).toBe(
      '普通窝满分大婉\n平和白发懒人\n\n普通窝满分小婉\n固执雪绒鸟_夏天的样子',
    );
  });

  test('不传窝就没有前缀；追双牌下档位不带「满分」', () => {
    const text = formatSwapWishes([wish('平和', '白发懒人')], 'medal');
    expect(text).toBe('大婉\n平和白发懒人');
  });
});
