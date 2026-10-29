import { bodyGradeOf } from '../shared/bodySize.js';
import type { DemandBody, DemandCriteria, DemandVoice } from '../shared/collectionGroups';
import { isBreedableGroup } from './eggs';
import type { AccountSnapshot } from './parseBackup';
import type { OwnedPet, SpeciesEntry } from './types';

/**
 * 需求口径的纯函数：本地背包匹配、同账号可孵、成员数据新鲜度。
 *
 * 空字符串 = 不挑 / 不限，**直接跳过该字段**，不是去找空值。
 * 这里不读网络、不写库；只服务客户端校验与展示。
 */

export const FRESH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PetMatch {
  snapshot: AccountSnapshot;
  pet: OwnedPet;
}

export interface DemandSupply {
  /** 只认**配对孵蛋**；已有现货但配不出另一半时不算能接单（2026-10-28 用户口径）。 */
  kind: 'breedable' | 'none';
  accountKey?: string;
  /** 可孵时用来配对的母本 / 种公，便于界面展示「谁能孵」。 */
  motherGameId?: number;
  maleGameId?: number;
}

const accountKeyOfSnapshot = (snapshot: AccountSnapshot): string =>
  snapshot.accountKey ?? `uid:${snapshot.gameId}`;

const bodyOfPet = (pet: OwnedPet): string => bodyGradeOf(pet);

const matchesDemandVoice = (pet: OwnedPet, voice: string): boolean => {
  if (!voice) return true;
  if (voice === '+100') return pet.voiceDb === 100;
  if (voice === '-100') return pet.voiceDb === -100;
  if (voice === '婉转声') return pet.voiceDb >= 96;
  if (voice === '粗嗓门') return pet.voiceDb <= -96;
  return true;
};

/**
 * 亲本是否满足需求里选的体型 / 声音。
 *
 * 注意是**父母双方都要满足**：声音遗传是 (父 + 母) / 2 向零取整，
 * 要 +100 / -100 必须父母双双同号满分；体型同理（双大块头才出大块头蛋）。
 * 体型认奖牌，也认身高到顶 / 到底（2026-10-26 用户口径）。
 */
const matchesParentGrade = (pet: OwnedPet, criteria: DemandCriteria): boolean =>
  (!criteria.body || bodyOfPet(pet) === criteria.body) &&
  matchesDemandVoice(pet, criteria.voice);

/** 这只个体是否满足需求的所有已选字段（空字段跳过）。 */
export function petMatchesDemand(
  pet: OwnedPet,
  criteria: DemandCriteria,
  eggOfGameId: ReadonlyMap<number, number>,
): boolean {
  if (eggOfGameId.get(pet.gameId) !== criteria.eggGameId) return false;
  if (criteria.nature && pet.nature !== criteria.nature) return false;
  if (criteria.gender && pet.gender !== criteria.gender) return false;
  if (criteria.body && bodyOfPet(pet) !== criteria.body) return false;
  if (!matchesDemandVoice(pet, criteria.voice)) return false;
  return true;
}

export function eggMapOf(species: readonly SpeciesEntry[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const entry of species) {
    if (entry.eggGameId != null && entry.eggGameId > 0) map.set(entry.gameId, entry.eggGameId);
  }
  return map;
}

export function findMatchingPet(
  snapshots: readonly AccountSnapshot[],
  criteria: DemandCriteria,
  species: readonly SpeciesEntry[],
): PetMatch | null {
  const eggOfGameId = eggMapOf(species);
  for (const snapshot of snapshots) {
    for (const pet of snapshot.pets) {
      if (petMatchesDemand(pet, criteria, eggOfGameId)) return { snapshot, pet };
    }
  }
  return null;
}

/** 本机是否有现货（完全匹配的个体）。 */
export function hasStockForDemand(
  snapshots: readonly AccountSnapshot[],
  criteria: DemandCriteria,
  species: readonly SpeciesEntry[],
): boolean {
  return findMatchingPet(snapshots, criteria, species) != null;
}

interface EggGroupInfo {
  groups: number[];
  maleCapable: boolean;
}

const eggInfoOf = (species: readonly SpeciesEntry[]): Map<number, EggGroupInfo> => {
  const map = new Map<number, EggGroupInfo>();
  for (const entry of species) {
    if (entry.eggGameId !== entry.gameId) continue;
    map.set(entry.gameId, {
      groups: (entry.eggGroups ?? []).filter(isBreedableGroup),
      maleCapable: entry.maleCapable === true,
    });
  }
  return map;
};

/**
 * 本机同账号能否孵出这条需求。
 *
 * - **只认配对孵蛋**：必须找**同账号**的「该蛋母本 + 同蛋组公」，且父母双方都满足体型 / 声音；
 *   自己已有一只、但配不出另一只时不算能接（2026-10-28 用户口径：不交割精灵）；
 * - 性格指定时，父母至少一方带目标性格（学院小窝 100% 遗传）；
 * - 需求为公时，该蛋物种必须能出公（`maleCapable`）。
 *
 * 不能跨账号拼父母；公也不能只按蛋组筛——非大婉公 + 大婉母孵不出大婉蛋。
 */
export function findBreedableSupply(
  snapshots: readonly AccountSnapshot[],
  criteria: DemandCriteria,
  species: readonly SpeciesEntry[],
): DemandSupply {
  const eggOfGameId = eggMapOf(species);

  const infoByGameId = eggInfoOf(species);
  /** 所有形态的蛋组：公本只要是同蛋组即可，不要求是蛋物种本体（进化形态也能配）。 */
  const groupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    groupsByGameId.set(entry.gameId, (entry.eggGroups ?? []).filter(isBreedableGroup));
  }
  const info = infoByGameId.get(criteria.eggGameId);
  if (!info || info.groups.length === 0) return { kind: 'none' };
  if (criteria.gender === '公' && !info.maleCapable) return { kind: 'none' };

  for (const snapshot of snapshots) {
    const females = snapshot.pets.filter(
      (pet) =>
        eggOfGameId.get(pet.gameId) === criteria.eggGameId &&
        pet.gender === '母' &&
        matchesParentGrade(pet, criteria),
    );
    if (females.length === 0) continue;
    const males = snapshot.pets.filter(
      (pet) =>
        pet.gender === '公' &&
        matchesParentGrade(pet, criteria) &&
        (groupsByGameId.get(pet.gameId) ?? []).some((group) =>
          info.groups.includes(group),
        ),
    );
    if (males.length === 0) continue;

    const female = females.find(
      (pet) => !criteria.nature || pet.nature === criteria.nature,
    ) ?? females[0];
    const male = males.find(
      (pet) => !criteria.nature || pet.nature === criteria.nature,
    ) ?? males[0];
    // 性格指定时至少一方带目标性格；都没带就不算可孵
    if (criteria.nature && female.nature !== criteria.nature && male.nature !== criteria.nature) {
      continue;
    }
    return {
      kind: 'breedable',
      accountKey: accountKeyOfSnapshot(snapshot),
      motherGameId: female.gameId,
      maleGameId: male.gameId,
    };
  }
  return { kind: 'none' };
}

/**
 * 种公需求在现有需求表里的键：用**负数蛋 id** 表示蛋组（`-groupId`）。
 * 这样母本需求（正蛋 id）与种公需求（负蛋组 id）共用一张表 / 一套接口，
 * 不需要改主键；`eggGameId < 0` 即种公需求。
 */
export const isStudDemandKey = (eggGameId: number): boolean => eggGameId < 0;
export const eggGroupIdOfDemand = (eggGameId: number): number => -eggGameId;

export interface StudDemandSupply extends DemandSupply {
  /** 满足条件的蛋（蛋组里任意一只）。 */
  eggGameId?: number;
  /** 接单方具体用哪只母本 / 哪只公配对（便于直接显示怎么配窝）。 */
  mother?: PetMatch;
  male?: PetMatch;
}

/** 组内任意一只蛋里，是否能凑出同账号、双方同档位的一对。 */
export function findStudBreedableSupply(
  snapshots: readonly AccountSnapshot[],
  demand: { eggGameId: number; nature: string; body: string; voice: string },
  species: readonly SpeciesEntry[],
): StudDemandSupply {
  if (!isStudDemandKey(demand.eggGameId)) return { kind: 'none' };
  const groupId = eggGroupIdOfDemand(demand.eggGameId);
  const eggs = species.filter(
    (entry) =>
      entry.eggGameId != null &&
      entry.eggGameId === entry.gameId &&
      (entry.eggGroups ?? []).some((group) => group === groupId && isBreedableGroup(group)),
  );
  for (const egg of eggs) {
    const supply = findBreedableSupply(
      snapshots,
      {
        eggGameId: egg.gameId,
        nature: demand.nature,
        gender: '公',
        body: demand.body as DemandBody,
        voice: demand.voice as DemandVoice,
      },
      species,
    );
    if (supply.kind === 'none') continue;
    const snapshot = snapshots.find(
      (item) => accountKeyOfSnapshot(item) === supply.accountKey,
    );
    /** 同 gameId 可能有多只（性格不同）：优先挑带目标性格的那只，展示的配对才孵得出来。 */
    const pickPet = (gameId: number, gender: '公' | '母'): OwnedPet | undefined => {
      const candidates = (snapshot?.pets ?? []).filter(
        (pet) => pet.gameId === gameId && pet.gender === gender,
      );
      return (
        candidates.find((pet) => !demand.nature || pet.nature === demand.nature) ??
        candidates[0]
      );
    };
    if (supply.motherGameId == null || supply.maleGameId == null) {
      return { ...supply, eggGameId: egg.gameId };
    }
    const mother = pickPet(supply.motherGameId, '母');
    const male = pickPet(supply.maleGameId, '公');
    return {
      ...supply,
      eggGameId: egg.gameId,
      mother: snapshot && mother ? { snapshot, pet: mother } : undefined,
      male: snapshot && male ? { snapshot, pet: male } : undefined,
    };
  }
  return { kind: 'none' };
}

/** 需求方背包里是否已经有「该蛋组任意物种 + 公 + 性格 + 体型 + 声音」的个体。 */
export function hasStockForStudDemand(
  snapshots: readonly AccountSnapshot[],
  demand: { eggGameId: number; nature: string; body: string; voice: string },
  species: readonly SpeciesEntry[],
): boolean {
  if (!isStudDemandKey(demand.eggGameId)) return false;
  const groupId = eggGroupIdOfDemand(demand.eggGameId);
  const groupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    groupsByGameId.set(
      entry.gameId,
      (entry.eggGroups ?? []).filter(isBreedableGroup),
    );
  }
  for (const snapshot of snapshots) {
    for (const pet of snapshot.pets) {
      if (pet.gender !== '公') continue;
      if (demand.nature && pet.nature !== demand.nature) continue;
      if (demand.body && bodyOfPet(pet) !== demand.body) continue;
      if (!matchesDemandVoice(pet, demand.voice)) continue;
      if ((groupsByGameId.get(pet.gameId) ?? []).includes(groupId)) return true;
    }
  }
  return false;
}

export interface MemberFreshness {
  published: boolean;
  /** 最旧账号的未更新天数；没有账号时为 null。 */
  days: number | null;
  stale: boolean;
}

/** 新鲜度只看这两份摘要的账号导出时间；母本组 / 种公组的成员结构都能直接用。 */
export interface FreshnessMemberLike {
  resource?: { accounts?: readonly { sourceExportedAt: string }[] } | null;
  studResource?: { accounts?: readonly { sourceExportedAt: string }[] } | null;
}

/**
 * 成员数据新鲜度：按账号的 `sourceExportedAt` 算。
 * 只要有一个账号旧，就不能下「全组都没有」的结论，因此用最旧账号判定。
 */
export function memberFreshness(
  member: FreshnessMemberLike,
  now: number = Date.now(),
  freshDays: number = FRESH_DAYS,
): MemberFreshness {
  const stamps = [
    ...(member.resource?.accounts ?? []).map((account) => account.sourceExportedAt),
    ...(member.studResource?.accounts ?? []).map((account) => account.sourceExportedAt),
  ];
  if (stamps.length === 0) return { published: false, days: null, stale: true };
  const oldest = Math.min(...stamps.map((value) => Date.parse(value)).filter(Number.isFinite));
  if (!Number.isFinite(oldest)) return { published: true, days: null, stale: true };
  const days = Math.max(0, Math.floor((now - oldest) / DAY_MS));
  return { published: true, days, stale: days > freshDays };
}

export interface GroupFreshness {
  fresh: number;
  stale: number;
  total: number;
  staleMemberIds: string[];
}

export function groupFreshness(
  members: readonly (FreshnessMemberLike & { accountId: string })[],
  now: number = Date.now(),
): GroupFreshness {
  const staleMemberIds = members
    .filter((member) => memberFreshness(member, now).stale)
    .map((member) => member.accountId);
  return {
    fresh: members.length - staleMemberIds.length,
    stale: staleMemberIds.length,
    total: members.length,
    staleMemberIds,
  };
}
