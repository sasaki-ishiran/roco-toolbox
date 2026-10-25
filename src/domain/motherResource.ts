import {
  MOTHER_CATALOG_VERSION_MAX,
  MOTHER_CRITERIA_ID,
  MOTHER_RESOURCE_MAX_ACCOUNTS,
  MOTHER_RESOURCE_MAX_EGGS_PER_ACCOUNT,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  canonicalEggGameIds,
  isCanonicalMotherAccountKey,
  isValidIsoTimestamp,
  type MotherResourceDraft,
  type SharedMotherAccount,
} from '../shared/motherGroups';
import { isBreedableGroup } from './eggs';
import { isQualifiedMother, type MotherCriteria } from './motherCriteria';
import { createNaturesResolver, type NatureOverrides } from './recommendedNatures';
import { accountKeyOf, type AccountSnapshot } from './parseBackup';
import type { SpeciesEntry } from './types';

/**
 * 多人母本共享：从**原始账号快照**提取固定口径的母本摘要。
 *
 * 口径固定为「母 + 大块头 + +100dB」（`MOTHER_CRITERIA_ID`），不跟随页面的目标模式、
 * 账号筛选或母本筛选——组里每个人读到的必须是同一条件。
 *
 * 单位是「蛋」（`SpeciesEntry.eggGameId`），不是进化形态；同一颗蛋的重复个体只算一次。
 * 这里刻意不使用 `useOwnedPets()` 的输出（它受顶部账号筛选影响，`account` 只是显示名）。
 */
export const SHARED_MOTHER_CRITERIA: MotherCriteria = { bodies: ['大块头'], voices: ['+100'] };

export type MotherResourceErrorCode =
  | 'NO_SELECTED_ACCOUNTS'
  | 'INVALID_ACCOUNT_KEY'
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_EXPORTED_AT'
  | 'INVALID_CATALOG_VERSION'
  | 'TOO_MANY_ACCOUNTS'
  | 'TOO_MANY_EGG_IDS';

export class MotherResourceError extends Error {
  readonly code: MotherResourceErrorCode;

  constructor(code: MotherResourceErrorCode, message: string) {
    super(message);
    this.name = 'MotherResourceError';
    this.code = code;
  }
}

export interface BuildMotherResourceInput {
  /** 完整账号快照（`listSnapshots()` 的结果），不是全局筛选后的精灵列表。 */
  snapshots: readonly AccountSnapshot[];
  /** 用户明确勾选的账号键，规范形式 `uid:<正整数>`。 */
  selectedAccountKeys: readonly string[];
  species: readonly SpeciesEntry[];
  catalogVersion: string;
  /** 本组口径；不传时沿用一期的固定口径（母 · 大块头 · +100dB）。 */
  criteria?: MotherCriteria;
  /** 与 criteria 对应的稳定标识；不传时用一期的固定 id。 */
  criteriaId?: string;
  /** 组内是否要求母本性格为推荐性格（2026-10-25）。 */
  requireRecommendedNatures?: boolean;
  /** 这份口径用的推荐性格覆盖（组长那一份）；不传 = 图鉴推荐 + 种族值兜底。 */
  natureOverrides?: NatureOverrides;
}

/**
 * 生成一份可发布的摘要。任何选中的账号缺失、UID 非规范或导出时间无效都直接抛错，
 * **不产出半份摘要**（否则会把「本机没有这个号」静默变成「这个号没有母本」）。
 */
export function buildMotherResource(input: BuildMotherResourceInput): MotherResourceDraft {
  const { snapshots, selectedAccountKeys, species, catalogVersion } = input;
  const criteria = input.criteria ?? SHARED_MOTHER_CRITERIA;
  const criteriaId = input.criteriaId ?? MOTHER_CRITERIA_ID;
  const effectiveCriteria: MotherCriteria = input.requireRecommendedNatures
    ? { ...criteria, recommendedNatures: true }
    : criteria;
  const naturesOf = createNaturesResolver({ species, overrides: input.natureOverrides });

  if (catalogVersion.trim().length === 0 || catalogVersion.length > MOTHER_CATALOG_VERSION_MAX) {
    throw new MotherResourceError('INVALID_CATALOG_VERSION', '图鉴版本无效');
  }

  const keys = [...new Set(selectedAccountKeys)];
  if (keys.length === 0) {
    throw new MotherResourceError('NO_SELECTED_ACCOUNTS', '没有选择要共享的游戏账号');
  }
  if (keys.length > MOTHER_RESOURCE_MAX_ACCOUNTS) {
    throw new MotherResourceError('TOO_MANY_ACCOUNTS', '共享的游戏账号超过上限');
  }
  for (const key of keys) {
    if (!isCanonicalMotherAccountKey(key)) {
      throw new MotherResourceError('INVALID_ACCOUNT_KEY', `账号键不是规范的 uid 形式：${key}`);
    }
  }

  const snapshotsByKey = new Map<string, AccountSnapshot>();
  for (const snapshot of snapshots) {
    snapshotsByKey.set(snapshot.accountKey ?? accountKeyOf(snapshot), snapshot);
  }

  // 目标全集：`eggGameId === gameId` 且至少有一个可孵蛋组的图鉴蛋物种。
  const byGameId = new Map<number, SpeciesEntry>();
  const eggSpeciesIds = new Set<number>();
  for (const entry of species) {
    byGameId.set(entry.gameId, entry);
    if (entry.eggGameId !== entry.gameId) continue;
    if (!(entry.eggGroups ?? []).some(isBreedableGroup)) continue;
    eggSpeciesIds.add(entry.gameId);
  }

  const accounts: SharedMotherAccount[] = keys.map((key) => {
    const snapshot = snapshotsByKey.get(key);
    if (!snapshot) {
      throw new MotherResourceError('ACCOUNT_NOT_FOUND', `本机没有账号 ${key}，请先导入或云同步`);
    }
    if (!isValidIsoTimestamp(snapshot.exportedAt)) {
      throw new MotherResourceError('INVALID_EXPORTED_AT', `账号 ${key} 的数据导出时间无效`);
    }

    const eggGameIds = new Set<number>();
    for (const pet of snapshot.pets) {
      const eggGameId = byGameId.get(pet.gameId)?.eggGameId;
      if (eggGameId == null || !eggSpeciesIds.has(eggGameId)) continue;
      if (!isQualifiedMother(pet, effectiveCriteria, naturesOf)) continue;
      eggGameIds.add(eggGameId);
    }
    if (eggGameIds.size > MOTHER_RESOURCE_MAX_EGGS_PER_ACCOUNT) {
      throw new MotherResourceError('TOO_MANY_EGG_IDS', `账号 ${key} 的蛋血脉数量超过上限`);
    }

    return {
      accountKey: key,
      accountName: snapshot.accountName,
      sourceExportedAt: snapshot.exportedAt,
      eggGameIds: canonicalEggGameIds([...eggGameIds]),
    };
  });

  accounts.sort((a, b) => compareAccountKey(a.accountKey, b.accountKey));

  return {
    schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
    criteriaId: criteriaId as MotherResourceDraft['criteriaId'],
    catalogVersion,
    accounts,
  };
}

/** 账号键按游戏 UID 数值排序，避免 `uid:100` 排在 `uid:99` 前面。 */
function compareAccountKey(a: string, b: string): number {
  const uidOf = (key: string): number => (isCanonicalMotherAccountKey(key) ? Number(key.slice(4)) : 0);
  return uidOf(a) - uidOf(b) || a.localeCompare(b);
}

export interface MotherResourceAccountDiff {
  accountKey: string;
  addedEggGameIds: number[];
  removedEggGameIds: number[];
}

export interface MotherResourceDiff {
  /** 按人汇总后的蛋覆盖变化（所有账号取并集）。 */
  addedEggGameIds: number[];
  removedEggGameIds: number[];
  addedAccounts: string[];
  removedAccounts: string[];
  /** 账号仍在、但覆盖变了。 */
  changedAccounts: MotherResourceAccountDiff[];
  /**
   * 覆盖完全没变（账号键集合与各自蛋 ID 集合都一致）。
   * 只改账号名或导出时间不算变化——「摘要未变不重复提示」。
   */
  unchanged: boolean;
}

/** 对比两份摘要的**覆盖**（忽略 revision / publishedAt / 账号名 / 导出时间）。 */
export function diffMotherResources(
  previous: MotherResourceDraft,
  next: MotherResourceDraft,
): MotherResourceDiff {
  const prev = byAccount(previous);
  const after = byAccount(next);

  const addedAccounts = [...after.keys()]
    .filter((key) => !prev.has(key))
    .sort(compareAccountKey);
  const removedAccounts = [...prev.keys()]
    .filter((key) => !after.has(key))
    .sort(compareAccountKey);

  const changedAccounts: MotherResourceAccountDiff[] = [];
  for (const key of [...after.keys()].filter((item) => prev.has(item)).sort(compareAccountKey)) {
    const before = prev.get(key) ?? new Set<number>();
    const current = after.get(key) ?? new Set<number>();
    const added = [...current].filter((id) => !before.has(id)).sort((a, b) => a - b);
    const removed = [...before].filter((id) => !current.has(id)).sort((a, b) => a - b);
    if (added.length > 0 || removed.length > 0) {
      changedAccounts.push({ accountKey: key, addedEggGameIds: added, removedEggGameIds: removed });
    }
  }

  const beforeIds = unionIds(prev);
  const afterIds = unionIds(after);
  const addedEggGameIds = [...afterIds].filter((id) => !beforeIds.has(id)).sort((a, b) => a - b);
  const removedEggGameIds = [...beforeIds].filter((id) => !afterIds.has(id)).sort((a, b) => a - b);

  return {
    addedEggGameIds,
    removedEggGameIds,
    addedAccounts,
    removedAccounts,
    changedAccounts,
    unchanged:
      addedEggGameIds.length === 0 &&
      removedEggGameIds.length === 0 &&
      addedAccounts.length === 0 &&
      removedAccounts.length === 0 &&
      changedAccounts.length === 0,
  };
}

const byAccount = (resource: MotherResourceDraft): Map<string, Set<number>> =>
  new Map(
    resource.accounts.map((account) => [account.accountKey, new Set(canonicalEggGameIds(account.eggGameIds))]),
  );

const unionIds = (accounts: Map<string, Set<number>>): Set<number> => {
  const union = new Set<number>();
  for (const ids of accounts.values()) for (const id of ids) union.add(id);
  return union;
};

/**
 * 稳定序列化：账号与 ID 顺序不影响结果。
 * 用于判断「这份摘要和服务器上的是不是同一份覆盖」，以及服务端同源冲突比较。
 */
export function motherResourceSignature(resource: MotherResourceDraft): string {
  return JSON.stringify({
    schemaVersion: resource.schemaVersion,
    criteriaId: resource.criteriaId,
    catalogVersion: resource.catalogVersion,
    accounts: [...resource.accounts]
      .map((account) => ({
        accountKey: account.accountKey,
        accountName: account.accountName,
        sourceExportedAt: account.sourceExportedAt,
        eggGameIds: canonicalEggGameIds(account.eggGameIds),
      }))
      .sort((a, b) => compareAccountKey(a.accountKey, b.accountKey)),
  });
}
