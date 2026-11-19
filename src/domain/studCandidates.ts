import { studMatrixPetKey } from './studMatrix';
import type { NestPlan } from './nestPlan';
import type { OwnedPet, SpeciesEntry } from './types';
import type { PetGrade } from './petFilters';
import { isBreedableGroup } from './eggs';
import { speciesDisplayName } from './speciesName';

/**
 * 种公缺口格的候选种公（2026-11-19 用户口径）。
 *
 * 格子里的性格已经锁定，所以这里不再按性格排序：只回答「这一格能拿谁当种公、怎么拿到」。
 * - 本号可配：本号的配窝方案里已经有补这一格的线（父本就在本号）；
 * - 跨号 · 账号：别的号方案里有这一格，蛋传过来孵；
 * - 只能求助：谁都没排上这一格。
 *
 * 权重（悬浮窗默认展示谁、列表怎么排）：
 * 能配 > 能跨号传 > 只能求助，再看能覆盖几个真实蛋组、手里有几只同种公。
 * 性格不参与权重——格子上已经定了。
 */
export interface StudGapCell {
  groupId: number;
  natureName: string;
  grade: PetGrade;
}

export interface StudCandidate {
  gameId: number;
  name: string;
  /** 这只公占的可孵蛋组（真实组名由界面查 eggGroupNames） */
  groupIds: number[];
  /** 手里这只精灵的公有几只（跨号时含别的号） */
  males: number;
  route: 'self' | 'transfer' | 'none';
  /** 跨号时哪个号能传 */
  sourceAccount?: string;
  /** 这一格的概率（性格概率 × 出公比例拿不到时按性格概率） */
  chance: number;
  /** 选中后写回种公阵列的稳定键；找不到对应背包个体时为 null */
  petKey: string | null;
  /** 卡片展示用（与配窝卡同源） */
  voiceDb: number | null;
  medalBody: string | null;
  weightPercent: number | null;
  weight: number;
}

const matchesCell = (
  pairing: { groupIds: number[]; natureName: string; grade: PetGrade },
  cell: StudGapCell,
): boolean =>
  pairing.grade === cell.grade &&
  pairing.natureName === cell.natureName &&
  pairing.groupIds.includes(cell.groupId);

const ROUTE_RANK = { self: 3, transfer: 2, none: 1 } as const;

const weightOf = (item: Omit<StudCandidate, 'weight'>): number =>
  ROUTE_RANK[item.route] * 100 + item.groupIds.length * 10 + Math.min(item.males, 3);

export interface StudCandidatesInput {
  cell: StudGapCell;
  plans: readonly NestPlan[];
  /** 当前选中的号（不在这个列表里的号算「跨号」） */
  accounts: readonly string[];
  owned: readonly OwnedPet[];
  species: readonly SpeciesEntry[];
}

export function buildStudCandidates({
  cell,
  plans,
  accounts,
  owned,
  species,
}: StudCandidatesInput): StudCandidate[] {
  const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));
  const byGameId = new Map<number, StudCandidate>();

  for (const plan of plans) {
    const isSelf = accounts.includes(plan.account);
    for (const pairing of plan.pairings) {
      if (!matchesCell(pairing, cell)) continue;
      const father = pairing.father;
      const exist = byGameId.get(father.gameId);
      // 同一只公可能被几个号排上：本号优先，其次概率高的
      if (exist && (exist.route === 'self' || !isSelf)) {
        if (exist.route === 'self' || pairing.natureChance <= exist.chance) continue;
      }
      const entry = speciesByGameId.get(father.gameId);
      const groupIds = (entry?.eggGroups ?? []).filter(isBreedableGroup);
      const base = {
        gameId: father.gameId,
        name: speciesDisplayName(entry, father.name),
        groupIds,
        males: countMales(owned, father.gameId),
        route: isSelf ? ('self' as const) : ('transfer' as const),
        sourceAccount: isSelf ? undefined : plan.account,
        chance: pairing.natureChance,
        petKey: pickKeyOf(father.key, owned),
        voiceDb: father.voiceDb ?? null,
        medalBody: father.medalBody ?? null,
        weightPercent: father.weightPercent ?? null,
      };
      byGameId.set(father.gameId, { ...base, weight: weightOf(base) });
    }
  }

  return [...byGameId.values()].sort(
    (a, b) => b.weight - a.weight || a.name.localeCompare(b.name, 'zh-Hans-CN'),
  );
}

const countMales = (owned: readonly OwnedPet[], gameId: number): number =>
  owned.filter((pet) => pet.gameId === gameId && pet.gender === '公').length;

/**
 * `NestPet.key` 是 `账号#账号内序号`；种公阵列的键是 `账号|captureId`。
 * 两者对不上时（比如方案里的父本不是背包里的同一只）返回 null，界面就不写回。
 */
const pickKeyOf = (nestKey: string, owned: readonly OwnedPet[]): string | null => {
  const [account, rawIndex] = nestKey.split('#');
  const index = Number(rawIndex);
  if (!account || !Number.isInteger(index) || index < 0) return null;
  // 方案里的序号是「这个号的宠物列表里的序号」，与按账号筛出来的顺序一致
  const petsOfAccount = owned.filter((pet) => pet.account === account);
  const pet = petsOfAccount[index];
  if (!pet) return null;
  return studMatrixPetKey(pet, owned.indexOf(pet));
};
