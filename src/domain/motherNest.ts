import { classifyGrade, type PetGrade, type TargetMode } from './petFilters';
import { isQualifiedMother, type MotherCriteria } from './motherCriteria';
import { genderFactorOf, genderShareOf } from './genderRatio';
import { isBreedableGroup } from './eggs';
import { speciesDisplayName } from './speciesName';
import { boxLabel } from './coverageDetail';
import { targetNatureNames } from '../data/catalog';
import type { NestPet } from './nestPlan';
import type { OwnedPet, SpeciesEntry } from './types';

/**
 * 玩家说的「八大性格」（2026-11-19 用户口径）。
 *
 * 公只有带这八种之一，才可能补上某个种公格；带其他性格的公对种公目标没有任何收益
 * （母本概率可能一样，但那只公白占一个窝）。所以**同等概率下优先八大公**；
 * 这一组实在没有八大公时才退回非八大——软门槛，不能因为卡八大把母本缺口丢掉。
 */
const EIGHT_NATURES: ReadonlySet<string> = new Set(targetNatureNames);

const isEightNature = (nature: string): boolean => EIGHT_NATURES.has(nature);

/**
 * 母本线的**最低真实概率**（2026-11-19 用户口径：包含公母比例）。
 *
 * 真实概率 = 子代拿到推荐性格的概率 × 这个蛋的出母比例，和配窝卡头写的是同一个数：
 * - 0.6（双方同性格）× 0.5（5:5）= 30% → 值当占窝；
 * - 0.3（只有一方带）× 0.5 = 15% → 太低，不占窝，也不推给别的号，改「向小组求助」；
 * - 0.3 × 1.0（出母 100%）= 30% → 也值当，本号自己配；
 * - 0.6 × 0.2（2:8 的蛋）= 12% → 再稳的性格也救不回来，同样改求助。
 *
 * 一句话：**看界面上的那个百分比**，低于这条线就不占窝。
 */
export const MIN_MOTHER_CHANCE = 0.3;

/**
 * 母本配窝建议（2026-11-18 用户口径）。
 *
 * 现有配窝方案只补种公；母本缺口是另一条收集线。这里补上「这个号怎么把未收集的母本配出来」：
 * - 本号有目标档位母本、只是性格不对 → 配一只带推荐性格的公；同种（母本蛋血脉 = 种公蛋血脉）
 *   时这条线同时补种公格，记「一窝双收益」。
 * - 本号连目标档位母本都没有 → 别的号配蛋传过来；每个源号只取**最高概率**的那一对，
 *   再按「对性母」概率（推荐性格 × 出母率）排序，不再用固定的 15% / 30%。
 *
 * 2026-11-19 之后加了两条硬口径（见 `MIN_MOTHER_CHANCE`）：
 * 1. **真实概率低于 30% 的线不占窝**（真实概率 = 性格概率 × 出母比例，和卡头写的是同一个数）；
 * 2. 本号和别的号都到不了 30% → 既不自配也不传蛋，改成 `helps`（向小组求助）。
 *
 * 只做纯计算，不读网络、不写库。本号内的线要占窝：返回 `nestsNeeded`，由调用方从剩余窝位里扣。
 */
export interface MotherNestPairing {
  account: string;
  grade: PetGrade;
  eggGameId: number;
  eggName: string;
  /** 这枚蛋的蛋组（后代随母方，蛋组也就是母方的蛋组） */
  groupIds: number[];
  /** 该蛋的推荐性格（母本达标条件要求推荐性格时，子代要命中其中之一） */
  recommendedNatures: string[];
  mother: NestPet;
  father: NestPet;
  /** 子代拿到推荐性格的概率（公带 0.3 / 双方同性格 0.6 / 学院不在本模块建模） */
  natureChance: number;
  /** 子代是母的概率（按蛋物种性别比例；缺数据按 5:5） */
  femaleChance: number;
  /** 母本收益 = 推荐性格概率 × 出母率 */
  motherGain: number;
  /** 同种时这条线同时补上的种公期望（否则 0） */
  studGain: number;
  /** 母本 + 种公，排序与界面「期望」都用它 */
  expectedValue: number;
  /** 公的蛋血脉 = 母本的蛋血脉（同一个精灵 / 同一颗蛋） */
  sameSpecies: boolean;
  /** 这条线新占几个窝（父/母已在种公方案里的不重复占） */
  nestsNeeded: number;
}

export interface MotherNestTask {
  /** 目标号（需要这只母本的账号） */
  account: string;
  grade: PetGrade;
  eggGameId: number;
  eggName: string;
  groupIds: number[];
  recommendedNatures: string[];
  sourceAccount: string;
  mother: NestPet;
  father: NestPet;
  natureChance: number;
  femaleChance: number;
  /** 对性母概率 = natureChance × femaleChance（界面排序用这个，不用 15% / 30%） */
  chance: number;
  /** 目标号已经有同种（同一颗蛋）的目标档位公：蛋到手孵成母本后直接和它配窝 */
  sameSpecies: boolean;
}

/**
 * 只能找小组帮忙的母本缺口（2026-11-19 用户口径）。
 *
 * 本号和别的号的最好配法都到不了 30%（性格 × 出母比例）：不值得占窝，也不推给别的号，
 * 改成「向小组求助」。
 */
export interface MotherHelpItem {
  eggGameId: number;
  eggName: string;
  groupIds: number[];
  recommendedNatures: string[];
  /** 现在能做出来的最好性格概率（不含公母比例；本号或别的号；乘上出母比例后仍不到 30% 才会进这里） */
  bestNatureChance: number;
  /** 这只蛋的出母比例（公母比例；缺数据按 5:5）：界面上要和性格概率相乘，和配窝卡一个口径 */
  femaleChance: number;
}

export interface MotherNestAccount {
  /** 本号未收集的母本蛋数（没有达标母本的蛋；不等于下面能补的条数） */
  gapCount: number;
  pairings: MotherNestPairing[];
  /** 跨号建议：每个蛋只留最高概率的源号，按 chance 降序 */
  tasks: MotherNestTask[];
  /** 只能向小组求助的蛋（本号 / 别的号都只能 30%） */
  helps: MotherHelpItem[];
  /** 本号母本配窝新占的窝数（已从剩余窝位里扣过） */
  nestsUsed: number;
}

export interface MotherNestInput {
  species: SpeciesEntry[];
  owned: OwnedPet[];
  mode: TargetMode;
  /** 当前目标档位；母本和公都要这个档位（体型 + 声音） */
  grade: PetGrade;
  /** 母本达标条件（`grades` 应与 grade 一致；推荐性格开关决定本号内能不能配） */
  criteria: MotherCriteria;
  naturesOf: (gameId: number) => readonly string[];
  /** 每个号的种公覆盖度（同种双收要找未覆盖的种公格） */
  coverageByAccount: ReadonlyMap<
    string,
    { cells: ReadonlyArray<{ groupId: number; natureName: string; grade: PetGrade; state: string }> }
  >;
  /** 每个号已排的种公方案：用来算新占几个窝，以及「这个号已有同种种公」 */
  plans?: readonly MotherNestPlanUsage[];
}

interface MotherNestPlanUsage {
  account: string;
  slots: ReadonlyArray<{ pet: { key: string } }>;
  nestsUsed: number;
  nestsTotal: number;
}

interface AccountIndex {
  account: string;
  pets: OwnedPet[];
  /** 目标档位母本，按蛋血脉分组 */
  femalesByEgg: Map<number, OwnedPet[]>;
  /** 目标档位公，按蛋组分组 */
  malesByGroup: Map<number, OwnedPet[]>;
  /** 这个号已有目标档位母本的蛋（达标条件口径，不只是目标档位） */
  qualifiedEggs: Set<number>;
  /** 这个号已有目标档位公的蛋血脉（同种判断） */
  maleEggs: Set<number>;
  /** 种公方案里已经占窝的个体（`NestPet.key` = `账号#账号内序号`） */
  placedKeys: Set<string>;
  nestsUsed: number;
  nestsTotal: number;
}

const eggOf = (pet: OwnedPet, byGameId: ReadonlyMap<number, SpeciesEntry>): number | null => {
  const entry = byGameId.get(pet.gameId);
  const egg = entry?.eggGameId;
  return egg != null && egg > 0 ? egg : null;
};

const groupsOf = (pet: OwnedPet, byGameId: ReadonlyMap<number, SpeciesEntry>): number[] =>
  (byGameId.get(pet.gameId)?.eggGroups ?? []).filter(isBreedableGroup);

const sharesGroup = (a: OwnedPet, b: OwnedPet, byGameId: ReadonlyMap<number, SpeciesEntry>): boolean => {
  const groups = groupsOf(a, byGameId);
  return groupsOf(b, byGameId).some((group) => groups.includes(group));
};

const toNestPet = (
  pet: OwnedPet,
  key: string,
  byGameId: ReadonlyMap<number, SpeciesEntry>,
): NestPet => ({
  key,
  gameId: pet.gameId,
  name: speciesDisplayName(byGameId.get(pet.gameId), pet.name),
  account: pet.account,
  gender: pet.gender === '公' ? '公' : '母',
  nature: pet.nature,
  voiceDb: pet.voiceDb,
  medalBody: pet.medalBody,
  heightPercent: pet.heightPercent ?? null,
  weightPercent: pet.weightPercent ?? null,
  box: boxLabel(pet),
});

/** 子代拿到推荐性格集合中任意一个的概率：双方同性格 0.6 / 单方带 0.3（不累加同一方）。 */
export function recommendedNatureChance(
  motherNature: string,
  fatherNature: string,
  recommended: readonly string[],
): number {
  let chance = 0;
  for (const nature of recommended) {
    const m = motherNature === nature;
    const f = fatherNature === nature;
    if (m && f) chance += 0.6;
    else if (m || f) chance += 0.3;
  }
  return chance;
}

const buildIndex = (
  account: string,
  pets: OwnedPet[],
  byGameId: ReadonlyMap<number, SpeciesEntry>,
  mode: TargetMode,
  grade: PetGrade,
  criteria: MotherCriteria,
  naturesOf: (gameId: number) => readonly string[],
  plan: MotherNestPlanUsage | undefined,
): AccountIndex => {
  const femalesByEgg = new Map<number, OwnedPet[]>();
  const malesByGroup = new Map<number, OwnedPet[]>();
  const qualifiedEggs = new Set<number>();
  const maleEggs = new Set<number>();

  for (const pet of pets) {
    const egg = eggOf(pet, byGameId);
    if (egg == null) continue;
    if (pet.gender === '母' && isQualifiedMother(pet, criteria, naturesOf)) qualifiedEggs.add(egg);
    if (classifyGrade(pet, mode) !== grade) continue;
    if (pet.gender === '母') {
      const list = femalesByEgg.get(egg) ?? [];
      list.push(pet);
      femalesByEgg.set(egg, list);
    } else if (pet.gender === '公') {
      maleEggs.add(egg);
      for (const group of groupsOf(pet, byGameId)) {
        const list = malesByGroup.get(group) ?? [];
        list.push(pet);
        malesByGroup.set(group, list);
      }
    }
  }

  const placedKeys = new Set((plan?.slots ?? []).map((slot) => slot.pet.key));
  return {
    account,
    pets,
    femalesByEgg,
    malesByGroup,
    qualifiedEggs,
    maleEggs,
    placedKeys,
    nestsUsed: plan?.nestsUsed ?? 0,
    nestsTotal: plan?.nestsTotal ?? 0,
  };
};

/** 一只目标档位母本 + 一只目标档位公，按「推荐性格 + 同种双收」挑最好的一对。 */
const bestPairForEgg = (
  eggGameId: number,
  mothers: OwnedPet[],
  account: AccountIndex,
  byGameId: ReadonlyMap<number, SpeciesEntry>,
  grade: PetGrade,
  recommendedNatures: string[],
  uncoveredCells: ReadonlySet<string>,
  eggGroups: number[],
): { mother: OwnedPet; father: OwnedPet; natureChance: number; studGain: number } | null => {
  let best: {
    mother: OwnedPet;
    father: OwnedPet;
    natureChance: number;
    studGain: number;
  } | null = null;
  const fathers = new Set<OwnedPet>();
  for (const group of eggGroups) {
    for (const father of account.malesByGroup.get(group) ?? []) fathers.add(father);
  }
  for (const mother of mothers) {
    for (const father of fathers) {
      if (mother === father || !sharesGroup(mother, father, byGameId)) continue;
      const natureChance = recommendedNatureChance(mother.nature, father.nature, recommendedNatures);
      if (natureChance <= 0) continue;
      const sameSpecies = eggOf(father, byGameId) === eggGameId;
      let studGain = 0;
      if (sameSpecies) {
        const groupCount = eggGroups.filter((group) =>
          uncoveredCells.has(`${group}|${father.nature}|${grade}`),
        ).length;
        if (groupCount > 0) {
          studGain =
            (father.nature === mother.nature ? 0.6 : 0.3) *
            groupCount *
            genderFactorOf(byGameId.get(eggGameId), '公');
        }
      }
      const candidate = { mother, father, natureChance, studGain };
      // 依次比：能补的种公格 → 母本概率 → 公是不是八大性格（2026-11-19）
      const better =
        !best ||
        candidate.studGain > best.studGain ||
        (candidate.studGain === best.studGain && candidate.natureChance > best.natureChance) ||
        (candidate.studGain === best.studGain &&
          candidate.natureChance === best.natureChance &&
          isEightNature(father.nature) &&
          !isEightNature(best.father.nature));
      if (better) best = candidate;
    }
  }
  return best;
};

/**
 * 某个号里「这颗蛋」能配出的最好一对（只看性格概率；同等概率优先八大公）。
 *
 * 跨号传蛋与「向小组求助」共用这一份判定：两边口径不一致时，会出现
 * 「本号说只有 30%、别的号也说只有 30%，却谁也不肯认」的错位。
 */
const bestPairInAccount = (
  source: AccountIndex,
  eggGameId: number,
  eggGroups: number[],
  recommended: string[],
  recommendedNaturesOn: boolean,
  byGameId: ReadonlyMap<number, SpeciesEntry>,
): { mother: OwnedPet; father: OwnedPet; natureChance: number } | null => {
  const mothers = source.femalesByEgg.get(eggGameId);
  if (!mothers || mothers.length === 0) return null;
  const fathers = new Set<OwnedPet>();
  for (const group of eggGroups) {
    for (const father of source.malesByGroup.get(group) ?? []) fathers.add(father);
  }
  let best: { mother: OwnedPet; father: OwnedPet; natureChance: number } | null = null;
  for (const mother of mothers) {
    for (const father of fathers) {
      if (mother === father || !sharesGroup(mother, father, byGameId)) continue;
      const natureChance = recommendedNaturesOn
        ? recommendedNatureChance(mother.nature, father.nature, recommended)
        : 1;
      if (natureChance <= 0) continue;
      if (
        !best ||
        natureChance > best.natureChance ||
        (natureChance === best.natureChance &&
          isEightNature(father.nature) &&
          !isEightNature(best.father.nature))
      ) {
        best = { mother, father, natureChance };
      }
    }
  }
  return best;
};

export function buildMotherNestSuggestions(input: MotherNestInput): Map<string, MotherNestAccount> {
  const { species, owned, mode, grade, criteria, naturesOf, coverageByAccount, plans = [] } = input;
  const byGameId = new Map(species.map((entry) => [entry.gameId, entry]));
  const plansByAccount = new Map(plans.map((plan) => [plan.account, plan]));

  // 每个号一份索引（与 buildNestPlans 的账号分组、`NestPet.key` 序号保持一致）
  const ownedByAccount = new Map<string, OwnedPet[]>();
  for (const pet of owned) {
    const list = ownedByAccount.get(pet.account) ?? [];
    list.push(pet);
    ownedByAccount.set(pet.account, list);
  }
  const indexes = new Map<string, AccountIndex>();
  for (const [account, pets] of ownedByAccount) {
    indexes.set(
      account,
      buildIndex(
        account,
        pets,
        byGameId,
        mode,
        grade,
        criteria,
        naturesOf,
        plansByAccount.get(account),
      ),
    );
  }

  /** 蛋物种全集（只保留能孵、能出母的蛋；性别比例缺数据按 5:5） */
  const eggEntries = species.filter((entry) => {
    if (entry.eggGameId !== entry.gameId) return false;
    if (!(entry.eggGroups ?? []).some(isBreedableGroup)) return false;
    return genderShareOf(entry, '母') > 0;
  });

  const recommendedNaturesOn = criteria.recommendedNatures === true;
  const result = new Map<string, MotherNestAccount>();
  for (const [account, index] of indexes) {
    const uncovered = new Set<string>();
    for (const cell of coverageByAccount.get(account)?.cells ?? []) {
      if (cell.state !== 'covered' && cell.grade === grade) {
        uncovered.add(`${cell.groupId}|${cell.natureName}|${cell.grade}`);
      }
    }

    // —— 本号内：目标档位母本已有、只是没达标（推荐性格）——
    // 2026-11-19 用户口径：低于 60% 的线不占窝。本号内永远只有 30%（母本性格不对，公最多带 30%），
    // 所以这一段实际上会全部落到下面的「传蛋 / 向小组求助」。
    const pairings: MotherNestPairing[] = [];
    /** 本号各蛋自己能做到的最高性格概率（给 helps 判断用） */
    const selfChanceByEgg = new Map<number, number>();
    if (recommendedNaturesOn) {
      for (const [eggGameId, mothers] of index.femalesByEgg) {
        if (index.qualifiedEggs.has(eggGameId)) continue;
        const egg = byGameId.get(eggGameId);
        if (!egg) continue;
        const eggGroups = (egg.eggGroups ?? []).filter(isBreedableGroup);
        const recommended = [...naturesOf(eggGameId)];
        if (recommended.length === 0) continue;
        const best = bestPairForEgg(
          eggGameId,
          mothers,
          index,
          byGameId,
          grade,
          recommended,
          uncovered,
          eggGroups,
        );
        if (!best) continue;
        selfChanceByEgg.set(eggGameId, best.natureChance);
        const femaleChance = genderShareOf(egg, '母');
        // 真实概率 = 性格概率 × 出母比例；低于门槛就不占窝（2026-11-19 用户口径）
        if (best.natureChance * femaleChance < MIN_MOTHER_CHANCE) continue;
        const motherGain = best.natureChance * femaleChance;
        const sameSpecies = eggOf(best.father, byGameId) === eggGameId;
        pairings.push({
          account,
          grade,
          eggGameId,
          eggName: speciesDisplayName(egg, egg.name),
          groupIds: [...eggGroups].sort((a, b) => a - b),
          recommendedNatures: recommended,
          mother: toNestPet(best.mother, `${account}#${index.pets.indexOf(best.mother)}`, byGameId),
          father: toNestPet(best.father, `${account}#${index.pets.indexOf(best.father)}`, byGameId),
          natureChance: best.natureChance,
          femaleChance,
          motherGain,
          studGain: best.studGain,
          expectedValue: motherGain + best.studGain,
          sameSpecies,
          nestsNeeded:
            (index.placedKeys.has(`${account}#${index.pets.indexOf(best.mother)}`) ? 0 : 1) +
            (index.placedKeys.has(`${account}#${index.pets.indexOf(best.father)}`) ? 0 : 1),
        });
      }
    }
    pairings.sort(
      (a, b) =>
        b.expectedValue - a.expectedValue ||
        Number(b.sameSpecies) - Number(a.sameSpecies) ||
        a.eggName.localeCompare(b.eggName, 'zh-Hans-CN'),
    );
    // 本号内的线要占窝：按期望从高到低，占得下的才收；占不下的不硬塞
    let nestsLeft = Math.max(0, index.nestsTotal - index.nestsUsed);
    const accepted: MotherNestPairing[] = [];
    for (const pairing of pairings) {
      if (pairing.nestsNeeded > nestsLeft) continue;
      nestsLeft -= pairing.nestsNeeded;
      accepted.push(pairing);
    }
    const servedEggs = new Set(accepted.map((pairing) => pairing.eggGameId));

    // —— 跨号：别的号能到 60% 的才建议传蛋（2026-11-19：30% 推给别的号同样是白占窝）——
    const tasks: MotherNestTask[] = [];
    const taskEggs = new Set<number>();
    for (const egg of eggEntries) {
      const eggGameId = egg.gameId;
      if (servedEggs.has(eggGameId) || index.qualifiedEggs.has(eggGameId)) continue;
      const eggGroups = (egg.eggGroups ?? []).filter(isBreedableGroup);
      const recommended = [...naturesOf(eggGameId)];
      if (recommendedNaturesOn && recommended.length === 0) continue;
      const femaleChance = genderShareOf(egg, '母');
      let bestTask: MotherNestTask | null = null;
      for (const [sourceAccount, source] of indexes) {
        if (sourceAccount === account) continue;
        const bestPair = bestPairInAccount(
          source,
          eggGameId,
          eggGroups,
          recommended,
          recommendedNaturesOn,
          byGameId,
        );
        if (!bestPair || bestPair.natureChance * femaleChance < MIN_MOTHER_CHANCE) continue;
        const task: MotherNestTask = {
          account,
          grade,
          eggGameId,
          eggName: speciesDisplayName(egg, egg.name),
          groupIds: [...eggGroups].sort((a, b) => a - b),
          recommendedNatures: recommended,
          sourceAccount,
          mother: toNestPet(
            bestPair.mother,
            `${sourceAccount}#${source.pets.indexOf(bestPair.mother)}`,
            byGameId,
          ),
          father: toNestPet(
            bestPair.father,
            `${sourceAccount}#${source.pets.indexOf(bestPair.father)}`,
            byGameId,
          ),
          natureChance: bestPair.natureChance,
          femaleChance,
          chance: bestPair.natureChance * femaleChance,
          sameSpecies: index.maleEggs.has(eggGameId),
        };
        // 跨号也优先八大公（2026-11-19）：概率一样时别把非八大的公推给用户
        if (
          !bestTask ||
          task.chance > bestTask.chance ||
          (task.chance === bestTask.chance &&
            isEightNature(task.father.nature) &&
            !isEightNature(bestTask.father.nature)) ||
          (task.chance === bestTask.chance &&
            isEightNature(task.father.nature) === isEightNature(bestTask.father.nature) &&
            Number(task.sameSpecies) > Number(bestTask.sameSpecies))
        ) {
          bestTask = task;
        }
      }
      if (bestTask) {
        tasks.push(bestTask);
        taskEggs.add(eggGameId);
      }
    }
    tasks.sort(
      (a, b) =>
        b.chance - a.chance ||
        Number(isEightNature(b.father.nature)) - Number(isEightNature(a.father.nature)) ||
        Number(b.sameSpecies) - Number(a.sameSpecies) ||
        a.eggName.localeCompare(b.eggName, 'zh-Hans-CN'),
    );

    // —— 谁也到不了 60% → 向小组求助（2026-11-19 用户口径）——
    // 只列「本号或别的号手里已经有这只蛋的母本」的蛋：连母本都没有的蛋不在这里刷屏，
    // 它们本来就在「母本全收集」的未收集里。
    const helps: MotherHelpItem[] = [];
    for (const egg of eggEntries) {
      const eggGameId = egg.gameId;
      if (
        servedEggs.has(eggGameId) ||
        taskEggs.has(eggGameId) ||
        index.qualifiedEggs.has(eggGameId)
      ) {
        continue;
      }
      const eggGroups = (egg.eggGroups ?? []).filter(isBreedableGroup);
      const recommended = [...naturesOf(eggGameId)];
      if (recommendedNaturesOn && recommended.length === 0) continue;
      let bestChance = selfChanceByEgg.get(eggGameId) ?? 0;
      for (const [sourceAccount, source] of indexes) {
        if (sourceAccount === account) continue;
        const bestPair = bestPairInAccount(
          source,
          eggGameId,
          eggGroups,
          recommended,
          recommendedNaturesOn,
          byGameId,
        );
        if (bestPair) bestChance = Math.max(bestChance, bestPair.natureChance);
      }
      if (bestChance <= 0) continue;
      helps.push({
        eggGameId,
        eggName: speciesDisplayName(egg, egg.name),
        groupIds: [...eggGroups].sort((a, b) => a - b),
        recommendedNatures: recommended,
        bestNatureChance: bestChance,
        femaleChance: genderShareOf(egg, '母'),
      });
    }
    /** 求助也要按「性格 × 公母比例」的真实概率排，和配窝卡的卡头一个口径 */
    const helpChance = (item: MotherHelpItem): number => item.bestNatureChance * item.femaleChance;
    helps.sort(
      (a, b) => helpChance(b) - helpChance(a) || a.eggName.localeCompare(b.eggName, 'zh-Hans-CN'),
    );

    const gapCount = eggEntries.filter((egg) => !index.qualifiedEggs.has(egg.gameId)).length;
    result.set(account, {
      gapCount,
      pairings: accepted,
      tasks: tasks.slice(0, 5),
      helps: helps.slice(0, 5),
      nestsUsed: accepted.reduce((sum, pairing) => sum + pairing.nestsNeeded, 0),
    });
  }
  return result;
}
