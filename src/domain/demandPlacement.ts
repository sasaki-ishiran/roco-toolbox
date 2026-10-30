import { bodyGradeOf } from '../shared/bodySize.js';
import type { DemandCriteria } from '../shared/collectionGroups';
import { isBreedableGroup } from './eggs';
import { matchesVoiceOption } from './petFilters';
import type { AccountSnapshot } from './parseBackup';
import type { OwnedPet, SpeciesEntry } from './types';

/**
 * 需求单上窝分配（需求中心二期，2026-10-30）。
 *
 * 把「我接的未完成需求」变成按账号的上窝名单。思路沿用家园配窝（`nestPlan`）：
 * **窝是资源、配对是边**——一只精灵只占 1 窝；优先 1:1，只有窝不够 / 种公不够时才允许
 * 一只亲本服务第二条单（1:2）。学院小窝只有 1 只、最多 2 个配对方，且只遗传它自己的性格。
 *
 * **不看家园现状**（用户 2026-10-30 口径）：这里只回答「这些单该怎么上窝才满足需求」，
 * 至于那只精灵现在在哪个窝、是不是已经在学院小窝，都与分配无关——名单本身就是
 * 「该把哪只挪到哪个窝」。所以学院小窝按「谁自带目标性格」来派，而不是看谁已经住进去。
 *
 * 与 `findBreedableSupply` 的关系：那边的判定口径在这里逐条沿用（后代随母方、父母双方
 * 都要满足体型/声音、性格至少一方带），区别是这里做**全局分配**，不会让同一只精灵
 * 在两条单里各占一个窝。
 */

/** 默认每账号窝数：1 个学院小窝 + 10 个普通小窝。 */
export const DEFAULT_PLACEMENT_NESTS = 11;

/** 一只亲本最多服务几条单（用户口径：优先 1:1，不够时 1:2）。 */
export const MAX_PLACEMENT_SHARES = 2;

/**
 * 一个账号只有 1 个学院小窝：**学院那只也只能有一只**，但它可以和 2 只异性配对（1:2），
 * 所以同一只精灵最多服务 2 条单（用户 2026-10-30 口径：共用同一只精灵可以，不能出现第二只绿窝）。
 */
export const MAX_ACADEMY_PARTNERS = 2;

export interface DemandPlacementDemand extends DemandCriteria {
  groupId: string;
  groupName?: string;
  demanderAccountId: string;
  demanderName?: string;
  /** 接单时间：先到先得。 */
  claimedAt: number;
  /** 需求行的版本号（界面「已上窝」记忆按它区分同款重发）。 */
  version?: number;
}

export interface DemandPlacementParent {
  accountKey: string;
  pet: OwnedPet;
}

export type DemandTier = 'academy' | 'normal60' | 'normal30';

export interface DemandPlacementOption {
  mother: DemandPlacementParent;
  father: DemandPlacementParent;
  tier: DemandTier;
  /** 目标性格的遗传概率：学院 1 / 普通同性格 0.6 / 普通单方 0.3。 */
  natureChance: number;
  /** 这条单新占几个窝（0 = 父母都已在方案里）。 */
  newNests: number;
  /** 学院方案时：哪一方要放进学院小窝（另一只放普通窝）。 */
  academyResident: 'mother' | 'father' | null;
  /** 被复用的亲本（1:2 时非空），值是父母各自的个体键。 */
  sharedKeys: string[];
}

export interface DemandPlacement extends DemandPlacementOption {
  demand: DemandPlacementDemand;
  accountKey: string;
  /** 可行配对候选（第一条就是已选中的），界面右上角的数字角标用它。 */
  options: DemandPlacementOption[];
}

export type DemandPlacementReason =
  | 'impossible'
  | 'no-mother'
  | 'no-father'
  | 'nature'
  | 'no-room';

export interface DemandPlacementSkip {
  demand: DemandPlacementDemand;
  reason: DemandPlacementReason;
  message: string;
}

export interface DemandPlacementAccount {
  accountKey: string;
  label: string;
  placements: DemandPlacement[];
  nestsUsed: number;
  nestsTotal: number;
}

export interface DemandPlacementResult {
  accounts: DemandPlacementAccount[];
  /** 所有账号都排不上的单（不属于任何账号）。 */
  unassigned: DemandPlacementSkip[];
  totalDemands: number;
  placedCount: number;
}

export interface DemandPlacementInput {
  demands: readonly DemandPlacementDemand[];
  snapshots: readonly AccountSnapshot[];
  species: readonly SpeciesEntry[];
  nestCount?: number;
}

interface Target {
  /** 目标蛋血脉的蛋物种 gameId（种公单可能有多个）。 */
  eggIds: number[];
  /** 目标蛋组：公本必须属于其中之一。 */
  groups: number[];
}

interface EggInfo {
  groups: number[];
  maleCapable: boolean;
}

const accountKeyOfSnapshot = (snapshot: AccountSnapshot): string =>
  snapshot.accountKey ?? (snapshot.gameId > 0 ? `uid:${snapshot.gameId}` : `name:${snapshot.accountName}`);

const groupsOf = (entry: SpeciesEntry | undefined): number[] =>
  (entry?.eggGroups ?? []).filter(isBreedableGroup);

const matchesGrade = (pet: OwnedPet, criteria: DemandCriteria): boolean =>
  (!criteria.body || bodyGradeOf(pet) === criteria.body) &&
  (!criteria.voice || matchesVoiceOption(pet.voiceDb, criteria.voice));

interface Chip {
  pet: OwnedPet;
  key: string;
}

interface AccountState {
  accountKey: string;
  label: string;
  pets: Chip[];
  usage: Map<string, number>;
  used: Set<string>;
  /** 学院小窝里那只的个体键（谁都不住时是 null——不看家园现状，按需求派）。 */
  academyPetKey: string | null;
  /** 学院那只已经服务了几条单（上限 MAX_ACADEMY_PARTNERS：一只精灵可以 1:2）。 */
  academyPartners: number;
  /** 学院簇（那只 + 它的配对方）不能再出现在普通配对里。 */
  academyReserved: Set<string>;
  /** 已经被普通配对用掉的精灵，不能再当学院配对方。 */
  normalUsed: Set<string>;
  speciesByGameId: Map<number, SpeciesEntry>;
  eggOfGameId: Map<number, number>;
  placements: DemandPlacement[];
}

interface PairPick {
  mother: Chip;
  father: Chip;
  tier: DemandTier;
  natureChance: number;
  newNests: number;
  academyResident: 'mother' | 'father' | null;
  sharedKeys: string[];
}

interface PairPickResult {
  best: PairPick;
  options: PairPick[];
}

function resolveTarget(
  demand: DemandPlacementDemand,
  species: readonly SpeciesEntry[],
  eggInfo: Map<number, EggInfo>,
): Target | null {
  if (demand.eggGameId > 0) {
    const info = eggInfo.get(demand.eggGameId);
    if (!info || info.groups.length === 0) return null;
    if (demand.gender === '公' && !info.maleCapable) return null;
    return { eggIds: [demand.eggGameId], groups: info.groups };
  }
  const groupId = -demand.eggGameId;
  if (!Number.isFinite(groupId) || groupId <= 0) return null;
  const eggs = species.filter(
    (entry) =>
      entry.eggGameId != null &&
      entry.eggGameId === entry.gameId &&
      groupsOf(entry).includes(groupId),
  );
  const usable = demand.gender === '公' ? eggs.filter((entry) => entry.maleCapable === true) : eggs;
  if (usable.length === 0) return null;
  return { eggIds: usable.map((entry) => entry.gameId), groups: [groupId] };
}

function isMotherCandidate(chip: Chip, target: Target, demand: DemandPlacementDemand, state: AccountState): boolean {
  const pet = chip.pet;
  if (pet.gender !== '母') return false;
  if ((state.eggOfGameId.get(pet.gameId) ?? -1) !== -1) {
    if (!target.eggIds.includes(state.eggOfGameId.get(pet.gameId) as number)) return false;
  } else if (!target.eggIds.includes(pet.gameId)) {
    return false;
  }
  return matchesGrade(pet, demand);
}

function isFatherCandidate(chip: Chip, target: Target, demand: DemandPlacementDemand, state: AccountState): boolean {
  const pet = chip.pet;
  if (pet.gender !== '公') return false;
  const groups = groupsOf(state.speciesByGameId.get(pet.gameId));
  if (!groups.some((group) => target.groups.includes(group))) return false;
  return matchesGrade(pet, demand);
}

function pickPair(
  target: Target,
  demand: DemandPlacementDemand,
  state: AccountState,
  nestCount: number,
  allowSecondShare: boolean,
): PairPickResult | null {
  const mothers = state.pets.filter((chip) => isMotherCandidate(chip, target, demand, state));
  const fathers = state.pets.filter((chip) => isFatherCandidate(chip, target, demand, state));
  const picks: Array<PairPick & { bothNature: number }> = [];
  const academyHasRoom = state.academyPartners < MAX_ACADEMY_PARTNERS;
  const academyFree = state.academyPetKey === null;

  for (const mother of mothers) {
    for (const father of fathers) {
      if (mother.key === father.key) continue;
      if (mother.pet.gender === father.pet.gender) continue;

      const natureOk =
        !demand.nature ||
        mother.pet.nature === demand.nature ||
        father.pet.nature === demand.nature;
      if (!natureOk) continue;

      const motherUsage = state.usage.get(mother.key) ?? 0;
      const fatherUsage = state.usage.get(father.key) ?? 0;
      const motherIsResident = state.academyPetKey === mother.key;
      const fatherIsResident = state.academyPetKey === father.key;

      let tier: DemandTier;
      let academyResident: 'mother' | 'father' | null = null;
      if (motherIsResident || fatherIsResident) {
        /**
         * 学院那只只传自己的性格（用户口径）：性格正好等于目标性格时这条单才有 100% 收益，
         * 否则它对这条单毫无帮助，换成普通配对。
         */
        const resident = motherIsResident ? mother : father;
        const partner = motherIsResident ? father : mother;
        if (!demand.nature || resident.pet.nature !== demand.nature) continue;
        if (!academyHasRoom) continue;
        // 学院簇要干净：配对方不能已经被普通配对用过，否则绿窝蛋 / 普通蛋分不清。
        if (state.normalUsed.has(partner.key)) continue;
        tier = 'academy';
        academyResident = motherIsResident ? 'mother' : 'father';
      } else if (state.academyReserved.has(mother.key) || state.academyReserved.has(father.key)) {
        // 学院簇里的精灵不再参与普通配对（宁可少配一条，也不弄错蛋的身份）。
        continue;
      } else if (
        academyFree &&
        academyHasRoom &&
        demand.nature &&
        motherUsage === 0 &&
        fatherUsage === 0 &&
        (mother.pet.nature === demand.nature || father.pet.nature === demand.nature)
      ) {
        /**
         * 学院小窝还空着：**不看家园现状**，谁自带目标性格就把谁派进学院小窝
         * （100% 遗传性格）。不挑性格的单不吃这个优势，留给后面真正需要的单。
         */
        tier = 'academy';
        academyResident = mother.pet.nature === demand.nature ? 'mother' : 'father';
      } else {
        tier =
          !demand.nature ||
          (mother.pet.nature === demand.nature && father.pet.nature === demand.nature)
            ? 'normal60'
            : 'normal30';
      }

      const limit = allowSecondShare ? MAX_PLACEMENT_SHARES : 1;
      if (motherUsage >= limit || fatherUsage >= limit) continue;

      const newNests =
        (state.used.has(mother.key) ? 0 : 1) + (state.used.has(father.key) ? 0 : 1);
      if (state.used.size + newNests > nestCount) continue;

      const sharedKeys: string[] = [];
      if (motherUsage > 0) sharedKeys.push(mother.key);
      if (fatherUsage > 0) sharedKeys.push(father.key);

      const bothNature =
        (demand.nature && mother.pet.nature === demand.nature ? 1 : 0) +
        (demand.nature && father.pet.nature === demand.nature ? 1 : 0);
      const natureChance = tier === 'academy' ? 1 : tier === 'normal60' ? 0.6 : 0.3;

      picks.push({
        mother,
        father,
        tier,
        natureChance,
        newNests,
        academyResident,
        sharedKeys,
        bothNature,
      });
    }
  }

  if (picks.length === 0) return null;
  picks.sort(
    (a, b) =>
      b.natureChance - a.natureChance ||
      a.newNests - b.newNests ||
      b.bothNature - a.bothNature ||
      a.mother.key.localeCompare(b.mother.key) ||
      a.father.key.localeCompare(b.father.key),
  );
  const best = picks[0];
  const options: PairPick[] = picks.slice(0, 5).map((pick) => ({
    mother: pick.mother,
    father: pick.father,
    tier: pick.tier,
    natureChance: pick.natureChance,
    newNests: pick.newNests,
    academyResident: pick.academyResident,
    sharedKeys: pick.sharedKeys,
  }));
  return { best, options };
}

function diagnose(
  target: Target | null,
  demand: DemandPlacementDemand,
  state: AccountState,
): DemandPlacementReason {
  if (!target) return 'impossible';
  const mothers = state.pets.filter((chip) => isMotherCandidate(chip, target, demand, state));
  if (mothers.length === 0) return 'no-mother';
  const fathers = state.pets.filter((chip) => isFatherCandidate(chip, target, demand, state));
  if (fathers.length === 0) return 'no-father';
  const hasNaturePair = mothers.some((mother) =>
    fathers.some(
      (father) =>
        mother.key !== father.key &&
        (!demand.nature || mother.pet.nature === demand.nature || father.pet.nature === demand.nature),
    ),
  );
  return hasNaturePair ? 'no-room' : 'nature';
}

const REASON_MESSAGES: Record<DemandPlacementReason, string> = {
  impossible: '这颗蛋（或蛋组）本身孵不出要求的性别',
  'no-mother': '本机没有满足条件的母本',
  'no-father': '本机没有满足条件的种公',
  nature: '没有带目标性格的亲本',
  'no-room': '窝位不够，或可用的精灵已经被别的单占用',
};

const REASON_RANK: Record<DemandPlacementReason, number> = {
  impossible: 0,
  'no-mother': 1,
  'no-father': 2,
  nature: 3,
  'no-room': 4,
};

export function buildDemandPlacements(input: DemandPlacementInput): DemandPlacementResult {
  const nestCount = input.nestCount ?? DEFAULT_PLACEMENT_NESTS;
  const speciesByGameId = new Map<number, SpeciesEntry>();
  const eggOfGameId = new Map<number, number>();
  const eggInfo = new Map<number, EggInfo>();
  for (const entry of input.species) {
    speciesByGameId.set(entry.gameId, entry);
    if (entry.eggGameId != null && entry.eggGameId > 0) {
      eggOfGameId.set(entry.gameId, entry.eggGameId);
      if (entry.eggGameId === entry.gameId) {
        eggInfo.set(entry.gameId, {
          groups: groupsOf(entry),
          maleCapable: entry.maleCapable === true,
        });
      }
    }
  }

  const states: AccountState[] = input.snapshots.map((snapshot) => {
    const accountKey = accountKeyOfSnapshot(snapshot);
    const chips = snapshot.pets.map((pet, index) => ({ pet, key: `${accountKey}#${index}` }));
    return {
      accountKey,
      label: snapshot.accountName,
      pets: chips,
      usage: new Map(),
      used: new Set(),
      academyPetKey: null,
      academyPartners: 0,
      academyReserved: new Set(),
      normalUsed: new Set(),
      speciesByGameId,
      eggOfGameId,
      placements: [],
    };
  });

  const demands = [...input.demands].sort(
    (a, b) => a.claimedAt - b.claimedAt || a.groupId.localeCompare(b.groupId),
  );

  const unassigned: DemandPlacementSkip[] = [];

  const commit = (
    state: AccountState,
    demand: DemandPlacementDemand,
    result: PairPickResult,
  ) => {
    const pick = result.best;
    state.usage.set(pick.mother.key, (state.usage.get(pick.mother.key) ?? 0) + 1);
    state.usage.set(pick.father.key, (state.usage.get(pick.father.key) ?? 0) + 1);
    state.used.add(pick.mother.key);
    state.used.add(pick.father.key);

    if (pick.tier === 'academy') {
      // 学院只有 1 个窝位：第一次派出去的那只就是「学院那只」，之后只能它继续服务。
      if (state.academyPetKey === null) {
        state.academyPetKey = pick.academyResident === 'mother' ? pick.mother.key : pick.father.key;
      }
      state.academyPartners += 1;
      state.academyReserved.add(pick.mother.key);
      state.academyReserved.add(pick.father.key);
    } else {
      state.normalUsed.add(pick.mother.key);
      state.normalUsed.add(pick.father.key);
    }

    state.placements.push({
      demand,
      accountKey: state.accountKey,
      mother: { accountKey: state.accountKey, pet: pick.mother.pet },
      father: { accountKey: state.accountKey, pet: pick.father.pet },
      tier: pick.tier,
      natureChance: pick.natureChance,
      newNests: pick.newNests,
      academyResident: pick.academyResident,
      sharedKeys: pick.sharedKeys,
      options: result.options.map((option) => ({
        mother: { accountKey: state.accountKey, pet: option.mother.pet },
        father: { accountKey: state.accountKey, pet: option.father.pet },
        tier: option.tier,
        natureChance: option.natureChance,
        newNests: option.newNests,
        academyResident: option.academyResident,
        sharedKeys: option.sharedKeys,
      })),
    });
  };

  for (const demand of demands) {
    const target = resolveTarget(demand, input.species, eggInfo);
    if (!target) {
      unassigned.push({
        demand,
        reason: 'impossible',
        message: REASON_MESSAGES.impossible,
      });
      continue;
    }

    let placed = false;
    // 第一轮：严格 1:1（父母都没被任何单使用过）。
    for (const state of states) {
      const pick = pickPair(target, demand, state, nestCount, false);
      if (!pick) continue;
      commit(state, demand, pick);
      placed = true;
      break;
    }
    if (placed) continue;

    // 第二轮：允许 1:2（复用已被占用一次的亲本）。
    for (const state of states) {
      const pick = pickPair(target, demand, state, nestCount, true);
      if (!pick) continue;
      commit(state, demand, pick);
      placed = true;
      break;
    }
    if (placed) continue;

    // 都排不上：取最有信息量的原因，挂到「排不上」组。
    let reason: DemandPlacementReason = 'no-room';
    let best = Number.POSITIVE_INFINITY;
    for (const state of states) {
      const candidate = diagnose(target, demand, state);
      if (REASON_RANK[candidate] < best) {
        best = REASON_RANK[candidate];
        reason = candidate;
      }
    }
    unassigned.push({ demand, reason, message: REASON_MESSAGES[reason] });
  }

  const accounts = states.map((state) => ({
    accountKey: state.accountKey,
    label: state.label,
    placements: state.placements,
    nestsUsed: state.used.size,
    nestsTotal: nestCount,
  }));

  return {
    accounts,
    unassigned,
    totalDemands: demands.length,
    placedCount: accounts.reduce((sum, account) => sum + account.placements.length, 0),
  };
}
