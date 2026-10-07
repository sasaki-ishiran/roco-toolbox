import CryptoJS from "crypto-js";
import { Deflate, ungzip } from "pako";
import catalog from "./generated/catalog.json";
import petProtocolIdMap from "../../../miniprogram/utils/petProtocolIdMap";
import colorfulProtocol from "../../../miniprogram/utils/colorfulProtocol";
import petSpeciality from "../../../miniprogram/utils/petSpeciality";
import guluBallProtocol from "../../../miniprogram/utils/guluBallProtocol";
import eggProtocol from "../../../miniprogram/utils/eggProtocol";
import eggPetFormMap from "../../../miniprogram/utils/eggPetFormMap";
import petAdventureProtocol from "../../../scripts/lib/petAdventureProtocol";
import { createFirstFieldProbe } from "./loose-probe";

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

function parseLooseProto(bytes, start, end = bytes.length) {
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

function readGameFlows(bytes, { allowTruncated = false } = {}) {
  const { littleEndian } = pcapFormat(bytes);
  const read32 = littleEndian ? readU32LE : readU32BE;
  const linkType = read32(bytes, 20);
  if (!PCAP_LINK_TYPES.has(linkType)) {
    throw new Error(`不支持此 PCAP 链路类型（${linkType}）。当前支持 Ethernet、RAW IP、Linux SLL/SLL2。`);
  }
  const flows = new Map();
  const flowGenerations = new Map();
  let offset = 24;
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
    if (!flows.has(key)) flows.set(key, { key, firstPacket: packets, serverSegments: [] });
    if (serverToClient) flows.get(key).serverSegments.push({
      sequence: tcp.sequence,
      payload: tcp.payload,
      packetIndex: packets
    });
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
  sorted.forEach(({ sequence, payload, packetIndex }) => {
    if (next === null) next = sequence;
    if (sequence + payload.length <= next) return;
    if (sequence > next) throw new Error(`TCP 流缺失 ${sequence - next} 字节，无法安全重组`);
    const trim = Math.max(0, next - sequence);
    const chunk = payload.subarray(trim);
    chunks.push(chunk);
    ranges.push({ start: length, end: length + chunk.length, packetIndex: Number(packetIndex || 0) });
    length += chunk.length;
    next += chunk.length;
  });
  return { bytes: concatBytes(chunks), ranges };
}

function framePacketIndex(ranges, start, end) {
  let packetIndex = 0;
  ranges.forEach((range) => {
    if (range.end > start && range.start < end) packetIndex = Math.max(packetIndex, range.packetIndex);
  });
  return packetIndex;
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
    frames.push({
      bytes: bytes.subarray(offset, end),
      streamOffset: offset,
      packetIndex: framePacketIndex(ranges, offset, end)
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

function decryptAesCbc(encrypted, key) {
  const ciphertext = CryptoJS.lib.WordArray.create(encrypted);
  const keyWords = CryptoJS.lib.WordArray.create(key);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext },
    keyWords,
    {
      iv: CryptoJS.lib.WordArray.create(new Uint8Array(16)),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.NoPadding
    }
  );
  return wordArrayToBytes(decrypted);
}

function decodeFlow(flow, flowIndex) {
  const reassembled = reassemble(flow.serverSegments);
  const frames = parseTgcpFrames(reassembled.bytes, reassembled.ranges);
  let aesKey = null;
  let decryptedFrames = 0;
  const events = [];
  frames.forEach((entry, frameIndex) => {
    const frame = entry.bytes;
    const kind = frame[6];
    const subKind = frame[7];
    if (kind === 16 && subKind === 2 && frame.length >= 39 && frame[20] === 16) {
      aesKey = frame.slice(23, 39);
      return;
    }
    if (kind !== 64 || subKind !== 19 || !aesKey) return;
    const headerLength = frame[16];
    const encrypted = frame.subarray(headerLength);
    if (!encrypted.length || encrypted.length % 16) return;
    const plaintext = decryptAesCbc(encrypted, aesKey);
    decryptedFrames += 1;
    events.push({
      flowKey: flow.key,
      flowIndex,
      frameIndex,
      packetIndex: Number(entry.packetIndex || flow.firstPacket || 0),
      hasKey: Boolean(aesKey),
      profile: decodeProfile(plaintext),
      plaintext
    });
  });
  return {
    report: { flow: flow.key, frames: frames.length, decryptedFrames, hasKey: Boolean(aesKey) },
    events
  };
}

function applyPlaintextToAccount(event, capture, retainRawProtocol = true) {
  const { plaintext } = event;
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

export function extractPcap(bytesLike, options = {}) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const parsed = readGameFlows(bytes, options);
  const flowReports = [];
  const events = [];
  parsed.flows.forEach((flow, flowIndex) => {
    try {
      const decoded = decodeFlow(flow, flowIndex);
      flowReports.push(decoded.report);
      events.push(...decoded.events);
    } catch (error) {
      flowReports.push({ flow: flow.key, error: error.message });
    }
  });
  events.sort((left, right) => (
    left.packetIndex - right.packetIndex
    || left.flowIndex - right.flowIndex
    || left.frameIndex - right.frameIndex
  ));
  events.forEach((event, index) => { event.order = index + 1; });

  const accounts = new Map();
  const flowAccounts = new Map();
  const pendingEvents = new Map();
  let activeUid = "";
  const ensureAccount = (uid, profile = null) => {
    if (!accounts.has(uid)) accounts.set(uid, createAccountCapture(profile));
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
  const records = capture.records;
  const positions = buildBoxPositions(capture.boxes);
  const output = Array.from(records.values()).map((record) => ({
    ...record,
    ...(positions.get(String(record.instance_id)) || { box_number: null, slot_order: null })
  })).sort((left, right) => left.instance_id - right.instance_id);
  return {
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

function resolveForm(raw) {
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
  return {
    entry: matches[0] || usableCandidates[0],
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
  if (!entry || !Number.isFinite(weightKg)) return { medal: "", resolved: false, sourceName: "" };
  const small = entry.adultSmallWeight === null ? NaN : Number(entry.adultSmallWeight);
  const big = entry.adultBigWeight === null ? NaN : Number(entry.adultBigWeight);
  if (Number.isFinite(small) && weightKg <= small) return { medal: "小不点", resolved: true, sourceName: entry.sizeSourceName };
  if (Number.isFinite(big) && weightKg >= big) return { medal: "大块头", resolved: true, sourceName: entry.sizeSourceName };
  return { medal: "", resolved: Number.isFinite(small) || Number.isFinite(big), sourceName: entry.sizeSourceName };
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
  const resolution = resolveForm(raw);
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
  const heightCm = rawFirstInt(raw, 26);
  const weightGrams = rawFirstInt(raw, 27);
  const weightKg = weightGrams / 1000;
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
