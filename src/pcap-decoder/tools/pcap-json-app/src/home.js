/**
 * 家园场景解析（移植自采集器 1.2.6 的 NativeCaptureFields.home / decorate）。
 *
 * 只做纯解码：输入业务 payload（已去掉 0x55aa 帧头）和 opcode，
 * 输出「当前家园」的可读快照。坐标保留游戏世界单位（collector 已 /100）。
 *
 * 数据来源：TCP/8195 业务帧
 * - 330：家园全量场景
 * - 1043/1044：住户/蛋的进出增量（需要上一份全量场景做底）
 */

const NEST_CONFIG = {
  1001071: { nestType: 'ordinary', nestName: '普通小窝' },
  1001072: { nestType: 'academy', nestName: '学院小窝' },
};

function readVarint(bytes, offset) {
  let value = 0n;
  let shift = 0n;
  for (let index = offset; index < bytes.length && shift <= 63n; index += 1, shift += 7n) {
    const byte = bytes[index];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return {
        value,
        number: value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null,
        text: value.toString(),
        next: index + 1,
      };
    }
  }
  return null;
}

/** 严格 protobuf 解析；任何截断都返回 null（与采集器 Fields.parse 一致）。 */
export function parseFields(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const fields = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    if (!tag || tag.number === null || tag.number <= 0) return null;
    const field = Math.floor(tag.number / 8);
    const wire = tag.number % 8;
    offset = tag.next;
    let value;
    if (wire === 0) {
      const scalar = readVarint(bytes, offset);
      if (!scalar) return null;
      value = scalar.number === null ? scalar.text : scalar.number;
      offset = scalar.next;
    } else if (wire === 1) {
      if (offset + 8 > bytes.length) return null;
      value = bytes.subarray(offset, offset + 8);
      offset += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, offset);
      if (!length || length.number === null) return null;
      offset = length.next;
      if (offset + length.number > bytes.length) return null;
      value = bytes.subarray(offset, offset + length.number);
      offset += length.number;
    } else if (wire === 5) {
      if (offset + 4 > bytes.length) return null;
      value = bytes.subarray(offset, offset + 4);
      offset += 4;
    } else {
      return null;
    }
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

const values = (fields, number) => (fields && fields.get(number)) || [];
const first = (fields, number) => values(fields, number)[0];

function firstInt(fields, number) {
  const value = first(fields, number);
  return typeof value === 'number' ? value : null;
}

function firstBytes(fields, number) {
  const value = first(fields, number);
  return value instanceof Uint8Array ? value : null;
}

function sub(fields, number) {
  return parseFields(firstBytes(fields, number));
}

const idOf = (fields, number) => {
  const value = first(fields, number);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
};

function textOf(fields, number) {
  const bytes = firstBytes(fields, number);
  if (!bytes) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_error) {
    return '';
  }
}

function positionOf(fields, scaled) {
  if (!fields) return null;
  const x = firstInt(fields, 1);
  const y = firstInt(fields, 2);
  const z = firstInt(fields, 3);
  if (x === null || y === null || z === null) return null;
  return {
    x: scaled ? x / 100 : x,
    y: scaled ? y / 100 : y,
    z: scaled ? z / 100 : z,
  };
}

/** 住户：npc.22.1 = 宠物数据，npc.1 = 身份（actorId）。 */
function actor(raw) {
  const message = parseFields(raw);
  if (!message) return null;
  const npc = sub(message, 11);
  const pet = sub(sub(npc, 22), 1);
  if (!pet) return null;
  // 家具 GUID / 身份 ID 是 64 位，可能超出 Number 安全范围；
  // parseFields 会把这种 varint 转成字符串，这里统一按字符串 ID 处理。
  const instanceId = idOf(pet, 1);
  const baseId = idOf(pet, 2);
  const furnitureGuid = idOf(pet, 3);
  if (!instanceId || !baseId || !furnitureGuid || furnitureGuid === '0') return null;
  const identity = sub(npc, 1);
  const position = positionOf(sub(pet, 13), false) || positionOf(sub(sub(identity, 8), 1), false);
  const name = textOf(pet, 11);
  return {
    instanceId,
    baseId,
    confId: firstInt(pet, 14),
    furnitureGuid,
    actorId: idOf(identity, 2),
    resident: true,
    position,
    coordinateSystem: 'game-world',
    ...(name ? { name } : {}),
  };
}

/** 地上的蛋：identity.1 = 13，attachment.2 是该蛋所在小窝。 */
function sceneEgg(raw) {
  const message = parseFields(raw);
  if (!message) return null;
  const npc = sub(message, 11);
  const identity = sub(npc, 1);
  if (!identity || firstInt(identity, 1) !== 13) return null;
  const attachment = sub(npc, 23);
  const furnitureGuid = idOf(attachment, 2);
  if (!furnitureGuid || furnitureGuid === '0') return null;
  return {
    actorId: idOf(identity, 2),
    furnitureGuid,
    npcConfigId: firstInt(sub(npc, 3), 1),
  };
}

function decorate(home) {
  const furniture = home.furniture || [];
  const residents = home.residents || [];
  const byId = new Map();
  const decoratedFurniture = furniture.map((item) => {
    const config = NEST_CONFIG[item.configId] || null;
    const row = {
      ...item,
      nestType: config ? config.nestType : null,
      nestName: config ? config.nestName : null,
      residentIds: [],
    };
    if (item.furnitureGuid) byId.set(String(item.furnitureGuid), row);
    return row;
  });
  const decoratedResidents = residents.map((resident) => {
    const nest = byId.get(String(resident.furnitureGuid));
    if (!nest) return { ...resident, nest: null };
    nest.residentIds.push(resident.instanceId);
    return {
      ...resident,
      nest: {
        furnitureGuid: nest.furnitureGuid,
        configId: nest.configId,
        nestType: nest.nestType,
        nestName: nest.nestName,
        position: nest.position,
        positionRaw: nest.positionRaw,
        roomId: nest.roomId,
        roomName: nest.roomName,
      },
    };
  });
  // 家具本身不进入快照，只保留「小窝」这一层必要信息。
  const { furniture: _furniture, ...rest } = home;
  return {
    ...rest,
    residents: decoratedResidents,
    nests: decoratedFurniture.filter((item) => item.nestType || item.residentIds.length > 0),
    schemaVersion: 1,
  };
}

function fullHome(root, gameId, capturedAt, foreignScene) {
  const home = sub(root, 22);
  if (!home || idOf(home, 2) !== String(gameId) || foreignScene) return null;
  const residents = [];
  const sceneEggs = [];
  values(root, 7).forEach((raw) => {
    if (!(raw instanceof Uint8Array)) return;
    const resident = actor(raw);
    const egg = sceneEgg(raw);
    if (resident) residents.push(resident);
    if (egg) sceneEggs.push(egg);
  });
  const furniture = [];
  const rooms = sub(home, 20);
  if (rooms) {
    values(rooms, 1).forEach((rawRoom) => {
      const room = parseFields(rawRoom);
      if (!room) return;
      values(room, 20).forEach((rawPlane) => {
        const plane = parseFields(rawPlane);
        if (!plane) return;
        values(plane, 20).forEach((rawFurniture) => {
          const item = parseFields(rawFurniture);
          if (!item) return;
          const position = sub(sub(item, 6), 1);
          furniture.push({
            furnitureGuid: idOf(item, 1),
            parentFurnitureGuid: idOf(item, 2),
            itemGid: idOf(item, 4),
            configId: firstInt(item, 5),
            positionRaw: positionOf(position, false),
            position: positionOf(position, true),
            coordinateSystem: 'game-world',
            roomId: firstInt(room, 1),
            roomName: textOf(room, 2),
            planeGuid: idOf(plane, 1),
          });
        });
      });
    });
  }
  const couples = [];
  const coupleInfo = sub(home, 22);
  if (coupleInfo) {
    values(coupleInfo, 1).forEach((rawCouple) => {
      const couple = parseFields(rawCouple);
      if (!couple) return;
      const femaleActorId = idOf(couple, 1);
      if (!femaleActorId) return;
      couples.push({
        femaleActorId,
        maleActorIds: values(couple, 2).map((value) => String(value)),
      });
    });
  }
  return decorate({
    ok: true,
    gameId: String(gameId),
    roomLevel: firstInt(home, 5),
    homeLevel: firstInt(home, 4),
    capturedAt,
    residents,
    furniture,
    layEggCouples: couples,
    couplesStale: false,
    snapshotKind: 'full',
    sceneEggs,
  });
}

function deltaHome(root, previous, capturedAt) {
  const result = {
    ...previous,
    residents: Array.isArray(previous.residents) ? previous.residents.map((item) => ({ ...item })) : [],
    sceneEggs: Array.isArray(previous.sceneEggs) ? previous.sceneEggs.map((item) => ({ ...item })) : [],
    // 小窝是增量重新挂住户所需的唯一家具信息；完整家具不再保留。
    furniture: Array.isArray(previous.nests) ? previous.nests : [],
  };
  const residents = new Map(result.residents.map((item) => [String(item.instanceId), item]));
  const eggs = new Map(result.sceneEggs.map((item) => [String(item.actorId), item]));
  let changed = false;
  let petChanged = false;
  values(root, 1).forEach((rawAction) => {
    const action = parseFields(rawAction);
    if (!action) return;
    const enter = sub(action, 1);
    if (enter) {
      values(enter, 1).forEach((raw) => {
        if (!(raw instanceof Uint8Array)) return;
        const resident = actor(raw);
        const egg = sceneEgg(raw);
        if (resident) {
          residents.set(String(resident.instanceId), resident);
          changed = true;
          petChanged = true;
        }
        if (egg) {
          eggs.set(String(egg.actorId), egg);
          changed = true;
        }
      });
    }
    const leave = sub(action, 2);
    if (leave) {
      values(leave, 1).forEach((value) => {
        const actorId = String(value);
        residents.forEach((resident, key) => {
          if (String(resident.actorId) === actorId) {
            residents.delete(key);
            changed = true;
            petChanged = true;
          }
        });
        if (eggs.delete(actorId)) changed = true;
      });
    }
  });
  if (!changed) return null;
  return decorate({
    ...result,
    residents: Array.from(residents.values()),
    sceneEggs: Array.from(eggs.values()),
    capturedAt,
    snapshotKind: 'delta',
    couplesStale: Boolean(previous.couplesStale) || petChanged,
  });
}

/**
 * 解一帧家园数据。
 *
 * @param {Uint8Array} payload 已解密的业务 payload（不是整帧密文）
 * @param {number} opcode 业务 opcode
 * @param {string|number} gameId 当前账号 UID
 * @param {object|null} previous 上一份家园快照（增量用）
 * @param {boolean} foreignScene 是否在别人家园（scene=30002）
 * @param {string} capturedAt ISO 时间
 */
export function decodeHomePayload(payload, opcode, gameId, previous, foreignScene, capturedAt) {
  if (!(payload instanceof Uint8Array)) return null;
  const root = parseFields(payload);
  if (!root) return null;
  if (opcode === 330) return fullHome(root, gameId, capturedAt, foreignScene);
  if ((opcode === 1043 || opcode === 1044) && previous) return deltaHome(root, previous, capturedAt);
  return null;
}

/** 338/348 是场景切换：返回「是否他人家园」。 */
export function decodeHomeScene(payload, opcode) {
  if (opcode !== 338 && opcode !== 348) return null;
  const root = parseFields(payload);
  if (!root) return null;
  const scene = firstInt(root, opcode === 338 ? 3 : 12);
  return { scene, foreign: scene === 30002 };
}
