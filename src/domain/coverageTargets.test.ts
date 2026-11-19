import { describe, expect, test } from 'vitest';
import {
  ALL_EGG_GROUP_IDS,
  ALL_GRADES,
  DEFAULT_GRADES,
  buildCoverageSlots,
  buildDefaultFilter,
} from './coverageTargets';
import type { TargetNature } from './studCoverage';

const pool = [
  { id: 2, name: '固执' },
  { id: 28, name: '平和' },
  { id: 23, name: '开朗' },
  { id: 22, name: '急躁' },
];

const targets: TargetNature[] = [
  { groupId: 2, natureId: 2, name: '固执' },
  { groupId: 2, natureId: 28, name: '平和' },
  { groupId: 2, natureId: 23, name: '开朗' },
  { groupId: 5, natureId: 23, name: '开朗' },
];

describe('覆盖矩阵的筛选与槽位', () => {
  test('蛋组是 14 个可孵蛋组（2~15，不含「未发现」）', () => {
    expect(ALL_EGG_GROUP_IDS).toHaveLength(14);
    expect(Math.min(...ALL_EGG_GROUP_IDS)).toBe(2);
    expect(Math.max(...ALL_EGG_GROUP_IDS)).toBe(15);
  });

  test('默认筛选：蛋组全选、八大性格、档位只勾大婉', () => {
    const filter = buildDefaultFilter(targets);

    expect(filter.groupIds).toHaveLength(14);
    // 2026-11-19 用户口径：默认就是「八大性格」，推荐前 3 只作为切换推荐模式时的组内默认
    expect(filter.natureMode).toBe('eight');
    expect(filter.naturesByGroup[2]).toEqual(['固执', '平和', '开朗']);
    // 没有推荐数据的蛋组默认不勾任何性格，不会强行塞满
    expect(filter.naturesByGroup[6]).toEqual([]);
    expect(filter.grades).toEqual(['大婉']);
    expect(DEFAULT_GRADES).toEqual(['大婉']);
    expect(ALL_GRADES).toHaveLength(4);
  });

  test('槽位 = 蛋组 × 性格 × 档位（默认八大性格 = 整池 8 个）', () => {
    const filter = buildDefaultFilter(targets);
    const slots = buildCoverageSlots(filter, pool);

    // 14 个蛋组 × 4 个性格（本用例的池子）× 1 个档位
    expect(slots).toHaveLength(14 * 4);
    expect(slots[0]).toEqual({ groupId: 2, natureId: 2, natureName: '固执', grade: '大婉' });
  });

  test('性格三模式：八大=整池、推荐=每组前 3、自选=勾选的性格', () => {
    const eight = buildDefaultFilter(targets);
    expect(buildCoverageSlots(eight, pool)).toHaveLength(14 * 4);

    const recommended = { ...eight, natureMode: 'recommended' as const };
    expect(buildCoverageSlots(recommended, pool)).toHaveLength(4);

    const custom = {
      ...eight,
      natureMode: 'custom' as const,
      customNatures: ['固执'],
    };
    expect(new Set(buildCoverageSlots(custom, pool).map((slot) => slot.natureName))).toEqual(
      new Set(['固执']),
    );
  });

  test('多勾档位时格数按倍数展开', () => {
    const filter = { ...buildDefaultFilter(targets), grades: [...ALL_GRADES] };
    const slots = buildCoverageSlots(filter, pool);

    expect(slots).toHaveLength(14 * 4 * 4);
    expect(new Set(slots.map((s) => s.grade)).size).toBe(4);
  });

  test('去掉某个蛋组就不再产出它的槽位', () => {
    const filter = { ...buildDefaultFilter(targets), groupIds: [2] };
    const slots = buildCoverageSlots(filter, pool);

    expect(slots.every((s) => s.groupId === 2)).toBe(true);
    expect(slots).toHaveLength(4);
  });

  test('性格池里没有的名字给出 id 0，不会崩', () => {
    const filter = {
      ...buildDefaultFilter([]),
      groupIds: [2],
      grades: DEFAULT_GRADES,
      natureMode: 'recommended' as const,
    };
    filter.naturesByGroup = { 2: ['不存在的性格'] };
    const slots = buildCoverageSlots(filter, pool);

    expect(slots[0].natureId).toBe(0);
    expect(slots[0].natureName).toBe('不存在的性格');
  });
});
