import { classifyGrade, type PetGrade, type TargetMode } from './petFilters';
import { isBreedableGroup } from './eggs';
import type { CoverageSlot } from './studCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

/** 一只种公实际覆盖的一个目标：蛋组 × 性格 × 档位 */
export interface StudTargetHit {
  groupId: number;
  groupLabel: string;
  natureName: string;
  grade: PetGrade;
}

export interface StudPetHit {
  /** 在传入的 owned 数组里的下标（界面用它取回精灵，逗号后面的列表不会错位） */
  petIndex: number;
  /** 这只精灵自己的档位（公且够档时才有；界面用它做四档筛选） */
  grade: PetGrade | null;
  targets: StudTargetHit[];
}

export interface DescribeStudTargetsInput {
  owned: OwnedPet[];
  species: SpeciesEntry[];
  /** 当前追踪的目标槽位（蛋组 × 性格 × 档位），来自覆盖度筛选 */
  slots: CoverageSlot[];
  eggGroupNames: Record<number, string>;
  mode: TargetMode;
}

/**
 * 逐只精灵算出它作为**种公**的档位与覆盖目标。
 *
 * 谁能进「种公名单」由界面口径决定：现在**种公 = 公 + 档位达标**（体型 + 分贝，阈值随模式），
 * 性格不再当门槛——否则一只「合格但性格不在目标池」的精灵会凭空消失
 * （用户 2026-10-03 报的缺陷：小号的满分小婉懒散梦游导入后找不到）。
 * 覆盖目标（`targets`）只用于排序与提示：覆盖多的在前，零覆盖的排在最后。
 *
 * 覆盖判定本身（`targets` 的内容）仍与覆盖度矩阵的 `covered` 完全同口径：
 * 性别公、档位正好吻合、性格是该蛋组**选中的目标性格**、物种属于该蛋组。
 */
export function describeStudTargets(input: DescribeStudTargetsInput): StudPetHit[] {
  const { owned, species, slots, eggGroupNames, mode } = input;

  const groupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    groupsByGameId.set(
      entry.gameId,
      (entry.eggGroups ?? []).filter(isBreedableGroup),
    );
  }

  const hits = owned.map((pet, petIndex): StudPetHit => {
    const targets: StudTargetHit[] = [];
    const grade = pet.gender === '公' ? classifyGrade(pet, mode) : null;
    if (grade) {
      const groups = groupsByGameId.get(pet.gameId) ?? [];
      for (const slot of slots) {
        if (slot.grade !== grade) continue;
        if (slot.natureName !== pet.nature) continue;
        if (!groups.includes(slot.groupId)) continue;
        targets.push({
          groupId: slot.groupId,
          groupLabel: eggGroupNames[slot.groupId] ?? `蛋组${slot.groupId}`,
          natureName: slot.natureName,
          grade,
        });
      }
    }
    return { petIndex, grade, targets };
  });

  return hits.sort((a, b) => b.targets.length - a.targets.length || a.petIndex - b.petIndex);
}