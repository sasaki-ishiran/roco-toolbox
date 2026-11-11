import { describe, expect, test } from 'vitest';
import { decorateWildPet, sortNearby, withDistance, type WildPet } from './wildNearby';
import { applyBattleEncounterFrame, applyWildEntityFrame, parseSceneInfo, parseWildEntities, parseOwnedPetDetails, parseSeasonEncounterUnits, parseUpstreamSelfPosition, removeCapturedWildPets, type SeasonEncounterRaw, type WildEntityRaw } from '../pcap-decoder/tools/pcap-json-app/src/core';

/** 真实野外抓包 capture-1793891528222.pcap 里出现过的实体（脱敏：只保留协议字段）。 */
const HUSKY: WildEntityRaw = {
  cfgId: 10096, actorId: 6, uniqueId: 12011305, level: 37,
  height: 78, weight: 15513, voiceDb: -99, mutation: 0, glassType: 0, glassValue: 0,
  pos: { x: 429462, y: 648300, z: 1088 },
};
const IBERRY: WildEntityRaw = {
  cfgId: 10065, actorId: 6, uniqueId: 260360003, level: 40,
  height: 61, weight: 4126, voiceDb: -99, mutation: 0, glassType: 0, glassValue: 0,
  pos: { x: 431992, y: 641328, z: 421 },
};

describe('野外实体补全', () => {
  test('cfgId 映射到种族名与体重区间，算出百分位', () => {
    const pet = decorateWildPet(HUSKY);
    expect(pet.petId).toBe(3070);
    expect(pet.name).toBe('护主犬');
    // 15513g 落在 13.678~17.422kg 区间的中段
    expect(pet.weightPct).toBeGreaterThan(45);
    expect(pet.weightPct).toBeLessThan(55);
  });

  test('声音 -99dB 只算牌子，不到 ±100 不触发主动提醒', () => {
    const pet = decorateWildPet(IBERRY);
    expect(pet.kinds).toEqual(['low']);
    expect(pet.rare).toBe(true);
    expect(pet.alertReason).toBeNull();
  });

  test('±100dB 才触发主动提醒', () => {
    const pet = decorateWildPet({ ...IBERRY, voiceDb: -100 });
    expect(pet.alertReason).toBe('-100dB');
  });

  test('宠物记录回填性格与性别：7 = 天真，1 = 公', () => {
    const pet = decorateWildPet(HUSKY, { natureId: 7, genderId: 1 });
    expect(pet.natureId).toBe(7);
    expect(pet.nature).toBe('天真');
    expect(pet.gender).toBe('公');
  });

  test('没有宠物记录时性格性别为空，不伪造', () => {
    const pet = decorateWildPet(HUSKY);
    expect(pet.natureId).toBeNull();
    expect(pet.nature).toBe('');
    expect(pet.gender).toBe('');
  });

  test('未知 cfgId 不伪造名称', () => {
    const pet = decorateWildPet({ ...HUSKY, cfgId: 19999 });
    expect(pet.petId).toBeNull();
    expect(pet.name).toBe('未知精灵 19999');
    expect(pet.weightPct).toBeNull();
  });

  test('去重键优先 uniqueId', () => {
    expect(decorateWildPet(HUSKY).key).toBe('12011305');
  });
});

describe('体型牌：体重与身高同时到顶（2026-11-10 真机反馈）', () => {
  // 格兰花 3073 / cfgId 10181：体重区间 6.526~7.774kg、身高区间 0.48~0.68m。
  // 用户抓到 7.76/7.80kg 的一只，游戏里没有大块头奖牌，旧口径单看体重 98.9% 会误判。
  const GLANFLOWER: WildEntityRaw = {
    cfgId: 10181, actorId: 6, uniqueId: 330001, level: 20,
    height: 60, weight: 7760, voiceDb: 0, mutation: 0, glassType: 0, glassValue: 0,
    pos: { x: 420000, y: 650000, z: 0 },
  };

  test('7.76kg / 身高 60%：体重 98.9% 但不算大块头', () => {
    const pet = decorateWildPet(GLANFLOWER);
    expect(pet.petId).toBe(3073);
    expect(pet.name).toBe('格兰花');
    expect(pet.weightPct).toBeCloseTo(98.88, 1);
    expect(pet.heightPct).toBeCloseTo(60, 1);
    expect(pet.kinds).toEqual([]);
    expect(pet.rare).toBe(false);
    expect(pet.alertReason).toBeNull();
  });

  test('真正的大块头：身高体重双 100%', () => {
    const pet = decorateWildPet({ ...GLANFLOWER, weight: 7800, height: 68 });
    expect(pet.weightPct).toBe(100);
    expect(pet.heightPct).toBe(100);
    expect(pet.kinds).toEqual(['big']);
    expect(pet.rare).toBe(true);
  });
});

describe('特殊场景实体（蛋包蛋）', () => {
  /** 330 里的特殊实体：cfgId 29401、41 级、不带身高体重。 */
  const SPECIAL: WildEntityRaw = {
    cfgId: 29401, actorId: 6, uniqueId: 292001600, level: 41,
    height: 0, weight: 0, voiceDb: 0, mutation: 0, glassType: 0, glassValue: 0,
    pos: { x: 459403, y: 553946, z: 20134 },
  };

  test('cfgId 29401 识别为蛋包蛋，没有身高体重也不出体型牌', () => {
    const pet = decorateWildPet(SPECIAL);
    expect(pet.petId).toBe(3808);
    expect(pet.name).toBe('蛋包蛋');
    expect(pet.weightPct).toBeNull();
    expect(pet.kinds).toEqual([]);
    expect(pet.rare).toBe(false);
  });

  test('解析 330 时不再因为 cfgId 不在 10000-19999 丢掉蛋包蛋', () => {
    expect(parseWildEntities(specialEntityFrame())).toEqual([SPECIAL]);
  });
});

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest & 0x7f);
  return bytes;
};
const tag = (field: number, wire: number) => varint((field << 3) | wire);
const scalar = (field: number, value: number) => [...tag(field, 0), ...varint(value)];
const message = (field: number, body: number[]) => [...tag(field, 2), ...varint(body.length), ...body];

/** 拼一个 330 实体帧：顶层 field 7 → actor(field 11) → identity(field 1) / pet(field 3)。 */
function specialEntityFrame(): Uint8Array {
  const pos = [
    ...scalar(1, 459403), ...scalar(2, 553946), ...scalar(3, 20134),
  ];
  const identity = [
    ...scalar(1, 6),
    ...message(8, message(1, pos)),
    ...scalar(11, 41),
  ];
  const pet = [
    ...scalar(1, 29401),
    ...scalar(17, 292001600),
  ];
  const actor = [...message(1, identity), ...message(3, pet)];
  return new Uint8Array(message(7, message(11, actor)));
}

describe('赛季奇遇战（龙棋士）', () => {
  test('战斗帧 4886/4890 里能直接读到守卫的真实性格', () => {
    const [unit] = parseSeasonEncounterUnits(encounterFrame(4));
    expect(unit).toMatchObject({
      formId: 1646, guardName: '龙棋士', unitId: 9006, level: 41,
      natureId: 4, natureConfirmed: true, genderId: 1, height: 32, weight: 1900, bloodId: 24,
      voiceDb: 0,
    });
  });

  test('性格占位 30 时仍返回单位，但标记为未确认', () => {
    const unit = parseSeasonEncounterUnits(encounterFrame(30))[0];
    expect(unit).toBeTruthy();
    expect(unit.natureConfirmed).toBe(false);
    expect(unit.level).toBe(41);
  });

  test('普通对战（非奇遇形态）不解析', () => {
    expect(parseSeasonEncounterUnits(encounterFrame(4, 3572))).toEqual([]);
  });

  describe('跨战斗残留（2026-11-11 真机：伊雷龙战斗显示上一场的小翼龙）', () => {
    const previous: SeasonEncounterRaw = {
      formId: 1646, guardName: '龙棋士', unitId: 3209, level: 42, natureId: 23,
      natureConfirmed: true, genderId: 1, height: 64, weight: 26560, bloodId: 24, voiceDb: 68,
    };

    test('新战斗的 4886 里有单位、但不是奇遇形态 → 清掉上一场的卡', () => {
      expect(applyBattleEncounterFrame(previous, 4886, encounterFrame(4, 3572))).toBeNull();
    });

    test('新战斗的 4886 仍是奇遇形态 → 正常替换成这一场的守卫', () => {
      const next = applyBattleEncounterFrame(previous, 4886, encounterFrame(4));
      expect(next).toMatchObject({ formId: 1646, unitId: 9006, level: 41 });
    });

    test('4890 会在一场战斗里重复下发：没有奇遇记录也不能清掉当前卡', () => {
      expect(applyBattleEncounterFrame(previous, 4890, encounterFrame(4, 3572))).toBe(previous);
    });

    test('4886 里没有任何宠物记录（心跳/空帧）→ 保持现状', () => {
      expect(applyBattleEncounterFrame(previous, 4886, new Uint8Array([0x08, 0x01]))).toBe(previous);
    });
  });

  test('秒杀/奖励登场：战斗帧（5107/4890）里与守卫同数据的记录可解析为宠物记录', () => {
    // 2026-11-08 秒杀+成功捕捉局实测：道具秒杀守卫后，奖励精灵（与守卫同个体数据）
    // 最早出现在 5107/4890 战斗帧；抓到后 579 才有完整捕获记录，没抓的局 579 为空。
    // extractPcap 靠这两个帧把守卫的临时 unitId 回填成真实 petId，
    // 名字与身高体重百分比在 579 之前就能显示。
    const rewardRecord = [
      ...scalar(7, 23), ...scalar(8, 1), ...scalar(10, 42),
      ...scalar(15, 3381), ...scalar(26, 218), ...scalar(27, 660812),
      ...scalar(47, 24),
    ];
    const battleFrame = new Uint8Array(message(1, message(2, message(4, rewardRecord))));
    expect(parseOwnedPetDetails(battleFrame)).toEqual([
      { petId: 3381, level: 42, height: 218, weight: 660812, natureId: 23, genderId: 1, bloodId: 24, voiceDb: 0 },
    ]);
  });
});

describe('抓到后从附近实体里剔除', () => {
  const captureOf = (pets: WildEntityRaw[]) => ({
    wildPets: new Map(pets.map((pet) => [String(pet.uniqueId), pet])),
    capturedWild: new Set<string>(),
  });
  const detailOf = (overrides: Record<string, unknown> = {}) => ({
    petId: 3070, level: 37, height: 78, weight: 15513,
    natureId: 1, genderId: 1, bloodId: 0, voiceDb: -99, ...overrides,
  });

  test('579 捕获记录按 种族+等级+身高+体重 命中后删除对应实体', () => {
    const capture = captureOf([HUSKY, IBERRY]);
    removeCapturedWildPets(capture, [detailOf()]);
    expect([...capture.wildPets.keys()]).toEqual(['260360003']);
    // 记入墓碑：后续 330/1043 再下发同一只也不会回到列表
    expect([...capture.capturedWild]).toEqual(['12011305']);
  });

  test('体重/等级对不上不删：避免误删同种族的另一只', () => {
    const capture = captureOf([HUSKY]);
    removeCapturedWildPets(capture, [detailOf({ weight: 15514 })]);
    expect(capture.wildPets.size).toBe(1);
  });

  test('空记录（丢球 / 捕捉失败）不删任何实体', () => {
    const capture = captureOf([HUSKY, IBERRY]);
    removeCapturedWildPets(capture, []);
    expect(capture.wildPets.size).toBe(2);
  });
});

/** 拼一个战斗帧（4886/4890）里的奇遇守卫记录：record 带形态、名字、性格等。 */
function encounterFrame(natureId: number, formId = 1646): Uint8Array {
  const record = [
    ...scalar(2, formId),
    ...message(3, [...new TextEncoder().encode('龙棋士')]),
    ...scalar(7, natureId), ...scalar(8, 1), ...scalar(10, 41),
    ...scalar(15, 9006), ...scalar(26, 32), ...scalar(27, 1900), ...scalar(47, 24),
  ];
  return new Uint8Array(message(3, message(1, message(2, record))));
}

describe('场景号解析', () => {
  const frame = (fields: number[][]) => new Uint8Array(fields.flat());

  test('338 进场景读 field 3', () => {
    expect(parseSceneInfo(frame([scalar(3, 10003), scalar(2, 12)]), 338))
      .toEqual({ scene: 10003, sceneCfgId: 12 });
  });

  test('348 传送读 field 12，不能把 field 3 当场景号', () => {
    // 真实反馈：传送后界面停在「场景 1」——旧代码对 348 也读 field 3，
    // 那里是传送类型/序号，不是场景号。
    expect(parseSceneInfo(frame([scalar(3, 1), scalar(12, 10003)]), 348))
      .toEqual({ scene: 10003, sceneCfgId: null });
  });

  test('348 没有 field 12 时不覆盖现有场景', () => {
    expect(parseSceneInfo(frame([scalar(3, 1)]), 348).scene).toBeNull();
  });
});

describe('上行自身坐标（2026-11-10 真机 pcap 对账）', () => {
  // 真机上行为 `[前缀] + protobuf{1:时间戳, 2:{1:x,2:y,3:z}}`，不是 0x55aa 业务帧。
  const frame = (body: number[]) => new Uint8Array([...new Array(30).fill(0xff), ...body]);

  test('从「时间戳 + field 2 坐标」结构读出自身世界坐标', () => {
    const plaintext = frame([
      ...scalar(1, 1794253017526),
      ...message(2, [...scalar(1, 420876), ...scalar(2, 653992), ...scalar(3, 2029)]),
    ]);
    expect(parseUpstreamSelfPosition(plaintext)).toEqual({ x: 420876, y: 653992, heading: null });
  });

  test('同一帧的速度向量给出移动朝向（0=正北、顺时针）', () => {
    const plaintext = frame([
      ...scalar(1, 1794253017526),
      ...message(2, [...scalar(1, 420876), ...scalar(2, 653992), ...scalar(3, 2029)]),
      // 向东走：vx>0、vy=0 → 正东 = 90°
      ...message(4, [...scalar(1, 590), ...scalar(2, 0)]),
    ]);
    expect(parseUpstreamSelfPosition(plaintext)?.heading).toBeCloseTo(90, 1);
  });

  test('静止（速度为 0）时不编造朝向', () => {
    const plaintext = frame([
      ...scalar(1, 1794253017526),
      ...message(2, [...scalar(1, 420876), ...scalar(2, 653992)]),
      ...message(4, [...scalar(1, 0), ...scalar(2, 0)]),
    ]);
    expect(parseUpstreamSelfPosition(plaintext)?.heading).toBeNull();
  });

  test('没有毫秒时间戳的帧不当作自身坐标', () => {
    const plaintext = frame(message(2, [...scalar(1, 420876), ...scalar(2, 653992)]));
    expect(parseUpstreamSelfPosition(plaintext)).toBeNull();
  });

  test('坐标越界不当作自身坐标', () => {
    const plaintext = frame([
      ...scalar(1, 1794253017526),
      ...message(2, [...scalar(1, 99), ...scalar(2, 99)]),
    ]);
    expect(parseUpstreamSelfPosition(plaintext)).toBeNull();
  });
});

describe('实体包裹深度（2026-11-10 真机 pcap 对账）', () => {
  // 1044 的单实体记录在真包里是 root.f1 → f1 → f1 → { f1: 类型, f11: 角色 }，
  // 旧解析只认「顶层 f7」和「固定两层 f1.f1」，62 条实体帧里有 58 条被整包丢掉。
  const FROG: WildEntityRaw = {
    cfgId: 10065, actorId: 6, uniqueId: 260360778, level: 40,
    height: 61, weight: 4126, voiceDb: 0, mutation: 0, glassType: 0, glassValue: 0,
    pos: { x: 431992, y: 641328, z: 421 },
  };

  /** 角色消息：field 1 = identity（含 field 8 坐标）、field 3 = pet。 */
  const actorOf = (pet: WildEntityRaw): number[] => {
    const pos = [...scalar(1, pet.pos.x), ...scalar(2, pet.pos.y), ...scalar(3, pet.pos.z)];
    const identity = [...scalar(1, pet.actorId), ...message(8, message(1, pos)), ...scalar(11, pet.level)];
    const petMsg = [
      ...scalar(1, pet.cfgId), ...scalar(11, pet.height), ...scalar(12, pet.weight),
      ...scalar(17, pet.uniqueId), ...scalar(31, pet.voiceDb),
    ];
    return [...message(1, identity), ...message(3, petMsg)];
  };
  /** 330 全量快照：顶层 field 7 → actor(field 11)。 */
  const snapshotFrame = (pets: WildEntityRaw[]): Uint8Array =>
    new Uint8Array(message(7, pets.flatMap((pet) => message(11, actorOf(pet)))));
  /** 1044 单实体：三层包裹，最内层带 field 11。 */
  const unitSyncFrame = (pet: WildEntityRaw): Uint8Array =>
    new Uint8Array(message(1, message(1, message(1, [...scalar(1, 6), ...message(11, actorOf(pet))]))));

  const captureOf = (pets: WildEntityRaw[], captured: string[] = []) => ({
    wildPets: new Map(pets.map((pet) => [String(pet.uniqueId), pet])),
    capturedWild: new Set<string>(captured),
  });

  test('1044 三层嵌套实体能解出来（不再是 0 条）', () => {
    expect(parseWildEntities(unitSyncFrame(FROG))).toEqual([FROG]);
  });

  test('1044 单只实体按 uniqueId 合并进现有列表，不清空其他精灵', () => {
    const capture = captureOf([HUSKY]);
    expect(applyWildEntityFrame(capture, 1044, unitSyncFrame(FROG))).toBe(1);
    expect([...capture.wildPets.keys()].sort()).toEqual([String(FROG.uniqueId), String(HUSKY.uniqueId)].sort());
    expect(capture.wildPets.get(String(FROG.uniqueId))).toEqual(FROG);
  });

  test('330 仍是全量覆盖，旧快照里没有的精灵要消失', () => {
    const capture = captureOf([HUSKY, FROG]);
    applyWildEntityFrame(capture, 330, snapshotFrame([FROG]));
    expect([...capture.wildPets.keys()]).toEqual([String(FROG.uniqueId)]);
  });

  test('墓碑不复活：抓过的实体在 1044 / 330 里再下发也不写回', () => {
    const capture = captureOf([], [String(HUSKY.uniqueId)]);
    expect(applyWildEntityFrame(capture, 1044, unitSyncFrame(HUSKY))).toBe(0);
    expect(applyWildEntityFrame(capture, 330, snapshotFrame([HUSKY]))).toBe(0);
    expect(capture.wildPets.size).toBe(0);
  });
});

describe('附近排序', () => {
  test('稀有优先，其次距离', () => {
    const rare: WildPet = decorateWildPet(HUSKY);
    const plain: WildPet = decorateWildPet({ ...HUSKY, uniqueId: 2, voiceDb: 0 });
    const rows = sortNearby([
      withDistance(plain, { x: HUSKY.pos.x, y: HUSKY.pos.y }),
      withDistance(rare, { x: HUSKY.pos.x + 10000, y: HUSKY.pos.y }),
    ]);
    expect(rows[0].uniqueId).toBe(rare.uniqueId);
  });

  test('距离按 100:1 世界单位换算成米', () => {
    const row = withDistance(decorateWildPet(HUSKY), { x: HUSKY.pos.x + 1000, y: HUSKY.pos.y });
    expect(row.distanceM).toBeCloseTo(10);
  });
});
