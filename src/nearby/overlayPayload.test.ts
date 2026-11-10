import { describe, expect, test } from 'vitest';
import type { LiveNearbyPet } from '../collector/captureProgress';
import type { BattleTarget } from '../collector/battleTargetStore';
import type { NearbySnapshot } from '../collector/nearbyStore';
import type { DemandHit } from '../pcap/demandMatch';
import type { NearbyFilter } from './nearbyFilterStore';
import {
  buildNearbyOverlayPayload,
  isOverlayTarget,
  overlayHitReason,
  OVERLAY_MAP_POINT_LIMIT,
  OVERLAY_PET_LIMIT,
} from './overlayPayload';

const pet = (overrides: Partial<LiveNearbyPet> & { key: string }): LiveNearbyPet => ({
  cfgId: 10000, name: '未知精灵', level: 1, voiceDb: 0,
  weightPct: null, kinds: [], rare: false, alertReason: null, distanceM: null,
  ...overrides,
});

const target = (overrides: Partial<BattleTarget> = {}): BattleTarget => ({
  natures: [], gender: '', voices: [], bodies: [], mode: 'any', ...overrides,
});

const snapshot = (overrides: Partial<NearbySnapshot> & { pets: LiveNearbyPet[] }): NearbySnapshot => ({
  session: 's1', scene: 10003, self: null, encounter: null, updatedAt: 1000,
  ...overrides,
});

const build = (
  pets: LiveNearbyPet[],
  extra: Partial<NearbySnapshot> = {},
  options: { filter?: NearbyFilter; target?: BattleTarget; demandHits?: Map<string, DemandHit[]> } = {},
) =>
  buildNearbyOverlayPayload({
    capturing: true,
    hasKey: true,
    snapshot: snapshot({ pets, ...extra }),
    ...options,
  });

const demandHit = (eggGameId = 101): DemandHit => ({
  demand: {
    eggGameId,
    nature: '',
    gender: '',
    body: '',
    voice: '',
    groupId: 'g1',
    demanderAccountId: 'u1',
    status: 'open',
    claimerAccountId: null,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  },
  groupName: '测试小组',
  known: [],
  unverified: [],
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
    const payload = build([pet({ key: 'a', rare: true, pos: { x: 500, y: 0, z: 0 } })], { self: { x: 0, y: 0 } });
    expect(payload.pets[0].distanceM).toBeCloseTo(5);
    expect(payload.pets[0].bearingLabel).toBe('东');
  });

  test('8 方向标签', () => {
    // 世界坐标 y 轴指向南（与 nearbyRadar 同一套）：正 y 是南，负 y 是北
    const directions: Array<[number, number, string]> = [
      [0, -1000, '北'],
      [1000, -1000, '东北'],
      [1000, 0, '东'],
      [1000, 1000, '东南'],
      [0, 1000, '南'],
      [-1000, 1000, '西南'],
      [-1000, 0, '西'],
      [-1000, -1000, '西北'],
    ];
    const pets = directions.map(([x, y], index) =>
      pet({ key: `k${index}`, rare: true, pos: { x, y, z: 0 } }));
    const payload = build(pets, { self: { x: 0, y: 0 } });
    const labelOf = new Map(payload.pets.map((item) => [item.key, item.bearingLabel]));
    directions.forEach(([, , label], index) => {
      expect(labelOf.get(`k${index}`)).toBe(label);
    });
  });

  test('方向箭头与方位标签同源，没有方向时都是 null', () => {
    const payload = build([
      pet({ key: 'east', rare: true, pos: { x: 1000, y: 0, z: 0 } }),
      pet({ key: 'northwest', rare: true, pos: { x: -1000, y: -1000, z: 0 } }),
    ], { self: { x: 0, y: 0 } });
    const arrowOf = new Map(payload.pets.map((item) => [item.key, item.bearingArrow]));
    expect(arrowOf.get('east')).toBe('→');
    expect(arrowOf.get('northwest')).toBe('↖');
    const noPos = build([pet({ key: 'no-pos', rare: true, distanceM: 3 })], { self: { x: 0, y: 0 } });
    expect(noPos.pets[0].bearingArrow).toBeNull();
  });

  test('距离按世界坐标实测，不采用快照里的旧值', () => {
    const payload = build([pet({ key: 'a', distanceM: 99, rare: true, pos: { x: 1000, y: 0, z: 0 } })], {
      self: { x: 0, y: 0 },
    });
    expect(payload.pets[0].distanceM).toBeCloseTo(10);
  });

  test('没有坐标的精灵仍进列表：距离退回快照值，方向为空', () => {
    const payload = build([pet({ key: 'a', distanceM: 42, rare: true })], { self: { x: 0, y: 0 } });
    expect(payload.pets[0]).toMatchObject({
      key: 'a',
      distanceM: 42,
      bearingLabel: null,
      x: null,
      y: null,
    });
  });

  test('只有 1 只且没有自身坐标：它就是中心，距离 0、方向为空', () => {
    const payload = build([pet({ key: 'a', rare: true, pos: { x: 800, y: 600, z: 0 } })]);
    expect(payload.self).toEqual({ x: 800, y: 600 });
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets[0].distanceM).toBeCloseTo(0);
    expect(payload.pets[0].bearingLabel).toBeNull();
  });
});

describe('排序与截断', () => {
  test('提醒 > 稀有 > 距离', () => {
    const pets = [
      pet({ key: 'near', kinds: ['shiny'], pos: { x: 100, y: 0, z: 0 } }),
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

  test('超过上限截断，但总数保留', () => {
    const pets = Array.from({ length: OVERLAY_PET_LIMIT + 2 }, (_, index) =>
      pet({ key: `k${index}`, rare: true, pos: { x: (index + 1) * 100, y: 0, z: 0 } }));
    const payload = build(pets, { self: { x: 0, y: 0 } });
    expect(payload.pets).toHaveLength(OVERLAY_PET_LIMIT);
    expect(payload.total).toBe(OVERLAY_PET_LIMIT + 2);
    expect(payload.pets[0].key).toBe('k0');
    expect(payload.pets[OVERLAY_PET_LIMIT - 1].key).toBe(`k${OVERLAY_PET_LIMIT - 1}`);
  });

  test('提醒超过上限：只留最近的，提醒总数保留', () => {
    const pets = Array.from({ length: OVERLAY_PET_LIMIT + 1 }, (_, index) =>
      pet({ key: `a${index}`, alertReason: '±100dB', pos: { x: (index + 1) * 1000, y: 0, z: 0 } }));
    const payload = build(pets, { self: { x: 0, y: 0 } });
    expect(payload.pets).toHaveLength(OVERLAY_PET_LIMIT);
    expect(payload.alertTotal).toBe(OVERLAY_PET_LIMIT + 1);
    expect(payload.pets[OVERLAY_PET_LIMIT - 1].key).toBe(`a${OVERLAY_PET_LIMIT - 1}`);
  });
});

describe('列表口径：总范围 × 战斗目标维度筛选', () => {
  test('全部档 + 维度都没设：附近所有精灵都进列表（上限 24）', () => {
    const payload = build([
      pet({ key: 'plain' }),
      pet({ key: 'rare', rare: true }),
      pet({ key: 'alert', alertReason: '±100dB' }),
    ], {}, { filter: 'all', target: target() });
    expect(payload.pets.map((item) => item.key).sort()).toEqual(['alert', 'plain', 'rare']);
    expect(OVERLAY_PET_LIMIT).toBe(24);
  });

  test('稀有档：只放行稀有，普通精灵不进列表', () => {
    const payload = build([
      pet({ key: 'plain', pos: { x: 100, y: 0, z: 0 } }),
      pet({ key: 'rare', rare: true, pos: { x: 200, y: 0, z: 0 } }),
    ], { self: { x: 0, y: 0 } }, { filter: 'rare' });
    expect(payload.pets.map((item) => item.key)).toEqual(['rare']);
    expect(payload.total).toBe(2);
    // 地图仍全量
    expect(payload.mapPets.map((item) => item.key).sort()).toEqual(['plain', 'rare']);
  });

  test('需求档：除命中需求外一律不进列表', () => {
    const demandHits = new Map<string, DemandHit[]>([['hit', [demandHit()]]]);
    const payload = build([
      pet({ key: 'hit', pos: { x: 100, y: 0, z: 0 } }),
      pet({ key: 'rare', rare: true, pos: { x: 200, y: 0, z: 0 } }),
      pet({ key: 'plain', pos: { x: 300, y: 0, z: 0 } }),
    ], { self: { x: 0, y: 0 } }, { filter: 'demand', demandHits });
    expect(payload.pets.map((item) => item.key)).toEqual(['hit']);
  });

  test('单维度勾选：只放行命中项，其他维度不设限', () => {
    const payload = build([
      pet({ key: 'big', weightPct: 99 }),
      pet({ key: 'small', weightPct: 1 }),
      pet({ key: 'unknown', weightPct: null }),
    ], {}, { filter: 'all', target: target({ bodies: ['big'] }) });
    expect(payload.pets.map((item) => item.key)).toEqual(['big']);
  });

  test('性别 / 声音 / 性格单维度勾选同样只放行命中项', () => {
    const pets = [
      pet({ key: 'female', gender: '母', voiceDb: 100, nature: '胆小' }),
      pet({ key: 'male', gender: '公', voiceDb: -100, nature: '勇敢' }),
    ];
    expect(build(pets, {}, { target: target({ gender: '母' }) }).pets.map((item) => item.key))
      .toEqual(['female']);
    expect(build(pets, {}, { target: target({ voices: ['-100'] }) }).pets.map((item) => item.key))
      .toEqual(['male']);
    expect(build(pets, {}, { target: target({ natures: ['胆小'] }) }).pets.map((item) => item.key))
      .toEqual(['female']);
  });

  test('维度未勾选 = 该维度全部档位通过', () => {
    const pets = [
      pet({ key: 'a', gender: '公', voiceDb: 100, nature: '胆小', weightPct: 99 }),
      pet({ key: 'b', gender: '母', voiceDb: 0, nature: '', weightPct: 50 }),
    ];
    const payload = build(pets, {}, { filter: 'all', target: target() });
    expect(payload.pets.map((item) => item.key).sort()).toEqual(['a', 'b']);
  });

  test('多维度 any：命中任一维度即放行', () => {
    const pets = [
      pet({ key: 'voice', voiceDb: 100 }),
      pet({ key: 'body', weightPct: 99 }),
      pet({ key: 'none', voiceDb: 0, weightPct: 50 }),
    ];
    const payload = build(pets, {}, {
      target: target({ voices: ['+100'], bodies: ['big'], mode: 'any' }),
    });
    expect(payload.pets.map((item) => item.key).sort()).toEqual(['body', 'voice']);
  });

  test('多维度 all：必须全部维度都命中', () => {
    const pets = [
      pet({ key: 'both', voiceDb: 100, weightPct: 99 }),
      pet({ key: 'voice', voiceDb: 100, weightPct: 50 }),
      pet({ key: 'body', voiceDb: 0, weightPct: 99 }),
    ];
    const payload = build(pets, {}, {
      target: target({ voices: ['+100'], bodies: ['big'], mode: 'all' }),
    });
    expect(payload.pets.map((item) => item.key)).toEqual(['both']);
  });

  test('命中需求恒放行：总范围与维度筛选都挡不住', () => {
    const demandHits = new Map<string, DemandHit[]>([['wanted', [demandHit()]]]);
    const payload = build([
      pet({ key: 'wanted', gender: '公', weightPct: 50, pos: { x: 900, y: 0, z: 0 } }),
      pet({ key: 'rare', rare: true, gender: '公', pos: { x: 100, y: 0, z: 0 } }),
    ], { self: { x: 0, y: 0 } }, {
      filter: 'rare',
      target: target({ gender: '母' }),
      demandHits,
    });
    expect(payload.pets.map((item) => item.key)).toEqual(['wanted']);
  });

  test('可提醒不能绕过筛选：未命中维度就不进列表，但仍在 mapPets', () => {
    const payload = build([
      pet({ key: 'alert', alertReason: '±100dB', weightPct: 50, pos: { x: 100, y: 0, z: 0 } }),
    ], { self: { x: 0, y: 0 } }, { filter: 'all', target: target({ bodies: ['big'] }) });
    expect(payload.pets).toEqual([]);
    expect(payload.mapPets.map((item) => item.key)).toEqual(['alert']);
  });
});

describe('需求中心命中', () => {
  test('命中需求的普通精灵进列表，reason 为 demand', () => {
    const demandHits = new Map<string, DemandHit[]>([['plain', [demandHit()]]]);
    const payload = buildNearbyOverlayPayload({
      capturing: true,
      hasKey: true,
      snapshot: snapshot({
        pets: [pet({ key: 'plain', pos: { x: 100, y: 0, z: 0 } })],
        self: { x: 0, y: 0 },
      }),
      demandHits,
    });
    expect(payload.pets.map((item) => item.key)).toEqual(['plain']);
    expect(payload.pets[0].reason).toBe('demand');
    expect(payload.matched).toBe(1);
    expect(payload.mapPets[0].reason).toBe('demand');
  });

  test('reason 优先级：需求 > 可提醒 > 稀有 > 炫彩·异色·污染', () => {
    const all = pet({ key: 'a', alertReason: '±100dB', rare: true, kinds: ['shiny'] });
    expect(overlayHitReason(all, [demandHit()])).toBe('demand');
    expect(overlayHitReason(all)).toBe('alert');
    expect(overlayHitReason(pet({ key: 'a', rare: true, kinds: ['shiny'] }))).toBe('rare');
    expect(overlayHitReason(pet({ key: 'a', kinds: ['colorful', 'pollution'] }))).toBe('colorful');
    expect(overlayHitReason(pet({ key: 'a', kinds: ['big'] }))).toBeNull();
    expect(isOverlayTarget(all, [demandHit()], 'rare')).toBe(true);
    expect(isOverlayTarget(pet({ key: 'a', kinds: ['big'] }), [], 'rare')).toBe(false);
  });

  test('命中需求的精灵排在可提醒 / 稀有之前（即使更远）', () => {
    const demandHits = new Map<string, DemandHit[]>([['demand-far', [demandHit()]]]);
    const payload = buildNearbyOverlayPayload({
      capturing: true,
      hasKey: true,
      snapshot: snapshot({
        pets: [
          pet({ key: 'alert-near', alertReason: '±100dB', pos: { x: 100, y: 0, z: 0 } }),
          pet({ key: 'demand-far', pos: { x: 10000, y: 0, z: 0 } }),
        ],
        self: { x: 0, y: 0 },
      }),
      demandHits,
    });
    expect(payload.pets.map((item) => item.key)).toEqual(['demand-far', 'alert-near']);
  });
});

describe('地图 / 雷达点位', () => {
  test('普通精灵不进列表，但进 mapPets', () => {
    const payload = build([
      pet({ key: 'plain', pos: { x: 100, y: 0, z: 0 } }),
      pet({ key: 'rare', rare: true, pos: { x: 200, y: 0, z: 0 } }),
      pet({ key: 'no-pos', rare: true }),
    ], { self: { x: 0, y: 0 } }, { filter: 'rare' });
    expect(payload.pets.map((item) => item.key)).toEqual(['rare', 'no-pos']);
    expect(payload.mapPets.map((item) => item.key)).toEqual(['plain', 'rare']);
  });

  test('mapPets 按距离截断到上限', () => {
    const pets = Array.from({ length: OVERLAY_MAP_POINT_LIMIT + 6 }, (_, index) =>
      pet({ key: `k${index}`, pos: { x: (index + 1) * 10, y: 0, z: 0 } }));
    const payload = build(pets, { self: { x: 0, y: 0 } });
    expect(payload.mapPets).toHaveLength(OVERLAY_MAP_POINT_LIMIT);
    expect(payload.mapPets[0].key).toBe('k0');
    expect(payload.total).toBe(OVERLAY_MAP_POINT_LIMIT + 6);
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
    const payload = build([pet({ key: 'a', nature: '', gender: '', rare: true, pos: { x: 0, y: 0, z: 0 } })], {
      self: { x: 0, y: 0 },
    });
    expect(payload.pets[0].nature).toBeNull();
    expect(payload.pets[0].gender).toBeNull();
  });
});

describe('自身坐标缺失时的估算中心', () => {
  test('有自身坐标：直接用，不标估算', () => {
    const payload = build([pet({ key: 'a', rare: true, pos: { x: 0, y: 0, z: 0 } })], { self: { x: 10, y: 20 } });
    expect(payload.self).toEqual({ x: 10, y: 20 });
    expect(payload.selfEstimated).toBe(false);
  });

  test('无自身坐标：以附近精灵几何中位数为中心，并标记估算', () => {
    const payload = build([
      pet({ key: 'a', rare: true, pos: { x: 0, y: 0, z: 0 } }),
      pet({ key: 'b', rare: true, pos: { x: 1000, y: 0, z: 0 } }),
    ]);
    expect(payload.self).toEqual({ x: 500, y: 0 });
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets.map((item) => item.distanceM)).toEqual([expect.closeTo(5), expect.closeTo(5)]);
  });

  test('全部没有坐标：没有中心，列表照常输出', () => {
    const payload = build([pet({ key: 'a', rare: true }), pet({ key: 'b', rare: true })]);
    expect(payload.self).toBeNull();
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets).toHaveLength(2);
  });

  test('自身坐标不是有限数：退回精灵几何中位数，并标估算', () => {
    const payload = build(
      [
        pet({ key: 'a', rare: true, pos: { x: 0, y: 0, z: 0 } }),
        pet({ key: 'b', rare: true, pos: { x: 1000, y: 0, z: 0 } }),
      ],
      { self: { x: Number.NaN, y: 0 } },
    );
    // NaN 经 JSON 会变成 null，壳算出的中心会是 NaN；必须退回有人区域
    expect(payload.self).toEqual({ x: 500, y: 0 });
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets.every((item) => Number.isFinite(item.x as number))).toBe(true);
  });

  test('307 缺失时用里程计估算的自身坐标（走动时地图才会跟着动）', () => {
    const payload = build([pet({ key: 'a', rare: true, pos: { x: 1000, y: 0, z: 0 } })], {
      self: null,
      estimatedSelf: { x: 800, y: 0 },
    });
    expect(payload.self).toEqual({ x: 800, y: 0 });
    // 没有真实 307：面板标题要标「估算」，避免用户把它当精确坐标
    expect(payload.selfEstimated).toBe(true);
    expect(payload.pets[0].distanceM).toBeCloseTo(2);
  });

  test('真实 307 优先于里程计估算', () => {
    const payload = build([pet({ key: 'a', rare: true, pos: { x: 1000, y: 0, z: 0 } })], {
      self: { x: 900, y: 0 },
      estimatedSelf: { x: 0, y: 0 },
    });
    expect(payload.self).toEqual({ x: 900, y: 0 });
    expect(payload.selfEstimated).toBe(false);
  });

  test('自身坐标来源随 payload 带出，供壳端 RocoPerf 判断是 307 还是旧值', () => {
    const packet = build([pet({ key: 'a', pos: { x: 1000, y: 0, z: 0 } })], {
      self: { x: 900, y: 0 },
      selfSource: 'packet',
      selfAt: 1731234567890,
    });
    expect(packet.selfSource).toBe('packet');
    expect(packet.selfAt).toBe(1731234567890);
    expect(packet.selfEstimated).toBe(false);

    const odometry = build([pet({ key: 'a', pos: { x: 1000, y: 0, z: 0 } })], {
      self: { x: 900, y: 0 },
      selfSource: 'odometry',
    });
    // 里程计/沿用上一帧都算估算：标题要标「中心为估算」
    expect(odometry.selfSource).toBe('odometry');
    expect(odometry.selfEstimated).toBe(true);

    const stale = build([pet({ key: 'a', pos: { x: 1000, y: 0, z: 0 } })], {
      self: { x: 900, y: 0 },
      selfSource: 'stale',
    });
    expect(stale.selfEstimated).toBe(true);

    const none = build([pet({ key: 'a', pos: { x: 1000, y: 0, z: 0 } })], { self: null });
    expect(none.selfSource).toBe('none');
  });

  test('地图点位带距离，壳端据此判断地图是否在跟随', () => {
    const payload = build([pet({ key: 'a', pos: { x: 1000, y: 0, z: 0 } })], {
      self: { x: 800, y: 0 },
    });
    expect(payload.mapPets[0].distanceM).toBe(2);
  });
});

describe('列表个体字段（高 / 重 / 声音）', () => {
  test('高 / 重百分比与声音档位文字随 payload 带出', () => {
    const payload = build([
      pet({ key: 'a', heightPct: 12.38, weightPct: 8.19, kinds: ['high'] }),
      pet({ key: 'b', heightPct: null, weightPct: 30, kinds: [] }),
    ]);
    expect(payload.pets.find((item) => item.key === 'a')).toMatchObject({
      heightPct: 12.38,
      weightPct: 8.19,
    });
    expect(payload.pets.find((item) => item.key === 'b')).toMatchObject({
      heightPct: null,
      weightPct: 30,
    });
  });
});
