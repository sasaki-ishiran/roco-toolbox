import { beforeEach, describe, expect, test } from 'vitest';
import { buildCoverageSlots, type CoverageFilter } from '../domain/coverageTargets';
import { targetNaturePool } from '../data/catalog';
import {
  getCoverageFilter,
  resetCoverageFilter,
  toggleFilterGrade,
  toggleFilterGroup,
  toggleGroupNature,
} from './coverageFilterStore';

const slotCount = (filter: CoverageFilter): number =>
  buildCoverageSlots(filter, targetNaturePool).length;

const naturesOf = (groupId: number): string[] =>
  getCoverageFilter().naturesByGroup[groupId] ?? [];

describe('覆盖筛选 store', () => {
  beforeEach(() => {
    resetCoverageFilter();
    // 档位 2026-10-06 起是全局口径（入口在看板），「恢复默认」刻意不动它 → 测试里显式复位，保证用例隔离
    if (!getCoverageFilter().grades.includes('大婉')) toggleFilterGrade('大婉');
    for (const grade of getCoverageFilter().grades.filter((item) => item !== '大婉')) {
      toggleFilterGrade(grade);
    }
  });

  test('默认：14 蛋组全选、每蛋组推荐前 3、档位只勾大婉 → 42 个槽位', () => {
    const filter = getCoverageFilter();
    expect(filter.groupIds).toHaveLength(14);
    expect(filter.grades).toEqual(['大婉']);
    expect(slotCount(filter)).toBe(42);
  });

  test('档位多选：加一个档位，分母翻倍', () => {
    toggleFilterGrade('小婉');
    expect(getCoverageFilter().grades).toEqual(['大婉', '小婉']);
    expect(slotCount(getCoverageFilter())).toBe(84);
  });

  test('蛋组取消：只影响该组，别组不变', () => {
    toggleFilterGroup(2);
    const filter = getCoverageFilter();
    expect(filter.groupIds).not.toContain(2);
    expect(filter.groupIds).toHaveLength(13);
    expect(slotCount(filter)).toBe(39);
  });

  // 「急躁」不在任何蛋组的默认前 3 里（它是额外目标性格），适合用来验证组内加减
  test('组内加减：给某个蛋组加一个非默认性格，只加这一组', () => {
    toggleGroupNature(2, '急躁');
    expect(naturesOf(2)).toContain('急躁');
    expect(naturesOf(3)).not.toContain('急躁');
    expect(slotCount(getCoverageFilter())).toBe(43);
  });

  test('组内性格按八大池顺序排列，与点击顺序无关', () => {
    toggleGroupNature(2, '急躁');
    const ordered = targetNaturePool.map((entry) => entry.name);
    const names = naturesOf(2);
    expect(names).toEqual([...names].sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b)));
  });
});
