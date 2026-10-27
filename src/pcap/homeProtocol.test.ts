import { describe, expect, test } from 'vitest';
import { decodeHomePayload, decodeHomeScene } from '../pcap-decoder/tools/pcap-json-app/src/home';

const encoder = new TextEncoder();

function varint(value: number | bigint): number[] {
  const bytes: number[] = [];
  let rest = BigInt(value);
  do {
    const byte = Number(rest & 0x7fn);
    rest >>= 7n;
    bytes.push(rest > 0n ? byte | 0x80 : byte);
  } while (rest > 0n);
  return bytes;
}

function intField(field: number, value: number | bigint): number[] {
  return [...varint(field * 8), ...varint(value)];
}

function bytesField(field: number, value: Uint8Array | number[]): number[] {
  const bytes = value instanceof Uint8Array ? Array.from(value) : value;
  return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
}

function strField(field: number, value: string): number[] {
  return bytesField(field, encoder.encode(value));
}

function position(x: number, y: number, z: number): number[] {
  return [...intField(1, x), ...intField(2, y), ...intField(3, z)];
}

function petMessage(options: {
  instanceId: number | bigint;
  baseId: number | bigint;
  furnitureGuid: number | bigint;
  name: string;
  position?: [number, number, number];
}): number[] {
  return [
    ...intField(1, options.instanceId),
    ...intField(2, options.baseId),
    ...intField(3, options.furnitureGuid),
    ...intField(14, 100),
    ...strField(11, options.name),
    ...bytesField(13, position(...(options.position || [0, 0, 0]))),
  ];
}

function actorMessage(identityType: number, actorId: number | bigint, pet: number[], extra: number[] = []): number[] {
  const identity = [...intField(1, identityType), ...intField(2, actorId)];
  const npc = [...bytesField(1, identity), ...bytesField(22, bytesField(1, pet)), ...extra];
  return bytesField(11, npc);
}

function eggActor(actorId: number | bigint, furnitureGuid: number | bigint, npcConfigId: number): number[] {
  const identity = [...intField(1, 13), ...intField(2, actorId)];
  const npc = [
    ...bytesField(1, identity),
    ...bytesField(3, intField(1, npcConfigId)),
    ...bytesField(23, intField(2, furnitureGuid)),
  ];
  return bytesField(11, npc);
}

function furniture(configId: number, guid: number | bigint, x: number, y: number, z: number): number[] {
  return [
    ...intField(1, guid),
    ...intField(2, 0),
    ...intField(4, 9000n + BigInt(guid)),
    ...intField(5, configId),
    ...bytesField(6, bytesField(1, position(x, y, z))),
  ];
}

function homeMessage(options: {
  gameId: number;
  homeLevel: number;
  roomLevel: number;
  rooms: number[][];
  couples?: Array<{ female: number | bigint; males: Array<number | bigint> }>;
  planeGuid?: number;
  roomId?: number;
  roomName?: string;
}): number[] {
  const roomId = options.roomId ?? 1;
  const roomName = options.roomName ?? '一楼';
  const plane = [...intField(1, options.planeGuid ?? 1)];
  options.rooms.forEach((item) => plane.push(...bytesField(20, item)));
  const room = [...intField(1, roomId), ...strField(2, roomName), ...bytesField(20, plane)];
  const rooms = bytesField(1, room);
  const couples: number[] = [];
  (options.couples || []).forEach((couple) => {
    const row = [...intField(1, couple.female)];
    couple.males.forEach((male) => row.push(...intField(2, male)));
    couples.push(...bytesField(1, row));
  });
  return [
    ...intField(2, options.gameId),
    ...intField(4, options.homeLevel),
    ...intField(5, options.roomLevel),
    ...bytesField(20, rooms),
    ...bytesField(22, couples),
  ];
}

function fullPayload(gameId = 151910): Uint8Array {
  const actors = [
    actorMessage(1, 7001, petMessage({ instanceId: 1101, baseId: 2201, furnitureGuid: 8801, name: '母本甲' })),
    actorMessage(1, 7002, petMessage({ instanceId: 1102, baseId: 2202, furnitureGuid: 8802, name: '公本乙' })),
    eggActor(7009, 8801, 301),
  ];
  const home = homeMessage({
    gameId,
    homeLevel: 2,
    roomLevel: 3,
    rooms: [furniture(1001071, 8801, 120, 240, 60), furniture(1001072, 8802, 400, 240, 26)],
    couples: [{ female: 7002, males: [7001] }],
  });
  return new Uint8Array([...actors.map((actor) => bytesField(7, actor)).flat(), ...bytesField(22, home)]);
}

describe('家园解析', () => {
  test('330 全量场景解出住户、小窝、实际配对和地上的蛋', () => {
    const home = decodeHomePayload(fullPayload(), 330, '151910', null, false, '2026-10-27T00:00:00.000Z');

    expect(home).not.toBeNull();
    expect(home?.gameId).toBe('151910');
    expect(home?.homeLevel).toBe(2);
    expect(home?.roomLevel).toBe(3);
    expect(home?.residents).toHaveLength(2);
    expect(home?.residents[0]).toMatchObject({
      instanceId: '1101',
      baseId: '2201',
      furnitureGuid: '8801',
      actorId: '7001',
      name: '母本甲',
      nest: { nestType: 'ordinary', nestName: '普通小窝' },
    });
    expect(home?.nests).toHaveLength(2);
    expect(home?.nests?.map((nest) => nest.configId)).toEqual([1001071, 1001072]);
    expect(home?.nests?.[0].residentIds).toEqual(['1101']);
    expect(home?.layEggCouples).toEqual([{ femaleActorId: '7002', maleActorIds: ['7001'] }]);
    expect(home?.sceneEggs).toEqual([{ actorId: '7009', furnitureGuid: '8801', npcConfigId: 301 }]);
    expect(home?.schemaVersion).toBe(1);
  });

  test('账号不匹配或身处别人家园时丢弃全量场景', () => {
    expect(decodeHomePayload(fullPayload(999), 330, '151910', null, false, 't')).toBeNull();
    expect(decodeHomePayload(fullPayload(), 330, '151910', null, true, 't')).toBeNull();
  });

  test('338 场景切换能识别他人家园', () => {
    const payload = new Uint8Array(intField(3, 30002));
    expect(decodeHomeScene(payload, 338)).toEqual({ scene: 30002, foreign: true });
  });

  test('1043 增量能补进新住户并标记配对可能过期', () => {
    const previous = decodeHomePayload(fullPayload(), 330, '151910', null, false, 't');
    const newActor = actorMessage(
      1,
      7003,
      petMessage({ instanceId: 1103, baseId: 2203, furnitureGuid: 8802, name: '新来的' }),
    );
    const enter = bytesField(1, newActor);
    const action = bytesField(1, enter);
    const payload = new Uint8Array(bytesField(1, action));

    const next = decodeHomePayload(payload, 1043, '151910', previous, false, 't2');

    expect(next?.residents).toHaveLength(3);
    expect(next?.residents.some((resident) => resident.name === '新来的')).toBe(true);
    expect(next?.couplesStale).toBe(true);
    expect(next?.snapshotKind).toBe('delta');
  });

  test('64 位家具 / 身份 ID 用字符串保留，不会把住户丢掉', () => {
    const femaleActor = 9511622085510694758n;
    const maleActor = 9511622085510694765n;
    const femaleNest = 991530862998624803n;
    const maleNest = 991657899541305891n;
    const payload = new Uint8Array([
      ...bytesField(7, actorMessage(1, femaleActor, petMessage({
        instanceId: 63916,
        baseId: 3442,
        furnitureGuid: femaleNest,
        name: '小星光',
      }))),
      ...bytesField(7, actorMessage(1, maleActor, petMessage({
        instanceId: 63773,
        baseId: 3771,
        furnitureGuid: maleNest,
        name: '小浣蛋',
      }))),
      ...bytesField(22, homeMessage({
        gameId: 293143,
        homeLevel: 25,
        roomLevel: 5,
        rooms: [furniture(1001071, femaleNest, 0, 0, 0), furniture(1001071, maleNest, 10, 0, 0)],
        couples: [{ female: femaleActor, males: [maleActor] }],
      })),
    ]);

    const home = decodeHomePayload(payload, 330, '293143', null, false, 't');

    expect(home?.residents).toHaveLength(2);
    expect(home?.residents[0]).toMatchObject({
      instanceId: '63916',
      furnitureGuid: String(femaleNest),
      actorId: String(femaleActor),
      name: '小星光',
      nest: { nestName: '普通小窝' },
    });
    expect(home?.layEggCouples).toEqual([
      { femaleActorId: String(femaleActor), maleActorIds: [String(maleActor)] },
    ]);
  });
});
