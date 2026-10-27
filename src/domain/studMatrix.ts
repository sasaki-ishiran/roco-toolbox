import type { PetGrade, TargetMode } from './petFilters';
import { speciesDisplayName } from './speciesName';
import type { CoverageSlot } from './studCoverage';
import { describeStudTargets } from './studTargets';
import type { OwnedPet, SpeciesEntry } from './types';

/** 阵列里的一只种公（已经按展示优先级排好序） */
export interface StudMatrixPet {
  /** 本机 override 用的稳定键（账号 + 抓包 id；没有 captureId 时退回序号） */
  key: string;
  petIndex: number;
  gameId: number;
  name: string;
  account: string;
  nature: string;
  grade: PetGrade;
  weightPercent?: number;
  voiceDb: number;
  medalBody: string;
  isShiny: boolean;
  isColorful: boolean;
}

export interface StudMatrixCell {
  groupId: number;
  natureName: string;
  /** 该蛋组是否把这一列性格列为目标（false = 淡灰「—」，不参与统计） */
  targeted: boolean;
  candidates: StudMatrixPet[];
}

export interface StudMatrixRow {
  groupId: number;
  groupLabel: string;
  cells: StudMatrixCell[];
}

export interface StudMatrix {
  grade: PetGrade;
  /** 列：当前档位下所有目标性格的并集（出现次数多的在前） */
  natures: string[];
  rows: StudMatrixRow[];
}

export interface BuildStudMatrixInput {
  slots: CoverageSlot[];
  owned: OwnedPet[];
  species: SpeciesEntry[];
  speciesByGameId: Map<number, SpeciesEntry>;
  eggGroupNames: Record<number, string>;
  mode: TargetMode;
  /** 当前 tab 的档位 */
  grade: PetGrade;
}

/** 代表选择的键：档位、蛋组、性格三者定位一格 */
export function studMatrixPickKey(grade: PetGrade, groupId: number, natureName: string): string {
  return `${grade}::${groupId}::${natureName}`;
}

/** 一只种公的稳定键：优先抓包 id，避免重新导入后序号变化 */
export function studMatrixPetKey(pet: OwnedPet, petIndex: number): string {
  return pet.captureId
    ? `${pet.account}|${pet.captureId}`
    : `${pet.account}|${pet.gameId}|${petIndex}`;
}

/** 全局出现的目标性格（出现次数多的在前，同次数保持首次出现顺序） */
function unionNatures(slots: CoverageSlot[]): string[] {
  const count = new Map<string, number>();
  const order: string[] = [];
  for (const slot of slots) {
    if (!count.has(slot.natureName)) order.push(slot.natureName);
    count.set(slot.natureName, (count.get(slot.natureName) ?? 0) + 1);
  }
  return order.sort(
    (a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b),
  );
}

/** 候选排序：体重更满 → 声音更极端 → 账号 → 名字（同档位下都能互换） */
function compareCandidates(a: StudMatrixPet, b: StudMatrixPet): number {
  const weight = (b.weightPercent ?? -1) - (a.weightPercent ?? -1);
  if (weight !== 0) return weight;
  const voice = Math.abs(b.voiceDb) - Math.abs(a.voiceDb);
  if (voice !== 0) return voice;
  return a.account.localeCompare(b.account, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN');
}

/**
 * 种公阵列（2026-10-28）：蛋组（行）× 目标性格（列）× 档位（tab）。
 *
 * 列不是固定八大性格，而是「当前档位下，所有选中蛋组的目标性格并集」：
 * 某组没把这个性格列为目标时，格子 `targeted = false`（界面显示淡灰「—」），
 * 避免用户把「不是目标」误看成「缺种公」。
 */
export function buildStudMatrix(input: BuildStudMatrixInput): StudMatrix {
  const { slots, owned, species, speciesByGameId, eggGroupNames, mode, grade } = input;
  const gradeSlots = slots.filter((slot) => slot.grade === grade);
  const natures = unionNatures(gradeSlots);

  const rowOrder: number[] = [];
  const targeted = new Set<string>();
  for (const slot of gradeSlots) {
    if (!rowOrder.includes(slot.groupId)) rowOrder.push(slot.groupId);
    targeted.add(`${slot.groupId}::${slot.natureName}`);
  }

  const hits = describeStudTargets({ owned, species, slots: gradeSlots, eggGroupNames, mode });
  const byCell = new Map<string, StudMatrixPet[]>();
  for (const hit of hits) {
    if (hit.grade !== grade) continue;
    const pet = owned[hit.petIndex];
    if (!pet) continue;
    for (const target of hit.targets) {
      if (target.grade !== grade) continue;
      const key = `${target.groupId}::${target.natureName}`;
      const list = byCell.get(key) ?? [];
      list.push({
        key: studMatrixPetKey(pet, hit.petIndex),
        petIndex: hit.petIndex,
        gameId: pet.gameId,
        name: speciesDisplayName(speciesByGameId.get(pet.gameId), pet.name),
        account: pet.account,
        nature: pet.nature,
        grade,
        weightPercent: pet.weightPercent,
        voiceDb: pet.voiceDb,
        medalBody: pet.medalBody,
        isShiny: Boolean(pet.isShiny),
        isColorful: Boolean(pet.isColorful),
      });
      byCell.set(key, list);
    }
  }
  for (const list of byCell.values()) list.sort(compareCandidates);

  const rows: StudMatrixRow[] = rowOrder.map((groupId) => ({
    groupId,
    groupLabel: eggGroupNames[groupId] ?? `蛋组${groupId}`,
    cells: natures.map((natureName) => {
      const key = `${groupId}::${natureName}`;
      return {
        groupId,
        natureName,
        targeted: targeted.has(key),
        candidates: byCell.get(key) ?? [],
      };
    }),
  }));

  return { grade, natures, rows };
}

/**
 * 阵列一格实际展示的那只：本机记住的代表还在候选里就用它，否则自动取排序第一只。
 * 找不到候选返回 null。
 */
export function representativeOf(
  cell: StudMatrixCell,
  picks: Record<string, string> | undefined,
  grade: PetGrade,
): StudMatrixPet | null {
  const pickedKey = picks?.[studMatrixPickKey(grade, cell.groupId, cell.natureName)];
  const picked = pickedKey ? cell.candidates.find((pet) => pet.key === pickedKey) : undefined;
  return picked ?? cell.candidates[0] ?? null;
}
