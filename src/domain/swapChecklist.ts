import { isBreedableGroup } from './eggs';
import { isQualifiedMother, type MotherCriteria } from './motherCriteria';
import { speciesDisplayName } from './speciesName';
import type { OwnedPet, SpeciesEntry } from './types';

/**
 * 「互换清单」：按账号阵营算三份大婉母本清单。
 *
 * - 单位是「蛋」（`eggGameId`）：同一颗蛋下的形态合并算一个目标；
 * - 达标 = 母 + 所选体型 + 所选声音。默认传 `BIG_WAN_CRITERIA`（大块头 + 100dB）；
 * - 两边都有的蛋 = 已覆盖，不进任何清单（没什么可换的）。
 */
export interface ChecklistItem {
  /** 蛋物种的 gameId（= eggGameId）；也是同步状态的键 */
  eggGameId: number;
  /** 展示名（官方名优先） */
  name: string;
  /** 哪些账号有这枚「达标母本」（显示名） */
  accounts: string[];
}

export interface MotherChecklist {
  /** 对方有、我没有 —— 他能给我孵 */
  heCanHatch: ChecklistItem[];
  /** 我有、对方没有 —— 我能给他孵 */
  iCanHatch: ChecklistItem[];
  /** 两边都没有 */
  neither: ChecklistItem[];
}

export interface BuildMotherChecklistInput {
  species: SpeciesEntry[];
  owned: OwnedPet[];
  /** 我方账号（与 `OwnedPet.account` 一致的显示名）；其余账号都算对方 */
  mineAccounts: readonly string[];
  criteria: MotherCriteria;
}

/** 大婉 = 大块头 + 满音（游戏里说的「大婉满分」）。 */
export const BIG_WAN_CRITERIA: MotherCriteria = { bodies: ['大块头'], voices: ['+100'] };

const byName = (a: ChecklistItem, b: ChecklistItem): number =>
  a.name.localeCompare(b.name, 'zh-Hans-CN');

export function buildMotherChecklist(input: BuildMotherChecklistInput): MotherChecklist {
  const { species, owned, mineAccounts, criteria } = input;

  const byGame = new Map<number, SpeciesEntry>();
  /** 蛋物种：只有 `eggGameId === gameId` 的图鉴条目才代表一颗蛋 */
  const eggSpecies = new Map<number, SpeciesEntry>();
  for (const entry of species) {
    byGame.set(entry.gameId, entry);
    if (entry.eggGameId != null && entry.eggGameId === entry.gameId) {
      eggSpecies.set(entry.gameId, entry);
    }
  }

  const mine = new Set(mineAccounts);
  const coverage = new Map<number, Set<string>>();
  for (const pet of owned) {
    const entry = byGame.get(pet.gameId);
    if (!entry) continue;
    const chain = entry.eggGameId;
    if (chain == null || !eggSpecies.has(chain)) continue;
    if (!(entry.eggGroups ?? []).some(isBreedableGroup)) continue;
    if (!isQualifiedMother(pet, criteria)) continue;
    const accounts = coverage.get(chain) ?? new Set<string>();
    accounts.add(pet.account);
    coverage.set(chain, accounts);
  }

  const heCanHatch: ChecklistItem[] = [];
  const iCanHatch: ChecklistItem[] = [];
  const neither: ChecklistItem[] = [];

  for (const [eggGameId, entry] of eggSpecies) {
    if (!(entry.eggGroups ?? []).some(isBreedableGroup)) continue; // 未发现组的蛋不可孵
    const accounts = [...(coverage.get(eggGameId) ?? [])].sort();
    const mineHas = accounts.some((account) => mine.has(account));
    const theirsHas = accounts.some((account) => !mine.has(account));
    if (mineHas && theirsHas) continue; // 两边都有 = 已覆盖
    const item: ChecklistItem = {
      eggGameId,
      name: speciesDisplayName(entry, entry.name),
      accounts,
    };
    if (mineHas) iCanHatch.push(item);
    else if (theirsHas) heCanHatch.push(item);
    else neither.push(item);
  }

  heCanHatch.sort(byName);
  iCanHatch.sort(byName);
  neither.sort(byName);
  return { heCanHatch, iCanHatch, neither };
}

/* ---------- 每条的勾选 / 归属状态（两个人共享） ---------- */

export type ChecklistOwner = 'mine' | 'theirs' | null;

export interface ChecklistItemState {
  /** 这条分给谁去收；null = 没分 */
  owner: ChecklistOwner;
  /** 是否已经收到 */
  done: boolean;
  /** 最后修改时间（毫秒），合并时大的赢 */
  at: number;
}

/** 键 = `eggGameId`（字符串） */
export type ChecklistState = Record<string, ChecklistItemState>;

/**
 * 按条合并：`at` 大的赢；时间相同保留本地，除非对方勾了「已收」而本地没勾
 * （同一毫秒内一人勾上一人取消的概率极低，这里按「不丢进度」处理）。
 */
export function mergeChecklistState(
  local: ChecklistState,
  incoming: ChecklistState,
): ChecklistState {
  const merged: ChecklistState = { ...local };
  for (const [key, next] of Object.entries(incoming)) {
    const current = merged[key];
    if (!current || next.at > current.at) {
      merged[key] = next;
      continue;
    }
    if (next.at === current.at && next.done && !current.done) {
      merged[key] = { ...current, done: true };
    }
  }
  return merged;
}
