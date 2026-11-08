import { describe, expect, test } from 'vitest';
import type { LiveNearbyPet } from '../collector/captureProgress';
import { buildRadar, geometricMedian, niceCeil } from './nearbyRadar';
import { projectToPixel, WORLD_MAPS } from './worldMap';

const pet = (overrides: Partial<LiveNearbyPet> & { key: string }): LiveNearbyPet => ({
  cfgId: 10000, name: '未知精灵', level: 1, voiceDb: 0,
  weightPct: null, kinds: [], rare: false, alertReason: null, distanceM: null,
  ...overrides,
});

describe('geometricMedian', () => {
  test('空集返回 null', () => {
    expect(geometricMedian([])).toBeNull();
  });

  test('单点返回自身', () => {
    expect(geometricMedian([{ x: 1000, y: 2000 }])).toEqual({ x: 1000, y: 2000 });
  });

  test('三点直角三角形的中位数落在三角形内部', () => {
    const origin = geometricMedian([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }])!;
    expect(origin.x).toBeGreaterThan(0);
    expect(origin.x).toBeLessThan(100);
    expect(origin.y).toBeGreaterThan(0);
    expect(origin.y).toBeLessThan(100);
  });
});

describe('niceCeil', () => {
  test('向上取整到 1/2/5 × 10^n', () => {
    expect(niceCeil(0.3)).toBe(0.5);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(1.2)).toBe(2);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(12)).toBe(20);
    expect(niceCeil(60)).toBe(100);
  });

  test('非正数按 1 处理', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
  });
});

describe('buildRadar', () => {
  test('空集：中心 null、没有点', () => {
    const data = buildRadar([]);
    expect(data.origin).toBeNull();
    expect(data.points).toEqual([]);
    expect(data.unplaced).toEqual([]);
  });

  test('单点：自己就是中心，归一化坐标 0，圈距至少 1 米', () => {
    const data = buildRadar([pet({ key: 'a', pos: { x: 500, y: 500, z: 0 } })]);
    expect(data.origin).toEqual({ x: 500, y: 500 });
    expect(data.maxDistanceM).toBeGreaterThanOrEqual(1);
    expect(data.points[0]).toMatchObject({ key: 'a', nx: 0, ny: 0 });
  });

  test('100 世界单位 = 1 米', () => {
    const data = buildRadar([
      pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } }),
      pet({ key: 'b', pos: { x: 0, y: 100, z: 0 } }),
    ]);
    const b = data.points.find((point) => point.key === 'b')!;
    // 几何中位数落在两点之间，b 到中心的距离应小于 1 米
    expect(b.distanceM).toBeLessThanOrEqual(1);
    expect(data.maxDistanceM).toBeGreaterThanOrEqual(1);
  });

  test('缺坐标的精灵只进 unplaced，不画到雷达', () => {
    const data = buildRadar([
      pet({ key: 'placed', pos: { x: 0, y: 0, z: 0 } }),
      pet({ key: 'no-pos' }),
    ]);
    expect(data.points.map((point) => point.key)).toEqual(['placed']);
    expect(data.unplaced.map((item) => item.key)).toEqual(['no-pos']);
  });

  test('八方向标签与箭头（世界坐标 y 轴指向南，与地图同一套）', () => {
    const center = { x: 0, y: 0, z: 0 };
    const cases: Array<[number, number, string, string]> = [
      [0, 1000, '南', '↓'],
      [1000, 0, '东', '→'],
      [0, -1000, '北', '↑'],
      [-1000, 0, '西', '←'],
    ];
    for (const [x, y, label, arrow] of cases) {
      const data = buildRadar([pet({ key: 'center', pos: center }), pet({ key: `${x}:${y}`, pos: { x, y, z: 0 } })]);
      const point = data.points.find((item) => item.key === `${x}:${y}`)!;
      expect(point.bearingLabel).toBe(label);
      expect(point.bearingArrow).toBe(arrow);
    }
  });

  test('稀有与可提醒标记原样带出', () => {
    const data = buildRadar([
      pet({ key: 'rare', pos: { x: 0, y: 0, z: 0 }, rare: true, kinds: ['big'], alertReason: '大块头·婉转声' }),
    ]);
    expect(data.points[0]).toMatchObject({ rare: true, alert: true, kinds: ['big'] });
  });

  test('可覆盖中心（估算自身位置）：距离与方位按中心计算', () => {
    const data = buildRadar(
      [pet({ key: 'a', pos: { x: 0, y: 100, z: 0 } })],
      { origin: { x: 0, y: 0 }, minRadiusM: 30 },
    );
    expect(data.points[0]).toMatchObject({ key: 'a', distanceM: 1, bearingLabel: '南' });
    expect(data.maxDistanceM).toBe(30);
  });

  test('雷达与地图同向：正 y（南）的点在中心下方，负 y（北）在上方', () => {
    const data = buildRadar(
      [
        pet({ key: 'south', pos: { x: 0, y: 1000, z: 0 } }),
        pet({ key: 'north', pos: { x: 0, y: -1000, z: 0 } }),
      ],
      { origin: { x: 0, y: 0 }, radiusM: 115 },
    );
    const south = data.points.find((point) => point.key === 'south')!;
    const north = data.points.find((point) => point.key === 'north')!;
    // 渲染端是 cy = center + ny * radius（向下为正），所以南必须是正 ny
    expect(south.ny).toBeGreaterThan(0);
    expect(north.ny).toBeLessThan(0);
    expect(south.bearingLabel).toBe('南');
    expect(north.bearingLabel).toBe('北');
    // 地图落图：世界 y 增大 → 像素 py 增大（向下），与雷达一致
    const map = WORLD_MAPS[10003];
    const lower = projectToPixel(map, { x: map.originX, y: map.originY + 1000 });
    const upper = projectToPixel(map, { x: map.originX, y: map.originY - 1000 });
    expect(lower.py).toBeGreaterThan(upper.py);
  });

  test('视野半径下限：精灵很近时仍保留至少 30 米视野', () => {
    const data = buildRadar([pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } })], { minRadiusM: 30 });
    expect(data.maxDistanceM).toBe(30);
  });

  test('固定 115 米视野：精灵都在范围内时半径不随最远距离缩放', () => {
    const near = buildRadar(
      [pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } }), pet({ key: 'b', pos: { x: 0, y: 100, z: 0 } })],
      { radiusM: 115 },
    );
    const far = buildRadar(
      [pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } }), pet({ key: 'b', pos: { x: 0, y: 10000, z: 0 } })],
      { radiusM: 115 },
    );
    expect(near.maxDistanceM).toBe(115);
    // 10000 单位 = 100 米，仍在 115 米内
    expect(far.maxDistanceM).toBe(115);
    // 靠近时归一化坐标更小 → 点位更靠中心
    expect(Math.abs(near.points[1].ny)).toBeLessThan(Math.abs(far.points[1].ny));
  });

  test('固定视野永远不超过 115m：超出的精灵不画、计入 outsideRadius', () => {
    const data = buildRadar(
      [pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } }), pet({ key: 'b', pos: { x: 0, y: 30000, z: 0 } })],
      { radiusM: 115, origin: { x: 0, y: 0 } },
    );
    expect(data.maxDistanceM).toBe(115);
    expect(data.points.map((point) => point.key)).toEqual(['a']);
    expect(data.outsideRadius).toBe(1);
  });

  test('中心离大部分精灵太远时，自动落到最密集的精灵附近，不把雷达拉成几千米', () => {
    const cluster = Array.from({ length: 10 }, (_, index) =>
      pet({ key: `near-${index}`, pos: { x: index * 500, y: index * 500, z: 0 } }));
    const far = pet({ key: 'far', pos: { x: 0, y: 30000, z: 0 } });
    const data = buildRadar([...cluster, far], { radiusM: 115, origin: { x: 0, y: 30000 } });
    expect(data.maxDistanceM).toBe(115);
    expect(data.outsideRadius).toBe(1);
    expect(data.points.length).toBe(10);
  });

  test('trustOrigin（真实自身坐标）时不落回最密集精灵，玩家走远就看到「超出视野」', () => {
    const cluster = Array.from({ length: 10 }, (_, index) =>
      pet({ key: `near-${index}`, pos: { x: index * 500, y: index * 500, z: 0 } }));
    const data = buildRadar(cluster, { radiusM: 115, origin: { x: 0, y: 30000 }, trustOrigin: true });
    expect(data.maxDistanceM).toBe(115);
    expect(data.points).toEqual([]);
    expect(data.outsideRadius).toBe(10);
  });
});
