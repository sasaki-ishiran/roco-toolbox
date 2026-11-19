import { beforeEach, describe, expect, test } from 'vitest';
import { buildCoverageSlots, type CoverageFilter } from '../domain/coverageTargets';
import { allNatureNames, targetNaturePool } from '../data/catalog';
import {
  getCoverageFilter,
  resetCoverageFilter,
  toggleAllCustomNatures,
  toggleCustomNature,
  toggleFilterGrade,
  toggleFilterGroup,
  toggleGroupNature,
  setNatureMode,
  setTargetGrade,
} from './coverageFilterStore';

const slotCount = (filter: CoverageFilter): number =>
  buildCoverageSlots(filter, targetNaturePool).length;

const naturesOf = (groupId: number): string[] =>
  getCoverageFilter().naturesByGroup[groupId] ?? [];

describe('覆盖筛选 store', () => {
  beforeEach(() => {
    resetCoverageFilter();
    // 档位 2026-11-18 起是单选、全局口径（入口在看板 / 覆盖度筛选）；「恢复默认」刻意不动它
    setTargetGrade('大婉');
  });

  test('默认：14 蛋组全选、八大性格、档位只勾大婉 → 112 个槽位', () => {
    const filter = getCoverageFilter();
    expect(filter.groupIds).toHaveLength(14);
    expect(filter.grades).toEqual(['大婉']);
    // 2026-11-19 用户口径：默认「八大性格」= 整池 8 个 × 14 组 × 1 档位
    expect(filter.natureMode).toBe('eight');
    expect(slotCount(filter)).toBe(112);
  });

  test('切到自选性格先预选八大，不会从空白开始', () => {
    setNatureMode('custom');
    const filter = getCoverageFilter();
    expect(filter.natureMode).toBe('custom');
    expect(filter.customNatures).toHaveLength(targetNaturePool.length);
    expect(slotCount(filter)).toBe(112);
  });

  test('推荐模式：每蛋组各取前 3 → 42 个槽位', () => {
    setNatureMode('recommended');
    expect(slotCount(getCoverageFilter())).toBe(42);
  });

  test('档位单选：再点一个会替换，不会累加', () => {
    toggleFilterGrade('小婉');
    expect(getCoverageFilter().grades).toEqual(['小婉']);
    expect(slotCount(getCoverageFilter())).toBe(112);
  });

  test('蛋组取消：只影响该组，别组不变', () => {
    toggleFilterGroup(2);
    const filter = getCoverageFilter();
    expect(filter.groupIds).not.toContain(2);
    expect(filter.groupIds).toHaveLength(13);
    expect(slotCount(filter)).toBe(104);
  });

  // 「急躁」不在任何蛋组的默认前 3 里（它是额外目标性格），适合用来验证组内加减。
  // 组内性格只在推荐模式生效，所以这里先切到推荐模式。
  test('组内加减：给某个蛋组加一个非默认性格，只加这一组', () => {
    setNatureMode('recommended');
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

  // R2-4-M01（2026-11-01 用户拍板 B）：全选 / 全部取消只作用于八大，不静默清掉已勾的池外性格
  test('全选八大只补八大，池外已勾的性格保留；再点只取消八大', () => {
    const outside = allNatureNames.find(
      (name) => !targetNaturePool.some((entry) => entry.name === name),
    )!;
    setNatureMode('custom');
    // 切到自选时会预选八大：先清空，才验证「全选只补八大、不动池外」
    toggleAllCustomNatures();
    toggleCustomNature(outside);

    toggleAllCustomNatures();
    const filled = getCoverageFilter().customNatures;
    for (const entry of targetNaturePool) expect(filled).toContain(entry.name);
    expect(filled).toContain(outside);

    toggleAllCustomNatures();
    const cleared = getCoverageFilter().customNatures;
    for (const entry of targetNaturePool) expect(cleared).not.toContain(entry.name);
    expect(cleared).toContain(outside);
  });
});
