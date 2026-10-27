import { classifyGrade, GRADE_BODY, type PetGrade, type TargetMode } from './petFilters';
import { isBreedableGroup } from './eggs';
import { accountKeyOf, type AccountSnapshot } from './parseBackup';
import type { SpeciesEntry } from './types';

/**
 * 「产线」：同一账号里能稳定产出的 蛋 × 档位 × 性格。
 *
 * 规则（2026-10-27 与用户逐条确认）：
 * - **不能跨账号**：母本和配对公必须在同一个游戏账号里；
 * - **双方同档位**：声音遗传是 (父 + 母) / 2，要 +100 必须父母双双 +100；
 *   体型同理，双大块头才出大块头蛋；
 * - 母本必须是这枚蛋的物种（或它的进化形态），公只要同蛋组、同档位；
 * - 性格可以由母本带，也可以由公带（放学院小窝，100% 遗传），所以
 *   `natures` = 母本性格 ∪ 同档位可配公的性格；
 * - 种公需求还要看这枚蛋能不能出公（`maleCapable`），母本需求不需要。
 *
 * 这里只做纯计算，不读网络、不写库；共享摘要与页面都复用这一份口径。
 */
export interface ProductionLine {
  /** 这枚蛋的 gameId（母本的血脉蛋，不是形态 id）。 */
  eggGameId: number;
  /** 双方共同的档位（大婉 / 小婉 / 大粗 / 小粗）。 */
  grade: PetGrade;
  /** 这条产线能产出的性格（母本 + 同档位可配公）。 */
  natures: string[];
}

export interface AccountProductionLines {
  accountKey: string;
  lines: ProductionLine[];
}

export interface BuildProductionLinesInput {
  snapshots: readonly AccountSnapshot[];
  species: readonly SpeciesEntry[];
  mode: TargetMode;
}

/** 母本 / 种公两种目标；母本必须指定蛋，种公只认蛋组。 */
export type ProductionTarget =
  | {
      kind: 'mother';
      eggGameId: number;
      nature: string;
      body: string;
      voice: string;
    }
  | {
      kind: 'stud';
      groupId: number;
      nature: string;
      body: string;
      voice: string;
    };

const sortNatures = (natures: Iterable<string>): string[] =>
  [...new Set(natures)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

const eggGroupsOf = (species: readonly SpeciesEntry[]): Map<number, number[]> => {
  const map = new Map<number, number[]>();
  for (const entry of species) {
    if (entry.eggGameId != null && entry.eggGameId === entry.gameId) {
      map.set(entry.gameId, (entry.eggGroups ?? []).filter(isBreedableGroup));
    }
  }
  return map;
};

const maleCapableOf = (species: readonly SpeciesEntry[]): Map<number, boolean> => {
  const map = new Map<number, boolean>();
  for (const entry of species) {
    if (entry.eggGameId != null && entry.eggGameId === entry.gameId) {
      map.set(entry.gameId, entry.maleCapable === true);
    }
  }
  return map;
};

/**
 * 从账号快照生成产线。每个账号单独算，绝不跨账号拼父母。
 */
export function buildProductionLines(
  input: BuildProductionLinesInput,
): AccountProductionLines[] {
  const { snapshots, species, mode } = input;
  const eggOfGameId = new Map<number, number>();
  for (const entry of species) {
    if (entry.eggGameId != null && entry.eggGameId > 0) {
      eggOfGameId.set(entry.gameId, entry.eggGameId);
    }
  }
  const groupsByEgg = eggGroupsOf(species);
  const groupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    groupsByGameId.set(entry.gameId, (entry.eggGroups ?? []).filter(isBreedableGroup));
  }

  return snapshots.map((snapshot) => {
    const mothers = new Map<string, { eggGameId: number; grade: PetGrade; natures: Set<string> }>();
    const males = new Map<PetGrade, Array<{ groups: number[]; nature: string }>>();

    for (const pet of snapshot.pets) {
      const grade = classifyGrade(pet, mode);
      if (!grade) continue;
      if (pet.gender === '公') {
        const groups = groupsByGameId.get(pet.gameId) ?? [];
        if (groups.length === 0) continue;
        const list = males.get(grade) ?? [];
        list.push({ groups, nature: pet.nature });
        males.set(grade, list);
        continue;
      }
      if (pet.gender !== '母') continue;
      const eggGameId = eggOfGameId.get(pet.gameId);
      if (eggGameId == null) continue;
      const key = `${eggGameId}|${grade}`;
      const entry = mothers.get(key) ?? {
        eggGameId,
        grade,
        natures: new Set<string>(),
      };
      entry.natures.add(pet.nature);
      mothers.set(key, entry);
    }

    const lines: ProductionLine[] = [];
    for (const mother of mothers.values()) {
      const eggGroups = groupsByEgg.get(mother.eggGameId) ?? [];
      if (eggGroups.length === 0) continue;
      const compatibleMales = (males.get(mother.grade) ?? []).filter((male) =>
        male.groups.some((group) => eggGroups.includes(group)),
      );
      if (compatibleMales.length === 0) continue;
      const natures = new Set(mother.natures);
      for (const male of compatibleMales) natures.add(male.nature);
      lines.push({
        eggGameId: mother.eggGameId,
        grade: mother.grade,
        natures: sortNatures(natures),
      });
    }

    lines.sort((a, b) => a.eggGameId - b.eggGameId || a.grade.localeCompare(b.grade));
    return {
      accountKey: snapshot.accountKey ?? accountKeyOf(snapshot),
      lines,
    };
  });
}

const VOICE_GRADES: Record<TargetMode, Record<string, readonly PetGrade[]>> = {
  perfect: {
    '+100': ['大婉', '小婉'],
    '-100': ['大粗', '小粗'],
  },
  medal: {
    婉转声: ['大婉', '小婉'],
    粗嗓门: ['大粗', '小粗'],
  },
};

const gradeMatchesTarget = (grade: PetGrade, target: ProductionTarget, mode: TargetMode): boolean => {
  if (target.body && GRADE_BODY[grade] !== target.body) return false;
  if (!target.voice) return true;
  return (VOICE_GRADES[mode][target.voice] ?? []).includes(grade);
};

/**
 * 一条产线能否满足目标。
 *
 * - 母本：必须是指定蛋；
 * - 种公：蛋属于目标蛋组即可，且该蛋必须能出公；
 * - 性格：目标不挑 = 任意；否则产线的 `natures` 必须包含；
 * - 体型 / 声音：按档位匹配。
 */
export function lineSuppliesTarget(
  line: ProductionLine,
  target: ProductionTarget,
  species: readonly SpeciesEntry[],
  mode: TargetMode,
): boolean {
  if (target.kind === 'mother') {
    if (line.eggGameId !== target.eggGameId) return false;
  } else {
    const groups = (species.find((entry) => entry.gameId === line.eggGameId)?.eggGroups ?? [])
      .filter(isBreedableGroup);
    if (!groups.includes(target.groupId)) return false;
    if (maleCapableOf(species).get(line.eggGameId) !== true) return false;
  }
  if (target.nature && !line.natures.includes(target.nature)) return false;
  return gradeMatchesTarget(line.grade, target, mode);
}

/** 一组产线（一个账号 / 一个小组）里是否有人能满足目标。 */
export function linesSupplyTarget(
  lines: readonly ProductionLine[],
  target: ProductionTarget,
  species: readonly SpeciesEntry[],
  mode: TargetMode,
): boolean {
  return lines.some((line) => lineSuppliesTarget(line, target, species, mode));
}
