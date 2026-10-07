import type { OwnedPet, SpeciesEntry } from './types';

/**
 * 「母方物种能不能出公」的统一判定（后代随母方，母方出不了公就永远孵不出种公）。
 *
 * 2026-10-06 消重（m5）：此前 studCoverage / nestPlan / coverageDetail 三处各自
 * 构造同样的 maleCapable Set，口径容易漂移；收敛到这一个工厂。
 */
export function buildCanBreedMale(species: SpeciesEntry[]): (pet: OwnedPet) => boolean {
  const maleCapable = new Set(
    species.filter((entry) => entry.maleCapable === true).map((entry) => entry.gameId),
  );
  return (pet: OwnedPet): boolean => maleCapable.has(pet.gameId);
}
