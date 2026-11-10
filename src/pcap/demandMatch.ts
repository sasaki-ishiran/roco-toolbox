import type { LiveNearbyPet } from '../collector/captureProgress';
import { matchesVoiceOption } from '../domain/petFilters';
import type { EggGroupId, SpeciesEntry } from '../domain/types';
import type { CollectionDemand } from '../shared/collectionGroups';

/**
 * 附近野生精灵 ↔ 需求中心（2026-11-06）。
 *
 * 需求有两种主键：
 * - `eggGameId > 0`：要某个物种的蛋 → 野生精灵的蛋血脉必须指向同一颗蛋；
 * - `eggGameId < 0`：种公需求，`-eggGameId` 是蛋组 → 野生精灵的蛋组必须包含它。
 *
 * 体型 / 声音可以从野生实体直接判断；**性格 / 性别读不到**，命中时标记「需抓到后确认」，
 * 不能假装已经满足。
 */
export interface DemandHit {
  demand: CollectionDemand;
  /** 需求所在小组名（由需求中心条目带出；纯匹配时不填） */
  groupName?: string;
  /** 可从野生实体验证且已满足的条件（体型 / 声音） */
  known: string[];
  /** 需求要求、但野生实体读不到的条件（性格 / 性别） */
  unverified: string[];
}

export interface DemandSpeciesIndex {
  byGameId: Map<number, SpeciesEntry>;
}

export function demandSpeciesIndex(species: readonly SpeciesEntry[]): DemandSpeciesIndex {
  const byGameId = new Map<number, SpeciesEntry>();
  for (const entry of species) byGameId.set(entry.gameId, entry);
  return { byGameId };
}

/** 体型条件：与附近列表的牌子同一套口径（`kindsOf`），大块头 / 小不点要身高同时到顶 / 到底。 */
function bodyMatches(body: string, weightPct: number | null, heightPct: number | null): boolean {
  if (!body) return true;
  if (weightPct == null || !Number.isFinite(weightPct)) return false;
  const height = heightPct != null && Number.isFinite(heightPct) ? heightPct : null;
  switch (body) {
    case '大块头': return weightPct >= 98 && height != null && height >= 98;
    case '满体重': return weightPct >= 100;
    case '小不点': return weightPct <= 2 && height != null && height <= 2;
    case '零体重': return weightPct <= 0;
    default: return true;
  }
}

function voiceMatches(voice: string, voiceDb: number): boolean {
  return !voice || matchesVoiceOption(voiceDb, voice);
}

export function demandHitsForPet(
  pet: LiveNearbyPet,
  demands: readonly CollectionDemand[],
  index: DemandSpeciesIndex,
): DemandHit[] {
  if (pet.petId == null) return [];
  const entry = index.byGameId.get(pet.petId);
  if (!entry) return [];
  const hits: DemandHit[] = [];
  for (const demand of demands) {
    if (demand.eggGameId > 0) {
      if (entry.eggGameId !== demand.eggGameId) continue;
    } else if (demand.eggGameId < 0) {
      if (!entry.eggGroups.includes((-demand.eggGameId) as EggGroupId)) continue;
    } else {
      continue;
    }
    if (!bodyMatches(demand.body, pet.weightPct, pet.heightPct ?? null)) continue;
    if (!voiceMatches(demand.voice, pet.voiceDb)) continue;
    const known: string[] = [];
    if (demand.body) known.push('体型');
    if (demand.voice) known.push('声音');
    const unverified: string[] = [];
    if (demand.nature) {
      if (pet.nature) {
        if (pet.nature !== demand.nature) continue;
        known.push('性格');
      } else {
        unverified.push('性格');
      }
    }
    if (demand.gender) {
      if (pet.gender) {
        if (pet.gender !== demand.gender) continue;
        known.push('性别');
      } else {
        unverified.push('性别');
      }
    }
    hits.push({
      demand,
      groupName: (demand as CollectionDemand & { groupName?: string }).groupName,
      known,
      unverified,
    });
  }
  return hits;
}
