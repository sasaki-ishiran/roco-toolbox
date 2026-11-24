import type { IndividualBonus } from './types';

/**
 * 个体三维（2026-11-22 用户口径）：游戏里每只精灵最多三项个体加成，
 * 例如「物攻+8 · 生命+9 · 速度+10」。抓包协议里它们和种族值放在同一个
 * `rawFields.bytes["14"]` 里：
 *
 * - 顶层 field 1~6 = 生命 / 物攻 / 魔攻 / 物防 / 魔防 / 速度，每个是嵌套消息；
 * - 嵌套消息的 field 7 = 这一项的个体加成值（>0 才算有）。
 *
 * 采集器（src/pcap-decoder）解析 PCAP 时会把值一起导出成 `individualBonuses`；
 * 这里再保留一份从原始 hex 解码的兜底，方便重新导入旧抓包 JSON（里面往往还带着 rawFields）。
 */
const STAT_NAMES = ['生命', '物攻', '魔攻', '物防', '魔防', '速度'] as const;
const MAX_BONUSES = 3;
/** 显示顺序固定：生命 → 物攻 → 魔攻 → 物防 → 魔防 → 速度（2026-11-22 用户口径）。 */
const STAT_ORDER = new Map<string, number>(STAT_NAMES.map((name, index) => [name, index]));
const byStatOrder = (left: IndividualBonus, right: IndividualBonus): number =>
  (STAT_ORDER.get(left.name) ?? 99) - (STAT_ORDER.get(right.name) ?? 99);

type ProtoValue = number | Uint8Array;

function hexToBytes(hex: string): Uint8Array | undefined {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return undefined;
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** 读一个 varint；超过 64 位或截断时返回 undefined。 */
function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } | undefined {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length && shift < 64) {
    const byte = bytes[cursor];
    value += (byte & 0x7f) * 2 ** shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
  }
  return undefined;
}

/**
 * 极简 protobuf 解析：只保留 varint 与 length-delimited 字段，
 * 其余 wire type 按长度跳过（group 不参与，遇到就停）。
 */
function parseMessage(bytes: Uint8Array): Map<number, ProtoValue[]> {
  const fields = new Map<number, ProtoValue[]>();
  let cursor = 0;
  while (cursor < bytes.length) {
    const tag = readVarint(bytes, cursor);
    if (!tag) break;
    cursor = tag.next;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (wire === 0) {
      const scalar = readVarint(bytes, cursor);
      if (!scalar) break;
      cursor = scalar.next;
      const list = fields.get(field) ?? [];
      list.push(scalar.value);
      fields.set(field, list);
    } else if (wire === 2) {
      const length = readVarint(bytes, cursor);
      if (!length) break;
      cursor = length.next;
      if (cursor + length.value > bytes.length) break;
      const list = fields.get(field) ?? [];
      list.push(bytes.subarray(cursor, cursor + length.value));
      fields.set(field, list);
      cursor += length.value;
    } else if (wire === 1) {
      cursor += 8;
    } else if (wire === 5) {
      cursor += 4;
    } else {
      break;
    }
  }
  return fields;
}

/** 按固定六维顺序排序（展示端也用它，避免直接传进来的数据顺序不对）。 */
export function sortIndividualBonuses(
  bonuses: readonly IndividualBonus[],
): IndividualBonus[] {
  return [...bonuses].sort(byStatOrder);
}

/** 从 `rawFields.bytes["14"]` 的 hex 里解出带数值的三维（最多三项）。 */
export function individualBonusesFromRawHex(hex: unknown): IndividualBonus[] {
  if (typeof hex !== 'string') return [];
  const bytes = hexToBytes(hex);
  if (!bytes) return [];
  const top = parseMessage(bytes);
  const result: IndividualBonus[] = [];
  for (let field = 1; field <= STAT_NAMES.length; field += 1) {
    const nestedBytes = top.get(field)?.[0];
    if (!(nestedBytes instanceof Uint8Array)) continue;
    const value = parseMessage(nestedBytes).get(7)?.[0];
    if (typeof value === 'number' && value > 0) {
      result.push({ name: STAT_NAMES[field - 1], value });
    }
  }
  return result.sort(byStatOrder).slice(0, MAX_BONUSES);
}

/** 清洗外部传入的 `individualBonuses`（备份 / 云端旧快照都可能被手改）。 */
export function sanitizeIndividualBonuses(value: unknown): IndividualBonus[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: IndividualBonus[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    const bonus = typeof record.value === 'number' && Number.isFinite(record.value) ? record.value : 0;
    if (!(STAT_NAMES as readonly string[]).includes(name) || bonus <= 0) continue;
    if (result.some((entry) => entry.name === name)) continue;
    result.push({ name, value: Math.round(bonus) });
  }
  return result.length > 0 ? result.sort(byStatOrder).slice(0, MAX_BONUSES) : undefined;
}

/** 一条抓包 / 备份里的精灵条目：优先读采集器导出的值，没有再回退到 rawFields。 */
export function individualBonusesOfItem(item: Record<string, unknown>): IndividualBonus[] | undefined {
  const direct = sanitizeIndividualBonuses(item.individualBonuses);
  if (direct) return direct;
  const rawFields = item.rawFields;
  if (typeof rawFields !== 'object' || rawFields === null) return undefined;
  const bytes = (rawFields as Record<string, unknown>).bytes;
  if (typeof bytes !== 'object' || bytes === null) return undefined;
  const rawHex = (bytes as Record<string, unknown>)['14'];
  const hex = Array.isArray(rawHex) ? rawHex[0] : rawHex;
  const decoded = individualBonusesFromRawHex(hex);
  return decoded.length > 0 ? decoded : undefined;
}
