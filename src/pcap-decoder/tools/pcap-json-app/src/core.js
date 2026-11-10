import CryptoJS from "crypto-js";
import { Deflate, ungzip } from "pako";
import catalog from "./generated/catalog.json";
import cfgPetMap from "./generated/cfgPetMap.json";
import petProtocolIdMap from "../../../miniprogram/utils/petProtocolIdMap";
import colorfulProtocol from "../../../miniprogram/utils/colorfulProtocol";
import petSpeciality from "../../../miniprogram/utils/petSpeciality";
import guluBallProtocol from "../../../miniprogram/utils/guluBallProtocol";
import eggProtocol from "../../../miniprogram/utils/eggProtocol";
import eggPetFormMap from "../../../miniprogram/utils/eggPetFormMap";
import petAdventureProtocol from "../../../scripts/lib/petAdventureProtocol";
import { decodeHomePayload, decodeHomeScene } from "./home";
import { createFirstFieldProbe } from "./loose-probe";
import { resolveBodySize, bodyMedalOf } from "../../../../shared/bodySize.js";

const { decodeColorfulMutation } = colorfulProtocol;
const { decodeSpeciality } = petSpeciality;
const { decodeGuluBallEntry } = guluBallProtocol;
const { isKnownSpecialEgg, normalizeEgg } = eggProtocol;
const DECODER_VERSION = "1.1.7";
const RAW_SCHEMA_VERSION = "protocol-raw-v1";
const { decodePetAdventure } = petAdventureProtocol;

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();
const INDIVIDUAL_STAT_NAMES = ["生命", "物攻", "魔攻", "物防", "魔防", "速度"];
const BLOODLINE_BY_ID = {
  1: "普通系血脉",
  2: "草系血脉",
  3: "火系血脉",
  4: "水系血脉",
  5: "光系血脉",
  6: "地系血脉",
  7: "冰系血脉",
  8: "龙系血脉",
  9: "电系血脉",
  10: "毒系血脉",
  11: "虫系血脉",
  12: "武系血脉",
  13: "翼系血脉",
  14: "萌系血脉",
  15: "幽系血脉",
  16: "恶系血脉",
  17: "机械系血脉",
  18: "幻系血脉",
  19: "首领血脉",
  23: "污染血脉",
  24: "奇异血脉"
};
const PCAP_LINK_TYPES = new Map([
  [0, "BSD loopback"],
  [1, "Ethernet"],
  [12, "Raw IP"],
  [101, "Raw IP"],
  [108, "OpenBSD loopback"],
  [113, "Linux cooked capture (SLL)"],
  [228, "Raw IPv4"],
  [229, "Raw IPv6"],
  [276, "Linux cooked capture v2 (SLL2)"]
]);

function readU16BE(bytes, offset) {
  return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
}

function readU32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function readU32LE(bytes, offset) {
  return (
    bytes[offset]
    + (bytes[offset + 1] << 8)
    + (bytes[offset + 2] << 16)
    + (bytes[offset + 3] * 0x1000000)
  ) >>> 0;
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function bytesToHex(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    const length = Math.min(4096, bytes.length - offset);
    const part = new Array(length);
    for (let i = 0; i < length; i++) part[i] = HEX_BYTE[bytes[offset + i]];
    chunks.push(part.join(""));
  }
  return chunks.join("");
}
const HEX_BYTE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function hexToBytes(hex) {
  const clean = String(hex || "");
  const result = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

function readVarint(bytes, offset, limit = bytes.length) {
  let value = 0n;
  let shift = 0n;
  for (let index = offset; index < limit && shift <= 63n; index += 1, shift += 7n) {
    const byte = bytes[index];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return {
        value,
        number: value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null,
        next: index + 1
      };
    }
  }
  return null;
}

function parseProto(bytes, start = 0, end = bytes.length) {
  const fields = new Map();
  let offset = start;
  while (offset < end) {
    const tag = readVarint(bytes, offset, end);
    if (!tag || !tag.number || tag.next > end) return null;
    const field = Math.floor(tag.number / 8);
    const wire = tag.number % 8;
    offset = tag.next;
    let value;
    if (wire === 0) {
      const parsed = readVarint(bytes, offset, end);
      if (!parsed || parsed.next > end) return null;
      value = parsed.number === null ? parsed.value.toString() : parsed.number;
      offset = parsed.next;
    } else if (wire === 1) {
      if (offset + 8 > end) return null;
      value = bytes.subarray(offset, offset + 8);
      offset += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, offset, end);
      if (!length || length.number === null || length.number < 0) return null;
      offset = length.next;
      if (offset + length.number > end) return null;
      value = bytes.subarray(offset, offset + length.number);
      offset += length.number;
    } else if (wire === 5) {
      if (offset + 4 > end) return null;
      value = bytes.subarray(offset, offset + 4);
      offset += 4;
    } else {
      return null;
    }
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return offset === end ? fields : null;
}

const looseProtoCache = new WeakMap();

function cachedParseLooseProto(bytes, start, end = bytes.length) {
  let cached = looseProtoCache.get(bytes);
  if (!cached || cached.end !== end) {
    cached = { end, probe: createFirstFieldProbe(bytes, readVarint, end) };
    looseProtoCache.set(bytes, cached);
  }
  return cached.probe(start);
}

function parseLooseProto(bytes, start = 0, end = bytes.length) {
  const fields = new Map();
  let offset = start;
  while (offset < end) {
    const tag = readVarint(bytes, offset, end);
    if (!tag || !tag.number || tag.next > end) break;
    const field = Math.floor(tag.number / 8);
    const wire = tag.number % 8;
    offset = tag.next;
    let value;
    if (wire === 0) {
      const parsed = readVarint(bytes, offset, end);
      if (!parsed || parsed.next > end) break;
      value = parsed.number === null ? parsed.value.toString() : parsed.number;
      offset = parsed.next;
    } else if (wire === 1) {
      if (offset + 8 > end) break;
      value = bytes.slice(offset, offset + 8);
      offset += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, offset, end);
      if (!length || length.number === null || length.number < 0) break;
      offset = length.next;
      if (offset + length.number > end) break;
      value = bytes.slice(offset, offset + length.number);
      offset += length.number;
    } else if (wire === 5) {
      if (offset + 4 > end) break;
      value = bytes.slice(offset, offset + 4);
      offset += 4;
    } else break;
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

function firstInt(fields, field) {
  const value = fields && fields.get(field) && fields.get(field)[0];
  return typeof value === "number" ? value : null;
}

function decodeUtf8(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  try {
    return textDecoder.decode(bytes);
  } catch (_error) {
    return null;
  }
}

function decodeProfile(plaintext) {
  for (let offset = 16; offset < plaintext.length - 2; offset += 1) {
    if (plaintext[offset] !== 10) continue;
    const length = readVarint(plaintext, offset + 1);
    if (!length || length.number === null || length.number < 20) continue;
    const end = length.next + length.number;
    if (end > plaintext.length) continue;
    const fields = parseProto(plaintext, length.next, end);
    if (!fields) continue;
    const gameId = firstInt(fields, 1);
    const numericId = fields.get(2) && fields.get(2)[0];
    const playerNameBytes = fields.get(3) && fields.get(3)[0];
    const numericText = numericId instanceof Uint8Array ? String.fromCharCode(...numericId) : "";
    const playerName = decodeUtf8(playerNameBytes);
    if (!(gameId >= 100000 && gameId <= 0xffffffff) || !/^\d{10,30}$/.test(numericText) || playerName === null) continue;
    return { game_id: gameId, player_name: playerName };
  }
  return null;
}

/**
 * 帧的 profile 解析结果缓存在解密缓存对象上：场景全量帧有 50KB+，
 * 每轮重扫一遍字节很贵，而同一帧的 profile 永远不变。
 */
function profileOfFrame(decoded) {
  if (decoded.profile === undefined) decoded.profile = decodeProfile(decoded.legacy);
  return decoded.profile;
}

function isNormalBox(fields) {
  const allowed = new Set([1, 2, 3, 4, 5, 6]);
  if (![1, 2, 3, 4].every((field) => fields.has(field))) return false;
  if (Array.from(fields.keys()).some((field) => !allowed.has(field))) return false;
  if (fields.get(1).length !== 1 || fields.get(2).length !== 1 || fields.get(3).length !== 30 || fields.get(4).length !== 1) return false;
  if (![1, 2, 3, 4].every((field) => fields.get(field).every((value) => !(value instanceof Uint8Array)))) return false;
  if (fields.has(5) && (fields.get(5).length !== 1 || !(fields.get(5)[0] instanceof Uint8Array))) return false;
  return !fields.has(6) || (fields.get(6).length === 1 && !(fields.get(6)[0] instanceof Uint8Array));
}

function decodeBoxes(plaintext) {
  const boxes = [];
  const seen = new Set();
  for (let offset = 16; offset < plaintext.length - 2; offset += 1) {
    const tag = readVarint(plaintext, offset);
    if (!tag || !tag.number || tag.number % 8 !== 2) continue;
    const length = readVarint(plaintext, tag.next);
    if (!length || length.number === null || length.number < 20) continue;
    const end = length.next + length.number;
    if (end > plaintext.length) continue;
    const fields = parseProto(plaintext, length.next, end);
    if (!fields || !isNormalBox(fields)) continue;
    const number = firstInt(fields, 1);
    if (!(number >= 1 && number <= 200) || seen.has(number)) continue;
    boxes.push({ number, slots: fields.get(3).map(Number) });
    seen.add(number);
  }
  return boxes;
}

function networkPacketOffset(packet, linkType) {
  if (linkType === 1) {
    if (packet.length < 14) return null;
    let etherTypeOffset = 12;
    let etherType = readU16BE(packet, etherTypeOffset);
    let ipOffset = 14;
    while (etherType === 0x8100 || etherType === 0x88a8 || etherType === 0x9100) {
      if (packet.length < ipOffset + 4) return null;
      etherTypeOffset += 4;
      etherType = readU16BE(packet, etherTypeOffset);
      ipOffset += 4;
    }
    if (etherType !== 0x0800 && etherType !== 0x86dd) return null;
    return { ipOffset, version: etherType === 0x0800 ? 4 : 6 };
  }
  if (linkType === 113) {
    if (packet.length < 16) return null;
    const protocol = readU16BE(packet, 14);
    if (protocol !== 0x0800 && protocol !== 0x86dd) return null;
    return { ipOffset: 16, version: protocol === 0x0800 ? 4 : 6 };
  }
  if (linkType === 276) {
    if (packet.length < 20) return null;
    const protocol = readU16BE(packet, 0);
    if (protocol !== 0x0800 && protocol !== 0x86dd) return null;
    return { ipOffset: 20, version: protocol === 0x0800 ? 4 : 6 };
  }
  if (linkType === 228) return { ipOffset: 0, version: 4 };
  if (linkType === 229) return { ipOffset: 0, version: 6 };
  if (linkType === 0 || linkType === 108) {
    if (packet.length < 5) return null;
    const version = packet[4] >> 4;
    return version === 4 || version === 6 ? { ipOffset: 4, version } : null;
  }
  if (linkType === 12 || linkType === 101) {
    if (!packet.length) return null;
    const version = packet[0] >> 4;
    return version === 4 || version === 6 ? { ipOffset: 0, version } : null;
  }
  return null;
}

function ipv6Address(packet, offset) {
  const groups = [];
  for (let index = 0; index < 16; index += 2) groups.push(readU16BE(packet, offset + index).toString(16));
  return groups.join(":");
}

function ipv6TcpOffset(packet, ipOffset) {
  if (packet.length < ipOffset + 40) return null;
  let nextHeader = packet[ipOffset + 6];
  let offset = ipOffset + 40;
  while (nextHeader !== 6) {
    if (offset + 2 > packet.length) return null;
    if (nextHeader === 0 || nextHeader === 43 || nextHeader === 60) {
      const current = nextHeader;
      nextHeader = packet[offset];
      const length = (packet[offset + 1] + 1) * 8;
      if (length < 8 || offset + length > packet.length) return null;
      offset += length;
      if (current === 59) return null;
    } else if (nextHeader === 44) {
      if (offset + 8 > packet.length) return null;
      const fragmentBits = readU16BE(packet, offset + 2);
      if ((fragmentBits & 0xfff8) !== 0) return null;
      nextHeader = packet[offset];
      offset += 8;
    } else if (nextHeader === 51) {
      nextHeader = packet[offset];
      const length = (packet[offset + 1] + 2) * 4;
      if (length < 8 || offset + length > packet.length) return null;
      offset += length;
    } else {
      return null;
    }
  }
  return offset;
}

function parseTcpPacket(packet, linkType) {
  const network = networkPacketOffset(packet, linkType);
  if (!network || (packet[network.ipOffset] >> 4) !== network.version) return null;
  const { ipOffset, version } = network;
  let tcpOffset;
  let packetEnd;
  let src;
  let dst;
  if (version === 4) {
    if (packet.length < ipOffset + 20) return null;
    const ipHeaderLength = (packet[ipOffset] & 0x0f) * 4;
    if (ipHeaderLength < 20 || packet[ipOffset + 9] !== 6) return null;
    tcpOffset = ipOffset + ipHeaderLength;
    const totalLength = readU16BE(packet, ipOffset + 2);
    packetEnd = Math.min(packet.length, totalLength > 0 ? ipOffset + totalLength : packet.length);
    src = Array.from(packet.slice(ipOffset + 12, ipOffset + 16)).join(".");
    dst = Array.from(packet.slice(ipOffset + 16, ipOffset + 20)).join(".");
  } else {
    if (packet.length < ipOffset + 40) return null;
    tcpOffset = ipv6TcpOffset(packet, ipOffset);
    if (tcpOffset === null) return null;
    const payloadLength = readU16BE(packet, ipOffset + 4);
    packetEnd = Math.min(packet.length, payloadLength > 0 ? ipOffset + 40 + payloadLength : packet.length);
    src = ipv6Address(packet, ipOffset + 8);
    dst = ipv6Address(packet, ipOffset + 24);
  }
  if (packet.length < tcpOffset + 20 || packetEnd < tcpOffset + 20) return null;
  const tcpHeaderLength = (packet[tcpOffset + 12] >> 4) * 4;
  const payloadOffset = tcpOffset + tcpHeaderLength;
  if (tcpHeaderLength < 20 || payloadOffset > packetEnd) return null;
  return {
    src,
    dst,
    srcPort: readU16BE(packet, tcpOffset),
    dstPort: readU16BE(packet, tcpOffset + 2),
    sequence: readU32BE(packet, tcpOffset + 4),
    flags: packet[tcpOffset + 13] & 0xff,
    payload: packet.subarray(payloadOffset, packetEnd)
  };
}

function pcapFormat(bytes) {
  if (bytes.length < 24) throw new Error("文件太小，不是有效的 PCAP 采集文件。");
  const signature = Array.from(bytes.slice(0, 4)).map((value) => value.toString(16).padStart(2, "0")).join("");
  if (signature === "d4c3b2a1" || signature === "4d3cb2a1") return { littleEndian: true };
  if (signature === "a1b2c3d4" || signature === "a1b23c4d") return { littleEndian: false };
  if (signature === "0a0d0d0a") throw new Error("当前版本不支持 PCAPNG，请在采集软件中另存为经典 PCAP 后再转换。");
  throw new Error("无法识别 PCAP 文件头，请确认选择的是经典 .pcap 文件。");
}

function readGameFlows(bytes, { allowTruncated = false, startRecordOffset = 24 } = {}) {
  const { littleEndian } = pcapFormat(bytes);
  const read32 = littleEndian ? readU32LE : readU32BE;
  const linkType = read32(bytes, 20);
  if (!PCAP_LINK_TYPES.has(linkType)) {
    throw new Error(`不支持此 PCAP 链路类型（${linkType}）。当前支持 Ethernet、RAW IP、Linux SLL/SLL2。`);
  }
  const flows = new Map();
  const flowGenerations = new Map();
  // 窗口化巡检（2026-11-08）：只从指定记录起点开始扫，但 packetStart 仍是**整份文件里的绝对偏移**，
  // 这样窗口滑动时同一帧的缓存键不变（见 frameCache）。
  let offset = Math.max(24, Number(startRecordOffset) || 24);
  let packets = 0;
  let truncated = false;
  while (offset + 16 <= bytes.length) {
    const capturedLength = read32(bytes, offset + 8);
    const packetStart = offset + 16;
    const packetEnd = packetStart + capturedLength;
    if (capturedLength > 64 * 1024 * 1024) {
      throw new Error("PCAP 数据记录不完整或已损坏。");
    }
    if (packetEnd > bytes.length) {
      if (allowTruncated) {
        truncated = true;
        break;
      }
      throw new Error("PCAP 数据记录不完整或已损坏。");
    }
    packets += 1;
    const tcp = parseTcpPacket(bytes.subarray(packetStart, packetEnd), linkType);
    offset = packetEnd;
    if (!tcp || (tcp.srcPort !== 8195 && tcp.dstPort !== 8195)) continue;
    const serverToClient = tcp.srcPort === 8195;
    const client = serverToClient ? `${tcp.dst}:${tcp.dstPort}` : `${tcp.src}:${tcp.srcPort}`;
    const server = serverToClient ? tcp.src : tcp.dst;
    const baseKey = `${client}->${server}:8195`;
    const startsConnection = (tcp.flags & 0x02) !== 0 && (tcp.flags & 0x10) === 0;
    if (startsConnection) flowGenerations.set(baseKey, Number(flowGenerations.get(baseKey) || 0) + 1);
    const generation = Number(flowGenerations.get(baseKey) || 1);
    const key = `${baseKey}#${generation}`;
    if (!tcp.payload.length) continue;
    // cacheKey 不含 generation：窗口化巡检时窗口里看不到更早的握手帧，代次会从 1 重新计数，
    // 用它做缓存键会让同一帧在不同轮次算出不同 key。绝对文件偏移已经能区分连接，所以去掉代次。
    if (!flows.has(key)) flows.set(key, { key, cacheKey: baseKey, firstPacket: packets, serverSegments: [], clientSegments: [] });
    const segment = {
      sequence: tcp.sequence,
      payload: tcp.payload,
      packetIndex: packets,
      packetStart
    };
    if (serverToClient) flows.get(key).serverSegments.push(segment);
    else flows.get(key).clientSegments.push(segment);
  }
  return {
    flows: Array.from(flows.values()),
    packets,
    linkType,
    linkTypeName: PCAP_LINK_TYPES.get(linkType),
    truncated
  };
}

function reassemble(segments) {
  const sorted = segments.slice().sort((left, right) => left.sequence - right.sequence);
  const chunks = [];
  const ranges = [];
  let next = null;
  let length = 0;
  sorted.forEach(({ sequence, payload, packetIndex, packetStart }) => {
    if (next === null) next = sequence;
    if (sequence + payload.length <= next) return;
    if (sequence > next) throw new Error(`TCP 流缺失 ${sequence - next} 字节，无法安全重组`);
    const trim = Math.max(0, next - sequence);
    const chunk = payload.subarray(trim);
    chunks.push(chunk);
    ranges.push({
      start: length,
      end: length + chunk.length,
      packetIndex: Number(packetIndex || 0),
      // 该段数据在整份 pcap 里的绝对字节偏移（trim 掉的字节也要算进去）
      packetStart: Number(packetStart || 0) + trim
    });
    length += chunk.length;
    next += chunk.length;
  });
  return { bytes: concatBytes(chunks), ranges };
}

/**
 * 帧在 TCP 流里的位置 → 包序号 + **整份文件的绝对字节偏移**。
 * 绝对偏移用于跨轮缓存键：窗口滑动时同一帧的偏移不变，缓存才能命中（见 frameCache）。
 */
function frameLocation(ranges, start, end) {
  let packetIndex = 0;
  let owner = null;
  let firstOverlap = null;
  ranges.forEach((range) => {
    if (range.end > start && range.start < end) {
      if (!firstOverlap) firstOverlap = range;
      if (range.start <= start && start < range.end) owner = range;
      packetIndex = Math.max(packetIndex, range.packetIndex);
    }
  });
  const anchor = owner || firstOverlap;
  return {
    packetIndex,
    fileOffset: anchor ? anchor.packetStart + Math.max(0, start - anchor.start) : 0
  };
}

function parseTgcpFrames(bytes, ranges = []) {
  const frames = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 6 <= bytes.length && bytes.slice(offset, offset + 6).every((value) => value === 0)) {
      offset += 6;
      continue;
    }
    let magic = -1;
    for (let index = offset; index + 1 < bytes.length; index += 1) {
      if (bytes[index] === 0x33 && bytes[index + 1] === 0x66) {
        magic = index;
        break;
      }
    }
    if (magic < 0 || magic + 21 > bytes.length) break;
    offset = magic;
    const headerLength = bytes[offset + 16];
    if (headerLength < 21) {
      offset += 2;
      continue;
    }
    const kind = bytes[offset + 6];
    const subKind = bytes[offset + 7];
    const payloadLength = kind === 64 && subKind === 19
      ? readU32BE(bytes, offset + 17)
      : (kind === 144 ? 0 : bytes[offset + 20]);
    const end = offset + headerLength + payloadLength;
    if (end > bytes.length) break;
    const location = frameLocation(ranges, offset, end);
    frames.push({
      bytes: bytes.subarray(offset, end),
      streamOffset: offset,
      packetIndex: location.packetIndex,
      fileOffset: location.fileOffset
    });
    offset = end;
  }
  return frames;
}

function petRecordsFromPlaintext(plaintext, records, capture) {
  const decodedIds = new Set();
  decodeBoxes(plaintext).forEach((box) => capture.boxes.set(box.number, box.slots));
  for (let offset = 16; offset < plaintext.length - 2; offset += 1) {
    if (plaintext[offset] !== 10) continue;
    const length = readVarint(plaintext, offset + 1);
    if (!length || length.number === null || length.number < 100) continue;
    const end = length.next + length.number;
    if (end > plaintext.length) continue;
    const fields = parseProto(plaintext, length.next, end);
    if (!fields || fields.size < 20) continue;
    const instanceId = firstInt(fields, 1);
    const ownerId = firstInt(fields, 2);
    const required10 = firstInt(fields, 10);
    const required11 = firstInt(fields, 11);
    const playerNameBytes = fields.get(3) && fields.get(3)[0];
    const playerName = decodeUtf8(playerNameBytes);
    if (!(instanceId > 0) || !(ownerId > 0) || required10 === null || required11 === null || playerName === null) continue;
    const intFields = {};
    const byteFields = {};
    fields.forEach((values, field) => {
      values.forEach((value) => {
        const isBytes = value instanceof Uint8Array;
        const target = isBytes ? byteFields : intFields;
        const serialized = isBytes ? bytesToHex(value) : value;
        if (!target[field]) target[field] = [];
        target[field].push(serialized);
      });
    });
    const recordKey = String(instanceId);
    decodedIds.add(recordKey);
    const previous = records.get(recordKey);
    records.set(recordKey, {
      instance_id: instanceId,
      owner_id: ownerId,
      player_name: playerName,
      int_fields: { ...(previous && previous.int_fields || {}), ...intFields },
      byte_fields: { ...(previous && previous.byte_fields || {}), ...byteFields },
      occurrences: Number(previous && previous.occurrences || 0) + 1,
      raw_source: {
        lastPacket: Number(capture && capture.lastDataPacket || 0),
        lastOrder: Number(capture && capture.lastDataOrder || 0)
      }
    });
  }
  return decodedIds.size;
}

function createAccountCapture(profile = null) {
  return {
    profile,
    records: new Map(),
    rawProtocolMessages: [],
    rawProtocolMessageKeys: new Set(),
    boxes: new Map(),
    eggInventory: null,
    guluInventory: null,
    fruitInventory: null,
    shelterFruits: null,
    fashions: null,
    topics: null,
    grassTrialSeen: false,
    grassMedalsSeen: false,
    grassBadgeHits: [],
    petMedals: [],
    grassMedals: [],
    grassTrials: [],
    homeScene: null,
    latestHome: null,
    homeEvents: [],
    foreignScene: false,
    /** 野外场景号（338/348）；家园场景为 30001/30002 */
    wildScene: null,
    /** 自身世界坐标（上行 307）；拿不到时为 null，雷达退回估算中心 */
    wildSelf: null,
    /** uniqueId → 野外实体（330 全量 + 1043 增量） */
    wildPets: new Map(),
    /** 已抓到的 uniqueId：后续 330/1043 再提到也不放回列表（2026-11-10） */
    capturedWild: new Set(),
    /** `petId:level:height:weight` → 宠物记录里的性格/性别（4934/579/4908，2026-11-06 验证） */
    ownedPetDetails: new Map(),
    /** 最近一次赛季奇遇战（4886/4890）里守卫的个体数据 */
    seasonEncounter: null,
    capturedAt: new Date().toISOString(),
    batchStarted: false,
    tailSeen: false,
    hasKey: false,
    lastProfilePacket: 0,
    lastProfileOrder: 0,
    lastDataPacket: 0,
    lastDataOrder: 0
  };
}

function protoObject(fields) {
  const result = {};
  if (!fields) return result;
  fields.forEach((values, field) => {
    result[field] = values.map((value) => value instanceof Uint8Array ? bytesToHex(value) : value);
  });
  return result;
}

function isoFromUnix(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Date(number * 1000).toISOString();
}

// Share the verified config resolver with the mini program.
function eggFormName(petConfId) { return eggPetFormMap.resolve(petConfId); }

function normalizeEggPetName(value) {
  return String(value || "").trim().replace(/的蛋$/, "");
}

function decodeEggEntryEnvelope(bytes) {
  const fields = parseProto(bytes);
  if (!fields) return null;
  const instanceId = firstInt(fields, 1);
  const itemConfId = firstInt(fields, 2);
  const quantity = firstInt(fields, 3);
  const bagType = firstInt(fields, 14);
  if (!(instanceId > 0) || !(itemConfId > 0) || !(quantity > 0) || !(bagType > 0)) return null;
  return { instanceId, itemConfId, quantity, bagType };
}

function decodeEggEntry(bytes, containerTimestamp) {
  const fields = parseProto(bytes);
  if (!fields) return null;
  const detailBytes = fields.get(15) && fields.get(15)[0];
  const detail = detailBytes instanceof Uint8Array ? parseProto(detailBytes) : new Map();
  if (!detail) return null;
  const instanceId = firstInt(fields, 1);
  const itemConfId = firstInt(fields, 2);
  if (!(instanceId > 0) || !(itemConfId > 0)) return null;
  const obtainedAtUnix = firstInt(fields, 4);
  const petConfId = firstInt(detail, 1);
  const specialEggConfId = firstInt(detail, 17);
  const knownSpecial = isKnownSpecialEgg(itemConfId, specialEggConfId);
  const staticInfo = petConfId > 0 && catalog.eggPets && catalog.eggPets[String(petConfId)] || {};
  const category = firstInt(detail, 10);
  const detailTimestampUnix = firstInt(detail, 9);
  const appearanceType = firstInt(detail, 18);
  const extensionType = firstInt(detail, 21);
  const preciousEggType = staticInfo.preciousEggType == null ? null : Number(staticInfo.preciousEggType);
  const hasExtension = [specialEggConfId, appearanceType, extensionType].some((value) => value !== null && Number(value) !== 0);
  const standardItem = itemConfId >= 107000 && itemConfId <= 107999;
  const ordinary = [3, 6].includes(category) && standardItem && !hasExtension && (preciousEggType === null || preciousEggType === 0);
  const traded = ordinary && category === 3 && detailTimestampUnix > 0 && obtainedAtUnix > detailTimestampUnix;
  const sourceType = traded ? "交换" : (category === 6 ? "巢穴" : (ordinary ? "普通" : (category === 2 ? "首领" : (category === 0 ? "活动" : "特殊"))));
  const resolvedFormName = eggFormName(petConfId);
  // A positive pet configuration is already enough to preserve the entry as
  // a normal importable egg even when this collector has no local name map;
  // cloud rules can resolve its display name later. Entries with no detail
  // configuration at all remain in `unrecognized` and never block completion.
  const recognized = Boolean(knownSpecial || petConfId > 0 || staticInfo.name || resolvedFormName);
  return normalizeEgg({
    externalEggId: String(instanceId), instanceId, itemConfId,
    quantity: firstInt(fields, 3) || 1, bagType: firstInt(fields, 14),
    petConfId, speciesPetId: petConfId > 0 ? Math.floor(petConfId / 1000) : null,
    petName: normalizeEggPetName(staticInfo.name),
    petFormName: resolvedFormName,
    petDisplayName: resolvedFormName || String(staticInfo.name || ""),
    formResolution: resolvedFormName ? "pet-conf-id" : "unresolved",
    preciousEggType,
    sourceType, isOrdinary: ordinary, isShiny: preciousEggType === 2,
    heightCm: firstInt(detail, 2), weightGrams: firstInt(detail, 3),
    hatchSeconds: firstInt(detail, 6), obtainedAtUnix,
    obtainedAt: isoFromUnix(obtainedAtUnix), detailTimestampUnix,
    detailTimestamp: isoFromUnix(detailTimestampUnix), containerTimestampUnix: containerTimestamp || null,
    category, specialEggConfId, appearanceType,
    appearanceParametersHex: detail.get(19) && detail.get(19)[0] instanceof Uint8Array ? bytesToHex(detail.get(19)[0]) : "",
    extensionType,
    recognized,
    unrecognized: !recognized,
    unrecognizedReason: recognized ? "" : (detailBytes instanceof Uint8Array ? "unknown-config" : "missing-detail-fields"),
    rawEntryFields: protoObject(fields), rawDetailFields: protoObject(detail)
  });
}

function decodeEggInventorySnapshots(plaintext) {
  const snapshots = [];
  for (let offset = 0; offset < plaintext.length - 2; offset += 1) {
    const tag = readVarint(plaintext, offset);
    if (!tag || tag.number === null || tag.number % 8 !== 2) continue;
    const length = readVarint(plaintext, tag.next);
    if (!length || length.number === null || length.number < 4) continue;
    const end = length.next + length.number;
    if (end > plaintext.length) continue;
    // Most responses begin with field 1 = 8, but protobuf field order is not
    // guaranteed. Probe the small root header before parsing so reordered
    // responses and short final pages are accepted without recursively
    // parsing every unrelated payload in the frame.
    let hasInventoryMarker = false;
    const markerEnd = Math.min(end - 1, length.next + 48);
    for (let marker = length.next; marker < markerEnd; marker += 1) {
      if (plaintext[marker] === 0x08 && plaintext[marker + 1] === 0x08) {
        hasInventoryMarker = true;
        break;
      }
    }
    if (!hasInventoryMarker) continue;
    const fields = parseProto(plaintext, length.next, end);
    if (!fields || firstInt(fields, 1) !== 8) continue;
    const rawDeclaredCount = firstInt(fields, 4);
    const containerTimestamp = firstInt(fields, 5);
    // Large inventories can switch to a paged response whose repeated entry
    // field differs from the compact response. Identify those entries by
    // their stable inner structure instead of relying only on root field 2.
    const entriesById = new Map();
    const unrecognizedById = new Map();
    const receivedEntryIds = new Set();
    fields.forEach((values) => values.forEach((value) => {
      if (!(value instanceof Uint8Array)) return;
      const envelope = decodeEggEntryEnvelope(value);
      if (!envelope) return;
      receivedEntryIds.add(String(envelope.instanceId));
      const egg = decodeEggEntry(value, containerTimestamp);
      if (!egg) return;
      const target = egg.unrecognized === true ? unrecognizedById : entriesById;
      target.set(String(egg.instanceId), egg);
    }));
    const entries = Array.from(entriesById.values());
    const unrecognized = Array.from(unrecognizedById.values());
    const receivedCount = receivedEntryIds.size;
    const normalizedDeclaredCount = Math.max(Number(rawDeclaredCount || 0), receivedCount, entries.length);
    const countReliable = rawDeclaredCount !== null && rawDeclaredCount >= receivedCount;
    const completeEmptyInventory = rawDeclaredCount === 0
      && receivedCount === 0
      && Number(containerTimestamp || 0) > 0;
    const usableInventory = receivedCount > 0;
    if (completeEmptyInventory || usableInventory) {
      snapshots.push({
        declaredCount: normalizedDeclaredCount,
        decodedCount: entries.length,
        receivedCount,
          unrecognizedCount: Math.max(0, receivedCount - entries.length),
        skippedCount: Math.max(0, normalizedDeclaredCount - entries.length),
        countReliable,
        containerTimestamp,
        receivedEntryIds: Array.from(receivedEntryIds),
          eggs: entries,
          unrecognized
      });
      offset = end - 1;
    }
  }
  return snapshots;
}

function mergeEggInventorySnapshot(previous, incoming) {
  if (!previous) return incoming;
  if (!incoming) return previous;
  const previousTimestamp = Number(previous.containerTimestamp || 0);
  const incomingTimestamp = Number(incoming.containerTimestamp || 0);
  const sameGeneration = previousTimestamp === incomingTimestamp;
  const declaredCount = Math.max(
    Number(previous.declaredCount || 0),
    Number(incoming.declaredCount || 0)
  );
  const combined = new Map();
  previous.eggs.forEach((egg) => combined.set(String(egg.instanceId), egg));
  incoming.eggs.forEach((egg) => combined.set(String(egg.instanceId), egg));
  const mergedEggs = Array.from(combined.values());
  const previousUnknown = new Map((previous.unrecognized || []).map((egg) => [String(egg.instanceId), egg]));
  (incoming.unrecognized || []).forEach((egg) => previousUnknown.set(String(egg.instanceId), egg));
  // A later paged response may contain a richer detail for an entry that was
  // initially undecodable. Once the same instance is recognized, remove the
  // stale unknown copy so the JSON never reports it twice.
  mergedEggs.forEach((egg) => previousUnknown.delete(String(egg.instanceId)));
  const mergedUnrecognized = Array.from(previousUnknown.values());
  const receivedEntryIds = new Set([
    ...(previous.receivedEntryIds || previous.eggs.map((egg) => String(egg.instanceId))),
    ...(incoming.receivedEntryIds || incoming.eggs.map((egg) => String(egg.instanceId)))
  ].map(String));
  const mergedReceivedCount = receivedEntryIds.size;
  const closeTimestampPage = previousTimestamp > 0
    && incomingTimestamp > 0
    && Math.abs(incomingTimestamp - previousTimestamp) <= 5
    && mergedReceivedCount <= declaredCount;

  // Egg inventories above the response threshold arrive as sibling pages.
  // Pages normally share the same container timestamp; tolerate a small
  // timestamp drift only when their union still fits the declared total.
  if (sameGeneration || closeTimestampPage) {
    const mergedDeclaredCount = Math.max(declaredCount, mergedReceivedCount, mergedEggs.length);
    return {
      declaredCount: mergedDeclaredCount,
      decodedCount: mergedEggs.length,
      receivedCount: mergedReceivedCount,
       unrecognizedCount: Math.max(0, mergedReceivedCount - mergedEggs.length),
      skippedCount: Math.max(0, mergedDeclaredCount - mergedEggs.length),
      countReliable: previous.countReliable !== false
        && incoming.countReliable !== false
        && mergedReceivedCount <= declaredCount,
      containerTimestamp: Math.max(previousTimestamp, incomingTimestamp) || null,
      receivedEntryIds: Array.from(receivedEntryIds),
       eggs: mergedEggs,
       unrecognized: mergedUnrecognized
    };
  }

  if (incomingTimestamp > previousTimestamp) return incoming;
  if (incomingTimestamp < previousTimestamp) return previous;
  return Number(incoming.receivedCount || incoming.eggs.length) >= Number(previous.receivedCount || previous.eggs.length)
    ? incoming
    : previous;
}

function decodeGuluBallInventorySnapshots(plaintext) {
  const snapshots = [];
  const visitedRoots = new Set();
  for (let offset = 16; offset < plaintext.length - 2; offset += 1) {
    if (plaintext[offset] !== 10) continue;
    const outer = cachedParseLooseProto(plaintext, offset);
    const rootBytes = outer.get(4) && outer.get(4)[0];
    if (!(rootBytes instanceof Uint8Array) || rootBytes.length < 1000) continue;
    const range = `${rootBytes.byteOffset}:${rootBytes.byteLength}`;
    if (visitedRoots.has(range)) continue;
    visitedRoots.add(range);
    const root = parseProto(rootBytes);
    if (!root) continue;
    for (const groupBytes of root.get(3) || []) {
      if (!(groupBytes instanceof Uint8Array)) continue;
      const group = parseProto(groupBytes);
      if (!group || firstInt(group, 1) !== 1) continue;
      const entries = (group.get(2) || []).filter((value) => value instanceof Uint8Array)
        .map((value) => decodeGuluBallEntry(parseProto(value)))
        .filter(Boolean);
      if (entries.length < 3 || entries.some((entry) => entry.itemConfId < 100000 || entry.itemConfId > 999999)) continue;
      snapshots.push({
        groupId: firstInt(group, 1),
        declaredCount: entries.length,
        decodedCount: entries.length,
        skippedCount: 0,
        updatedAtUnix: Math.max(...entries.map((entry) => Number(entry.updatedAtUnix || 0))),
        balls: entries
      });
    }
  }
  return snapshots;
}

function nestedMessage(fields, field, index = 0) {
  const value = fields && fields.get(field) && fields.get(field)[index];
  return value instanceof Uint8Array ? parseProto(value) : null;
}

function decodeFruitInventorySnapshots(plaintext) {
  const snapshots = [];
  const visitedRoots = new Set();
  for (let offset = 16; offset < plaintext.length - 2; offset += 1) {
    if (plaintext[offset] !== 10) continue;
    const outer = cachedParseLooseProto(plaintext, offset);
    const rootBytes = outer.get(4) && outer.get(4)[0];
    if (!(rootBytes instanceof Uint8Array) || rootBytes.length < 1000) continue;
    const range = `${rootBytes.byteOffset}:${rootBytes.byteLength}`;
    if (visitedRoots.has(range)) continue;
    visitedRoots.add(range);
    const root = parseProto(rootBytes);
    if (!root) continue;
    for (const groupBytes of root.get(3) || []) {
      if (!(groupBytes instanceof Uint8Array)) continue;
      const group = parseProto(groupBytes);
      if (!group || firstInt(group, 1) !== 11) continue;
      const fruitIds = (group.get(2) || []).filter((value) => value instanceof Uint8Array)
        .map((value) => firstInt(parseProto(value), 2))
        .map((itemConfId) => catalog.fruitIdsByItemConfId[String(itemConfId)] || "")
        .filter(Boolean);
      if (fruitIds.length) snapshots.push(Array.from(new Set(fruitIds)));
    }
  }
  return snapshots;
}

function decodeAccountCollectionSnapshot(plaintext) {
  const root = plaintext.length > 26 ? cachedParseLooseProto(plaintext, 26) : null;
  if (!root || !root.size) return null;
  const result = { fashions: null, topics: null, shelterFruits: null };

  const accountRoot = nestedMessage(root, 2);
  const wardrobeRoot = nestedMessage(nestedMessage(nestedMessage(accountRoot, 11), 16), 1);
  if (wardrobeRoot) {
    const validFashionIds = new Set(catalog.fashionPartIds || []);
    const normalizeFashionId = (value) => {
      const raw = String(value || "");
      if (validFashionIds.has(raw)) return raw;
      // Accessory records may omit the gender/variant suffix used by the
      // catalog (for example 325001 -> 32500101).
      const suffixed = `${raw}01`;
      return validFashionIds.has(suffixed) ? suffixed : "";
    };
    // The wardrobe response has used field 6 for clothing, but newer clients
    // place accessory groups (staff, bag charms, etc.) in sibling/nested
    // fields. Walk only this bounded wardrobe message and keep catalog IDs.
    const found = new Set();
    const visit = (value, depth = 0) => {
      if (depth > 4) return;
      if (value instanceof Uint8Array) {
        const nested = parseProto(value);
        if (!nested) return;
        const direct = firstInt(nested, 1);
        const directId = normalizeFashionId(direct);
        if (directId) found.add(directId);
        nested.forEach((values) => values.forEach((entry) => visit(entry, depth + 1)));
        return;
      }
      const id = normalizeFashionId(value);
      if (validFashionIds.has(id)) found.add(id);
    };
    wardrobeRoot.forEach((values) => values.forEach((value) => visit(value)));
    const fashions = Array.from(found);
    if (fashions.length) result.fashions = Array.from(new Set(fashions.map((id) => `item:${id}`)));
  }

  const topicRoot = nestedMessage(nestedMessage(accountRoot, 4), 8);
  if (topicRoot) {
    const topics = {};
    (topicRoot.get(2) || []).forEach((recordBytes) => {
      if (!(recordBytes instanceof Uint8Array)) return;
      const record = parseProto(recordBytes);
      const handbook = record && catalog.topicHandbooksById[String(firstInt(record, 1))];
      if (!record || !handbook) return;
      const topicRequirements = new Map((handbook.topics || []).map((topic) => [Number(topic.id), Number(topic.count) || 0]));
      (record.get(3) || []).forEach((topicBytes) => {
        if (!(topicBytes instanceof Uint8Array)) return;
        const topic = parseProto(topicBytes);
        const topicId = firstInt(topic, 5);
        const required = topicRequirements.get(topicId);
        const progress = firstInt(topic, 1) || 0;
        const claimed = firstInt(topic, 6) === 1;
        if (required !== undefined && (claimed || progress >= required)) topics[`${handbook.archiveKey}:${topicId}`] = true;
      });
    });
    if (Object.keys(topics).length) result.topics = topics;
  }

  const shelterRoot = nestedMessage(nestedMessage(nestedMessage(root, 11), 12), 36);
  if (shelterRoot) {
    const fruits = [];
    (shelterRoot.get(1) || []).forEach((shelterBytes) => {
      if (!(shelterBytes instanceof Uint8Array)) return;
      const shelter = parseProto(shelterBytes);
      const placement = nestedMessage(shelter, 8);
      (placement && placement.get(1) || []).forEach((fruitBytes) => {
        if (!(fruitBytes instanceof Uint8Array)) return;
        const itemConfId = firstInt(parseProto(fruitBytes), 1);
        const fruitId = catalog.fruitIdsByItemConfId[String(itemConfId)];
        if (fruitId) fruits.push(fruitId);
      });
    });
    if (fruits.length) result.shelterFruits = Array.from(new Set(fruits));
  }
  return result;
}

function decodePetMedalSnapshots(plaintext) {
  const snapshots = [];
  const roots = [];
  const visitedRoots = new Set();
  const addRoot = (fields) => {
    const bytes = fields && fields.get(2)?.[0];
    if (!(bytes instanceof Uint8Array)) return;
    const range = `${bytes.byteOffset}:${bytes.byteLength}`;
    if (visitedRoots.has(range)) return;
    visitedRoots.add(range);
    const account = parseProto(bytes);
    const medalRoot = nestedMessage(nestedMessage(account, 4), 33);
    if (medalRoot) roots.push(medalRoot);
  };
  addRoot(plaintext.length > 26 ? cachedParseLooseProto(plaintext, 26) : null);
  for (let offset = 0; offset < plaintext.length - 2; offset += 1) {
    if (plaintext[offset] !== 10) continue;
    const candidate = cachedParseLooseProto(plaintext, offset);
    if (candidate && candidate.size) addRoot(candidate);
  }
  roots.forEach((medalRoot) => {
    (medalRoot.get(1) || []).forEach((recordBytes) => {
      if (!(recordBytes instanceof Uint8Array)) return;
      const record = parseProto(recordBytes);
      const medalConfId = record && firstInt(record, 1);
      if (!record || !medalConfId) return;
      (record.get(3) || []).forEach((bucketBytes) => {
        if (!(bucketBytes instanceof Uint8Array)) return;
        const bucket = parseProto(bucketBytes);
        (bucket && bucket.get(2) || []).forEach((detailBytes) => {
          if (!(detailBytes instanceof Uint8Array)) return;
          const detail = parseProto(detailBytes);
          if (!detail) return;
          snapshots.push({
            medalConfId,
            medalType: firstInt(record, 2),
            ownerId: firstInt(detail, 2),
            addTime: firstInt(detail, 3),
            isWear: firstInt(detail, 4) !== 0,
            completeCount: firstInt(detail, 5),
            obtainPetGid: firstInt(detail, 6),
            wearPetGid: firstInt(detail, 8)
          });
        });
      });
    });
  });
  const seen = new Set();
  return snapshots.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeGrassTrialSnapshots(plaintext) {
  const officialNoByTrialId = {
    8101: 5010, 8102: 5017, 8103: 5003, 8104: 5016, 8105: 5004, 8106: 5012,
    8107: 5015, 8108: 5005, 8109: 5019, 8110: 5008, 8111: 5014, 8112: 5018,
    8113: 5001, 8114: 5007, 8115: 5009, 8116: 5013, 8117: 5023, 8118: 5024,
    8119: 5020, 8120: 5021, 8121: 5022, 8122: 5053
  };
  const results = [];
  const visitedRoots = new Set();
  for (let offset = 0; offset < plaintext.length - 2; offset += 1) {
    if (plaintext[offset] !== 10) continue;
    const outer = cachedParseLooseProto(plaintext, offset);
    const bytes = outer.get(2)?.[0];
    if (!(bytes instanceof Uint8Array)) continue;
    const range = `${bytes.byteOffset}:${bytes.byteLength}`;
    if (visitedRoots.has(range)) continue;
    visitedRoots.add(range);
    const root = parseProto(bytes);
    const activity = nestedMessage(root, 2);
    if (!activity) continue;
    const areaRecords = [];
    (activity.get(4) || []).forEach((areaBytes) => {
      if (!(areaBytes instanceof Uint8Array)) return;
      const area = parseProto(areaBytes);
      const areaId = firstInt(area, 1);
      if (![100, 101, 102].includes(areaId)) return;
      const stageKey = areaId === 100 ? "somia" : areaId === 101 ? "stone" : areaId === 102 ? "prata" : `area_${areaId}`;
      const stageName = areaId === 100 ? "记忆中的索米亚草原" : areaId === 101 ? "记忆中的巨石阵" : areaId === 102 ? "记忆中的普拉塔草原" : `区域${areaId}`;
      const footprintPetIds = Array.from(new Set((area.get(3) || [])
        .filter((value) => typeof value === "number" && value > 0)
        .map((value) => officialNoByTrialId[value] || value))).sort((a, b) => a - b);
      const footprintPets = footprintPetIds.map((petId) => {
        const entry = catalog.pets.find((candidate) => Number(candidate.petId) === petId);
        const protocolName = petProtocolIdMap[String(petId)];
        const catalogName = entry && (entry.identityName || entry.name);
        return { petId, name: String(protocolName || catalogName || `未知精灵 ${petId}`) };
      });
      areaRecords.push({ areaId, stageKey, stageName, footprintPetIds, footprintPets });
    });
    if (areaRecords.length) {
      results.push({ responseOpcode: 6489, activityState: firstInt(activity, 6), areaRecords });
    }
  }
  const seen = new Set();
  return results.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wordArrayToBytes(wordArray) {
  const result = new Uint8Array(wordArray.sigBytes);
  for (let index = 0; index < wordArray.sigBytes; index += 1) {
    result[index] = (wordArray.words[index >>> 2] >>> (24 - (index % 4) * 8)) & 0xff;
  }
  return result;
}

function decryptAesCbc(encrypted, key, iv = null) {
  const ciphertext = CryptoJS.lib.WordArray.create(encrypted);
  const keyWords = CryptoJS.lib.WordArray.create(key);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext },
    keyWords,
    {
      iv: CryptoJS.lib.WordArray.create(iv || new Uint8Array(16)),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.NoPadding
    }
  );
  return wordArrayToBytes(decrypted);
}

function stripPadding(value) {
  const length = value.length;
  if (length >= 6 && value[length - 6] === 0x74 && value[length - 5] === 0x73
    && value[length - 4] === 0x66 && value[length - 3] === 0x34
    && value[length - 2] === 0x67) {
    const padding = value[length - 1];
    if (padding >= 6 && padding <= 64 && padding <= length) return value.subarray(0, length - padding);
  }
  return value;
}

/** 0x55aa 业务帧头：返回去掉帧头的 payload 与 opcode。 */
function businessPayload(plaintext) {
  if (plaintext.length >= 30 && readU16BE(plaintext, 4) === 0x55aa && readU16BE(plaintext, 24) === 0x3963) {
    const payload = stripPadding(plaintext.subarray(30));
    const version = readU32BE(plaintext, 12);
    if (readU16BE(plaintext, 10) === 0 && (version === 0 || version === 1)
      && readU32BE(plaintext, 6) === 26 + payload.length
      && (readU32BE(plaintext, 16) & 0xffff) !== 0) {
      return { payload, opcode: readU32BE(plaintext, 16) & 0xffff };
    }
  }
  if (plaintext.length >= 10 && readU16BE(plaintext, 4) === 0x55aa) {
    const opcode = readU32BE(plaintext, 0);
    if (opcode > 0 && opcode <= 0xffff) {
      return { payload: stripPadding(plaintext.subarray(10)), opcode };
    }
  }
  return null;
}

/**
 * 同一帧解两次：
 * - legacy：零 IV 解整段（现有字段扫描都吃这个形态）
 * - business：当前协议用前 16 字节做 IV，解出 0x55aa 业务帧（家园用）
 */
function resolveFramePayload(encrypted, key) {
  const legacy = decryptAesCbc(encrypted, key);
  if (encrypted.length >= 32) {
    const exact = decryptAesCbc(encrypted.subarray(16), key, encrypted.subarray(0, 16));
    const business = businessPayload(exact);
    if (business) return { legacy, business };
  }
  const fallback = businessPayload(legacy.subarray(Math.min(16, legacy.length)));
  return { legacy, business: fallback };
}

/**
 * 跨轮解密缓存（2026-11-08 性能修复）。
 *
 * 实时巡检每轮都从头重解整个文件，实测瓶颈**只有** AES 解密（约 6ms/帧），
 * 字节扫描 12000 包仅 3–7ms；抓包涨到 7MiB 时单轮要 4s 以上，界面刷新严重滞后。
 * TCP 流是 append-only，已解出帧的位置稳定，因此按「流 + 帧在整份文件里的绝对字节偏移」
 * 复用解密结果，每轮只真正解密新增帧。用绝对偏移而不是包序号 / 帧序，是因为实时巡检
 * 只解文件尾部窗口（见 extractPcap 的 windowBytes），窗口滑动后包序号与帧序都会变。
 * 命中前用长度 + 首尾字节校验，重连 / 重组变化导致密文不同时自动落空重解，不会用到错数据。
 */
const FRAME_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const frameCache = new Map();
let frameCacheBytes = 0;

function frameSignature(bytes) {
  let head = 0;
  let tail = 0;
  for (let index = 0; index < 8 && index < bytes.length; index += 1) head = (head * 31 + bytes[index]) | 0;
  for (let index = Math.max(0, bytes.length - 8); index < bytes.length; index += 1) tail = (tail * 31 + bytes[index]) | 0;
  return `${bytes.length}:${head}:${tail}`;
}

function frameCacheSlot(flowKey, key, fileOffset, frameIndex) {
  // fileOffset 为 0（没有包区间信息）时退回帧序，只影响极端兜底路径。
  // key 也进缓存键：同一偏移理论上只会用一种 key 写，但重连后注入 key 解错的兜底
  // 情景下，不能把错 key 的结果喂给对 key。
  const keyTag = key ? keyIdOf(key) : "-";
  return fileOffset > 0 ? `${flowKey}#${keyTag}#${fileOffset}` : `${flowKey}#${keyTag}#f${frameIndex}`;
}

const keyIdCache = new WeakMap();

function keyIdOf(key) {
  let id = keyIdCache.get(key);
  if (!id) {
    id = bytesToHex(key instanceof Uint8Array ? key : new Uint8Array(key)).slice(0, 16);
    keyIdCache.set(key, id);
  }
  return id;
}

function cachedFramePayload(flowKey, key, fileOffset, frameIndex, encrypted) {
  const slot = frameCache.get(frameCacheSlot(flowKey, key, fileOffset, frameIndex));
  return slot && slot.signature === frameSignature(encrypted) ? slot.decoded : null;
}

function rememberFramePayload(flowKey, key, fileOffset, frameIndex, encrypted, decoded) {
  const cacheSlot = frameCacheSlot(flowKey, key, fileOffset, frameIndex);
  const previous = frameCache.get(cacheSlot);
  if (previous) frameCacheBytes -= previous.size;
  const size = decoded.legacy.length + (decoded.business ? decoded.business.payload.length : 0);
  // 超过上限直接清空：巡检只关心最新数据，清空后下一轮重建，不会无限占内存。
  if (frameCacheBytes + size > FRAME_CACHE_MAX_BYTES) {
    frameCache.clear();
    frameCacheBytes = 0;
  }
  frameCache.set(cacheSlot, { signature: frameSignature(encrypted), decoded, size });
  frameCacheBytes += size;
  return decoded;
}

function decryptFrameOnce(flowKey, key, fileOffset, frameIndex, encrypted) {
  const hit = cachedFramePayload(flowKey, key, fileOffset, frameIndex, encrypted);
  if (hit) { frameCacheHits += 1; return hit; }
  frameCacheMisses += 1;
  return rememberFramePayload(
    flowKey, key, fileOffset, frameIndex, encrypted,
    resolveFramePayload(encrypted, key),
  );
}

let frameCacheHits = 0;
let frameCacheMisses = 0;
/** 测试 / 性能诊断用：解密缓存命中情况。 */
export function __frameCacheStats() {
  return { hits: frameCacheHits, misses: frameCacheMisses, entries: frameCache.size, bytes: frameCacheBytes };
}
/** 测试用：清空跨轮解密缓存与已知 AES key。 */
export function __resetFrameCacheForTest() {
  frameCache.clear();
  frameCacheBytes = 0;
  frameCacheHits = 0;
  frameCacheMisses = 0;
  recentKeys.clear();
  resetNearbyBaseline("");
  headScannedKey = "";
  liveStateImportedKey = "";
}

/**
 * 最近一次解出的 AES key（按连接，不含代次）。
 * 尾部窗口通常不含握手帧（key 帧），窗口化巡检时用这里的 key 注入；
 * 重连换了 key 时注入会解出乱码，所以注入前必须先用帧验证（见 validateInjectedKey）。
 */
const recentKeys = new Map();

/**
 * 上行移动帧的自身坐标（2026-11-10 真机对账）。
 *
 * 真机 pcap 里上行帧不是 0x55aa 业务帧：整帧用下行同一个 AES key、零 IV 解出来后是
 * 「若干字节前缀 + protobuf」，消息结构为：
 *
 *   field 1 = 毫秒时间戳
 *   field 2 = { 1: x, 2: y, 3: z }   ← 自身世界坐标
 *
 * 前缀长度会随帧类型变化，所以这里从 0 开始逐字节尝试，用「时间戳 + 合法世界坐标」
 * 双重校验定位，避免误把别的消息当成自身坐标。
 */
export function parseUpstreamSelfPosition(plaintext) {
  if (!plaintext || plaintext.length < 24) return null;
  const limit = Math.min(40, plaintext.length - 8);
  for (let offset = 0; offset <= limit; offset += 1) {
    let fields;
    try { fields = parseLooseProto(plaintext.subarray(offset)); } catch { continue; }
    if (!fields) continue;
    const stamp = wildFieldNumber(fields, 1);
    if (!(stamp > 1e12 && stamp < 2.2e12)) continue;
    const wrap = (fields.get(2) || []).find((value) => value instanceof Uint8Array);
    if (!wrap) continue;
    let pos;
    try { pos = parseLooseProto(wrap); } catch { continue; }
    if (!pos) continue;
    const x = wildFieldNumber(pos, 1);
    const y = wildFieldNumber(pos, 2);
    if (x < 100000 || x > 2000000 || y < 100000 || y > 2000000) continue;
    return { x, y, heading: readUpstreamHeading(fields) };
  }
  return null;
}

/**
 * 同一帧里的朝向（2026-11-10 真机 pcap 交叉验证）。
 *
 * 包内**没有**独立的朝向字段：field 3 的值在 0–2000 间跳变但与移动方向不符，
 * 其余帧只有心跳。真正可用的方向信号是速度向量：
 *   field 4 = { 1: vx, 2: vy }（field 5 是同一方向的另一组缩放，兜底用）
 * 连续两帧位移方向与 atan2(vy, vx) 的偏差实测 ≤ 3°，因此用它的方向作为「移动朝向」；
 * 静止时 vx=vy=0，返回 null，由调用方沿用上一次朝向（不伪造）。
 */
function readUpstreamHeading(fields) {
  for (const field of [4, 5]) {
    const wrap = (fields.get(field) || []).find((value) => value instanceof Uint8Array);
    if (!wrap) continue;
    let sub;
    try { sub = parseLooseProto(wrap); } catch { continue; }
    const vx = wildFieldNumber(sub, 1);
    const vy = wildFieldNumber(sub, 2);
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
    if (Math.abs(vx) + Math.abs(vy) < 10) continue;
    // 世界 y 轴向南，方位角 0 = 正北、顺时针增大，与地图箭头口径一致
    const degrees = (Math.atan2(vx, -vy) * 180 / Math.PI + 360) % 360;
    return Math.round(degrees * 10) / 10;
  }
  return null;
}

/**
 * 307 自己移动（c2s）：跳过前 14 字节，field 2 是坐标。
 *
 * 参考多多的 `parse_player_position_307`：坐标有效范围 100000–2000000（世界坐标）。
 * 上行帧是否与下行同构仍待真机验证；解析失败就返回 null，不影响其它字段。
 */
function parsePlayerPosition307(payload) {
  if (!payload || payload.length < 16) return null;
  const body = payload.subarray(14);
  const fields = parseLooseProto(body);
  if (!fields) return null;
  const wrap = (fields.get(2) || []).find((value) => value instanceof Uint8Array);
  const pos = wrap ? parseLooseProto(wrap) : fields;
  if (!pos) return null;
  const x = wildFieldNumber(pos, 1);
  const y = wildFieldNumber(pos, 2);
  if (x < 100000 || x > 2000000 || y < 100000 || y > 2000000) return null;
  return { x, y };
}

/** 上行（客户端→服务器）里的自身坐标：同一连接用下行的 AES key 试解，明文帧也兜底试一次。 */
function decodeClientSelfPosition(flow, aesKey) {
  if (!flow.clientSegments || !flow.clientSegments.length) return null;
  const cacheKey = flow.cacheKey || flow.key;
  let frames;
  try {
    const stream = reassemble(flow.clientSegments);
    frames = parseTgcpFrames(stream.bytes, stream.ranges);
  } catch { return null; }
  let latest = null;
  let latestHeading = null;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex].bytes;
    // 握手帧（16）里没有业务数据；其余上行帧都可能是移动帧（2026-11-10 真机对账）
    if (frame[6] === 16) continue;
    const headerLength = frame[16];
    const encrypted = frame.subarray(headerLength);
    if (!encrypted.length) continue;
    if (aesKey && encrypted.length % 16 === 0) {
      // 上行帧同样走跨轮缓存（方向前缀 :c，避免与下行帧的绝对偏移相撞）
      try {
        const resolved = decryptFrameOnce(`${cacheKey}:c`, aesKey, frames[frameIndex].fileOffset, frameIndex, encrypted);
        const self = parseUpstreamSelfPosition(resolved.legacy)
          || (resolved.business && resolved.business.opcode === 307
            ? parsePlayerPosition307(resolved.business.payload)
            : null);
        if (self) {
          if (self.heading != null) latestHeading = self.heading;
          latest = self;
        }
        continue;
      } catch { /* 上行格式不同就退回明文尝试 */ }
    }
    const business = businessPayload(encrypted);
    if (business && business.opcode === 307) {
      const self = parsePlayerPosition307(business.payload);
      if (self) latest = self;
    }
  }
  // 停下来时速度是 0，沿用本窗口内最后一次移动朝向；跨窗口由调用方沿用
  if (latest && latest.heading == null && latestHeading != null) return { ...latest, heading: latestHeading };
  return latest;
}

/**
 * 诊断入口：逐条列出上行帧里能读出自身世界坐标的记录（2026-11-10 真机 pcap 对账）。
 *
 * 与 decodeClientSelfPosition 共用同一套 TCP 重组 / 解密逻辑，只是把每条命中都返回，
 * 用于回答「自身坐标有没有、多久一帧、是哪类帧」。调用前需先对同一份字节跑过
 * extractBusinessFrames / extractPcap，让握手帧里的 AES key 进入缓存。
 */
export function extractUpstreamSelfFrames(bytesLike) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const parsed = readGameFlows(bytes, {});
  const out = [];
  parsed.flows.forEach((flow, flowIndex) => {
    if (!flow.clientSegments || !flow.clientSegments.length) return;
    const cacheKey = flow.cacheKey || flow.key;
    const aesKey = recentKeys.get(cacheKey) || null;
    let frames;
    try {
      const stream = reassemble(flow.clientSegments);
      frames = parseTgcpFrames(stream.bytes, stream.ranges);
    } catch { return; }
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const frame = frames[frameIndex].bytes;
      if (frame[6] === 16) continue;
      const encrypted = frame.subarray(frame[16]);
      if (!encrypted.length) continue;
      const packetIndex = Number(frames[frameIndex].packetIndex || 0);
      if (aesKey && encrypted.length % 16 === 0) {
        try {
          const resolved = decryptFrameOnce(`${cacheKey}:c`, aesKey, frames[frameIndex].fileOffset, frameIndex, encrypted);
          const self = parseUpstreamSelfPosition(resolved.legacy)
            || (resolved.business && resolved.business.opcode === 307
              ? parsePlayerPosition307(resolved.business.payload)
              : null);
          if (self) {
            out.push({
              flowIndex, frameIndex, packetIndex,
              opcode: resolved.business ? resolved.business.opcode : null,
              ...self
            });
          }
          continue;
        } catch { /* 上行格式不同就退回明文尝试 */ }
      }
      const business = businessPayload(encrypted);
      if (business && business.opcode === 307) {
        const self = parsePlayerPosition307(business.payload);
        if (self) out.push({ flowIndex, frameIndex, packetIndex, opcode: 307, ...self });
      }
    }
  });
  return out;
}

/**
 * 注入 key 的验证：解 1~2 帧，能看到 0x55aa 业务帧头或合法的 profile 帧才认。
 *
 * 窗口里看不到握手帧时只能用上一轮学到的 key；重连换了 key 就会解出乱码，
 * 必须验证，否则会把垃圾数据当成附近精灵 / 奇遇战。
 */
function validateInjectedKey(frames, startIndex, key) {
  let tried = 0;
  for (let index = startIndex; index < frames.length && tried < 6; index += 1) {
    const frame = frames[index].bytes;
    if (frame[6] !== 64 || frame[7] !== 19) continue;
    const encrypted = frame.subarray(frame[16]);
    if (!encrypted.length || encrypted.length % 16) continue;
    tried += 1;
    try {
      const resolved = resolveFramePayload(encrypted, key);
      // 业务帧（0x55aa）是首选证据；只有 legacy 帧的连接（部分老协议）用 profile 帧验证，
      // 否则尾窗每轮都会因为「验证不过」退回全量。
      if (resolved.business || decodeProfile(resolved.legacy)) return true;
    } catch { /* 这一帧解不开就继续试下一帧 */ }
  }
  return false;
}

function decodeFlow(flow, flowIndex, options = {}) {
  const injectedKey = options.injectedKey || null;
  const reassembled = reassemble(flow.serverSegments);
  const frames = parseTgcpFrames(reassembled.bytes, reassembled.ranges);
  const cacheKey = flow.cacheKey || flow.key;
  let aesKey = null;
  let decryptedFrames = 0;
  const events = [];
  frames.forEach((entry, frameIndex) => {
    const frame = entry.bytes;
    const kind = frame[6];
    const subKind = frame[7];
    if (kind === 16 && subKind === 2 && frame.length >= 39 && frame[20] === 16) {
      aesKey = frame.slice(23, 39);
      recentKeys.set(cacheKey, aesKey);
      return;
    }
    if (kind !== 64 || subKind !== 19 || !aesKey) return;
    const headerLength = frame[16];
    const encrypted = frame.subarray(headerLength);
    if (!encrypted.length || encrypted.length % 16) return;
    // 跨轮复用解密结果：只有新增帧才真正跑 AES（见 decryptFrameOnce）。
    const decoded = decryptFrameOnce(cacheKey, aesKey, entry.fileOffset, frameIndex, encrypted);
    decryptedFrames += 1;
    events.push({
      flowKey: flow.key,
      flowIndex,
      frameIndex,
      fileOffset: entry.fileOffset,
      packetIndex: Number(entry.packetIndex || flow.firstPacket || 0),
      hasKey: Boolean(aesKey),
      profile: profileOfFrame(decoded),
      plaintext: decoded.legacy,
      opcode: decoded.business ? decoded.business.opcode : -1,
      homePayload: decoded.business ? decoded.business.payload : null
    });
  });
  if (!aesKey && injectedKey) {
    // 窗口里没有握手帧：用上一轮学到的 key 补上。验证不过就整轮退回全量解析（见 extractPcap）。
    if (validateInjectedKey(frames, 0, injectedKey)) {
      const injectedEvents = [];
      let injectedCount = 0;
      frames.forEach((entry, frameIndex) => {
        const frame = entry.bytes;
        if (frame[6] !== 64 || frame[7] !== 19) return;
        const headerLength = frame[16];
        const encrypted = frame.subarray(headerLength);
        if (!encrypted.length || encrypted.length % 16) return;
        const decoded = decryptFrameOnce(cacheKey, injectedKey, entry.fileOffset, frameIndex, encrypted);
        injectedCount += 1;
        injectedEvents.push({
          flowKey: flow.key,
          flowIndex,
          frameIndex,
          fileOffset: entry.fileOffset,
          packetIndex: Number(entry.packetIndex || flow.firstPacket || 0),
          hasKey: true,
          profile: profileOfFrame(decoded),
          plaintext: decoded.legacy,
          opcode: decoded.business ? decoded.business.opcode : -1,
          homePayload: decoded.business ? decoded.business.payload : null
        });
      });
      events.push(...injectedEvents);
      decryptedFrames = injectedCount;
      aesKey = injectedKey;
    } else {
      recentKeys.delete(cacheKey);
      return {
        report: { flow: flow.key, frames: frames.length, decryptedFrames: 0, hasKey: false, injectedKeyRejected: true },
        events: []
      };
    }
  }
  if (!aesKey && options.requireKey) {
    // 冷启动 / 换了连接：窗口里既没有 key 也没有可注入的 key，交给 extractPcap 退回全量解析。
    return {
      report: { flow: flow.key, frames: frames.length, decryptedFrames: 0, hasKey: false, missingKey: true },
      events: []
    };
  }
  // 上行 307（自己移动）拿到的自身坐标：附到本 flow 的事件上，由 applyPlaintextToAccount 落到账号
  const selfPosition = decodeClientSelfPosition(flow, aesKey);
  if (selfPosition) events.forEach((event) => { event.selfPosition = selfPosition; });
  return {
    report: { flow: flow.key, frames: frames.length, decryptedFrames, hasKey: Boolean(aesKey) },
    events
  };
}

function applyPlaintextToAccount(event, capture, retainRawProtocol = true) {
  const { plaintext } = event;
  if (event.selfPosition) capture.wildSelf = event.selfPosition;
  const homeGameId = String((capture.profile && capture.profile.game_id) || "");
  if (event.homePayload && homeGameId) {
    const opcode = Number(event.opcode);
    const scene = decodeHomeScene(event.homePayload, opcode);
    if (scene) {
      capture.foreignScene = scene.foreign;
      capture.homeScene = null;
    }
    const home = decodeHomePayload(
      event.homePayload,
      opcode,
      homeGameId,
      capture.homeScene,
      capture.foreignScene,
      capture.capturedAt
    );
    if (opcode === 330 && !home) capture.homeScene = null;
    if (home) {
      capture.homeScene = home;
      capture.latestHome = home;
      capture.homeEvents.push({
        type: "home.snapshot",
        occurredAt: capture.capturedAt,
        data: JSON.parse(JSON.stringify(home))
      });
    }
    // 野外附近精灵：330 是全量（先清空再写入），1043/1044 是增量 upsert。
    if (opcode === 330 || opcode === 1043 || opcode === 1044) {
      applyWildEntityFrame(capture, opcode, event.homePayload);
    }
    if (opcode === 338 || opcode === 348) {
      const scene = parseSceneInfo(event.homePayload, opcode);
      if (scene.scene) capture.wildScene = scene.scene;
    }
    // 宠物记录（仓库/背包/捕获/战斗同步）带性格(field7)与性别(field8)，用于抓后回填附近精灵。
    // 4890 / 5107 也要解析（2026-11-08 两份秒杀局抓包对比验证）：
    // 秒杀道具直接击败守卫后，奖励精灵登场时出现在这两个战斗帧里，
    // 且等级/身高/体重/性格/性别/声音与守卫完全一致（游戏把守卫个体直接复用为奖励个体）。
    // 抓到后 579 才给完整捕获记录；没抓的局 579 是空帧（len=4）。
    // 因此 4890/5107 是「本局奖励是谁、数据如何」的最早来源；玩家的出战宠也嵌在 4890 里，
    // 但它们的数据不会与守卫一致，回填时按数据匹配自然不会误填。
    if (opcode === 4934 || opcode === 579 || opcode === 4908 || opcode === 4900
      || opcode === 4890 || opcode === 5107) {
      const details = parseOwnedPetDetails(event.homePayload);
      for (const detail of details) {
        capture.ownedPetDetails.set(
          `${detail.petId}:${detail.level}:${detail.height}:${detail.weight}`,
          detail,
        );
        // 形似野生单位的奇遇记录里 field15 是临时 unitId（如 9006），
        // 真实 petId 只在捕获记录（579/4900/4908）里出现；按等级+身高+体重对齐后回填。
        // 顺带把捕获后才下发的真实性格补到奇遇卡上（战斗帧 field7 常是 30 占位）。
        capture.seasonEncounter = mergeEncounterDetail(capture.seasonEncounter, detail);
      }
      // 捕获成功才下发非空 579（失败/丢球是空帧），按 种族+等级+身高+体重 对齐
      // 附近实体后立刻剔除，别让抓到的精灵继续留在地图和列表上（2026-11-10 真机反馈）。
      if (opcode === 579) removeCapturedWildPets(capture, details);
    }
    // 赛季奇遇战（4886/4890）：守卫的宠物记录带真实性格，供捕获前展示
    if (opcode === 4886 || opcode === 4890) {
      const units = parseSeasonEncounterUnits(event.homePayload);
      if (units.length) capture.seasonEncounter = mergeSeasonEncounterUnit(capture.seasonEncounter, units[units.length - 1]);
    }
  }
  capture.hasKey = capture.hasKey || Boolean(event.hasKey);
  capture.lastDataPacket = Math.max(capture.lastDataPacket, Number(event.packetIndex || 0));
  capture.lastDataOrder = Math.max(capture.lastDataOrder, Number(event.order || 0));
  // Keep the decrypted application payload once per frame. This deliberately
  // excludes the original PCAP headers and AES key while retaining every
  // currently unknown business field for later cloud interpretation.
  const rawHex = retainRawProtocol ? bytesToHex(plaintext) : "";
  const text = new TextDecoder().decode(plaintext);
  const hasGrassTrial = text.includes("草系徽章试炼");
  // Match the legacy hex substring, including half-byte alignment.
  let hasGrassMedalMarker = false;
  for (let i = 0; i + 1 < plaintext.length && !hasGrassMedalMarker; i++) {
    hasGrassMedalMarker = (plaintext[i] === 0x80 && plaintext[i + 1] === 0x3e)
      || (i + 2 < plaintext.length && (plaintext[i] & 15) === 8 && plaintext[i + 1] === 3 && (plaintext[i + 2] >> 4) === 14);
  }
  if (hasGrassTrial) capture.grassTrialSeen = true;
  if (hasGrassMedalMarker) capture.grassMedalsSeen = true;
  if ((hasGrassTrial || hasGrassMedalMarker) && capture.grassBadgeHits.length < 32) {
    capture.grassBadgeHits.push({
      frameIndex: Number(event.frameIndex || 0),
      packetIndex: Number(event.packetIndex || 0),
      grassTrial: hasGrassTrial,
      medalMarker: hasGrassMedalMarker,
      text: hasGrassTrial ? "草系徽章试炼" : ""
    });
  }
  const petMedals = decodePetMedalSnapshots(plaintext);
  if (petMedals.length > capture.petMedals.length) capture.petMedals = petMedals;
  const grassMedals = petMedals.filter((medal) => medal.medalConfId === 8000);
  if (grassMedals.length > capture.grassMedals.length) {
    capture.grassMedals = grassMedals;
    capture.grassMedalsSeen = true;
  }
  const grassTrials = decodeGrassTrialSnapshots(plaintext);
  if (grassTrials.length > capture.grassTrials.length) capture.grassTrials = grassTrials;
  const rawKey = `${event.flowKey || ""}|${event.frameIndex || 0}|${event.packetIndex || 0}`;
  if (!capture.rawProtocolMessageKeys.has(rawKey)) {
    capture.rawProtocolMessageKeys.add(rawKey);
    if (retainRawProtocol) capture.rawProtocolMessages.push({
      flowKey: String(event.flowKey || ""),
      flowIndex: Number(event.flowIndex || 0),
      frameIndex: Number(event.frameIndex || 0),
      packetIndex: Number(event.packetIndex || 0),
      order: Number(event.order || 0),
      encoding: "hex",
      // 注意：bytes 是「零 IV 解整段」后的明文（plaintext = legacy），不是抓到的原始密文帧；
      // 字段名沿用旧契约，下游按密文二次解读会读不出（R2-7-L10 已确认保留现状）。
      bytes: rawHex
    });
  }
  decodeGuluBallInventorySnapshots(plaintext).forEach((snapshot) => {
    const previous = capture.guluInventory;
    if (!previous || snapshot.balls.length > previous.balls.length || (snapshot.balls.length === previous.balls.length && snapshot.updatedAtUnix >= previous.updatedAtUnix)) capture.guluInventory = snapshot;
  });
  decodeFruitInventorySnapshots(plaintext).forEach((snapshot) => {
    // Inventory arrives in batches, including smaller later batches. Keep the
    // per-account union so real-time previews and the final export agree.
    capture.fruitInventory = Array.from(new Set([...(capture.fruitInventory || []), ...snapshot]));
  });
  const accountCollections = decodeAccountCollectionSnapshot(plaintext);
  if (accountCollections) {
    if (accountCollections.fashions && (!capture.fashions || accountCollections.fashions.length > capture.fashions.length)) capture.fashions = accountCollections.fashions;
    if (accountCollections.topics && (!capture.topics || Object.keys(accountCollections.topics).length > Object.keys(capture.topics).length)) capture.topics = accountCollections.topics;
    if (accountCollections.shelterFruits && (!capture.shelterFruits || accountCollections.shelterFruits.length > capture.shelterFruits.length)) capture.shelterFruits = accountCollections.shelterFruits;
  }
  decodeEggInventorySnapshots(plaintext).forEach((snapshot) => {
    capture.eggInventory = mergeEggInventorySnapshot(capture.eggInventory, snapshot);
  });
  const decodedPets = petRecordsFromPlaintext(plaintext, capture.records, capture);
  if (decodedPets > 1) capture.batchStarted = true;
  if (decodedPets > 0 && capture.batchStarted && decodedPets < 50) capture.tailSeen = true;
}

function buildBoxPositions(boxes) {
  const positions = new Map();
  boxes.forEach((slots, boxNumber) => {
    slots.forEach((instanceId, slotIndex) => {
      if (instanceId > 0) positions.set(String(instanceId), { box_number: boxNumber, slot_order: slotIndex + 1 });
    });
  });
  return positions;
}

/**
 * 野外附近精灵（2026-11-05）。
 *
 * 数据来源：业务帧 opcode 330（场景全量）/ 1043（增量）/ 1044（移动）。
 * 字段路径与多多工具箱 4.2 的 `ra()` 一致，已在真实野外抓包上验证
 * （capture-1793891528222.pcap，scene=10003，27 只 cfgId 10000–19999 的实体）。
 *
 * 只返回协议原始字段；名称、体重百分位、稀有判定由 src/pcap/wildNearby.ts 负责。
 */
function wildFieldNumber(fields, field) {
  const value = (fields.get(field) || []).find((item) => typeof item === "number" || typeof item === "string");
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const big = BigInt(value);
  return Number(big >= 0x8000000000000000n ? big - 0x10000000000000000n : big);
}

function wildFieldBytes(fields, field, index = 0) {
  const value = (fields.get(field) || [])[index];
  return value instanceof Uint8Array ? value : null;
}

/**
 * 不在 10000–19999 野生段、但确实是「场上精灵」的特殊场景实体 cfgId。
 *
 * 蛋包蛋（petId 3808，2026-11-06 由 capture-1793905516970 验证）：场上 cfgId 29401、41 级，
 * 不带身高 / 体重 / 声音；抓后宠物记录 field43 = 2920016 = 该实体 uniqueId / 100。
 */
const SPECIAL_ENTITY_CFG_IDS = new Set([29401]);

function parseWildEntity(raw) {
  const actor = wildFieldBytes(parseLooseProto(raw), 11);
  if (!actor) return null;
  const actorFields = parseLooseProto(actor);
  const identity = wildFieldBytes(actorFields, 1);
  const pet = wildFieldBytes(actorFields, 3);
  if (!pet) return null;
  const identityFields = identity ? parseLooseProto(identity) : null;
  const petFields = parseLooseProto(pet);
  const posWrap = identityFields ? wildFieldBytes(identityFields, 8) : null;
  const posMessage = posWrap ? wildFieldBytes(parseLooseProto(posWrap), 1) : null;
  const posFields = posMessage ? parseLooseProto(posMessage) : null;
  const glassWrap = wildFieldBytes(petFields, 30);
  const glassFields = glassWrap ? parseLooseProto(glassWrap) : null;

  const cfgId = wildFieldNumber(petFields, 1);
  const height = wildFieldNumber(petFields, 11);
  const weight = wildFieldNumber(petFields, 12);
  const uniqueId = wildFieldNumber(petFields, 17);
  const special = SPECIAL_ENTITY_CFG_IDS.has(cfgId);
  if ((!special && (cfgId < 10000 || cfgId > 19999)) || (!special && (height <= 0 || weight <= 0))
    || uniqueId <= 0 || !posFields) return null;

  return {
    cfgId,
    actorId: (identityFields ? wildFieldNumber(identityFields, 1) : 0) || wildFieldNumber(actorFields, 1),
    uniqueId,
    level: identityFields ? wildFieldNumber(identityFields, 11) : 0,
    height,
    weight,
    voiceDb: wildFieldNumber(petFields, 31),
    mutation: wildFieldNumber(petFields, 14),
    glassType: glassFields ? wildFieldNumber(glassFields, 1) : 0,
    glassValue: glassFields ? wildFieldNumber(glassFields, 2) : 0,
    pos: { x: wildFieldNumber(posFields, 1), y: wildFieldNumber(posFields, 2), z: wildFieldNumber(posFields, 3) }
  };
}

/**
 * 捕获成功后把对应野生实体从附近列表里剔除（2026-11-10 真机反馈）。
 *
 * 579 的捕获记录只有 种族+等级+身高+体重，没有实体 uniqueId；野生实体带 cfgId，
 * 换算成 petId 后按这四个字段对齐即可。身高/体重是精确值，几乎不会撞到别的个体。
 * 只认 579（捕获成功才非空），战斗/背包帧不参与，避免抓失败、丢弃时误删。
 */
export function removeCapturedWildPets(capture, details) {
  if (!details.length) return;
  for (const detail of details) {
    for (const [key, pet] of capture.wildPets) {
      const petId = cfgPetMap[String(pet.cfgId)];
      if (!petId || petId !== detail.petId) continue;
      if (pet.level !== detail.level || pet.height !== detail.height || pet.weight !== detail.weight) continue;
      capture.wildPets.delete(key);
      capture.capturedWild.add(key);
    }
  }
}

/** 330 / 1043 / 1044 的实体包裹深度不固定，统一交给 {@link collectWildCandidates} 递归找。 */
export function parseWildEntities(payload) {
  let root;
  try { root = parseLooseProto(payload); } catch { return []; }
  const candidates = [];
  collectWildCandidates(root, 6, candidates);
  const pets = [];
  for (const candidate of candidates) {
    const pet = parseWildEntity(candidate);
    if (pet) pets.push(pet);
  }
  return pets;
}

/**
 * 把一帧实体数据写进采集状态：330 是全量（先清空），1043/1044 是按 uniqueId 增量 upsert。
 *
 * 抓过的实体记在 capture.capturedWild（墓碑），后续帧即使再下发也不放回地图 / 列表。
 * 返回本帧真正写入的实体数（诊断与单测用）。
 */
export function applyWildEntityFrame(capture, opcode, payload) {
  const wild = parseWildEntities(payload);
  if (opcode === 330) capture.wildPets.clear();
  let applied = 0;
  for (const pet of wild) {
    if (capture.capturedWild.has(String(pet.uniqueId))) continue;
    capture.wildPets.set(String(pet.uniqueId), pet);
    applied += 1;
  }
  return applied;
}

/**
 * 递归收集实体包裹（2026-11-10 真机 pcap 对账）。
 *
 * 330 的实体在顶层 field 7；1043/1044 的单实体记录**不是固定两层**：
 * capture-1794318431209.pcap 里出现 root.f1 → f1 → f1 → { f1: 类型, f11: 角色 }
 * 三层嵌套，旧的「固定两层」只解出 62 条实体帧里的 4 条（其余 58 条全丢）。
 * 这里改成递归找「带 field 11 演员子消息」的包裹，命中即停，不再往实体内部钻，
 * 避免同一实体被重复解析。
 */
function collectWildCandidates(fields, depth, out) {
  if (depth <= 0) return;
  for (const values of fields.values()) {
    for (const value of values) {
      if (!(value instanceof Uint8Array) || value.length < 8) continue;
      let sub;
      try { sub = parseLooseProto(value); } catch { continue; }
      if (!sub) continue;
      const actor = (sub.get(11) || []).find((item) => item instanceof Uint8Array);
      if (actor) { out.push(value); continue; }
      collectWildCandidates(sub, depth - 1, out);
    }
  }
}

/**
 * 宠物记录（仓库 / 背包 / 战斗同步）里的性格与性别（2026-11-06 验证）。
 *
 * 4934 / 579 / 4908 的宠物记录结构：
 *   field 7 = 性格 id（1–31）、field 8 = 性别（1=公，2=母）、
 *   field 10 = 等级、field 15/42 = petId、field 26/27 = 身高/体重、
 *   field 47 = 血脉、field 93 = 声音。
 * 注意：战斗帧 4886 的单位详情里 field7 恒为 30，**不是**性格，不要用。
 */
function collectOwnedPetDetails(fields, depth, out) {
  if (depth > 10) return;
  const natureId = wildFieldNumber(fields, 7);
  const genderId = wildFieldNumber(fields, 8);
  const level = wildFieldNumber(fields, 10);
  const petId = wildFieldNumber(fields, 15) || wildFieldNumber(fields, 42);
  const height = wildFieldNumber(fields, 26);
  const weight = wildFieldNumber(fields, 27);
  const bloodId = wildFieldNumber(fields, 47);
  if (natureId >= 1 && natureId <= 31 && genderId >= 1 && genderId <= 3
    && level > 0 && petId >= 3000 && petId <= 99999
    && height > 0 && weight > 0 && bloodId > 0) {
    out.push({
      petId, level, height, weight, natureId, genderId, bloodId,
      voiceDb: wildFieldNumber(fields, 93),
    });
  }
  for (const values of fields.values()) {
    for (const value of values) {
      if (value instanceof Uint8Array) collectOwnedPetDetails(parseLooseProto(value), depth + 1, out);
    }
  }
}

export function parseOwnedPetDetails(payload) {
  const out = [];
  collectOwnedPetDetails(parseLooseProto(payload), 0, out);
  return out;
}

/**
 * 赛季奇遇战（2026-11-06 由 capture-1793905516970 验证）。
 *
 * 奇遇守卫「龙棋士」在战斗帧 4886/4890 里的宠物记录已经带真实性格：
 *   unit 9006 / 41 级 / 公 / 性格 4（勇敢）/ 身高 32 / 体重 1900 / 血脉 24。
 * 捕获后 field15 会从临时 unitId 换成真实 petId（如 3808 / 3011），
 * 奖励精灵是随机的（可能是蛋包蛋，也可能是恶魔狼），所以这里不写死名字，
 * 由上层按 unitId 查图鉴。
 *
 * 普通野生精灵在这两帧里的 field7 恒为 30（未生成占位），抓后才分配真实性格，
 * 所以这里只认奇遇形态（field2 = 1646），普通对战不解析。
 */
const SEASON_ENCOUNTER_FORMS = new Map([
  [1646, { guardName: "龙棋士" }]
]);
/** 战斗帧里野生单位尚未分配性格时的占位值。 */
const UNASSIGNED_NATURE_ID = 30;

/**
 * 把一条宠物记录（捕获记录 579 / 背包同步 4934 / 战斗同步 4900·4908·4890）合并进奇遇卡。
 * 只在等级 + 身高 + 体重一致（同一只个体）时生效，补：
 *   - 真实 petId（奇遇帧里常是临时 unitId，如 9006）
 *   - 声音
 *   - 性格：战斗帧 field7 经常是 30 占位，抓到后记录里才给真实性格
 * 已确认的性格不会被占位值覆盖。
 */
export function mergeEncounterDetail(encounter, detail) {
  if (!encounter) return encounter;
  if (encounter.level !== detail.level
    || encounter.height !== detail.height
    || encounter.weight !== detail.weight) return encounter;
  return {
    ...encounter,
    unitId: detail.petId,
    voiceDb: detail.voiceDb || encounter.voiceDb,
    natureId: encounter.natureConfirmed ? encounter.natureId : detail.natureId,
    natureConfirmed: encounter.natureConfirmed || detail.natureId !== UNASSIGNED_NATURE_ID
  };
}

/**
 * 同一场奇遇战里的后一帧（4866/4890 会重复下发）合并进已有奇遇卡：
 * 已经拿到真实性格后，不会被后来的 30 占位冲掉；换个体（等级/身高/体重不同）则直接替换。
 */
export function mergeSeasonEncounterUnit(previous, next) {
  if (!previous) return next;
  if (previous.level !== next.level
    || previous.height !== next.height
    || previous.weight !== next.weight) return next;
  return {
    ...next,
    natureId: next.natureConfirmed ? next.natureId : previous.natureId,
    natureConfirmed: next.natureConfirmed || previous.natureConfirmed,
    voiceDb: next.voiceDb || previous.voiceDb
  };
}

function collectSeasonEncounterUnits(fields, depth, out) {
  if (depth > 12) return;
  const formId = wildFieldNumber(fields, 2);
  const mapping = SEASON_ENCOUNTER_FORMS.get(formId);
  if (mapping) {
    const natureId = wildFieldNumber(fields, 7);
    const genderId = wildFieldNumber(fields, 8);
    const level = wildFieldNumber(fields, 10);
    const unitId = wildFieldNumber(fields, 15) || wildFieldNumber(fields, 42);
    const height = wildFieldNumber(fields, 26);
    const weight = wildFieldNumber(fields, 27);
    const guardName = decodeUtf8(fields.get(3) && fields.get(3)[0]) || mapping.guardName;
    if (natureId >= 1 && natureId <= 31 && genderId >= 1 && genderId <= 3
      && level > 0 && height > 0 && weight > 0 && unitId > 0) {
      out.push({
        formId,
        guardName,
        unitId,
        level,
        natureId,
        natureConfirmed: natureId !== UNASSIGNED_NATURE_ID,
        genderId,
        height,
        weight,
        bloodId: wildFieldNumber(fields, 47),
        voiceDb: wildFieldNumber(fields, 93)
      });
    }
  }
  for (const values of fields.values()) {
    for (const value of values) {
      if (value instanceof Uint8Array) collectSeasonEncounterUnits(parseLooseProto(value), depth + 1, out);
    }
  }
}

/** 从战斗帧（4886/4890）提取赛季奇遇守卫的个体数据；普通对战返回空数组。 */
export function parseSeasonEncounterUnits(payload) {
  const out = [];
  collectSeasonEncounterUnits(parseLooseProto(payload), 0, out);
  const seen = new Set();
  return out.filter((unit) => {
    const key = `${unit.formId}:${unit.unitId}:${unit.level}:${unit.height}:${unit.weight}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 场景号：338 进场景读 field 3（field 2 是场景配置号）；
 * 348 传送读 field 12（与 decodeHomeScene 一致），field 3 是传送类型/序号，不是场景号。
 * 2026-11-10 修：以前 348 也读 field 3，传送后被写成「场景 1」且一直不恢复。
 */
export function parseSceneInfo(payload, opcode = 338) {
  const root = parseLooseProto(payload);
  const scene = wildFieldNumber(root, opcode === 348 ? 12 : 3);
  const sceneCfgId = opcode === 348 ? null : wildFieldNumber(root, 2);
  return { scene: scene > 0 ? scene : null, sceneCfgId: sceneCfgId > 0 ? sceneCfgId : null };
}

/**
 * 诊断入口：只列出已解密的业务帧（opcode + payload），不做业务字段解析。
 *
 * 用于真实抓包验证场景实体帧（330/1043/1044）是否真的在样本里；
 * 与 extractPcap 共用同一套读包 / TCP 重组 / TGCP / AES 逻辑，不引入第二套协议模型。
 */
export function extractBusinessFrames(bytesLike, options = {}) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const parsed = readGameFlows(bytes, options);
  const frames = [];
  parsed.flows.forEach((flow, flowIndex) => {
    try {
      const decoded = decodeFlow(flow, flowIndex);
      decoded.events.forEach((event) => {
        if (event.opcode == null || event.opcode < 0) return;
        frames.push({
          flowIndex,
          opcode: Number(event.opcode),
          packetIndex: Number(event.packetIndex || 0),
          frameIndex: Number(event.frameIndex || 0),
          payloadHex: event.homePayload ? bytesToHex(event.homePayload) : ""
        });
      });
    } catch (error) {
      frames.push({ flowIndex, error: error.message });
    }
  });
  frames.sort((left, right) => left.packetIndex - right.packetIndex || left.frameIndex - right.frameIndex);
  return frames;
}

/**
 * 从文件尾部按 pcap 记录边界切出 windowBytes 大小的窗口，返回第一条记录在整份文件里的绝对偏移。
 * pcap 记录是变长的，倒推不可能，只能正向扫 16 字节记录头收集边界（只读长度，不解析包体，很快）。
 */
function tailWindowStart(bytes, windowBytes) {
  const limit = Number(windowBytes) || 0;
  if (!(limit > 0) || bytes.length <= limit + 24) return 0;
  const { littleEndian } = pcapFormat(bytes);
  const read32 = littleEndian ? readU32LE : readU32BE;
  const starts = [];
  let offset = 24;
  while (offset + 16 <= bytes.length) {
    const captured = read32(bytes, offset + 8);
    const end = offset + 16 + captured;
    if (captured > 64 * 1024 * 1024 || end > bytes.length) break;
    starts.push(offset);
    offset = end;
  }
  if (!starts.length) return 0;
  const target = bytes.length - limit;
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low < starts.length ? starts[low] : 0;
}

/**
 * 文件头补扫的截止位置（2026-11-08）。
 *
 * 尾部窗口里通常没有握手帧（key）与 profile 帧，Worker 刚启动 / 被系统回收后
 * 直接解尾窗只会退回全量解析（20MB+ 要十几秒）。冷启动时先扫文件头一小段，
 * 把 key 与账号基线建起来，再解尾窗，耗时从「全量」降到「头部 + 尾窗」。
 * 按 pcap 记录边界切，返回最后一条完整记录的结束偏移。
 */
function headScanEnd(bytes, limit) {
  if (!(limit > 0) || bytes.length <= limit) return 0;
  const { littleEndian } = pcapFormat(bytes);
  const read32 = littleEndian ? readU32LE : readU32BE;
  let offset = 24;
  let end = 0;
  while (offset + 16 <= bytes.length) {
    const captured = read32(bytes, offset + 8);
    const next = offset + 16 + captured;
    if (captured > 64 * 1024 * 1024 || next <= offset || next > bytes.length || next > limit) break;
    end = next;
    offset = next;
  }
  return end;
}

/** 冷启动补扫的文件头长度；真实抓包里握手帧与 profile 都在前 2MiB 内。 */
const HEAD_SCAN_BYTES = 2 * 1024 * 1024;

export function extractPcap(bytesLike, options = {}) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const windowBytes = Number(options.windowBytes) || 0;
  if (windowBytes > 0) {
    const sessionKey = typeof options.sessionKey === 'string' ? options.sessionKey : "";
    // 2026-11-10 真机反馈：一轮采集刚起步时文件只有 1MB 出头，比 2MiB 窗口小，
    // 以前这里判断 `start > 24` 不成立就直接退回全量解析，而「已应用帧」跳过只在
    // 窗口化路径生效，于是每轮把整份文件重放一遍（decodeAvg 随文件变大 0.6s→1.5s）。
    // 现在只要调用方给了窗口参数就一律走窗口化路径：start=24 表示整份文件，
    // 第一轮建立基线，之后每轮只真正应用新增字节。
    const start = Math.max(24, tailWindowStart(bytes, windowBytes));
    if (start > 24) {
      // 冷启动补扫：先扫文件头建立 key / 账号 / 场景基线，尾窗才能直接解密。
      // 每个会话只扫一次：第一轮没扫到 profile 也不每轮重扫（2MiB 扫一遍不便宜）。
      const headBytes = Number(options.headScanBytes) || HEAD_SCAN_BYTES;
      if (sessionKey && headScannedKey !== sessionKey) {
        headScannedKey = sessionKey;
        const headEnd = headScanEnd(bytes, Math.min(headBytes, bytes.length - 1));
        if (headEnd > 24) extractFlowEvents(bytes.subarray(0, headEnd), { ...options, startRecordOffset: 24, windowed: true });
      }
    }
    const windowed = extractFlowEvents(bytes, { ...options, startRecordOffset: start, windowed: true });
    // 冷启动或重连（窗口里既没握手帧、也没有可验证的 key）时退回全量解析，保证第一轮数据完整。
    if (!windowed.needsFullParse) return windowed.result;
  }
  return extractFlowEvents(bytes, options).result;
}

/**
 * 尾部窗口的「当前场景基线」（2026-11-08）。
 *
 * 330 场景全量帧只在进场景时发一次，长时间走动后会滑出 2MiB 窗口；只靠窗口内的帧，
 * 雷达会只剩最近移动过的精灵。这里把上一轮的附近状态（精灵 / 场景 / 自身坐标 / 奇遇战）
 * 作为基线喂给下一轮，330 出现时照常清空重写，1043/1044 在此基础上增量更新。
 * 按会话隔离：换采集会话直接作废，避免上一局的精灵串到新一局。
 */
const nearbyBaseline = {
  key: "",
  pets: new Map(),
  /** 已抓到的 uniqueId 墓碑：跨窗口 / 重开页面都保持剔除 */
  capturedWild: new Set(),
  scene: null,
  self: null,
  encounter: null,
  petDetails: new Map(),
  /** 已识别到账号（窗口里通常没有 profile 帧，靠它继续落到同一个账号） */
  uid: "",
  profile: null,
  /** 已经完整应用过的帧（key → 绝对偏移）：大帧（场景全量 50KB+）每轮重扫是尾窗的耗时大头。 */
  applied: new Map(),
  /** 上一轮看到的文件长度：变小说明采集被重写，绝对偏移全部失效，基线作废。 */
  size: 0
};

/** 已经补扫过文件头的会话（每个会话只扫一次）。 */
let headScannedKey = "";
/** 已经注入过恢复点的会话（避免每轮用旧快照覆盖 Worker 里的新基线）。 */
let liveStateImportedKey = "";

function resetNearbyBaseline(key) {
  nearbyBaseline.key = key;
  nearbyBaseline.pets = new Map();
  nearbyBaseline.capturedWild = new Set();
  nearbyBaseline.scene = null;
  nearbyBaseline.self = null;
  nearbyBaseline.encounter = null;
  nearbyBaseline.petDetails = new Map();
  nearbyBaseline.uid = "";
  nearbyBaseline.profile = null;
  nearbyBaseline.applied = new Map();
  nearbyBaseline.size = 0;
}

const LIVE_STATE_VERSION = 1;

/**
 * 可序列化的实时会话状态（2026-11-08）。
 *
 * 采集文件会被原生滚动裁剪（只保留最近一段），文件头里的握手帧 / profile 帧随之消失。
 * Worker 被系统回收后光靠文件已经解不开尾窗，所以把解密 key 与账号 / 附近基线
 * 交给主线程存 localStorage，冷启动时再注入。
 */
export function exportLiveDecodeState() {
  if (!nearbyBaseline.key) return null;
  if (!nearbyBaseline.uid && !nearbyBaseline.pets.size && !recentKeys.size) return null;
  return {
    version: LIVE_STATE_VERSION,
    key: nearbyBaseline.key,
    keys: Array.from(recentKeys, ([cacheKey, value]) => [cacheKey, Array.from(value)]),
    baseline: {
      pets: Array.from(nearbyBaseline.pets, ([id, pet]) => [id, pet]),
      capturedWild: Array.from(nearbyBaseline.capturedWild),
      scene: nearbyBaseline.scene,
      self: nearbyBaseline.self,
      encounter: nearbyBaseline.encounter,
      petDetails: Array.from(nearbyBaseline.petDetails, ([id, detail]) => [id, detail]),
      uid: nearbyBaseline.uid,
      profile: nearbyBaseline.profile
    }
  };
}

/**
 * 注入上一轮导出的会话状态。只在 Worker 没有本会话基线（冷启动）时恢复，
 * 避免旧快照把 Worker 里更新的数据覆盖掉；key 按连接补齐缺失项。
 */
export function importLiveDecodeState(state) {
  if (!state || state.version !== LIVE_STATE_VERSION || typeof state.key !== 'string' || !state.key) return false;
  const baseline = state.baseline || {};
  const keys = Array.isArray(state.keys) ? state.keys : [];
  if ((nearbyBaseline.key !== state.key || !nearbyBaseline.uid) && liveStateImportedKey !== state.key) {
    liveStateImportedKey = state.key;
    nearbyBaseline.key = state.key;
    nearbyBaseline.pets = new Map(Array.isArray(baseline.pets) ? baseline.pets : []);
    nearbyBaseline.capturedWild = new Set(Array.isArray(baseline.capturedWild) ? baseline.capturedWild : []);
    nearbyBaseline.scene = baseline.scene ?? null;
    nearbyBaseline.self = baseline.self ?? null;
    nearbyBaseline.encounter = baseline.encounter ?? null;
    nearbyBaseline.petDetails = new Map(Array.isArray(baseline.petDetails) ? baseline.petDetails : []);
    nearbyBaseline.uid = typeof baseline.uid === 'string' ? baseline.uid : "";
    nearbyBaseline.profile = baseline.profile ?? null;
    nearbyBaseline.applied = new Map();
    nearbyBaseline.size = 0;
    // 已有 key 就不用再补扫文件头（裁剪过的文件也扫不到握手帧）
    if (keys.length) headScannedKey = state.key;
  }
  keys.forEach((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) return;
    if (!recentKeys.has(entry[0])) recentKeys.set(entry[0], Uint8Array.from(entry[1]));
  });
  return true;
}

function extractFlowEvents(bytes, options = {}) {
  const sessionKey = typeof options.sessionKey === 'string' ? options.sessionKey : "";
  if (sessionKey && options.windowed && nearbyBaseline.key !== sessionKey) resetNearbyBaseline(sessionKey);
  // 文件变小 = 采集被滚动裁剪：绝对偏移与包序号全部失效，但 key / 账号 / 附近基线仍然有效，
  // 不能整份作废，否则裁剪后的第一轮会丢掉已经识别到的账号与附近精灵。
  if (sessionKey && options.windowed && bytes.length < nearbyBaseline.size) {
    nearbyBaseline.applied = new Map();
    nearbyBaseline.size = 0;
  }
  // 只有实时巡检（带 sessionKey）参与基线：导入流程 / 性能脚本永远拿全量结果，不受影响。
  const baseline = sessionKey && options.windowed ? nearbyBaseline : null;
  // 「已应用帧」按绝对偏移记录，尾窗滑走后旧条目永远不会再命中。
  // 不裁剪的话它会随会话长度一直涨（每帧一条字符串），长时间巡检白占内存。
  if (baseline && Number(options.startRecordOffset) > 24 && baseline.applied.size > 4096) {
    const startOffset = Number(options.startRecordOffset);
    for (const [key, offset] of baseline.applied) {
      if (offset < startOffset) baseline.applied.delete(key);
    }
  }
  const parsed = readGameFlows(bytes, options);
  const flowReports = [];
  const events = [];
  let needsFullParse = false;
  parsed.flows.forEach((flow, flowIndex) => {
    try {
      const cacheKey = flow.cacheKey || flow.key;
      const decoded = decodeFlow(flow, flowIndex, {
        requireKey: Boolean(options.windowed),
        injectedKey: options.windowed ? recentKeys.get(cacheKey) : null,
      });
      flowReports.push(decoded.report);
      events.push(...decoded.events);
      if (decoded.report.missingKey || decoded.report.injectedKeyRejected) needsFullParse = true;
    } catch (error) {
      flowReports.push({ flow: flow.key, error: error.message });
    }
  });
  if (needsFullParse) return { needsFullParse: true };
  events.sort((left, right) => (
    left.packetIndex - right.packetIndex
    || left.flowIndex - right.flowIndex
    || left.frameIndex - right.frameIndex
  ));
  events.forEach((event, index) => { event.order = index + 1; });

  const accounts = new Map();
  const flowAccounts = new Map();
  const pendingEvents = new Map();
  // 窗口里通常看不到 profile 帧：沿用上一轮认到的账号，否则事件会一直挂在 pendingEvents 里丢掉。
  let activeUid = baseline ? baseline.uid : "";
  const ensureAccount = (uid, profile = null) => {
    if (!accounts.has(uid)) {
      const created = createAccountCapture(profile || (baseline && baseline.uid === uid ? baseline.profile : null));
      if (baseline) {
        created.wildPets = new Map(baseline.pets);
        created.capturedWild = new Set(baseline.capturedWild || []);
        created.wildScene = baseline.scene;
        created.wildSelf = baseline.self;
        created.seasonEncounter = baseline.encounter;
        created.ownedPetDetails = new Map(baseline.petDetails);
      }
      accounts.set(uid, created);
    }
    const account = accounts.get(uid);
    if (profile) account.profile = profile;
    return account;
  };
  const applyEvent = (event, uid) => {
    const account = ensureAccount(uid, event.profile);
    if (event.profile) {
      account.lastProfilePacket = Math.max(account.lastProfilePacket, Number(event.packetIndex || 0));
      account.lastProfileOrder = Math.max(account.lastProfileOrder, Number(event.order || 0));
    }
    // 窗口化巡检：前几轮已经完整应用过的帧只补单调计数，不再重扫明文（大帧的主要开销）。
    // 帧的效果都落在基线里（野生精灵 / 场景 / 自身坐标 / 奇遇战 / 捕获个体），
    // 跳过重放不会丢数据。
    if (baseline && event.fileOffset > 0) {
      const frameKey = `${event.flowKey}#${event.fileOffset}`;
      if (baseline.applied.has(frameKey)) {
        account.hasKey = account.hasKey || Boolean(event.hasKey);
        account.lastDataPacket = Math.max(account.lastDataPacket, Number(event.packetIndex || 0));
        account.lastDataOrder = Math.max(account.lastDataOrder, Number(event.order || 0));
        event.plaintext = null;
        return;
      }
      baseline.applied.set(frameKey, event.fileOffset);
    }
    applyPlaintextToAccount(event, account, options.retainRawProtocol !== false);
    // All business fields have been extracted; do not retain every decrypted frame.
    looseProtoCache.delete(event.plaintext);
    event.plaintext = null;
  };

  events.forEach((event) => {
    if (event.profile) {
      const uid = String(Number(event.profile.game_id));
      activeUid = uid;
      flowAccounts.set(event.flowKey, uid);
      const pending = pendingEvents.get(event.flowKey) || [];
      pendingEvents.delete(event.flowKey);
      pending.forEach((item) => applyEvent(item, uid));
      applyEvent(event, uid);
      return;
    }
    let uid = flowAccounts.get(event.flowKey) || activeUid;
    if (!uid) {
      if (!pendingEvents.has(event.flowKey)) pendingEvents.set(event.flowKey, []);
      pendingEvents.get(event.flowKey).push(event);
      return;
    }
    if (!flowAccounts.has(event.flowKey)) flowAccounts.set(event.flowKey, uid);
    uid = flowAccounts.get(event.flowKey);
    applyEvent(event, uid);
  });
  if (pendingEvents.size && activeUid) {
    pendingEvents.forEach((items) => items.forEach((event) => applyEvent(event, activeUid)));
  }

  const selectedEntry = Array.from(accounts.entries()).sort((left, right) => (
    right[1].lastProfileOrder - left[1].lastProfileOrder
    || right[1].lastDataOrder - left[1].lastDataOrder
    || right[1].lastProfilePacket - left[1].lastProfilePacket
  ))[0] || ["", createAccountCapture()];
  const [selectedUid, capture] = selectedEntry;
  if (sessionKey) {
    nearbyBaseline.key = sessionKey;
    nearbyBaseline.pets = new Map(capture.wildPets);
    nearbyBaseline.capturedWild = new Set(capture.capturedWild);
    nearbyBaseline.scene = capture.wildScene;
    nearbyBaseline.self = capture.wildSelf;
    nearbyBaseline.encounter = capture.seasonEncounter;
    nearbyBaseline.petDetails = new Map(capture.ownedPetDetails);
    nearbyBaseline.uid = selectedUid;
    nearbyBaseline.profile = capture.profile;
    nearbyBaseline.size = bytes.length;
  }
  const records = capture.records;
  const positions = buildBoxPositions(capture.boxes);
  const output = Array.from(records.values()).map((record) => ({
    ...record,
    ...(positions.get(String(record.instance_id)) || { box_number: null, slot_order: null })
  })).sort((left, right) => left.instance_id - right.instance_id);
  const result = {
    records: output,
    profile: capture.profile,
    selectedUid,
    accountTransitions: Math.max(0, accounts.size - 1),
    accountCount: accounts.size,
    accountCandidates: Array.from(accounts.entries()).map(([uid, account]) => ({
      uid,
      playerName: account.profile ? account.profile.player_name : "",
      records: account.records.size,
      eggs: account.eggInventory ? account.eggInventory.eggs.length : 0,
      lastProfilePacket: account.lastProfilePacket,
      lastProfileOrder: account.lastProfileOrder
    })).sort((left, right) => right.lastProfileOrder - left.lastProfileOrder),
    boxes: Array.from(capture.boxes.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([number, slots]) => ({ number, slots })),
    eggInventory: capture.eggInventory,
    captureHome: capture.latestHome,
    captureNestEvents: capture.homeEvents,
    /** 野外附近精灵（330 全量 + 1043 增量），按 uniqueId 去重 */
    nearbyPets: Array.from(capture.wildPets.values()),
    /** 宠物记录里的性格/性别（抓后回填附近精灵） */
    ownedPetDetails: Array.from(capture.ownedPetDetails.values()),
    nearbyScene: capture.wildScene,
    /** 自身世界坐标（上行 307）；拿不到为 null */
    nearbySelf: capture.wildSelf,
    /** 最近一次赛季奇遇战守卫的个体数据；没有奇遇战为 null */
    seasonEncounter: capture.seasonEncounter,
    rawProtocolMessages: capture.rawProtocolMessages,
    rawProtocolMessageCount: capture.rawProtocolMessageKeys.size,
    guluInventory: capture.guluInventory,
    fruits: Array.from(new Set([...(capture.fruitInventory || []), ...(capture.shelterFruits || [])])),
    fashions: capture.fashions || [],
    topics: capture.topics || {},
    grassTrialSeen: Boolean(capture.grassTrialSeen),
    grassMedalsSeen: Boolean(capture.grassMedalsSeen),
    grassBadgeHits: capture.grassBadgeHits,
    petMedals: capture.petMedals,
    grassMedals: capture.grassMedals,
    grassTrials: capture.grassTrials,
    hasKey: Boolean(capture.hasKey),
    batchStarted: capture.batchStarted,
    tailSeen: capture.tailSeen,
    flows: flowReports,
    packets: parsed.packets,
    linkType: parsed.linkType,
    linkTypeName: parsed.linkTypeName,
    truncated: parsed.truncated
  };
  return { needsFullParse: false, result };
}

export function inspectExtractedCapture(extracted) {
  const decodedFlows = extracted.flows.filter((flow) => !flow.error);
  const previewCounts = { matched: 0, shiny: 0, colorful: 0 };
  for (const record of extracted.records) {
    if (resolveForm(record).entry?.formId) previewCounts.matched++;
    const flags = petFlags(record);
    if (flags.isShiny) previewCounts.shiny++;
    if (flags.isColorful) previewCounts.colorful++;
  }
  const diagnostics = {
    linkType: extracted.linkType,
    linkTypeName: extracted.linkTypeName,
    packets: extracted.packets,
    gameFlows: extracted.flows.length,
    frames: decodedFlows.reduce((sum, flow) => sum + Number(flow.frames || 0), 0),
    hasKey: Boolean(extracted.hasKey) || decodedFlows.some((flow) => flow.hasKey),
    decryptedFrames: decodedFlows.reduce((sum, flow) => sum + Number(flow.decryptedFrames || 0), 0),
    profile: extracted.profile,
    accountTransitions: Number(extracted.accountTransitions || 0),
    accountCount: Number(extracted.accountCount || (extracted.profile ? 1 : 0)),
    accountCandidates: Array.isArray(extracted.accountCandidates) ? extracted.accountCandidates : [],
    boxes: extracted.boxes.length,
    records: extracted.records.length,
    nearbyPets: Array.isArray(extracted.nearbyPets) ? extracted.nearbyPets.length : 0,
    nearbyScene: extracted.nearbyScene ?? null,
    nearbySelf: extracted.nearbySelf ?? null,
    eggRecords: extracted.eggInventory ? extracted.eggInventory.eggs.length : 0,
    eggUnrecognizedEntries: extracted.eggInventory && Array.isArray(extracted.eggInventory.unrecognized)
      ? extracted.eggInventory.unrecognized.length
      : 0,
    eggReceivedCount: extracted.eggInventory ? Number(extracted.eggInventory.receivedCount || extracted.eggInventory.eggs.length) : 0,
    eggUnrecognizedCount: extracted.eggInventory ? Number(extracted.eggInventory.unrecognizedCount || 0) : 0,
    eggDeclaredCount: extracted.eggInventory ? Number(extracted.eggInventory.declaredCount || 0) : 0,
    hasEggInventory: Boolean(extracted.eggInventory),
    eggCountReliable: Boolean(extracted.eggInventory) && extracted.eggInventory.countReliable !== false,
    guluBallRecords: extracted.guluInventory ? extracted.guluInventory.balls.length : 0,
    guluBallTotal: extracted.guluInventory ? extracted.guluInventory.balls.reduce((sum, item) => sum + Math.max(0, Number(item && item.quantity || 0)), 0) : 0,
    guluBallUnknown: extracted.guluInventory ? extracted.guluInventory.balls.filter((item) => !item.recognized).length : 0,
    hasGuluInventory: Boolean(extracted.guluInventory),
    fruits: extracted.fruits.length,
    fashions: extracted.fashions.length,
    topics: Object.keys(extracted.topics).length,
    grassTrialSeen: Boolean(extracted.grassTrialSeen),
    grassMedalsSeen: Boolean(extracted.grassMedalsSeen),
    grassMedalRecords: Number(previewCounts.grassMedals || (Array.isArray(extracted.grassMedals) ? extracted.grassMedals.length : 0)),
    petMedalRecords: Array.isArray(extracted.petMedals) ? extracted.petMedals.length : 0,
    grassTrialRecords: Array.isArray(extracted.grassTrials) ? extracted.grassTrials : [],
    grassBadgeHits: Array.isArray(extracted.grassBadgeHits) ? extracted.grassBadgeHits : [],
    shinyRecords: Number(previewCounts.shiny || 0),
    colorfulRecords: Number(previewCounts.colorful || 0),
    topicRecords: Number(previewCounts.topics || Object.keys(extracted.topics || {}).length || 0),
    fruitRecords: Number(previewCounts.fruits || extracted.fruits.length || 0),
    fashionRecords: Number(previewCounts.fashions || extracted.fashions.length || 0),
    rawProtocolMessages: Number(extracted.rawProtocolMessageCount ?? extracted.rawProtocolMessages?.length ?? 0),
    matchedRecords: previewCounts.matched,
    recordOccurrences: extracted.records.reduce((sum, record) => sum + Number(record.occurrences || 0), 0),
    truncated: extracted.truncated,
    batchStarted: Boolean(extracted.batchStarted),
    tailSeen: Boolean(extracted.tailSeen),
    flowErrors: extracted.flows.filter((flow) => flow.error).length
  };
  const occupiedIds = new Set();
  extracted.boxes.forEach((box) => box.slots.forEach((value) => {
    if (Number(value) > 0) occupiedIds.add(String(value));
  }));
  const recordIds = new Set(extracted.records.map((record) => String(record.instance_id)));
  diagnostics.occupiedRecords = occupiedIds.size;
  diagnostics.missingRecords = Array.from(occupiedIds).filter((value) => !recordIds.has(value)).length;
  diagnostics.eggInventoryComplete = diagnostics.hasEggInventory
    && diagnostics.eggCountReliable
    && diagnostics.eggReceivedCount >= diagnostics.eggDeclaredCount;
  diagnostics.hasGameTraffic = diagnostics.gameFlows > 0;
  diagnostics.hasDecodedData = diagnostics.records > 0;
  diagnostics.completionCandidate = Boolean(diagnostics.profile)
    && diagnostics.accountCount <= 1
    && diagnostics.hasKey
    && (diagnostics.batchStarted || diagnostics.occupiedRecords === 1)
    && diagnostics.boxes > 0
    && diagnostics.occupiedRecords > 0
    && diagnostics.missingRecords === 0
    && (!diagnostics.hasEggInventory || diagnostics.eggInventoryComplete);
  diagnostics.stableWaitMs = diagnostics.hasEggInventory && diagnostics.tailSeen ? 12000 : 25000;
  diagnostics.captureSuccessful = diagnostics.hasDecodedData && Boolean(diagnostics.profile);
  return diagnostics;
}

export function inspectPcapCapture(bytesLike) {
  return inspectExtractedCapture(extractPcap(bytesLike, { allowTruncated: true, retainRawProtocol: false }));
}

function parseMessage(bytes) {
  return parseProto(bytes) || new Map();
}

function rawFirstInt(raw, field) {
  const value = raw && raw.int_fields && raw.int_fields[String(field)] && raw.int_fields[String(field)][0];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function firstSignedInt(raw, field) {
  const value = raw && raw.int_fields && raw.int_fields[String(field)] && raw.int_fields[String(field)][0];
  if (value === undefined || value === null || value === "") return 0;
  try {
    let numeric = BigInt(value);
    if (numeric >= (1n << 63n)) numeric -= 1n << 64n;
    return Number(numeric);
  } catch (_error) {
    return 0;
  }
}

function protocolBloodline(raw) {
  const bloodlineId = rawFirstInt(raw, 47);
  return { bloodlineId: bloodlineId || null, bloodline: BLOODLINE_BY_ID[bloodlineId] || "" };
}

function protocolBaseStats(raw) {
  const hex = raw && raw.byte_fields && raw.byte_fields["14"] && raw.byte_fields["14"][0];
  if (!hex) return null;
  const top = parseMessage(hexToBytes(hex));
  const values = [];
  for (let field = 1; field <= 6; field += 1) {
    const nestedBytes = top.get(field) && top.get(field)[0];
    if (!(nestedBytes instanceof Uint8Array)) return null;
    const nested = parseMessage(nestedBytes);
    const base = nested.get(1) && nested.get(1)[0];
    if (!Number.isFinite(base)) return null;
    values.push(Number(base));
  }
  return values;
}

function protocolIndividualStats(raw) {
  const hex = raw && raw.byte_fields && raw.byte_fields["14"] && raw.byte_fields["14"][0];
  if (!hex) return [];
  const top = parseMessage(hexToBytes(hex));
  const stats = [];
  for (let field = 1; field <= INDIVIDUAL_STAT_NAMES.length; field += 1) {
    const nestedBytes = top.get(field) && top.get(field)[0];
    if (!(nestedBytes instanceof Uint8Array)) continue;
    const nested = parseMessage(nestedBytes);
    const bonus = Number(nested.get(7) && nested.get(7)[0] || 0);
    if (bonus > 0) stats.push(INDIVIDUAL_STAT_NAMES[field - 1]);
  }
  return stats.slice(0, 3);
}

function protocolEquippedSkills(raw) {
  const hex = raw && raw.byte_fields && raw.byte_fields["12"] && raw.byte_fields["12"][0];
  if (!hex) return [];
  const top = parseMessage(hexToBytes(hex));
  const equippedBySlot = new Map();
  (top.get(1) || []).forEach((nestedBytes) => {
    if (!(nestedBytes instanceof Uint8Array)) return;
    const nested = parseMessage(nestedBytes);
    const skillId = nested.get(1) && nested.get(1)[0];
    const skillType = Number(nested.get(2) && nested.get(2)[0] || 0);
    const equipped = Number(nested.get(4) && nested.get(4)[0] || 0) === 1;
    const slotNumber = Number(nested.get(5) && nested.get(5)[0] || 0);
    if (skillType !== 1 || !equipped || !skillId || slotNumber < 1 || slotNumber > 4 || equippedBySlot.has(slotNumber)) return;
    equippedBySlot.set(slotNumber, String(skillId));
  });
  return Array.from(equippedBySlot, ([slotNumber, id]) => ({ slotNumber, id }))
    .sort((left, right) => left.slotNumber - right.slotNumber);
}

function buildSkillSlots(raw) {
  const equippedBySlot = new Map(protocolEquippedSkills(raw).map((skill) => [skill.slotNumber, skill.id]));
  return Array.from({ length: 4 }, (_, index) => {
    const id = equippedBySlot.get(index + 1) || "";
    const catalogEntry = id && catalog.skillsById && catalog.skillsById[id];
    return {
      key: `slot-${index}`,
      id,
      name: id ? String(catalogEntry && catalogEntry.name || `未知技能 ${id}`) : "",
      icon: id ? String(catalogEntry && catalogEntry.icon || "") : ""
    };
  });
}

function rawProtocolFields(raw) {
  const intFields = raw && raw.int_fields && typeof raw.int_fields === "object" ? raw.int_fields : {};
  const byteFields = raw && raw.byte_fields && typeof raw.byte_fields === "object" ? raw.byte_fields : {};
  return {
    int: intFields,
    bytes: byteFields,
    fieldCount: Object.keys(intFields).length + Object.keys(byteFields).length,
    occurrences: Number(raw && raw.occurrences || 0),
    source: raw && raw.raw_source && typeof raw.raw_source === "object" ? raw.raw_source : {}
  };
}

function bytesToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const chunks = [];
  let part = [];
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset];
    const second = offset + 1 < bytes.length ? bytes[offset + 1] : 0;
    const third = offset + 2 < bytes.length ? bytes[offset + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    part.push(alphabet[(value >>> 18) & 63], alphabet[(value >>> 12) & 63],
      offset + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : "=",
      offset + 2 < bytes.length ? alphabet[value & 63] : "=");
    if (part.length >= 16384) { chunks.push(part.join("")); part = []; }
  }
  if (part.length) chunks.push(part.join(""));
  return chunks.join("");
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function decodeGrassMedalsFromRawProtocol(rawProtocol) {
  if (!rawProtocol || rawProtocol.encoding !== "gzip-base64" || !rawProtocol.data) return [];
  try {
    const compressed = base64ToBytes(rawProtocol.data);
    const text = new TextDecoder("utf-8").decode(ungzip(compressed));
    const messages = JSON.parse(text);
    const results = [];
    (Array.isArray(messages) ? messages : []).forEach((message) => {
      const hex = message && message.bytes;
      if (typeof hex !== "string") return;
      const medals = decodePetMedalSnapshots(hexToBytes(hex)).filter((medal) => medal.medalConfId === 8000);
      medals.forEach((medal) => results.push(medal));
    });
    return results;
  } catch (error) {
    return [];
  }
}

function buildRawProtocol(messages) {
  const values = Array.isArray(messages) ? messages : [];
  const deflate = new Deflate({ gzip: true, level: 9 });
  let uncompressedBytes = 2;
  deflate.push("[", false);
  values.forEach((value, index) => {
    const part = (index ? "," : "") + JSON.stringify(value);
    uncompressedBytes += textEncoder.encode(part).length;
    deflate.push(part, false);
  });
  deflate.push("]", true);
  if (deflate.err) throw new Error("原始协议压缩失败");
  const compressed = deflate.result;
  return {
    format: "decrypted-application-frames-gzip-base64-v1",
    encoding: "gzip-base64",
    messageCount: values.length,
    uncompressedBytes,
    compressedBytes: compressed.length,
    data: bytesToBase64(compressed)
  };
}

function colorfulMutation(raw) {
  const hex = raw && raw.byte_fields && raw.byte_fields["86"] && raw.byte_fields["86"][0];
  if (!hex) return decodeColorfulMutation(0, 0);
  const fields = parseMessage(hexToBytes(hex));
  return decodeColorfulMutation(
    Number(fields.get(1) && fields.get(1)[0] || 0),
    Number(fields.get(2) && fields.get(2)[0] || 0)
  );
}

function hasStatusMarker(raw, valueField, value, type) {
  const records = raw && raw.byte_fields && raw.byte_fields["87"];
  if (!Array.isArray(records)) return false;
  return records.some((hex) => {
    const fields = parseMessage(hexToBytes(hex));
    return Number(fields.get(valueField) && fields.get(valueField)[0] || 0) === value
      && Number(fields.get(4) && fields.get(4)[0] || 0) === type;
  });
}

function petFlags(raw) {
  const shinyProtocolMarker = rawFirstInt(raw, 98);
  const shinyStatusMarker = hasStatusMarker(raw, 2, 1, 8);
  const colorful = colorfulMutation(raw);
  const colorfulStatusMarker = hasStatusMarker(raw, 2, 8, 5);
  return {
    isShiny: shinyStatusMarker || shinyProtocolMarker !== 0,
    isColorful: colorful.colorfulMutationType > 0 || colorfulStatusMarker,
    shinyProtocolMarker,
    shinyStatusMarker,
    ...colorful,
    colorfulStatusMarker
  };
}

const archivesByPetId = new Map();
const archivesByRuntimePetId = new Map();
const archivesByStats = new Map();
catalog.pets.forEach((entry) => {
  if (!archivesByPetId.has(entry.petId)) archivesByPetId.set(entry.petId, []);
  archivesByPetId.get(entry.petId).push(entry);
  // 协议字段 15 在不同版本中可能返回图鉴 petId，也可能返回
  // runtimePetId（例如 pet_000588）。两套编号都建立索引，避免首领形态丢失。
  const runtimeId = Number(String(entry.runtimePetId || '').replace(/\D/g, ''));
  if (Number.isFinite(runtimeId) && runtimeId > 0) {
    if (!archivesByRuntimePetId.has(runtimeId)) archivesByRuntimePetId.set(runtimeId, []);
    archivesByRuntimePetId.get(runtimeId).push(entry);
  }
  const key = entry.stats.join(",");
  if (!archivesByStats.has(key)) archivesByStats.set(key, []);
  archivesByStats.get(key).push(entry);
});

function sameStats(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 6
    && left.every((value, index) => value === right[index]);
}

function isRichCatalogEntry(entry) {
  return Boolean(entry && (
    entry.formId
    || entry.weight
    || (Array.isArray(entry.stats) && entry.stats.length === 6)
  ));
}

function uniqueCatalogEntries(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const key = entry && (entry.formId || `${entry.name}:${entry.petId}:${entry.runtimePetId}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function comparablePetName(value) {
  return String(value || "")
    .replace(/（/g, "(").replace(/）/g, ")")
    .replace(/Ⅴ/g, "V")
    .replace(/储水期/g, "储水时")
    .replace(/\s+/g, "")
    .trim();
}

/** 体重到候选体型区间的距离：0 表示落在区间内。用于同 petId 多形态时兜底。 */
function weightRangeDistance(entry, weightKg) {
  const size = resolveBodySize(entry);
  if (!size || !Number.isFinite(weightKg) || weightKg <= 0) return Infinity;
  if (weightKg < size.small) return size.small - weightKg;
  if (weightKg > size.big) return weightKg - size.big;
  return 0;
}

/**
 * 同 petId 挂多个形态且基础属性相同时（如 3092 同时是「烈焰狂战士_首领形态」与
 * 「烈火守护」），按这只精灵自己的体重选最近的体型区间，否则会固定取到表里第一个
 * 形态，把普通形态判成小不点 / 大块头。
 */
function pickCandidateByWeight(entries, weightKg) {
  let best = entries[0];
  let bestDistance = weightRangeDistance(best, weightKg);
  for (let index = 1; index < entries.length; index += 1) {
    const distance = weightRangeDistance(entries[index], weightKg);
    if (distance < bestDistance) {
      best = entries[index];
      bestDistance = distance;
    }
  }
  return best;
}

function resolveForm(raw, weightKg) {
  const protocolPetId = rawFirstInt(raw, 15);
  const candidates = [];
  const seen = new Set();
  [archivesByPetId.get(protocolPetId) || [], archivesByRuntimePetId.get(protocolPetId) || []]
    .flat()
    .forEach((entry) => {
      // Keep separate forms even when their display names are equal. A
      // protocol alias may have both a rich archive entry and an older empty
      // placeholder with the same name.
      const key = entry.formId || `${entry.name}:${entry.petId}:${entry.runtimePetId}`;
      if (!seen.has(key)) { seen.add(key); candidates.push(entry); }
    });
  const baseStats = protocolBaseStats(raw);
  const globalMatches = uniqueCatalogEntries(archivesByStats.get((baseStats || []).join(",")))
    .filter(isRichCatalogEntry);
  if (!candidates.length) {
    if (globalMatches.length === 1) return { entry: globalMatches[0], reason: "protocol-base-stats-global", candidateCount: 1 };
    return { entry: null, reason: "unmatched", candidateCount: globalMatches.length };
  }
  // Prefer real archive entries over protocol-name placeholders. This keeps
  // old generated catalogs safe even when both records are present.
  const richCandidates = candidates.filter(isRichCatalogEntry);
  if (!richCandidates.length) {
    // The protocol ID map intentionally contains lightweight entries for
    // event/footprint IDs. If the packet also carries base stats, bridge that
    // placeholder to the one real archive form with the same stats. This is
    // the missing link that previously turned a genuine 大块头/小不点 into
    // 普通 (the placeholder has no weight thresholds).
    if (globalMatches.length === 1) {
      return { entry: globalMatches[0], reason: "protocol-base-stats-global", candidateCount: 1 };
    }
    const candidateNames = new Set(candidates.map((entry) => comparablePetName(entry.name)).filter(Boolean));
    const namedGlobalMatches = globalMatches.filter((entry) => candidateNames.has(comparablePetName(entry.name)));
    if (namedGlobalMatches.length === 1) {
      return { entry: namedGlobalMatches[0], reason: "protocol-base-stats-global", candidateCount: 1 };
    }
  }
  const usableCandidates = richCandidates.length ? richCandidates : candidates;
  if (usableCandidates.length === 1) {
    return { entry: usableCandidates[0], reason: "single-candidate", candidateCount: 1 };
  }
  const matches = usableCandidates.filter((entry) => sameStats(entry.stats, baseStats));
  if (matches.length === 1) return { entry: matches[0], reason: "protocol-base-stats", candidateCount: usableCandidates.length };
  const pool = matches.length ? matches : usableCandidates;
  return {
    entry: pickCandidateByWeight(pool, weightKg),
    reason: matches.length > 1 ? "duplicate-stat-fallback" : "ambiguous-fallback",
    candidateCount: usableCandidates.length
  };
}

function petNameByProtocolId(petId) {
  const numericId = Number(String(petId || '').replace(/\D/g, ''));
  const candidates = archivesByPetId.get(numericId) || archivesByRuntimePetId.get(numericId) || [];
  const preferred = candidates.find(isRichCatalogEntry) || candidates[0];
  return preferred && preferred.name || "";
}

function formatUnit(value, divisor, unit) {
  const numeric = Number(value || 0) / divisor;
  return numeric > 0 ? `${Number(numeric.toFixed(6))}${unit}` : "";
}

function parseRange(value) {
  const match = String(value || "").match(/([\d.]+)\s*[~-]\s*([\d.]+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function weightPercent(entry, weightKg) {
  const small = entry && entry.adultSmallWeight === null ? NaN : Number(entry && entry.adultSmallWeight);
  const big = entry && entry.adultBigWeight === null ? NaN : Number(entry && entry.adultBigWeight);
  const span = Number.isFinite(small) && Number.isFinite(big) && big > small
    ? (big - small) / 0.96
    : null;
  const range = span === null
    ? parseRange(entry && entry.weight)
    : [small - span * 0.02, big + span * 0.02];
  if (!range || !Number.isFinite(weightKg) || range[1] <= range[0]) return null;
  const percent = ((weightKg - range[0]) / (range[1] - range[0])) * 100;
  return Number(Math.min(100, Math.max(0, percent)).toFixed(1));
}

function bodyMedal(entry, weightKg) {
  const size = resolveBodySize(entry);
  return {
    medal: bodyMedalOf(size, weightKg),
    resolved: size != null && Number.isFinite(weightKg) && weightKg > 0,
    sourceName: size ? (entry.sizeSourceName || entry.name || "") : "",
  };
}

function voiceMedal(voiceDb) {
  if (voiceDb >= 96) return "婉转声";
  if (voiceDb <= -96) return "粗嗓门";
  return "";
}

function composeBrand(body, voice) {
  if (body === "大块头" && voice === "婉转声") return "大婉";
  if (body === "大块头" && voice === "粗嗓门") return "大粗";
  if (body === "小不点" && voice === "婉转声") return "小婉";
  if (body === "小不点" && voice === "粗嗓门") return "小粗";
  return body || voice || "普通";
}

function buildItem(raw, gameId) {
  const heightCm = rawFirstInt(raw, 26);
  const weightGrams = rawFirstInt(raw, 27);
  const weightKg = weightGrams / 1000;
  const resolution = resolveForm(raw, weightKg);
  const entry = resolution.entry;
  const spriteName = entry && entry.name || "";
  const flags = petFlags(raw);
  const bloodline = protocolBloodline(raw);
  const speciality = decodeSpeciality(rawFirstInt(raw, 82));
  const boxNumber = Number(raw.box_number) || null;
  const slotOrder = Number(raw.slot_order) || null;
  const boxGroup = boxNumber ? `盒子${String(boxNumber).padStart(2, "0")}` : "盒外精灵";
  const groups = [boxGroup].concat(flags.isShiny ? ["异色"] : [], flags.isColorful ? ["炫彩"] : []);
  const playerName = String(raw.player_name || "").trim();
  const natureId = rawFirstInt(raw, 7);
  const body = bodyMedal(entry, weightKg);
  const voiceDb = firstSignedInt(raw, 93);
  const medalVoice = voiceMedal(voiceDb);
  const individualStats = protocolIndividualStats(raw);
  const baseStats = protocolBaseStats(raw) || [];
  const currentWeightPercent = weightPercent(entry, weightKg);
  const shinyAvailable = Boolean(entry && entry.hasShiny);
  const skillSlots = buildSkillSlots(raw);
  const obtainedAtUnix = rawFirstInt(raw, 32);
  const adventure = decodePetAdventure(raw, { resolvePetName: petNameByProtocolId });
  return {
    id: `capture_${gameId || "unknown"}_${raw.instance_id}`,
    externalInstanceId: String(raw.instance_id),
    speciesPetId: rawFirstInt(raw, 15),
    baseId: Number(raw.owner_id) || 0,
    spriteName,
    name: playerName || spriteName || `未识别精灵 ${rawFirstInt(raw, 15)}`,
    pickerSubtitle: spriteName && playerName !== spriteName ? `实际种类：${spriteName}` : "",
    group: boxGroup,
    groups,
    boxNumber,
    slotOrder,
    gender: rawFirstInt(raw, 8) === 1 ? "公" : (rawFirstInt(raw, 8) === 2 ? "母" : ""),
    bloodline: bloodline.bloodline,
    bloodlineId: bloodline.bloodlineId,
    specialityId: speciality.specialityId,
    realSpecialityIds: speciality.realSpecialityIds,
    specialityText: speciality.specialityText,
    hasSpeciality: speciality.hasSpeciality,
    specialityRecognized: speciality.specialityRecognized,
    nature: catalog.natureNamesById[natureId] || "",
    natureId,
    height: formatUnit(heightCm, 100, "M"),
    heightCm,
    weight: formatUnit(weightGrams, 1000, "KG"),
    weightGrams,
    weightKg,
    weightPercent: currentWeightPercent,
    weightPercentText: currentWeightPercent === null ? "" : `${currentWeightPercent}%`,
    individualStats,
    individualText: individualStats.join(" · "),
    medalBody: body.medal,
    medalVoice,
    voiceDb,
    brand: composeBrand(body.medal, medalVoice),
    medalInference: `${body.resolved ? "body-from-dex-weight-threshold" : "body-unresolved"};voice-from-protocol-db`,
    bodyThresholdSource: body.sourceName,
    mutationType: flags.colorfulMutationType,
    obtainedAtUnix,
    obtainedAt: obtainedAtUnix > 0 ? new Date(obtainedAtUnix * 1000).toISOString() : "",
    ...adventure,
    isShinyVariant: flags.isShiny && shinyAvailable,
    isShiny: flags.isShiny,
    isColorful: flags.isColorful,
    formResolution: resolution.reason,
    skillSlots,
    skills: skillSlots.filter((slot) => slot.name).map((slot) => slot.name),
    importStatus: entry ? (resolution.candidateCount > 1 ? "matched-ambiguous-form" : "matched") : "unmatched",
    formId: entry && entry.formId || "",
    runtimePetId: entry && entry.runtimePetId || "",
    shinySpriteAvailable: shinyAvailable,
    shinyProtocolMarker: flags.shinyProtocolMarker,
    shinyStatusMarker: flags.shinyStatusMarker,
    colorfulMutationType: flags.colorfulMutationType,
    colorfulPackedValue: flags.colorfulPackedValue,
    colorfulParticleId: flags.colorfulParticleId,
    colorfulParticle: flags.colorfulParticle,
    colorfulColorNo: flags.colorfulColorNo,
    colorfulColor: flags.colorfulColor,
    colorfulColor1: flags.colorfulColor1,
    colorfulColor2: flags.colorfulColor2,
    colorfulCardKey: flags.colorfulCardKey,
    colorfulCardImage: flags.colorfulCardImage,
    colorfulRecognized: flags.colorfulRecognized,
     colorfulStatusMarker: flags.colorfulStatusMarker,
     formCandidateCount: resolution.candidateCount,
     protocolBaseStats: baseStats,
     protocolBaseStatsByName: Object.fromEntries(INDIVIDUAL_STAT_NAMES.map((name, index) => [name, baseStats[index] || 0])),
     // Preserve the complete generic protocol record so new cloud rules can
     // interpret fields without requiring another collector release.
     rawFields: rawProtocolFields(raw)
   };
}

function sortItemsByBoxPosition(items) {
  return items.map((item, sourceIndex) => ({
    item,
    sourceIndex,
    boxNumber: Number.isInteger(Number(item.boxNumber)) && Number(item.boxNumber) > 0 ? Number(item.boxNumber) : null,
    slotOrder: Number.isInteger(Number(item.slotOrder)) && Number(item.slotOrder) > 0 ? Number(item.slotOrder) : null
  })).sort((left, right) => {
    if ((left.boxNumber !== null) !== (right.boxNumber !== null)) return left.boxNumber !== null ? -1 : 1;
    if (left.boxNumber === null) return left.sourceIndex - right.sourceIndex;
    if (left.boxNumber !== right.boxNumber) return left.boxNumber - right.boxNumber;
    if ((left.slotOrder !== null) !== (right.slotOrder !== null)) return left.slotOrder !== null ? -1 : 1;
    if (left.slotOrder !== null && left.slotOrder !== right.slotOrder) return left.slotOrder - right.slotOrder;
    return left.sourceIndex - right.sourceIndex;
  }).map((entry) => entry.item);
}

export function buildBackpack(records, metadata = {}) {
  const gameId = Number(metadata.gameId || 0);
  const rawProtocol = buildRawProtocol(metadata.rawProtocolMessages);
  const medalsByGid = new Map();
  (Array.isArray(metadata.petMedals) ? metadata.petMedals : []).forEach((medal) => {
    [medal.obtainPetGid, medal.wearPetGid].forEach((gid) => {
      if (!gid) return;
      const key = String(gid);
      if (!medalsByGid.has(key)) medalsByGid.set(key, []);
      if (!medalsByGid.get(key).some((item) => item.medalConfId === medal.medalConfId && item.ownerId === medal.ownerId)) {
        medalsByGid.get(key).push(medal);
      }
    });
  });
  const grassByGid = new Map();
  (Array.isArray(metadata.grassMedals) ? metadata.grassMedals : []).forEach((medal) => {
    [medal.obtainPetGid, medal.wearPetGid].forEach((gid) => {
      if (!gid) return;
      grassByGid.set(String(gid), medal);
    });
  });
  const items = sortItemsByBoxPosition((Array.isArray(records) ? records : []).map((raw) => {
    const item = buildItem(raw, gameId);
    const gid = String(raw && raw.instance_id || "");
    const medal = grassByGid.get(gid);
    const medals = medalsByGid.get(gid) || [];
    const withMedals = medals.length ? { ...item, medals } : item;
    return medal ? {
      ...withMedals,
      grassMedal: true,
      grassMedalOwnerId: Number(medal.ownerId || 0),
      grassMedalObtainedAtUnix: Number(medal.addTime || 0),
      grassMedalWorn: Boolean(medal.isWear),
      grassMedalCompleteCount: medal.completeCount == null ? null : Number(medal.completeCount)
    } : withMedals;
  }));
  const counts = {
    petBackpackItems: items.length,
    matched: items.filter((item) => item.formId).length,
    unmatched: items.filter((item) => !item.formId).length,
    ambiguousForms: items.filter((item) => item.formResolution.includes("fallback")).length,
    shiny: items.filter((item) => item.isShiny).length,
    colorful: items.filter((item) => item.isColorful).length,
    male: items.filter((item) => item.gender === "公").length,
    female: items.filter((item) => item.gender === "母").length,
    individualBonuses: items.filter((item) => item.individualStats.length).length,
    bodyMedals: items.filter((item) => item.medalBody).length,
    voiceMedals: items.filter((item) => item.medalVoice).length,
    bloodline: items.filter((item) => item.bloodline).length,
    bloodlineUnknown: items.filter((item) => item.bloodlineId && !item.bloodline).length,
    specialities: items.filter((item) => item.hasSpeciality).length,
    specialityUnknown: items.filter((item) => item.specialityId && !item.specialityRecognized).length,
    fruits: Array.isArray(metadata.fruits) ? metadata.fruits.length : 0,
    fashions: Array.isArray(metadata.fashions) ? metadata.fashions.length : 0,
    topics: metadata.topics && typeof metadata.topics === "object" ? Object.keys(metadata.topics).length : 0,
    grassMedals: grassByGid.size,
    petMedals: Array.isArray(metadata.petMedals) ? metadata.petMedals.length : 0,
    guluBalls: metadata.guluInventory ? metadata.guluInventory.balls.length : 0,
    guluBallTotal: metadata.guluInventory ? metadata.guluInventory.balls.reduce((sum, item) => sum + Math.max(0, Number(item && item.quantity || 0)), 0) : 0,
    guluBallsUnknown: metadata.guluInventory ? metadata.guluInventory.balls.filter((item) => !item.recognized).length : 0,
    shinyAndColorful: items.filter((item) => item.isShiny && item.isColorful).length
  };
  const payload = {
     meta: {
       type: "hatch-backup",
       version: catalog.backupVersion,
       decoderVersion: DECODER_VERSION,
       schemaVersion: RAW_SCHEMA_VERSION,
       capabilities: ["pet.raw-fields.v1", "egg.raw-fields.v1", "protocol.raw-messages.v1", "pet-medals.v1", "grass-medals.v1", "unknown-preserved.v1"],
       exportedAt: new Date().toISOString(),
      source: metadata.source || "",
      gameId,
      playerName: metadata.playerName || "",
      counts,
       formResolution: "protocol-base-stats+stable-form-id",
       grassMedals: Array.isArray(metadata.grassMedals) ? metadata.grassMedals : [],
       petMedals: Array.isArray(metadata.petMedals) ? metadata.petMedals : [],
       grassTrials: Array.isArray(metadata.grassTrials) ? metadata.grassTrials : [],
       captureHome: metadata.captureHome || null,
       captureNestEvents: Array.isArray(metadata.captureNestEvents) ? metadata.captureNestEvents : [],
       rawProtocol: {
         format: rawProtocol.format,
         encoding: rawProtocol.encoding,
         messageCount: rawProtocol.messageCount,
         uncompressedBytes: rawProtocol.uncompressedBytes,
         compressedBytes: rawProtocol.compressedBytes
       }
    },
    collections: {
      petBackpack: { items },
      fruits: Array.isArray(metadata.fruits) ? metadata.fruits : [],
      fashions: Array.isArray(metadata.fashions) ? metadata.fashions : [],
      topics: metadata.topics && typeof metadata.topics === "object" ? metadata.topics : {},
      eggInventory: metadata.eggInventory ? {
        captured: true,
        declaredCount: metadata.eggInventory.declaredCount,
        decodedCount: metadata.eggInventory.eggs.length,
        receivedCount: metadata.eggInventory.receivedCount || metadata.eggInventory.eggs.length,
        unrecognizedCount: metadata.eggInventory.unrecognizedCount || 0,
         skippedCount: metadata.eggInventory.skippedCount,
         countReliable: metadata.eggInventory.countReliable !== false,
         containerTimestampUnix: metadata.eggInventory.containerTimestamp,
         eggs: metadata.eggInventory.eggs,
         // Unknown entries are retained for future cloud rules but are not
         // imported into a nest until a rule resolves them.
         unrecognized: Array.isArray(metadata.eggInventory.unrecognized) ? metadata.eggInventory.unrecognized : []
       } : null,
      guluInventory: metadata.guluInventory || {
        groupId: null,
        declaredCount: 0,
        decodedCount: 0,
        skippedCount: 0,
        updatedAtUnix: null,
        balls: []
      }
    },
    rawProtocol
  };
  const reasons = Array.from(new Set(items.map((item) => item.formResolution)));
  return {
    payload,
    report: {
      counts,
      formResolution: Object.fromEntries(reasons.map((reason) => [reason, items.filter((item) => item.formResolution === reason).length])),
      unresolved: items.filter((item) => !item.formId || item.formResolution.includes("fallback")).map((item) => ({
        externalInstanceId: item.externalInstanceId,
        speciesPetId: item.speciesPetId,
        name: item.name,
        spriteName: item.spriteName,
        protocolBaseStats: item.protocolBaseStats
      }))
    }
  };
}

function safeFilePart(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, "_")
    .replace(/[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return cleaned || fallback;
}

function fileTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}-${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`;
}

export function buildDataFileName(metadata = {}) {
  const playerName = safeFilePart(metadata.playerName, "未知玩家");
  const uid = safeFilePart(metadata.gameId, "未知UID");
  return `${playerName}_${uid}_${fileTimestamp(metadata.exportedAt)}.json`;
}

function outputNames(metadata) {
  const mainName = buildDataFileName(metadata);
  return {
    mainName,
    reportName: mainName.replace(/\.json$/i, ".report.json")
  };
}

export function convertExtractedPcap(extracted, fileName = "capture.pcap") {
  if (!/\.pcap$/i.test(fileName)) throw new Error("请选择经典 .pcap 文件（不支持 .pcapng）。");
  if (!extracted.records.length) {
    const flowErrors = extracted.flows.filter((flow) => flow.error).map((flow) => flow.error);
    const decodedFlows = extracted.flows.filter((flow) => !flow.error);
    if (!extracted.flows.length) {
      throw new Error(`采集文件有效（${extracted.linkTypeName}），但没有发现目标数据连接。请确认目标应用已运行，并在开始采集后完全退出、重新打开目标应用。`);
    }
    if (!decodedFlows.some((flow) => flow.hasKey)) {
      throw new Error("已发现目标数据连接，但解析准备信息不完整。请先开始采集，再完全退出并重新打开目标应用。");
    }
    if (!decodedFlows.some((flow) => Number(flow.decryptedFrames || 0) > 0)) {
      throw new Error("解析准备已完成，但后续数据仍不完整。请继续采集，并等待目标页面全部加载后再结束。");
    }
    const detail = flowErrors.length ? ` 其中一个 TCP 流提示：${flowErrors[0]}` : "";
    throw new Error(`数据已经解析，但尚未识别到完整记录。请等待目标页面和分页全部加载后再结束。${detail}`);
  }
  const built = buildBackpack(extracted.records, {
    gameId: extracted.profile && extracted.profile.game_id,
    playerName: extracted.profile && extracted.profile.player_name,
    source: fileName,
    eggInventory: extracted.eggInventory,
    captureHome: extracted.captureHome,
    captureNestEvents: extracted.captureNestEvents,
    guluInventory: extracted.guluInventory,
    fruits: extracted.fruits,
    fashions: extracted.fashions,
    topics: extracted.topics,
    petMedals: extracted.petMedals,
    grassMedals: extracted.grassMedals,
    grassTrials: extracted.grassTrials,
    rawProtocolMessages: extracted.rawProtocolMessages
  });
  built.payload.meta.grassTrialSeen = Boolean(extracted.grassTrialSeen);
  built.payload.meta.petMedalRecords = Array.isArray(extracted.petMedals) ? extracted.petMedals : [];
  built.payload.meta.grassMedalsSeen = Boolean(extracted.grassMedalsSeen);
  built.payload.meta.grassMedalRecords = Array.isArray(extracted.grassMedals) ? extracted.grassMedals : [];
  built.payload.meta.grassTrialRecords = Array.isArray(extracted.grassTrials) ? extracted.grassTrials : [];
  built.payload.meta.grassBadgeHits = Array.isArray(extracted.grassBadgeHits) ? extracted.grassBadgeHits : [];
  built.payload.meta.accountCount = Number(extracted.accountCount || (extracted.profile ? 1 : 0));
  built.payload.meta.accountTransitions = Number(extracted.accountTransitions || 0);
  const names = outputNames(built.payload.meta);
  const report = {
    inputFile: fileName,
    outputFile: names.mainName,
    profile: extracted.profile,
    accountTransitions: Number(extracted.accountTransitions || 0),
    accountCount: Number(extracted.accountCount || (extracted.profile ? 1 : 0)),
    accountCandidates: Array.isArray(extracted.accountCandidates) ? extracted.accountCandidates : [],
    boxes: extracted.boxes.length,
    packets: extracted.packets,
    linkType: extracted.linkType,
    linkTypeName: extracted.linkTypeName,
    flows: extracted.flows,
    grassTrialSeen: Boolean(extracted.grassTrialSeen),
    petMedalRecords: Array.isArray(extracted.petMedals) ? extracted.petMedals.length : 0,
    grassMedalsSeen: Boolean(extracted.grassMedalsSeen),
    grassMedalRecords: Array.isArray(extracted.grassMedals) ? extracted.grassMedals.length : 0,
    grassTrialRecords: Array.isArray(extracted.grassTrials) ? extracted.grassTrials.length : 0,
    grassBadgeHits: Array.isArray(extracted.grassBadgeHits) ? extracted.grassBadgeHits : [],
    ...built.report
  };
  return {
    ...names,
    payload: built.payload,
    report,
    mainText: `${JSON.stringify(built.payload)}\n`,
    reportText: `${JSON.stringify(report)}\n`
  };
}

export function convertPcapBytes(bytes, fileName = "capture.pcap") {
  if (!/\.pcap$/i.test(fileName)) throw new Error("请选择经典 .pcap 文件（不支持 .pcapng）。");
  return convertExtractedPcap(extractPcap(bytes), fileName);
}

export const appInfo = {
  catalogEntries: catalog.pets.length,
  backupVersion: catalog.backupVersion,
  decoderVersion: DECODER_VERSION,
  rawSchemaVersion: RAW_SCHEMA_VERSION
};

export function utf8Bytes(text) {
  return textEncoder.encode(text);
}
