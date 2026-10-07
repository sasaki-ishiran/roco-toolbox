import { boxLabel } from './coverageDetail';
import {
  MOTHER_CLASS_ORDER,
  classifyGrade,
  classifyMother,
  type MotherClass,
  type PetGrade,
  type TargetMode,
} from './petFilters';
import { isBreedableGroup } from './eggs';
import { speciesDisplayName } from './speciesName';
import { accountKeyOf, type AccountSnapshot } from './parseBackup';
import type { OwnedPet, SpeciesEntry } from './types';

/** 单个账号这次新抓到的精灵 */
export interface AccountAddition {
  accountName: string;
  /** 账号身份（游戏 UID 优先，见 parseBackup.accountKeyOf）——重名但不同 UID 靠它区分 */
  accountKey: string;
  isFirstImport: boolean;
  added: OwnedPet[];
}

/** 一条"够格进看板分类"的新增记录，直接带着位置，界面不用再算 */
export interface QualifiedPetRow {
  label: string; // 精灵名（有形态时带形态）
  box: string; // 盒子位置，如「盒子01 第3位」
  nature: string;
  voiceDb: number;
  gender: '公' | '母';
  /** 仅种公：它能当种公的蛋组（双蛋组可能跨组） */
  groupLabels?: string[];
}

export interface AccountImportResult {
  /** 展示用名：同名不同 UID 时补 (gameId) 后缀，避免界面上被当成同一个账号 */
  accountName: string;
  /** 账号身份（游戏 UID 优先）：列表 key 与去重都用它，不要用展示名 */
  accountKey: string;
  isFirstImport: boolean;
  /** 新增种公，按 4 档分组（与母本一致，2026-10-04 用户拍板） */
  studs: Array<{ studClass: PetGrade; pets: QualifiedPetRow[] }>;
  mothers: Array<{ motherClass: MotherClass; pets: QualifiedPetRow[] }>;
}

export interface ImportAnalysisInput {
  previous: AccountSnapshot[];
  imported: AccountSnapshot[];
  species: SpeciesEntry[];
  eggGroupNames: Record<number, string>;
  /** 目标模式：决定「够格」的档位口径（追满分 ±100 / 追双牌 ≥96） */
  mode: TargetMode;
}

/** 内容指纹：老数据没有唯一编号时用来兜底配对 */
const fingerprint = (pet: OwnedPet): string =>
  [
    pet.gameId,
    pet.gender,
    pet.nature,
    pet.voiceDb,
    pet.medalBody,
    pet.isShiny ? 1 : 0,
    pet.weightPercent ?? '',
  ].join('|');

/** 一只精灵的身份：优先抓包唯一编号，缺失时退回内容指纹 */
export const petIdentity = (pet: OwnedPet): string =>
  pet.captureId ? `id:${pet.captureId}` : `fp:${fingerprint(pet)}`;

/**
 * 按账号对比"导入前 / 导入后"，算出这次新抓到的精灵。
 *
 * 判定靠抓包里的唯一编号（captureId）。升级前导入的老数据没这个编号，
 * 这时两边都退回内容指纹，避免把已经拥有的精灵全判成"新增"。
 * 用多重集合配对（而不是 Set），这样"内容一模一样的多只"也能正确计数；
 * 放生掉的精灵只是从新数据里消失，不会反过来被算成新增。
 */
export function computeAddedPets(
  previous: AccountSnapshot[],
  imported: AccountSnapshot[],
): AccountAddition[] {
  // 按**账号身份（游戏 UID）**配对：重名但不同 UID 的两个账号各比各的，
  // 游戏内改过名也仍是同一账号（否则改名后会被误判成「首次导入」）
  const previousByAccount = new Map(previous.map((snapshot) => [accountKeyOf(snapshot), snapshot]));

  return imported.map((snapshot) => {
    const before = previousByAccount.get(accountKeyOf(snapshot));
    if (!before) {
      return {
        accountName: snapshot.accountName,
        accountKey: accountKeyOf(snapshot),
        isFirstImport: true,
        added: [...snapshot.pets],
      };
    }

    // 只要**任意一边**整体没有编号（升级前导入的老数据），就退回内容指纹。
    // 只判断 before 一侧是不够的：本地是新格式、再导一份旧格式抓包时，
    // 两边 key 前缀不同（id: / fp:）会永远对不上 → 整份精灵被误报成「新增」。
    const useFingerprint =
      !before.pets.some((pet) => pet.captureId) || !snapshot.pets.some((pet) => pet.captureId);
    const keyOf = useFingerprint ? (pet: OwnedPet) => `fp:${fingerprint(pet)}` : petIdentity;

    const remaining = new Map<string, number>();
    for (const pet of before.pets) {
      const key = keyOf(pet);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }

    const added: OwnedPet[] = [];
    for (const pet of snapshot.pets) {
      const key = keyOf(pet);
      const left = remaining.get(key) ?? 0;
      if (left > 0) remaining.set(key, left - 1);
      else added.push(pet);
    }

    return {
      accountName: snapshot.accountName,
      accountKey: accountKeyOf(snapshot),
      isFirstImport: false,
      added,
    };
  });
}

/**
 * 把"这次新增"过滤成符合看板分类的精灵：
 * 种公（公 · 当前模式档位达标，**不按目标性格过滤**——够格就该被看到，
 * 否则「明明自己有、却不知道哪去了」，2026-10-03 用户报的缺陷）与母本（档位 4 档）。
 * 其余新增（普通精灵）直接丢掉——用户只想知道够格的那些、以及在哪个盒子。
 */
export function analyzeImport(input: ImportAnalysisInput): AccountImportResult[] {
  const { previous, imported, species, eggGroupNames, mode } = input;

  const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));
  const groupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    groupsByGameId.set(
      entry.gameId,
      (entry.eggGroups ?? []).filter(isBreedableGroup),
    );
  }

  const labelOf = (pet: OwnedPet): string =>
    speciesDisplayName(speciesByGameId.get(pet.gameId), pet.name);

  /** 这只精灵能当种公的蛋组（双蛋组可能跨组）；不按性格过滤 */
  const studGroups = (pet: OwnedPet): number[] => {
    // 档位口径随模式（追满分 ±100 / 追双牌 ≥96 拿牌）；体型是大块头或小不点都算
    if (pet.gender !== '公' || classifyGrade(pet, mode) === null) return [];
    return groupsByGameId.get(pet.gameId) ?? [];
  };

  // 同名不同 UID 的两个账号在界面上要能分开：重名时补 (gameId)，
  // 与 useOwnedPets 的账号显示口径一致（列表 key 用 accountKey，不看展示名）。
  const nameCount = new Map<string, number>();
  for (const snapshot of imported) {
    nameCount.set(snapshot.accountName, (nameCount.get(snapshot.accountName) ?? 0) + 1);
  }
  const gameIdByKey = new Map(imported.map((snapshot) => [accountKeyOf(snapshot), snapshot.gameId]));
  const displayNameOf = (addition: AccountAddition): string => {
    if ((nameCount.get(addition.accountName) ?? 0) <= 1) return addition.accountName;
    const gameId = gameIdByKey.get(addition.accountKey);
    return gameId === undefined ? addition.accountName : `${addition.accountName}(${gameId})`;
  };

  return computeAddedPets(previous, imported).map((addition) => {
    const { accountKey, isFirstImport, added } = addition;
    const studBuckets = new Map<PetGrade, QualifiedPetRow[]>();
    const motherBuckets = new Map<MotherClass, QualifiedPetRow[]>();

    for (const pet of added) {
      const groups = studGroups(pet);
      if (groups.length > 0) {
        const studClass = classifyGrade(pet, mode) as PetGrade;
        const bucket = studBuckets.get(studClass) ?? [];
        bucket.push({
          label: labelOf(pet),
          box: boxLabel(pet),
          nature: pet.nature,
          voiceDb: pet.voiceDb,
          gender: '公',
          groupLabels: groups.map((groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`),
        });
        studBuckets.set(studClass, bucket);
      }

      const motherClass = classifyMother(pet, mode);
      if (motherClass !== null && motherClass !== '其他') {
        const bucket = motherBuckets.get(motherClass) ?? [];
        bucket.push({
          label: labelOf(pet),
          box: boxLabel(pet),
          nature: pet.nature,
          voiceDb: pet.voiceDb,
          gender: '母',
        });
        motherBuckets.set(motherClass, bucket);
      }
    }

    const studs = MOTHER_CLASS_ORDER.filter(
      (studClass) => studClass !== '其他' && studBuckets.has(studClass as PetGrade),
    ).map((studClass) => ({
      studClass: studClass as PetGrade,
      pets: studBuckets.get(studClass as PetGrade) as QualifiedPetRow[],
    }));

    const mothers = MOTHER_CLASS_ORDER.filter(
      (motherClass) => motherClass !== '其他' && motherBuckets.has(motherClass),
    ).map((motherClass) => ({
      motherClass,
      pets: motherBuckets.get(motherClass) as QualifiedPetRow[],
    }));

    return {
      accountKey,
      accountName: displayNameOf(addition),
      isFirstImport,
      studs,
      mothers,
    };
  });
}
