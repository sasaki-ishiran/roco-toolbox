import { isBreedableGroup } from './eggs';
import { lineSuppliesTarget, type ProductionIndex, type ProductionLine } from './productionLines';
import type { SpeciesEntry } from './types';

/**
 * 种公需求的候选蛋（2026-10-30 用户口径）。
 *
 * 种公需求本身只记「蛋组 + 性格 + 性别公 + 体型 / 声音」，在需求中心会变成一张
 * 没有头像的空卡。这里按**组内产线**把「能孵出这颗公的蛋」全部算出来：
 * 卡片用其中一枚当代表（双蛋组优先），其余用角标标数量。
 */
export interface StudCandidateMember {
  accountId: string;
  /** null = 旧摘要没带产线，只能用 `eggGameIds` 兜底判断。 */
  lines: ProductionLine[] | null;
  eggGameIds: ReadonlySet<number>;
}

export interface StudDemandCandidate {
  eggGameId: number;
  name: string;
  /** 组内能产这枚蛋（且满足性格 / 体型 / 声音）的成员。 */
  supplierIds: string[];
  /** 这枚蛋的可配蛋组数量；>= 2 视为双蛋组，排序优先。 */
  groupCount: number;
}

export interface StudDemandQuery {
  groupId: number;
  nature: string;
  body: string;
  voice: string;
}

/** 组内能孵出「这颗公」的蛋，按双蛋组 → 能补人数 → 图鉴号排序。 */
export function findStudDemandCandidates(
  query: StudDemandQuery,
  species: readonly SpeciesEntry[],
  index: ProductionIndex,
  members: readonly StudCandidateMember[],
): StudDemandCandidate[] {
  const target = {
    kind: 'stud' as const,
    groupId: query.groupId,
    nature: query.nature,
    body: query.body,
    voice: query.voice,
  };
  const candidates: StudDemandCandidate[] = [];

  for (const entry of species) {
    if (entry.eggGameId == null || entry.eggGameId !== entry.gameId) continue;
    if (entry.maleCapable !== true) continue;
    const groups = (entry.eggGroups ?? []).filter(isBreedableGroup);
    if (!groups.includes(query.groupId)) continue;

    const supplierIds: string[] = [];
    for (const member of members) {
      if (member.lines == null) {
        if (member.eggGameIds.has(entry.gameId)) supplierIds.push(member.accountId);
        continue;
      }
      const supplies = member.lines.some(
        (line) => line.eggGameId === entry.gameId && lineSuppliesTarget(line, target, index),
      );
      if (supplies) supplierIds.push(member.accountId);
    }
    if (supplierIds.length === 0) continue;

    candidates.push({
      eggGameId: entry.gameId,
      name: entry.name,
      supplierIds,
      groupCount: groups.length,
    });
  }

  return candidates.sort(
    (a, b) =>
      Number(b.groupCount >= 2) - Number(a.groupCount >= 2) ||
      b.supplierIds.length - a.supplierIds.length ||
      a.eggGameId - b.eggGameId,
  );
}
