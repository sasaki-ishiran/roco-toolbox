import type { SpeciesEntry } from './types';
import { fallbackNature } from './studRecommendations';

/**
 * 推荐性格（2026-10-25 母本口径）。
 *
 * 数据来源两级：
 * 1. 图鉴的 PVP 推荐（`SpeciesEntry.recommendedNatures`，来自 wiki 的 PVP 参考表）；
 * 2. 图鉴没有收录的物种（S4 新精灵等）按**种族值兜底**（`fallbackNature`，2026-10-04 就有，
 *    此前只用于种公推荐，母本这边一直没接）。
 *
 * 用户/组长按「蛋」覆盖：键是蛋的 gameId（`SpeciesEntry.eggGameId`），值是该蛋的推荐性格。
 * 覆盖为空 / 没覆盖 = 用默认。
 */
export type NatureOverrides = Record<string, string[]>;

const eggKey = (eggGameId: number): string => String(eggGameId);

/** 一颗蛋的默认推荐性格：基础形态的 PVP 推荐 → 种族值兜底 → 同蛋其它形态兜底。 */
export function defaultEggNatures(
  species: readonly SpeciesEntry[],
  eggGameId: number,
): string[] {
  const base = species.find((entry) => entry.gameId === eggGameId);
  if ((base?.recommendedNatures?.length ?? 0) > 0) return [...base!.recommendedNatures!];
  if (base?.stats) return [fallbackNature(base.stats)];
  const relative = species.find((entry) => entry.eggGameId === eggGameId);
  if ((relative?.recommendedNatures?.length ?? 0) > 0) return [...relative!.recommendedNatures!];
  if (relative?.stats) return [fallbackNature(relative.stats)];
  return [];
}

/** 一颗蛋当前的推荐性格：用户覆盖优先，否则默认。 */
export function eggNatures(
  species: readonly SpeciesEntry[],
  eggGameId: number,
  overrides?: NatureOverrides,
): string[] {
  const override = overrides?.[eggKey(eggGameId)];
  if (override && override.length > 0) return [...override];
  return defaultEggNatures(species, eggGameId);
}

/**
 * 生成「物种 gameId → 推荐性格」的解析器（内部按蛋缓存）。
 * 母本达标判定按精灵自己的物种查，同一颗蛋的所有形态共用一份。
 */
export function createNaturesResolver(input: {
  species: readonly SpeciesEntry[];
  overrides?: NatureOverrides;
}): (speciesGameId: number) => string[] {
  const byGameId = new Map(input.species.map((entry) => [entry.gameId, entry]));
  const cache = new Map<number, string[]>();
  return (gameId) => {
    const cached = cache.get(gameId);
    if (cached) return cached;
    const eggGameId = byGameId.get(gameId)?.eggGameId;
    const result = eggGameId == null ? [] : eggNatures(input.species, eggGameId, input.overrides);
    cache.set(gameId, result);
    return result;
  };
}

/** 覆盖表里实际生效的部分（空数组视为未覆盖）。 */
export function activeNatureOverrides(overrides: NatureOverrides | undefined): NatureOverrides {
  const result: NatureOverrides = {};
  for (const [key, natures] of Object.entries(overrides ?? {})) {
    const kept = [...new Set(natures.filter((nature) => typeof nature === 'string' && nature.trim()))];
    if (kept.length > 0) result[key] = kept;
  }
  return result;
}
