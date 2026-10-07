import { classifyGrade, type PetGrade, type TargetMode } from './petFilters';
import { isBreedableGroup } from './eggs';
import { buildCanBreedMale } from './breedAbility';
import type { OwnedPet, SpeciesEntry } from './types';

export type CoverageState = 'covered' | 'breedable' | 'missingStud' | 'empty';

/**
 * 图鉴里「每个蛋组推荐的目标性格」（数据推导，每蛋组前 3）。
 * 这是**默认值**来源；用户可在筛选里增减，可选项来自八大性格池。
 */
export interface TargetNature {
  groupId: number;
  natureId: number;
  name: string;
}

/**
 * 一个目标槽位：**某个蛋组 × 某个目标性格 × 某个档位**。
 *
 * 三个维度互相独立（用户 2026-10-03 确认）：
 * - 蛋组：14 个可孵蛋组，保留组间差异（不同组的目标性格不同）
 * - 性格：来自八大性格池，默认取该组推荐的前 3
 * - 档位：大婉 / 小婉 / 大粗 / 小粗（体型 × 声音方向的 4 种组合）；
 *   声音阈值随全局模式（追满分 |dB|==100 / 追双牌 |dB|>=96）
 *
 * 槽位由用户的筛选条件生成，见 coverageTargets.ts。
 */
export interface CoverageSlot {
  groupId: number;
  natureId: number;
  natureName: string;
  grade: PetGrade;
}

export interface CoverageCell extends CoverageSlot {
  state: CoverageState;
  /** 支撑这个格的精灵所属账号（便于用户回游戏里找） */
  owner?: string;
}

export interface StudCoverageResult {
  total: number;
  covered: number;
  cells: CoverageCell[];
  groupSummary: Array<{ groupId: number; covered: number; total: number; state: CoverageState }>;
  /** 已通的蛋组数（组内所有目标槽位都已覆盖） */
  passedGroups: number;
  /** 参与统计的蛋组数（随筛选变化，默认 14） */
  groupCount: number;
}

/**
 * 一个蛋组「已通」= 该组选中的目标槽位全部覆盖、缺口为 0。
 * 主数字（已通 N / 14 组）用它，而不是「已覆盖 N / 42」——蛋组数才是玩家能拿去说的进度。
 */
export const isGroupPassed = (row: { covered: number; total: number }): boolean =>
  row.total > 0 && row.covered === row.total;

// 状态优先级：covered 最好，empty 最差
const STATE_RANK: Record<CoverageState, number> = {
  covered: 0,
  breedable: 1,
  missingStud: 2,
  empty: 3,
};

const worst = (a: CoverageState, b: CoverageState): CoverageState =>
  STATE_RANK[a] >= STATE_RANK[b] ? a : b;

/**
 * 一个格子在「手上是这些精灵」时的状态（2026-10-05 与用户逐条对齐）。
 *
 * 判定只看**该蛋组 + 该档位**的精灵（`matched`），并且精灵按**它自己的性格**归格：
 * - `covered`：有**带这个性格的公** → 种公到位，不用动
 * - `breedable`：能凑出「一公一母」，且带这个性格的是**母**（公随便什么性格）
 *   → 自己孵就能出（用学院小窝放那只母，性格 100% 遗传）→ 界面叫「可迭代」
 * - `missingStud`：有**带这个性格的母**，但**同一个账号里**一只公都没有 → 「有母本」（只差一只公）
 * - `empty`：连一只带这个性格的都没有 → 「要去弄」（双方都不带，永远出不来）
 *
 * 覆盖度、配窝建议、换蛋收益共用这一份判定，避免两处口径走偏。
 * `canBreedMale`：母方物种能不能出公（后代随母方，出不了公就永远孵不出种公）。
 *
 * **配对必须同账号**（2026-10-07 修）：不同账号的精灵不能一起孵蛋，
 * 之前在全账号混池里挑「母 + 公」→ 会把两个账号的精灵配成一对、错报成「可迭代」。
 */
export function cellStateFor(
  matched: OwnedPet[],
  slot: CoverageSlot,
  canBreedMale: (pet: OwnedPet) => boolean,
): CoverageState {
  const carries = (pet: OwnedPet): boolean => pet.nature === slot.natureName;
  const males = matched.filter((pet) => pet.gender === '公');
  // 1) 种公到位：同档位 + 公 + 该性格
  if (males.some(carries)) return 'covered';
  // 母方物种出不了公的（如只能出母的物种），后代永远不是种公 → 她在这格上不算「有母本」
  const mothers = matched.filter(
    (pet) => pet.gender === '母' && carries(pet) && canBreedMale(pet),
  );
  // 2) 带该性格的母 + **同账号**的一只公 → 自己孵
  if (mothers.some((mother) => males.some((male) => male.account === mother.account))) {
    return 'breedable';
  }
  // 3) 有母本、本账号内缺公
  if (mothers.length > 0) return 'missingStud';
  return 'empty';
}

/** 覆盖度里那只「起作用」的精灵所属账号（便于用户回游戏里找）。 */
export function ownerAccountFor(matched: OwnedPet[], slot: CoverageSlot): string | undefined {
  const carries = (pet: OwnedPet): boolean => pet.nature === slot.natureName;
  const stud = matched.find((pet) => pet.gender === '公' && carries(pet));
  if (stud) return stud.account;
  const mother = matched.find((pet) => pet.gender === '母' && carries(pet));
  if (mother) return mother.account;
  return matched.find((pet) => pet.gender !== '未知')?.account ?? matched[0]?.account;
}

export function computeStudCoverage(
  slots: CoverageSlot[],
  species: SpeciesEntry[],
  owned: OwnedPet[],
  _eggGroupNames: Record<number, string>,
  mode: TargetMode,
): StudCoverageResult {
  // gameId → 物种蛋组（双蛋组都保留）
  const gameToEggGroups = new Map<number, number[]>();
  for (const entry of species) {
    gameToEggGroups.set(entry.gameId, entry.eggGroups.filter(isBreedableGroup));
  }

  // 母方物种能不能出公：后代随母方，母方出不了公就永远孵不出种公（`maleCapable` 由管线烘焙）
  const canBreedMale = buildCanBreedMale(species);

  const cells: CoverageCell[] = slots.map((slot) => {
    // 该蛋组里、且档位正好是这个槽位要求的个体（档位含体型要求，声音阈值随模式）
    const matched = owned.filter(
      (pet) =>
        classifyGrade(pet, mode) === slot.grade &&
        (gameToEggGroups.get(pet.gameId) ?? []).includes(slot.groupId),
    );

    return {
      ...slot,
      state: cellStateFor(matched, slot, canBreedMale),
      owner: ownerAccountFor(matched, slot),
    };
  });

  const covered = cells.filter((c) => c.state === 'covered').length;

  const groupMap = new Map<number, { covered: number; total: number; state: CoverageState }>();
  for (const cell of cells) {
    const existing = groupMap.get(cell.groupId);
    if (!existing) {
      groupMap.set(cell.groupId, {
        covered: cell.state === 'covered' ? 1 : 0,
        total: 1,
        state: cell.state,
      });
    } else {
      existing.total += 1;
      if (cell.state === 'covered') existing.covered += 1;
      existing.state = worst(existing.state, cell.state);
    }
  }

  const groupSummary = [...groupMap.entries()].map(([groupId, summary]) => ({
    groupId,
    ...summary,
  }));

  return {
    total: cells.length,
    covered,
    cells,
    groupSummary,
    passedGroups: groupSummary.filter(isGroupPassed).length,
    groupCount: groupSummary.length,
  };
}
