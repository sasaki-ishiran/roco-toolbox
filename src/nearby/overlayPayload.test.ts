import { describe, expect, test } from 'vitest';
import type { LiveNearbyPet } from '../collector/captureProgress';
import type { NearbySnapshot } from '../collector/nearbyStore';
import { buildNearbyOverlayPayload, OVERLAY_PET_LIMIT } from './overlayPayload';

const pet = (overrides: Partial<LiveNearbyPet> & { key: string }): LiveNearbyPet => ({
  cfgId: 10000, name: '未知精灵', level: 1, voiceDb: 0,
  weightPct: null, kinds: [], rare: false, alertReason: null, distanceM: null,
  ...overrides,
});

const snapshot = (overrides: Partial<NearbySnapshot> & { pets: LiveNearbyPet[] }): NearbySnapshot => ({
  session: 's1', scene: 10003, self: null, encounter: null, updatedAt: 1000,
  ...overrides,
});

const build = (pets: LiveNearbyPet[], extra: Partial<NearbySnapshot> = {}) =>
  buildNearbyOverlayPayload({
    capturing: true,
    hasKey: true,
    snapshot: snapshot({ pets, ...extra }),
  });

describe('buildNearbyOverlayPayload 基础字段', () => {
  test('采集中才可见，停止采集收起隐藏', () => {
    const pets = [pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } })];
    expect(build(pets).visible).toBe(true);
    expect(buildNearbyOverlayPayload({
      capturing: false,
      hasKey: true,
      snapshot: snapshot({ pets }),
    }).visible).toBe(false);
  });

  test('没有快照时给出空列表，计数为 0，自身坐标为空', () => {
    const payload = buildNearbyOverlayPayload({ capturing: true, hasKey: false, snapshot: null, now: 42 });
    expect(payload.pets).toEqual([]);
    expect(payload.total).toBe(0);
    expect(payload.rareTotal).toBe(0);
    expect(payload.alertTotal).toBe(0);
    expect(payload.self).toBeNull();
    expect(payload.scene).toBeNull();
    expect(payload.hasKey).toBe(false);
    expect(payload.updatedAt).toBe(42);
  });

  test('场景、密钥、更新时间与快照一致', () => {
    const payload = build([], { scene: 10004, updatedAt: 777 });
    expect(payload.scene).toBe(10004);
    expect(payload.hasKey).toBe(true);
    expect(payload.updatedAt).toBe(777);
  });
});

describe('方向与距离', () => {
  test('100 世界单位 = 1 米', () => {
    const payload = build([pet({ key: 'a', pos: { x: 500, y: 0, z: 0 } })], { self: { x: 0, y: 0 } });
    expect(payload.pets[0].distanceM).toBeCloseTo(5);
    expect(payload.pets[0].bearingLabel).toBe('东');
  });

  test('8 方向标签', () => {
    const directions: Array<[number, number, string]> = [
      [0, 1000, '北'],
      [1000, 1000, '东北'],
      [1000, 0, '东'],
      [1000, -1000, '东南'],
      [0, -1000, '南'],
      [-1000, -1000, '西南'],
      [-1000, 0, '西'],
      [-1000, 1000, '西北'],
    ];
    const pets = directions.map(([x, y], index) =>
      pet({ key: `k${index}`, pos: { x, y, z: 0 } }));
    const payload = build(pets, { self: { x: 0, y: 0 } });
    const labelOf = new Map(payload.pets.map((item) => [item.key, item.bearingLabel]));
    directions.forEach(([, , label], index) => {
      expect(labelOf.get(`k${index}`)).toBe(label);
    });
  });

  test('距离按世界坐标实测，不采用快照里的旧值', () => {
    const payload = build([pet({ key: 'a', distanceM: 99, pos: { x: 1000, y: 0, z: 0 } })], {
      self: { x: 0, y: 0 },
    });
    expect(payload.pets[0].distanceM).toBeCloseTo(10);
  });

  test('没有坐标的精灵仍进列表：距离退回快照值，方向为空', () => {
    const payload = build([pet({ key: 'a', distanceM: 42 })], { self: { x: 0, y: 0 } });
    expect(payload.pets[0]).toMatchObject({
      key: 'a',
      distanceM: 42,
      bearingLabel: null,
      x: null,
      y: null,
    });
  });

  test('只有 1 只且没有自身坐标：它就是中心，距离 0、方向为空', () => {
    const payload = build([pet({ key: 'a', pos: { x: 800, y: 600, z: 0 } })]);
    expect(payload.self).toEqual({ x: 800, y: 600 });
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets[0].distanceM).toBeCloseTo(0);
    expect(payload.pets[0].bearingLabel).toBeNull();
  });
});

describe('排序与截断', () => {
  test('提醒 > 稀有 > 距离', () => {
    const pets = [
      pet({ key: 'near', pos: { x: 100, y: 0, z: 0 } }),
      pet({ key: 'rare-far', rare: true, pos: { x: 5000, y: 0, z: 0 } }),
      pet({ key: 'alert-far', alertReason: '±100dB', pos: { x: 10000, y: 0, z: 0 } }),
      pet({ key: 'alert-near', alertReason: '体重牌', pos: { x: 500, y: 0, z: 0 } }),
    ];
    const payload = build(pets, { self: { x: 0, y: 0 } });
    expect(payload.pets.map((item) => item.key)).toEqual(['alert-near', 'alert-far', 'rare-far', 'near']);
  });

  test('全部稀有：仍按距离从近到远', () => {
    const pets = [
      pet({ key: 'c', rare: true, pos: { x: 3000, y: 0, z: 0 } }),
      pet({ key: 'a', rare: true, pos: { x: 1000, y: 0, z: 0 } }),
      pet({ key: 'b', rare: true, pos: { x: 2000, y: 0, z: 0 } }),
    ];
    const payload = build(pets, { self: { x: 0, y: 0 } });
    expect(payload.pets.map((item) => item.key)).toEqual(['a', 'b', 'c']);
    expect(payload.rareTotal).toBe(3);
  });

  test('超过 8 条截断，但总数保留', () => {
    const pets = Array.from({ length: 10 }, (_, index) =>
      pet({ key: `k${index}`, pos: { x: (index + 1) * 100, y: 0, z: 0 } }));
    const payload = build(pets, { self: { x: 0, y: 0 } });
    expect(payload.pets).toHaveLength(OVERLAY_PET_LIMIT);
    expect(payload.total).toBe(10);
    expect(payload.pets.map((item) => item.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']);
  });

  test('提醒超过 8 条：只留最近的 8 只，提醒总数保留', () => {
    const pets = Array.from({ length: 9 }, (_, index) =>
      pet({ key: `a${index}`, alertReason: '±100dB', pos: { x: (index + 1) * 1000, y: 0, z: 0 } }));
    const payload = build(pets, { self: { x: 0, y: 0 } });
    expect(payload.pets).toHaveLength(OVERLAY_PET_LIMIT);
    expect(payload.alertTotal).toBe(9);
    expect(payload.pets[OVERLAY_PET_LIMIT - 1].key).toBe('a7');
  });
});

describe('牌子与个体信息', () => {
  test('牌子、稀有度、可提醒、性格性别原样带出', () => {
    const payload = build([
      pet({
        key: 'a',
        name: '雪豆丁',
        level: 45,
        kinds: ['shiny', 'pollution'],
        rare: true,
        alertReason: '±100dB',
        nature: '保守',
        gender: '母',
        pos: { x: 0, y: 0, z: 0 },
      }),
    ], { self: { x: 0, y: 0 } });
    expect(payload.pets[0]).toMatchObject({
      key: 'a',
      name: '雪豆丁',
      level: 45,
      kinds: ['shiny', 'pollution'],
      rare: true,
      alert: true,
      nature: '保守',
      gender: '母',
    });
    expect(payload.rareTotal).toBe(1);
    expect(payload.alertTotal).toBe(1);
  });

  test('性格性别为空字符串时给 null，面板不显示空牌子', () => {
    const payload = build([pet({ key: 'a', nature: '', gender: '', pos: { x: 0, y: 0, z: 0 } })], {
      self: { x: 0, y: 0 },
    });
    expect(payload.pets[0].nature).toBeNull();
    expect(payload.pets[0].gender).toBeNull();
  });
});

describe('自身坐标缺失时的估算中心', () => {
  test('有自身坐标：直接用，不标估算', () => {
    const payload = build([pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } })], { self: { x: 10, y: 20 } });
    expect(payload.self).toEqual({ x: 10, y: 20 });
    expect(payload.selfEstimated).toBe(false);
  });

  test('无自身坐标：以附近精灵几何中位数为中心，并标记估算', () => {
    const payload = build([
      pet({ key: 'a', pos: { x: 0, y: 0, z: 0 } }),
      pet({ key: 'b', pos: { x: 1000, y: 0, z: 0 } }),
    ]);
    expect(payload.self).toEqual({ x: 500, y: 0 });
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets.map((item) => item.distanceM)).toEqual([expect.closeTo(5), expect.closeTo(5)]);
  });

  test('全部没有坐标：没有中心，列表照常输出', () => {
    const payload = build([pet({ key: 'a' }), pet({ key: 'b' })]);
    expect(payload.self).toBeNull();
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets).toHaveLength(2);
  });
});
