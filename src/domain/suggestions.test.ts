import { describe, expect, test } from 'vitest';
import { computeStudRecommendations, emptyRecommendationsNote, findUncataloguedCount } from './suggestions';
import { chainTopNaturesByGameId, species } from '../data/catalog';
import type { CoverageCell, StudCoverageResult } from './studCoverage';
import type { SwapWish } from './swapPlan';

const cell = (
  groupId: number,
  natureName: string,
  state: CoverageCell['state'],
): CoverageCell => ({ groupId, natureId: 2, natureName, grade: '大婉', state });

const mkStud = (cells: CoverageCell[], groupCount = 14): StudCoverageResult => ({
  total: cells.length,
  covered: cells.filter((item) => item.state === 'covered').length,
  cells,
  groupSummary: [],
  passedGroups: cells.length === 0 ? groupCount : 0,
  groupCount,
});

const wish = (over: Partial<SwapWish> = {}): SwapWish => ({
  fillGroups: [2],
  groupLabels: ['巨灵组'],
  natureName: '固执',
  grade: '大婉',
  score: 1,
  suggested: {
    gameId: 3301,
    name: '白发懒人',
    displayName: '白发懒人',
    number: '073',
    owned: false,
  },
  optionCount: 5,
  unownedOptionCount: 5,
  unlockedCells: 0,
  unlockedCellKeys: [],
  ...over,
});

describe('computeStudRecommendations（优质种公推荐的结构化待办）', () => {
  test('性格 = 缺口需要的那个性格（与槽位一致，不再用物种自身性格覆盖）', () => {
    const result = computeStudRecommendations([wish({ natureName: '沉默' })]);
    expect(result).toEqual([
      {
        id: '3301|沉默|大婉|2',
        natureName: '沉默', // 缺口要沉默 → 显示沉默（此前会错显示成该精灵自己的推荐性格）
        displayName: '白发懒人',
        groupLabels: ['巨灵组'],
        grade: '大婉',
        gameId: 3301,
      },
    ]);
  });

  test('一次能补两组的写明是哪两组', () => {
    const result = computeStudRecommendations([
      wish({
        fillGroups: [2, 9],
        groupLabels: ['巨灵组', '拟人组'],
        score: 2,
        suggested: { gameId: 3302, name: '雪豆丁', displayName: '雪豆丁', number: '134', owned: false },
      }),
    ]);
    expect(result).toEqual([
      {
        id: '3302|固执|大婉|2+9',
        natureName: '固执',
        displayName: '雪豆丁',
        groupLabels: ['巨灵组', '拟人组'],
        grade: '大婉',
        gameId: 3302,
      },
    ]);
  });

  test('同一精灵同一性格同一档位、不同组 → 合并成一条（组别取并集）', () => {
    const result = computeStudRecommendations([
      wish({ groupLabels: ['巨灵组'] }),
      wish({ groupLabels: ['拟人组'], fillGroups: [9] }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.groupLabels).toEqual(['巨灵组', '拟人组']);
  });

  test('不同性格是两个不同的目标，不合并', () => {
    const result = computeStudRecommendations([
      wish({ natureName: '固执' }),
      wish({ natureName: '平和' }),
    ]);
    expect(result).toHaveLength(2);
  });

  test('没有要换的缺口时给一行兜底', () => {
    expect(emptyRecommendationsNote(mkStud([cell(2, '固执', 'empty')]))).toBe(
      '当前没有要换的缺口',
    );
  });

  test('所有蛋组已通时兜底文案说明已全通', () => {
    expect(emptyRecommendationsNote(mkStud([], 14))).toBe(
      '种公网络已全通，没有要补的缺口',
    );
  });
});

describe('进化链推荐性格（换蛋候选据此过滤）', () => {
  test('喵喵链：忽略 stage4 的首领形态，取最高阶普通形态（魔力猫 stage3）的推荐', () => {
    const meow = species.find((s) => s.name === '喵喵');
    expect(meow).toBeDefined();
    // 喵喵链的 stage4 全是首领形态（叶冕魔力猫 / 武斗酷猫），排除后最高阶普通形态是 stage3 的魔力猫
    const normalTop = species
      .filter((s) => s.evolutionId === meow!.evolutionId && s.form !== '首领形态')
      .sort((a, b) => (b.stage ?? 0) - (a.stage ?? 0))[0];
    expect(normalTop?.name).toBe('魔力猫');
    expect(chainTopNaturesByGameId.get(meow!.gameId)).toEqual(normalTop.recommendedNatures ?? []);
  });

  test('火花链：首领形态「烈火战神」被排除，取火神 stage3 的「固执、开朗」', () => {
    const spark = species.find((s) => s.name === '火花');
    expect(spark).toBeDefined();
    expect(chainTopNaturesByGameId.get(spark!.gameId)).toEqual(['固执', '开朗']);
  });
});

describe('findUncataloguedCount', () => {
  test('统计图鉴未收录的 gameId 数量', () => {
    expect(findUncataloguedCount([1, 2, 3, 999], new Set([1, 2, 3]))).toBe(1);
  });
});
