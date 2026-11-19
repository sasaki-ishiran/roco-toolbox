import { breedingBodyGradeOf } from '../shared/bodySize.js';
import type { DemandBody, DemandCriteria, DemandVoice } from '../shared/collectionGroups';
import { isBreedableGroup } from './eggs';
import { genderShareOf } from './genderRatio';
import { matchesVoiceOption } from './petFilters';
import type { AccountSnapshot } from './parseBackup';
import { defaultEggNatures } from './recommendedNatures';
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
  /**
   * 被选中的**具体个体**（2026-10-29 代码审查 B1-H01）。
   *
   * 同图鉴号可能有多只，体型 / 声音达标的往往只有其中一只；调用方必须直接展示这两只，
   * 不要再按图鉴号 + 性别重新挑，否则会把不达标的那只展示成「推荐配对」。
   */
  motherPet?: PetMatch;
  malePet?: PetMatch;
}

const accountKeyOfSnapshot = (snapshot: AccountSnapshot): string =>
  snapshot.accountKey ?? `uid:${snapshot.gameId}`;

const bodyOfPet = (pet: OwnedPet): string => breedingBodyGradeOf(pet);

/**
 * 体型口径是否命中（2026-11-01 新增满体重 / 零体重）：
 * - `大块头` / `小不点`：奖牌档，满体重 / 零体重个体也算命中（极端档是它们的子集）；
 * - `满体重` / `零体重`：要求体重百分位正好 100% / 0%，缺体重字段判不了就返回 false。
 */
const bodyMatchesCriteria = (pet: OwnedPet, body: string): boolean => {
  if (!body) return true;
  const grade = bodyOfPet(pet);
  if (body === '大块头' || body === '小不点') return grade === body;
  const percent = pet.weightPercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return false;
  if (body === '满体重') return grade === '大块头' && percent >= 100;
  if (body === '零体重') return grade === '小不点' && percent <= 0;
  return false;
};

/**
 * 声音是否命中需求里的选项；空字符串 = 不挑。
 * 统一走 `petFilters.matchesVoiceOption`（2026-10-29 代码审查 B1-M01：此处曾复制一份，
 * 婉转声漏了 ≤100 上界，后续改口径必然漏改）。
 */
const matchesDemandVoice = (pet: OwnedPet, voice: string): boolean =>
  !voice || matchesVoiceOption(pet.voiceDb, voice);

/**
 * 亲本是否满足需求里选的体型 / 声音。
 *
 * 注意是**父母双方都要满足**：声音遗传是 (父 + 母) / 2 向零取整，
 * 要 +100 / -100 必须父母双双同号满分；体型同理（双大块头才出大块头蛋）。
 * 体型认奖牌，也认身高到顶 / 到底（2026-10-26 用户口径）。
 *
 * 「满体重 / 零体重」在这里**只按大块头 / 小不点算**（2026-11-01 用户口径）：
 * 孵蛋规则和普通体型一致，出满体重 / 零体重是概率事件，不要求父母本身就满分；
 * 满分只作为交付要求，由 `petMatchesDemand` 在结单时校验。
 *
 * 导出给 `demandPlacement.isMotherCandidate` / `isFatherCandidate` 共用
 * （2026-11-01 代码审查 R2-1-M09：那边曾手抄一份，声音档位改口径必然漏改）。
 */
export const matchesParentGrade = (pet: OwnedPet, criteria: DemandCriteria): boolean =>
  bodyMatchesCriteria(pet, parentBodyOf(criteria.body)) &&
  matchesDemandVoice(pet, criteria.voice);

/** 父母匹配用的体型：满体重 → 大块头、零体重 → 小不点，其余原样。 */
const parentBodyOf = (body: string): string =>
  body === '满体重' ? '大块头' : body === '零体重' ? '小不点' : body;

/** 这只个体是否满足需求的所有已选字段（空字段跳过）。 */
export function petMatchesDemand(
  pet: OwnedPet,
  criteria: DemandCriteria,
  eggOfGameId: ReadonlyMap<number, number>,
): boolean {
  if (eggOfGameId.get(pet.gameId) !== criteria.eggGameId) return false;
  if (criteria.nature && pet.nature !== criteria.nature) return false;
  if (criteria.gender && pet.gender !== criteria.gender) return false;
  if (criteria.body && !bodyMatchesCriteria(pet, criteria.body)) return false;
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

export interface DemandPairOption {
  motherPet: PetMatch;
  malePet: PetMatch;
  /** 目标性格的遗传概率：不挑 1 / 学院小窝 1 / 双亲同性格 0.6 / 单方 0.3。 */
  natureChance: number;
  /** 这组配对是否走绿窝（学院小窝）：性格由学院那只 100% 遗传。 */
  greenNest: boolean;
}

/** 性格遗传概率 → 档位描述（界面写概率分解用）。 */
export const NATURE_CHANCE_LABELS: Record<number, string> = {
  1: '性格不挑',
  0.6: '双亲同性格 60%',
  0.3: '单方带性格 30%',
};

/**
 * 本机能用来孵这颗蛋的所有配对（2026-10-30 用户口径：**必须按概率排序**）。
 *
 * 之前是「第一个能配的账号 / 第一个能配的公就返回」，多账号时会把 30% 那对
 * 当成推荐，而放过另一个号上的 60%（石岚号克莱因龙 + 莫比乌乌那次就是这个原因）。
 *
 * 规则与 `findBreedableSupply` 完全一致：只认同账号配对、父母双方体型 / 声音都达标、
 * 性格指定时至少一方带。区别只在于这里把所有可用组合都算出来并按性格概率降序，
 * 交给界面挑最优的那对。
 */
export function pairOptionsForEgg(
  snapshots: readonly AccountSnapshot[],
  criteria: DemandCriteria,
  species: readonly SpeciesEntry[],
  limit = 3,
  /**
   * 需求要求绿窝（学院小窝）时传 true：性格由学院那只 100% 遗传，
   * 不再按「双亲同性格 60% / 单方 30%」算（2026-11-01 用户口径）。
   */
  greenNest = false,
  /**
   * 需求**不挑性格**时用来排序的推荐性格（2026-11-03 用户口径）：
   * 接单人默认按推荐性格配（双亲都带推荐性格的排最前），一组都没有时才用其它配对。
   * 不传时取图鉴的默认推荐性格；界面可传已解析过用户覆盖表的结果。
   */
  preferredNatures: readonly string[] = defaultEggNatures(species, criteria.eggGameId),
): DemandPairOption[] {
  const preferred = criteria.nature ? [] : preferredNatures.filter(Boolean);
  const preferredSet = new Set(preferred);
  const eggOfGameId = eggMapOf(species);
  const infoByGameId = eggInfoOf(species);
  /** 所有形态的蛋组：公本只要是同蛋组即可，不要求是蛋物种本体（进化形态也能配）。 */
  const groupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    groupsByGameId.set(entry.gameId, (entry.eggGroups ?? []).filter(isBreedableGroup));
  }
  const info = infoByGameId.get(criteria.eggGameId);
  if (!info || info.groups.length === 0) return [];
  if (criteria.gender === '公' && !info.maleCapable) return [];

  const options: DemandPairOption[] = [];
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

    for (const female of females) {
      for (const male of males) {
        const motherHit = Boolean(criteria.nature) && female.nature === criteria.nature;
        const maleHit = Boolean(criteria.nature) && male.nature === criteria.nature;
        // 性格指定时至少一方带目标性格；都没带这一对就不算能孵
        if (criteria.nature && !motherHit && !maleHit) continue;
        // 绿窝：这一对要进学院小窝。性格指定时由学院那只 100% 遗传，不再看双亲是否同性格。
        // 不挑性格的单本来就发不了绿窝（发需求处已拦），这里仍按「有性格才算绿窝」处理。
        const viaGreenNest = greenNest && Boolean(criteria.nature);
        options.push({
          motherPet: { snapshot, pet: female },
          malePet: { snapshot, pet: male },
          natureChance: !criteria.nature || viaGreenNest ? 1 : motherHit && maleHit ? 0.6 : 0.3,
          greenNest: viaGreenNest,
        });
      }
    }
  }
  // sort 是稳定的：同概率时保留「先导入的账号 → 先出现的个体」顺序
  options.sort(
    (a, b) =>
      b.natureChance -
        a.natureChance ||
      // 不挑性格时：双亲都带推荐性格 > 一方带 > 都不带（2026-11-03）
      Number(preferredSet.has(b.motherPet.pet.nature)) +
        Number(preferredSet.has(b.malePet.pet.nature)) -
        (Number(preferredSet.has(a.motherPet.pet.nature)) +
          Number(preferredSet.has(a.malePet.pet.nature))),
  );
  /**
   * 按母本限流（2026-11-02）：不挑性格时所有组合概率都是 1，直接 slice 会让第一只母本
   * 吃满名额、后面的母本永远看不到。每个母本先给 cap/2 组，保证第二个母本能出现；
   * cap=1（`findBreedableSupply`）时仍只取排序后的全局第一组，行为不变。
   */
  const cap = Math.max(1, limit);
  const perMother = Math.max(1, Math.ceil(cap / 2));
  const picked: DemandPairOption[] = [];
  const countByMother = new Map<string, number>();
  const motherKeyOf = (option: DemandPairOption): string =>
    `${accountKeyOfSnapshot(option.motherPet.snapshot)}:${
      option.motherPet.pet.captureId ?? option.motherPet.pet.gameId
    }`;
  for (const option of options) {
    const key = motherKeyOf(option);
    const used = countByMother.get(key) ?? 0;
    if (used >= perMother) continue;
    countByMother.set(key, used + 1);
    picked.push(option);
    if (picked.length >= cap) break;
  }
  // 只有一只母本时，上面的限流会用不满名额（cap=3 只取 2 条），
  // 后两只同样合法的公被静默丢掉；补位到 cap（2026-11-19）。
  if (picked.length < cap) {
    const seen = new Set(picked);
    for (const option of options) {
      if (seen.has(option)) continue;
      picked.push(option);
      if (picked.length >= cap) break;
    }
  }
  return picked;
}

/**
 * 本机同账号能否孵出这条需求。
 *
 * - **只认配对孵蛋**：必须找**同账号**的「该蛋母本 + 同蛋组公」，且父母双方都满足体型 / 声音；
 *   自己已有一只、但配不出另一只时不算能接（2026-10-28 用户口径：不交割精灵）；
 * - 性格指定时，父母至少一方带目标性格（学院小窝 100% 遗传）；
 * - 需求为公时，该蛋物种必须能出公（`maleCapable`）。
 *
 * 不能跨账号拼父母；公也不能只按蛋组筛——非大婉公 + 大婉母孵不出大婉蛋。
 * 取的是**概率最高**的那一对（2026-10-30 修：原来取第一个能配的账号）。
 */
export function findBreedableSupply(
  snapshots: readonly AccountSnapshot[],
  criteria: DemandCriteria,
  species: readonly SpeciesEntry[],
): DemandSupply {
  const [best] = pairOptionsForEgg(snapshots, criteria, species, 1);
  if (!best) return { kind: 'none' };
  return {
    kind: 'breedable',
    accountKey: accountKeyOfSnapshot(best.motherPet.snapshot),
    motherGameId: best.motherPet.pet.gameId,
    maleGameId: best.malePet.pet.gameId,
    motherPet: best.motherPet,
    malePet: best.malePet,
  };
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
}

/** 种公需求里「我能用哪颗蛋接」的一个选项（2026-10-30 用户口径）。 */
export interface StudHatchOption extends DemandPairOption {
  eggGameId: number;
  name: string;
  /** 这颗蛋的可配蛋组 id（双蛋组时有两个）。 */
  groupIds: number[];
  /** 命中需求的整体概率 = 性格概率 × 出目标性别的比例（按蛋物种性别比例，缺数据 5:5）。 */
  chance: number;
}

/**
 * 种公需求在**本机**能用的蛋，按「真能孵出需求」的概率降序（2026-10-30 用户口径）。
 *
 * 种公需求只认「蛋组 + 性格 + 性别 + 体型 + 声音」，蛋组里任何一颗蛋都可能满足，
 * 所以必须把所有蛋各算一遍再比概率；原来按图鉴顺序取第一个能孵的蛋，
 * 会把 30% 的小翼龙当成推荐，漏掉 60% 的莫比乌乌（用户实测）。
 */
export function studHatchOptions(
  snapshots: readonly AccountSnapshot[],
  demand: {
    eggGameId: number;
    nature: string;
    gender: string;
    body: string;
    voice: string;
    requireGreenNest?: boolean;
  },
  species: readonly SpeciesEntry[],
): StudHatchOption[] {
  if (!isStudDemandKey(demand.eggGameId)) return [];
  const groupId = eggGroupIdOfDemand(demand.eggGameId);
  const eggs = species.filter(
    (entry) =>
      entry.eggGameId != null &&
      entry.eggGameId === entry.gameId &&
      entry.maleCapable === true &&
      (entry.eggGroups ?? []).some((group) => group === groupId && isBreedableGroup(group)),
  );
  const options: StudHatchOption[] = [];
  for (const egg of eggs) {
    const genderFactor =
      demand.gender === '公' || demand.gender === '母'
        ? genderShareOf(egg, demand.gender)
        : 1;
    const [best] = pairOptionsForEgg(
      snapshots,
      {
        eggGameId: egg.gameId,
        nature: demand.nature,
        gender: '公',
        body: demand.body as DemandBody,
        voice: demand.voice as DemandVoice,
      },
      species,
      1,
      demand.requireGreenNest === true,
    );
    if (!best) continue;
    options.push({
      eggGameId: egg.gameId,
      name: egg.name,
      groupIds: (egg.eggGroups ?? []).filter(isBreedableGroup),
      motherPet: best.motherPet,
      malePet: best.malePet,
      natureChance: best.natureChance,
      greenNest: best.greenNest,
      chance: best.natureChance * genderFactor,
    });
  }
  // 概率优先；同概率时双蛋组优先（可配的蛋更多），再按图鉴号稳定排序
  options.sort(
    (a, b) =>
      b.chance - a.chance ||
      Number(b.groupIds.length >= 2) - Number(a.groupIds.length >= 2) ||
      a.eggGameId - b.eggGameId,
  );
  return options;
}

/**
 * 组内任意一只蛋里，是否能凑出同账号、双方同档位的一对（**只判能不能**，找到就停）。
 * 要按概率挑蛋请用 `studHatchOptions`；这里给「能不能接」这种布尔判断用，避免白算全部候选。
 */
export function findStudBreedableSupply(
  snapshots: readonly AccountSnapshot[],
  demand: { eggGameId: number; nature: string; body: string; voice: string },
  species: readonly SpeciesEntry[],
): StudDemandSupply {
  if (!isStudDemandKey(demand.eggGameId)) return { kind: 'none' };
  const groupId = eggGroupIdOfDemand(demand.eggGameId);
  for (const egg of species) {
    if (
      egg.eggGameId == null ||
      egg.eggGameId !== egg.gameId ||
      egg.maleCapable !== true ||
      !(egg.eggGroups ?? []).some((group) => group === groupId && isBreedableGroup(group))
    ) {
      continue;
    }
    const [best] = pairOptionsForEgg(
      snapshots,
      {
        eggGameId: egg.gameId,
        nature: demand.nature,
        gender: '公',
        body: demand.body as DemandBody,
        voice: demand.voice as DemandVoice,
      },
      species,
      1,
    );
    if (!best) continue;
    return {
      kind: 'breedable',
      accountKey: accountKeyOfSnapshot(best.motherPet.snapshot),
      motherGameId: best.motherPet.pet.gameId,
      maleGameId: best.malePet.pet.gameId,
      motherPet: best.motherPet,
      malePet: best.malePet,
      eggGameId: egg.gameId,
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
      if (!bodyMatchesCriteria(pet, demand.body)) continue;
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
