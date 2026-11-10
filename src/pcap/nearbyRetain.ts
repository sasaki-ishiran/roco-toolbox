import type { LiveNearbyPet } from '../collector/captureProgress';
import type { DemandHit } from './demandMatch';

/**
 * 附近常驻列表的定期清理（2026-11-06）。
 *
 * 用户口径：常驻列表只保留高价值精灵（稀有 / 命中需求中心），普通精灵离开视野就清掉；
 * 高价值精灵离开后再保留 10 分钟，避免刚走开就丢记录，也防止列表无限增长。
 */
export const RETAIN_TTL_MS = 10 * 60 * 1000;
export const RETAIN_MAX_ENTRIES = 60;

export interface RetainedEntry {
  key: string;
  pet: LiveNearbyPet;
  firstSeenAt: number;
  lastSeenAt: number;
  /** 是否仍在当前附近列表里；false = 已离开视野，等待 TTL 清理 */
  present: boolean;
  /** 稀有或命中需求中心：离开后仍保留 */
  highValue: boolean;
  demandHits: DemandHit[];
}

export interface RetainClassify {
  highValue: boolean;
  demandHits: DemandHit[];
}

/** 真正值得常驻的牌子：炫彩 / 异色 / 污染；体重牌、单声音牌不常驻。 */
const KEEP_KINDS = new Set(['colorful', 'shiny', 'pollution']);

/**
 * 常驻列表的「高价值」口径（2026-11-06 用户反馈收紧，2026-11-09 补回稀有）：
 * - 可主动提醒（±100dB，或体重牌 + 声音牌）；
 * - 稀有（与附近页「稀有」筛选同一口径，雷达上能看到就必须能在列表里看到）；
 * - 炫彩 / 异色 / 污染；
 * - 命中需求中心。
 *
 * 只有单一「大块头 / 小不点 / 婉转声 / 粗嗓门」牌子的普通精灵只在雷达/当前视野显示，
 * 不再进入常驻列表。
 */
export function isHighValuePet(pet: LiveNearbyPet, demandHits: readonly DemandHit[]): boolean {
  return pet.rare
    || Boolean(pet.alertReason)
    || demandHits.length > 0
    || pet.kinds.some((kind) => KEEP_KINDS.has(kind));
}

export interface RetainOptions {
  ttlMs?: number;
  maxEntries?: number;
}

export function pruneRetained(
  previous: readonly RetainedEntry[],
  current: readonly LiveNearbyPet[],
  now: number,
  classify: (pet: LiveNearbyPet) => RetainClassify,
  options: RetainOptions = {},
): RetainedEntry[] {
  const ttlMs = options.ttlMs ?? RETAIN_TTL_MS;
  const maxEntries = options.maxEntries ?? RETAIN_MAX_ENTRIES;
  const previousByKey = new Map(previous.map((entry) => [entry.key, entry]));
  const currentKeys = new Set(current.map((pet) => pet.key));
  const rows: RetainedEntry[] = [];

  for (const pet of current) {
    const before = previousByKey.get(pet.key);
    const result = classify(pet);
    rows.push({
      key: pet.key,
      pet,
      firstSeenAt: before?.firstSeenAt ?? now,
      lastSeenAt: now,
      present: true,
      // 稀有与「命中需求中心」都算高价值，调用方只判断稀有也不会漏掉需求命中
      highValue: result.highValue || result.demandHits.length > 0,
      demandHits: result.demandHits,
    });
  }

  for (const entry of previous) {
    if (currentKeys.has(entry.key)) continue;
    // 普通精灵离开视野即清理，不进入常驻
    if (!entry.highValue) continue;
    if (now - entry.lastSeenAt > ttlMs) continue;
    rows.push({ ...entry, present: false });
  }

  if (rows.length <= maxEntries) return rows;
  // 超上限时先淘汰「已离开」的旧记录，再淘汰最久没出现的
  const ordered = [...rows].sort((left, right) =>
    Number(left.present) - Number(right.present) || left.lastSeenAt - right.lastSeenAt);
  const keep = new Set(ordered.slice(ordered.length - maxEntries).map((row) => row.key));
  return rows.filter((row) => keep.has(row.key));
}
