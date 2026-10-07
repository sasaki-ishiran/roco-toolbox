import { classifyGrade, type PetGrade, type TargetMode } from './petFilters';
import { isBreedableGroup } from './eggs';
import { buildCanBreedMale } from './breedAbility';
import { speciesDisplayName } from './speciesName';
import type { CoverageCell, CoverageState } from './studCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

export interface PetRef {
  name: string;
  account: string;
  /** 如「盒子01 第3位」；缺字段时为「位置未知」 */
  box: string;
  gender: '公' | '母' | '未知';
  voiceDb: number;
  medalBody: string;
  nature: string;
}

export interface CoverageCellDetail {
  groupId: number;
  natureId: number;
  natureName: string;
  /** 这条目标要求的档位（大婉 / 小婉 / 大粗 / 小粗；追满分时显示为「满分XX」） */
  grade: PetGrade;
  state: CoverageState;
  /** 已有种公时：**所有**命中该格的种公（2026-10-05 用户拍板：不只展示一只） */
  studs: PetRef[];
  /** 有满分个体时：随便哪只母本（仅「有满分缺种公」会在界面上用到） */
  mother?: PetRef;
  /** 要放进学院小窝的那只（必须自带目标性格） */
  academyParent?: PetRef;
  /** 与学院小窝那只配对的另一只（同档位异性） */
  partner?: PetRef;
}

export interface CoverageDetailInput {
  cells: CoverageCell[];
  species: SpeciesEntry[];
  owned: OwnedPet[];
  mode: TargetMode;
}

export const boxLabel = (pet: OwnedPet): string => {
  if (!pet.boxGroup) return '位置未知';
  return pet.slotOrder != null ? `${pet.boxGroup} 第${pet.slotOrder}位` : pet.boxGroup;
};

const toRef = (pet: OwnedPet, label: string): PetRef => ({
  name: label,
  account: pet.account,
  box: boxLabel(pet),
  gender: pet.gender,
  voiceDb: pet.voiceDb,
  medalBody: pet.medalBody,
  nature: pet.nature,
});

/**
 * 把覆盖度的每个目标展开成「具体是哪几只精灵」。
 *
 * 每条明细都对应一个槽位（蛋组 × 性格 × 满分档位），所以「同档位」是前提：
 * - `covered`：已经有合格种公（该档位 + 公 + 该性格）→ 报出它是谁、在哪个账号哪个盒子。
 * - `breedable`：学院小窝放「该档位 + 该性格」的那只（放进去它就是配对方，性格 100% 传给蛋），
 *   旁边放一只同档位的异性——**同一账号**（不同账号的精灵不能一起孵蛋，2026-10-07 修）。
 * - `missingStud`：报出手里那只满分个体，缺口由状态词表达。
 *
 * 注意这里**不再产出解释性文案**：界面上只显示状态词 + 这几只精灵，
 * 「该组有满分大婉的个体，但还缺一只…」这类提示对玩家是噪音。
 */
export function describeCoverageCells(input: CoverageDetailInput): CoverageCellDetail[] {
  const { cells, species, owned, mode } = input;

  const speciesByGameId = new Map<number, SpeciesEntry>();
  const groupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    speciesByGameId.set(entry.gameId, entry);
    groupsByGameId.set(
      entry.gameId,
      (entry.eggGroups ?? []).filter(isBreedableGroup),
    );
  }
  const inGroup = (pet: OwnedPet, groupId: number): boolean =>
    (groupsByGameId.get(pet.gameId) ?? []).includes(groupId);
  /** 母方物种能不能出公（后代随母方，出不了公就永远孵不出种公） */
  const canBreedMale = buildCanBreedMale(species);
  const labelFor = (pet: OwnedPet): string =>
    speciesDisplayName(speciesByGameId.get(pet.gameId), pet.name);

  return cells.map((cell) => {
    // 该蛋组里、档位正好是这个槽位要求的个体
    const matched = owned.filter(
      (pet) => inGroup(pet, cell.groupId) && classifyGrade(pet, mode) === cell.grade,
    );

    const studs = matched
      .filter((pet) => pet.gender === '公' && pet.nature === cell.natureName)
      .map((pet) => toRef(pet, labelFor(pet)));
    // 母本必须**自带这个性格**、且**她这物种能出公**（后代随母方，出不了公就孵不出种公）
    const mother = matched.find(
      (pet) => pet.gender === '母' && pet.nature === cell.natureName && canBreedMale(pet),
    );
    // 学院小窝那一对必须**同账号**（2026-10-07 修）：不同账号的精灵不能一起孵蛋，
    // 之前是在全账号混池里各挑一只，会把两个账号的精灵配成一对（假的「可迭代」）。
    // 所以按账号分组，找「本账号里既有学院那只、又有同档位异性」的账号；
    // 一只账号里配不上就换下一个账号；都配不上就都不给（界面本来也只在两只都有时才显示）。
    let academyParent: OwnedPet | undefined;
    let partner: OwnedPet | undefined;
    if (studs.length === 0) {
      const byAccount = new Map<string, OwnedPet[]>();
      for (const pet of matched) {
        const list = byAccount.get(pet.account) ?? [];
        list.push(pet);
        byAccount.set(pet.account, list);
      }
      for (const pets of byAccount.values()) {
        const parent = pets.find(
          (pet) => pet.nature === cell.natureName && pet.gender !== '未知' && canBreedMale(pet),
        );
        if (!parent) continue;
        const mate = pets.find(
          (pet) => pet !== parent && pet.gender !== parent.gender && pet.gender !== '未知',
        );
        if (!mate) continue;
        academyParent = parent;
        partner = mate;
        break;
      }
    }

    return {
      groupId: cell.groupId,
      natureId: cell.natureId,
      natureName: cell.natureName,
      grade: cell.grade,
      state: cell.state,
      studs,
      mother: mother ? toRef(mother, labelFor(mother)) : undefined,
      academyParent: academyParent ? toRef(academyParent, labelFor(academyParent)) : undefined,
      partner: partner ? toRef(partner, labelFor(partner)) : undefined,
    };
  });
}
