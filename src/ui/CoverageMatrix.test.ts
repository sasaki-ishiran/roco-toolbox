import { describe, expect, test } from 'vitest';
import { type GroupRow, groupTone, orderGroupRows } from './CoverageMatrix';

/**
 * 覆盖度蛋组行的排序（2026-10-07 用户要求：未收集多的先展示）。
 * 口径 = 行首圆点的状态色档从差到好（灰 → 橙 → 蓝 → 绿），同色档再比「还差几行」。
 */
const row = (groupId: number, covered: number, total: number): GroupRow => ({
  groupId,
  covered,
  total,
  state: 'empty',
});

describe('蛋组行状态色档 groupTone', () => {
  test('灰（一格没通）→ 橙（通了一部分）→ 蓝（有可迭代）→ 绿（全通）', () => {
    expect(groupTone(row(2, 0, 3), new Set())).toBe('gray');
    expect(groupTone(row(2, 1, 3), new Set())).toBe('amber');
    expect(groupTone(row(2, 1, 3), new Set([2]))).toBe('sky');
    expect(groupTone(row(2, 3, 3), new Set())).toBe('emerald');
  });

  test('全通优先于「有可迭代」：已通的组不会因为组内还有可迭代目标就标蓝', () => {
    expect(groupTone(row(2, 3, 3), new Set([2]))).toBe('emerald');
  });
});

describe('orderGroupRows', () => {
  test('按色档从差到好：灰 → 橙 → 蓝 → 绿', () => {
    const rows = [row(2, 3, 3), row(5, 1, 3), row(6, 0, 3), row(7, 2, 3)];
    const iterable = new Set([7]); // 组 7 里有可迭代目标

    expect(orderGroupRows(rows, iterable).map((r) => r.groupId)).toEqual([6, 5, 7, 2]);
  });

  test('同色档内：还差几行多的在前（色档是粗档，0/3 与 0/6 要分开）', () => {
    const rows = [row(2, 0, 3), row(5, 0, 6)];
    expect(orderGroupRows(rows, new Set()).map((r) => r.groupId)).toEqual([5, 2]);
  });

  test('同色档、同缺口 → 按蛋组 id 稳定排', () => {
    const rows = [row(9, 0, 3), row(4, 0, 3)];
    expect(orderGroupRows(rows, new Set()).map((r) => r.groupId)).toEqual([4, 9]);
  });

  test('不修改传入数组', () => {
    const rows = [row(9, 0, 3), row(4, 0, 3)];
    orderGroupRows(rows, new Set());
    expect(rows.map((r) => r.groupId)).toEqual([9, 4]);
  });
});
