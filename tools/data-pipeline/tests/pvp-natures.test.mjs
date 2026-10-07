import { describe, expect, test } from 'vitest';
import {
  extractPvpNatureRecommendations,
  pickRecommendedNatures,
  pickTargetNatures,
  rankNaturesByEggGroup,
} from '../src/pvp-natures.mjs';

const reference = {
  labels: { nature: { 2: { name: '固执' }, 23: { name: '开朗' }, 30: { name: '踏实' } } },
  pets: {
    3001: { pvp: { nature: [[30, 6511], [23, 242]] } },
    3002: { pvp: { nature: [[2, 7093], [23, 645]] } },
    3003: { pvp: { nature: [] } },
    3004: {},
  },
};

describe('extractPvpNatureRecommendations', () => {
  test('取数值最高的性格作为推荐', () => {
    const result = extractPvpNatureRecommendations(reference);
    expect(result['3001']).toEqual({
      natureId: 30,
      count: 6511,
      total: 6753,
      candidateCount: 2,
      candidates: [
        { natureId: 30, count: 6511 },
        { natureId: 23, count: 242 },
      ],
    });
    expect(result['3002']).toEqual({
      natureId: 2,
      count: 7093,
      total: 7738,
      candidateCount: 2,
      candidates: [
        { natureId: 2, count: 7093 },
        { natureId: 23, count: 645 },
      ],
    });
  });

  test('没有候选性格或没有 pvp 数据的精灵不进结果', () => {
    const result = extractPvpNatureRecommendations(reference);
    expect(Object.keys(result).sort()).toEqual(['3001', '3002']);
  });
});

const natureNames = { 2: '固执', 11: '聪明', 23: '开朗', 30: '踏实' };

// 伊兰龙一家：同一形态的三个进化阶段
// 鸭吉吉：两种样子，种族值不同，各算一只
const pets = [
  { game_id: 101, name: '伊雷龙', egg_group: [14], evolution_id: 'evo_ilan', stage: 1 },
  { game_id: 102, name: '伊兰亚龙', egg_group: [14], evolution_id: 'evo_ilan', stage: 2 },
  { game_id: 103, name: '伊兰龙', egg_group: [14], evolution_id: 'evo_ilan', stage: 4 },
  { game_id: 201, name: '鸭吉吉（蓬松的样子）', egg_group: [6, 9], evolution_id: 'evo_duck_a', stage: 1 },
  { game_id: 202, name: '鸭吉吉（紧实的样子）', egg_group: [6, 9], evolution_id: 'evo_duck_b', stage: 1 },
  { game_id: 301, name: '未发现的精灵', egg_group: [1], evolution_id: 'evo_hidden', stage: 1 },
  { game_id: 401, name: '没有推荐的精灵', egg_group: [6], evolution_id: 'evo_none', stage: 1 },
];

const makeRecommendations = (extra = {}) => ({
  101: { natureId: 23, count: 100 },
  102: { natureId: 23, count: 200 },
  103: { natureId: 11, count: 300 },
  201: { natureId: 23, count: 400 },
  202: { natureId: 11, count: 500 },
  301: { natureId: 2, count: 600 },
  ...extra,
});

describe('rankNaturesByEggGroup', () => {
  const recommendations = makeRecommendations();

  test('同一形态的不同进化阶段只算一票，取最高阶级那一条的推荐', () => {
    const ranking = rankNaturesByEggGroup(pets, recommendations, natureNames);
    expect(ranking[14]).toEqual([{ natureId: 11, name: '聪明', count: 1, pets: ['伊兰龙'] }]);
  });

  test('不同形态各算一票，不合并', () => {
    const ranking = rankNaturesByEggGroup(pets, recommendations, natureNames);
    expect(ranking[6]).toEqual([
      { natureId: 11, name: '聪明', count: 1, pets: ['鸭吉吉（紧实的样子）'] },
      { natureId: 23, name: '开朗', count: 1, pets: ['鸭吉吉（蓬松的样子）'] },
    ]);
  });

  test('双蛋组精灵会给两个蛋组各加一次', () => {
    const ranking = rankNaturesByEggGroup(pets, recommendations, natureNames);
    expect(ranking[9]).toHaveLength(2);
  });

  test('不可孵蛋（未发现组）的精灵不参与统计', () => {
    const ranking = rankNaturesByEggGroup(pets, recommendations, natureNames);
    expect(ranking[1]).toBeUndefined();
  });

  test('多个最终形态时取热度更高的那条', () => {
    const withBranch = [
      { game_id: 501, name: '魔力猫', egg_group: [12], evolution_id: 'evo_cat', stage: 4 },
      { game_id: 502, name: '武斗酷猫', egg_group: [12], evolution_id: 'evo_cat', stage: 4 },
    ];
    const ranking = rankNaturesByEggGroup(withBranch, makeRecommendations({ 501: { natureId: 30, count: 10 }, 502: { natureId: 23, count: 999 } }), natureNames);
    expect(ranking[12]).toEqual([{ natureId: 23, name: '开朗', count: 1, pets: ['武斗酷猫'] }]);
  });

  test('家族全部没有推荐时不投票', () => {
    const ranking = rankNaturesByEggGroup(pets, makeRecommendations(), natureNames);
    const counted = Object.values(ranking).flat().reduce((sum, item) => sum + item.count, 0);
    expect(counted).toBe(5); // 伊兰1 + 鸭吉吉2 + 鸭吉吉双蛋组多1 + 未发现0 + 无推荐0
  });
});

describe('pickTargetNatures', () => {
  const ranking = {
    2: [
      { natureId: 2, name: '固执', count: 14 },
      { natureId: 28, name: '平和', count: 6 },
      { natureId: 26, name: '沉默', count: 4 },
      { natureId: 23, name: '开朗', count: 4 },
    ],
    5: [{ natureId: 23, name: '开朗', count: 15 }, { natureId: 2, name: '固执', count: 9 }],
    14: [
      { natureId: 2, name: '固执', count: 2 },
      { natureId: 11, name: '聪明', count: 2 },
      { natureId: 23, name: '开朗', count: 1 },
    ],
  };

  test('每个蛋组取前 3 个性格', () => {
    expect(pickTargetNatures(ranking, 3)).toEqual({ 2: [2, 28, 23], 5: [23, 2], 14: [2, 11, 23] });
  });

  test('数量相同时按性格 id 排序决定先后', () => {
    const [first, second] = pickTargetNatures(ranking, 3)[2].slice(2);
    expect(first).toBe(23); // 开朗(23) 与 沉默(26) 都是 4 票，id 小的在前
    expect(second).toBeUndefined();
  });

  test('蛋组不足 3 个性格时返回现有的全部', () => {
    expect(pickTargetNatures({ 5: ranking[5] }, 3)[5]).toEqual([23, 2]);
  });

  test('空输入返回空对象', () => {
    expect(pickTargetNatures({}, 3)).toEqual({});
  });
});

describe('pickRecommendedNatures（按占比判定推荐性格）', () => {
  /** candidates 按热度降序；total 是全部候选（含未列出）之和，用来算占比 */
  const item = (total, pairs) => ({
    total,
    candidates: pairs.map(([natureId, count]) => ({ natureId, count })),
  });

  test('火神分布：55% / 23% / 1.4%… → 保留前两个', () => {
    // 阈 = max(10%, 55.08%/3≈18.4%) → 23.49% 过线，1.4% 不过
    const value = item(10000, [
      [2, 5508], // 固执 55.08%
      [23, 2349], // 开朗 23.49%
      [1, 140], // 大胆 1.4%
      [4, 139],
      [3, 133],
    ]);
    expect(pickRecommendedNatures(value).map((c) => c.natureId)).toEqual([2, 23]);
  });

  test('一枝独秀：88% / 2% / 1%… → 只留最高那条', () => {
    // 阈 = max(10%, 88%/3≈29.3%) → 2% 不过线
    const value = item(10000, [
      [2, 8800],
      [23, 200],
      [1, 100],
    ]);
    expect(pickRecommendedNatures(value).map((c) => c.natureId)).toEqual([2]);
  });

  test('最高占比不高时，阈值退回到绝对下限 10%', () => {
    // 最高 20% → 20%/3≈6.7% 低于 10% → 用 10%：12% 过线、9% 不过
    const value = item(10000, [
      [2, 2000],
      [23, 1200],
      [1, 900],
    ]);
    expect(pickRecommendedNatures(value).map((c) => c.natureId)).toEqual([2, 23]);
  });

  test('最多保留 3 条', () => {
    const value = item(10000, [
      [1, 3000],
      [2, 2500],
      [3, 2200],
      [4, 1300],
    ]);
    expect(pickRecommendedNatures(value)).toHaveLength(3);
  });

  test('没有 candidates（旧数据）退化为唯一一条', () => {
    expect(pickRecommendedNatures({ natureId: 2, count: 100 }).map((c) => c.natureId)).toEqual([2]);
  });

  test('空输入返回空数组', () => {
    expect(pickRecommendedNatures(undefined)).toEqual([]);
  });
});
