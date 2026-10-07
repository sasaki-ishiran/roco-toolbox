import { describe, expect, test } from 'vitest';
import {
  arrangeClusters,
  buildClusterOffsets,
  centerDistance,
  checkLayout,
  GROUP_GAP,
  nestsConnect,
  nestsOverlap,
  NEST_SIZE,
  PAIR_RANGE,
  type NestPosition,
} from './nestGeometry';

const allPairs = (points: NestPosition[]): Array<[NestPosition, NestPosition]> => {
  const pairs: Array<[NestPosition, NestPosition]> = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) pairs.push([points[i], points[j]]);
  }
  return pairs;
};

describe('小窝几何（1 窝 = 8 单元，中心欧氏 ≤17 单元）', () => {
  test('单位：1 窝 = 8 地板单元；可连范围 17 单元', () => {
    expect(NEST_SIZE).toBe(8);
    expect(PAIR_RANGE).toBe(17);
  });

  test('中心距离是欧氏距离（单位：地板单元）', () => {
    expect(centerDistance({ x: 0, y: 0 }, { x: 8, y: 8 })).toBeCloseTo(Math.SQRT2 * 8, 5);
    expect(centerDistance({ x: 0, y: 0 }, { x: 9, y: 12 })).toBe(15);
  });

  test('重叠判定：切比雪夫距离 <8 就压到了', () => {
    expect(nestsOverlap({ x: 0, y: 0 }, { x: 7, y: 7 })).toBe(true);
    expect(nestsOverlap({ x: 0, y: 0 }, { x: 8, y: 0 })).toBe(false);
  });

  test('可配对：斜向可连；(3,3) 格 = 12,12 单元连得上，(4,2) 格 = 16,6 连不上', () => {
    expect(nestsConnect({ x: 0, y: 0 }, { x: 8, y: 0 })).toBe(true); // 1 窝
    expect(nestsConnect({ x: 0, y: 0 }, { x: 12, y: 12 })).toBe(true); // 2.121 窝
    expect(nestsConnect({ x: 0, y: 0 }, { x: 8, y: 15 })).toBe(true); // 正好 17
    expect(nestsConnect({ x: 0, y: 0 }, { x: 16, y: 6 })).toBe(false); // 2.236 窝
    expect(nestsConnect({ x: 0, y: 0 }, { x: 20, y: 0 })).toBe(false); // 2.5 窝
  });
});

describe('贪心密排：尽量多连线', () => {
  test('1~6 个窝都能做到两两相连、且互不重叠（游戏里的上限就是 6）', () => {
    for (let size = 1; size <= 6; size += 1) {
      const offsets = buildClusterOffsets(size);
      expect(offsets).toHaveLength(size);
      for (const [a, b] of allPairs(offsets)) {
        expect(nestsOverlap(a, b)).toBe(false);
        expect(nestsConnect(a, b)).toBe(true);
      }
    }
  });

  test('7 个以上：放得下、互不重叠（不再强求两两全连）', () => {
    for (const size of [7, 9, 11]) {
      const offsets = buildClusterOffsets(size);
      expect(offsets).toHaveLength(size);
      for (const [a, b] of allPairs(offsets)) expect(nestsOverlap(a, b)).toBe(false);
    }
  });
});

describe('编组式布局：组内密排（多连线）、组间拉开（不串线）', () => {
  test('组间拉开 ≥24 单元 → 不串线、不重叠', () => {
    const clusters = arrangeClusters([buildClusterOffsets(4), buildClusterOffsets(2)]);
    expect(GROUP_GAP).toBeGreaterThan(PAIR_RANGE);
    const report = checkLayout(clusters);
    expect(report.ok).toBe(true);
    expect(report.crossLinks).toHaveLength(0);
    expect(report.overlaps).toHaveLength(0);
    for (const a of clusters[0]) {
      for (const b of clusters[1]) expect(nestsConnect(a, b)).toBe(false);
    }
  });

  test('把两组摆太近 → 报出串线', () => {
    const report = checkLayout([[{ x: 0, y: 0 }], [{ x: 12, y: 0 }]]);
    expect(report.ok).toBe(false);
    expect(report.crossLinks).toHaveLength(1);
    expect(report.crossLinks[0].distance).toBeCloseTo(12, 5);
  });

  test('重叠也会被报出来', () => {
    const report = checkLayout([[{ x: 0, y: 0 }], [{ x: 7, y: 0 }]]);
    expect(report.ok).toBe(false);
    expect(report.overlaps).toHaveLength(1);
  });

  test('组内本该成立的配对边若超距 → 报 outOfRange（B10 的回归网）', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 16, y: 6 }; // 17.09 单元 > 17
    const report = checkLayout([[a, b]], [[a, b]]);
    expect(report.ok).toBe(false);
    expect(report.outOfRange).toHaveLength(1);
    expect(report.outOfRange[0].distance).toBeCloseTo(Math.hypot(16, 6), 5);
  });

  test('组内配对边在范围内 → 不报 outOfRange', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 8, y: 15 }; // 正好 17
    expect(checkLayout([[a, b]], [[a, b]]).ok).toBe(true);
  });
});
