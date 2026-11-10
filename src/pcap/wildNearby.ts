import { parseSceneInfo, parseWildEntities, type WildEntityRaw } from '../pcap-decoder/tools/pcap-json-app/src/core';
import catalog from '../pcap-decoder/tools/pcap-json-app/src/generated/catalog.json';
import cfgPetMap from '../pcap-decoder/tools/pcap-json-app/src/generated/cfgPetMap.json';
import { heightPercentOf } from '../shared/bodySize';
import { species } from '../data/catalog';
import { kindsOf, rareAlertReason, weightPercentile, type RareKind } from './rareRules';

/**
 * 野外附近精灵（2026-11-05）。
 *
 * 协议解析在 `core.js` 的 `parseWildEntities`（与多多工具箱 4.2 的 `ra()` 同路径，
 * 已在真实野外抓包 `capture-1793891528222.pcap` 验证）；这里负责：
 * cfgId → 种族 → 名称 / 体重区间 → 体重百分位 → 牌子 → 稀有判定。
 */

export interface WildPet {
  /** 协议 cfgId（10000–19999） */
  cfgId: number;
  /** 种族 petId；未收录时为 null */
  petId: number | null;
  name: string;
  actorId: number;
  uniqueId: number;
  level: number;
  height: number;
  weight: number;
  /** 原始协议单位：克 */
  voiceDb: number;
  mutation: number;
  glassType: number;
  glassValue: number;
  pos: { x: number; y: number; z: number };
  /** 体重百分位（0–100）；没有收录体重区间时为 null */
  weightPct: number | null;
  /** 身高百分位（0–100）；没有收录身高区间时为 null（列表显示「高：xx.x%」） */
  heightPct: number | null;
  /** 性格 id（宠物记录回填）；未知为 null */
  natureId: number | null;
  /** 性格名（如「天真」）；未知为空字符串 */
  nature: string;
  /** 性别（1=公，2=母）；未知为空字符串 */
  gender: string;
  kinds: RareKind[];
  rare: boolean;
  /** 满足主动提醒条件时的原因；不满足为 null */
  alertReason: string | null;
  /** 去重键：优先 uniqueId */
  key: string;
}

interface CatalogPet {
  petId: number;
  name: string;
  adultSmallWeight?: number;
  adultBigWeight?: number;
}

interface CatalogNature {
  natureNamesById?: Record<string, string>;
}

const petById = new Map<number, CatalogPet>();
for (const pet of (catalog.pets || []) as CatalogPet[]) {
  if (typeof pet.petId === 'number') petById.set(pet.petId, pet);
}
const natureNames = ((catalog as unknown as CatalogNature).natureNamesById) ?? {};
const cfgToPet = cfgPetMap as Record<string, number>;
/** 身高区间只在主图鉴里；按 gameId（= 种族 petId）取，缺失就不显示百分比。 */
const heightSizeByGameId = new Map(species.map((entry) => [entry.gameId, entry.heightSize]));

/**
 * 特殊场景实体（cfgId 不在 10000–19999 野生段）→ 种族。
 *
 * 2026-11-06 由 capture-1793905516970 验证：蛋包蛋在场上 cfgId 29401、41 级，
 * 实体不带身高/体重/声音；抓后宠物记录（579 field43）指向该实体 uniqueId / 100。
 */
const SPECIAL_CFG_PETS: Record<number, { petId: number; name: string }> = {
  29401: { petId: 3808, name: '蛋包蛋' },
};

export interface DecorateOptions {
  /** 自己当前世界坐标；用于计算距离，缺省时距离为 null */
  self?: { x: number; y: number } | null;
}

export interface WildDetail {
  natureId: number;
  genderId: number;
}

const GENDER_NAMES: Record<number, string> = { 1: '公', 2: '母' };

/** 性格 id → 名称；未收录为空字符串。 */
export function natureNameOf(natureId: number | null): string {
  return natureId == null ? '' : natureNames[String(natureId)] ?? '';
}

/** 性别 id → 「公 / 母」；未知为空字符串。 */
export function genderNameOf(genderId: number | null): string {
  return genderId == null ? '' : GENDER_NAMES[genderId] ?? '';
}

/** 给协议实体补上名称、体重百分位、牌子与提醒原因；宠物记录可回填性格/性别。 */
export function decorateWildPet(raw: WildEntityRaw, detail: WildDetail | null = null): WildPet {
  const special = SPECIAL_CFG_PETS[raw.cfgId];
  const petId = special ? special.petId : cfgToPet[String(raw.cfgId)] ?? null;
  const entry = petId != null ? petById.get(petId) : undefined;
  const weightKg = raw.weight / 1000;
  const low = entry?.adultSmallWeight;
  const high = entry?.adultBigWeight;
  const weightPct = low != null && high != null && raw.weight > 0
    ? weightPercentile({ weightKg, lowKg: low, highKg: high })
    : null;
  const heightPct = petId != null && raw.height > 0
    ? heightPercentOf(heightSizeByGameId.get(petId), raw.height)
    : null;
  const kinds = kindsOf({
    mutation: raw.mutation, glassType: raw.glassType, weightPct, heightPct, voiceDb: raw.voiceDb,
  });
  return {
    ...raw,
    petId,
    name: entry?.name ?? special?.name ?? `未知精灵 ${raw.cfgId}`,
    weightPct,
    heightPct,
    natureId: detail?.natureId ?? null,
    nature: detail ? natureNames[String(detail.natureId)] ?? '' : '',
    gender: detail ? GENDER_NAMES[detail.genderId] ?? '' : '',
    kinds,
    rare: kinds.length > 0,
    alertReason: rareAlertReason({ voiceDb: raw.voiceDb, kinds }),
    key: String(raw.uniqueId || `${raw.cfgId}:${raw.actorId}`),
  };
}

/** 把一帧业务 payload 解成附近精灵；非实体帧返回空数组。 */
export function readWildPets(payload: Uint8Array): WildPet[] {
  return parseWildEntities(payload).map((raw) => decorateWildPet(raw));
}

/** 338 进场景帧 → 场景号。 */
export function readScene(payload: Uint8Array) {
  return parseSceneInfo(payload);
}

export interface NearbyRow extends WildPet {
  distanceM: number | null;
}

/** 计算距离（米），按游戏世界单位 100:1 换算（与多多一致）。 */
export function withDistance(pet: WildPet, self: { x: number; y: number } | null): NearbyRow {
  const distanceM = self ? Math.hypot(pet.pos.x - self.x, pet.pos.y - self.y) / 100 : null;
  return { ...pet, distanceM };
}

/** 附近列表排序：稀有优先，其次距离，最后按 uniqueId 稳定排序。 */
export function sortNearby(rows: readonly NearbyRow[]): NearbyRow[] {
  return [...rows].sort((left, right) => {
    if (left.kinds.length !== right.kinds.length) return right.kinds.length - left.kinds.length;
    const a = left.distanceM ?? Number.POSITIVE_INFINITY;
    const b = right.distanceM ?? Number.POSITIVE_INFINITY;
    if (a !== b) return a - b;
    return left.uniqueId - right.uniqueId;
  });
}
