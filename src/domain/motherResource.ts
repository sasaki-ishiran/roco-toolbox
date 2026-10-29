import {
  MOTHER_CATALOG_VERSION_MAX,
  MOTHER_RESOURCE_MAX_ACCOUNTS,
  MOTHER_RESOURCE_MAX_BODY_BYTES,
  MOTHER_RESOURCE_MAX_EGGS_PER_ACCOUNT,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  PRODUCTION_LINE_MAX_NATURES,
  PRODUCTION_LINE_MAX_PER_ACCOUNT,
  canonicalEggGameIds,
  canonicalProductionLines,
  isCanonicalMotherAccountKey,
  isValidIsoTimestamp,
  motherResourceCriteriaIdOf,
  type MotherResourceDraft,
  type SharedMotherAccount,
} from '../shared/motherGroups';
import { isBreedableGroup } from './eggs';
import type { TargetMode } from './petFilters';
import { buildProductionLines } from './productionLines';
import { accountKeyOf, type AccountSnapshot } from './parseBackup';
import type { SpeciesEntry } from './types';

/**
 * 多人母本共享：从**原始账号快照**提取「全部母本 + 产线」摘要（2026-10-28 起不再有母本口径）。
 *
 * 产线的档位门槛依赖**组目标模式**（追满分 ±100 / 追双牌 ≥96），所以模式必须随摘要一起走：
 * 它被编进 `criteriaId`（v3），组里每个人读到的产线口径才一致。
 *
 * 单位是「蛋」（`SpeciesEntry.eggGameId`），不是进化形态；同一颗蛋的重复个体只算一次。
 * 这里刻意不使用 `useOwnedPets()` 的输出（它受顶部账号筛选影响，`account` 只是显示名）。
 */

export type MotherResourceErrorCode =
  | 'NO_SELECTED_ACCOUNTS'
  | 'INVALID_ACCOUNT_KEY'
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_EXPORTED_AT'
  | 'INVALID_CATALOG_VERSION'
  | 'TOO_MANY_ACCOUNTS'
  | 'TOO_MANY_EGG_IDS'
  | 'TOO_MANY_LINES'
  | 'TOO_MANY_NATURES'
  | 'PAYLOAD_TOO_LARGE';

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
  /**
   * 组目标模式（必传）：产线按双方同档位计算，并按它生成 `criteriaId`。
   * 漏传会让摘要用错模式、组内口径混用（2026-10-29 代码审查 B2-M01）。
   */
  mode: TargetMode;
}

/**
 * 生成一份可发布的摘要。任何选中的账号缺失、UID 非规范或导出时间无效都直接抛错，
 * **不产出半份摘要**（否则会把「本机没有这个号」静默变成「这个号没有母本」）。
 */
export function buildMotherResource(input: BuildMotherResourceInput): MotherResourceDraft {
  const { snapshots, selectedAccountKeys, species, catalogVersion } = input;
  /**
   * 2026-10-28：小组不再设母本口径，共享全部母本 + 产线。
   * 具体缺什么由每个成员在自己的本地筛选里决定。
   * 2026-10-29：产线口径（目标模式）编进 criteriaId，切模式后旧摘要自动「需更新」。
   */
  const criteriaId = motherResourceCriteriaIdOf(input.mode);

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

  const linesByAccount = new Map(
    buildProductionLines({
      snapshots,
      species,
      mode: input.mode,
    }).map((account) => [account.accountKey, canonicalProductionLines(account.lines)]),
  );

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
      if (pet.gender !== '母') continue;
      const eggGameId = byGameId.get(pet.gameId)?.eggGameId;
      if (eggGameId == null || !eggSpeciesIds.has(eggGameId)) continue;
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
      lines: linesByAccount.get(key) ?? [],
    };
  });

  accounts.sort((a, b) => compareAccountKey(a.accountKey, b.accountKey));

  const resource: MotherResourceDraft = {
    schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
    criteriaId: criteriaId as MotherResourceDraft['criteriaId'],
    catalogVersion,
    accounts,
  };
  assertMotherResourceWithinLimits(resource);
  return resource;
}

/**
 * 发布前的本地预检：与服务端 `motherGroupsValidation` 同口径。
 *
 * 服务端的产线上限（单账号 1024 条、单条 30 个性格）和 256KiB 请求体上限，
 * 客户端不预检就只能等提交后收到 413 / INVALID_INPUT（2026-10-29 代码审查 B2-M02）。
 * 请求体还会包一层 `{ baseRevision, resource }`，这里留 1KiB 余量。
 */
export function assertMotherResourceWithinLimits(resource: MotherResourceDraft): void {
  for (const account of resource.accounts) {
    const lines = account.lines ?? [];
    if (lines.length > PRODUCTION_LINE_MAX_PER_ACCOUNT) {
      throw new MotherResourceError(
        'TOO_MANY_LINES',
        `账号 ${account.accountKey} 的产线超过 ${PRODUCTION_LINE_MAX_PER_ACCOUNT} 条，请减少共享账号后重试`,
      );
    }
    for (const line of lines) {
      if (line.natures.length === 0 || line.natures.length > PRODUCTION_LINE_MAX_NATURES) {
        throw new MotherResourceError(
          'TOO_MANY_NATURES',
          `账号 ${account.accountKey} 有产线的性格超过 ${PRODUCTION_LINE_MAX_NATURES} 个`,
        );
      }
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(resource)).length;
  if (bytes > MOTHER_RESOURCE_MAX_BODY_BYTES - 1024) {
    throw new MotherResourceError(
      'PAYLOAD_TOO_LARGE',
      `共享资源约 ${Math.ceil(bytes / 1024)}KiB，超过 ${Math.round(
        MOTHER_RESOURCE_MAX_BODY_BYTES / 1024,
      )}KiB 上限；请减少共享账号后重试`,
    );
  }
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
  /** 产线变化（稳定键：`蛋|档位|性格/性格`）。 */
  addedLines?: string[];
  removedLines?: string[];
}

export interface MotherResourceDiff {
  /** 按人汇总后的蛋覆盖变化（所有账号取并集）。 */
  addedEggGameIds: number[];
  removedEggGameIds: number[];
  addedAccounts: string[];
  removedAccounts: string[];
  /** 账号仍在、但覆盖变了。 */
  changedAccounts: MotherResourceAccountDiff[];
  /** 产线变化（顶层并集），用于发布预览。 */
  addedLines?: string[];
  removedLines?: string[];
  /**
   * 覆盖完全没变（账号键集合、各自蛋 ID 集合与产线都一致）。
   * 只改账号名或导出时间不算变化——「摘要未变不重复提示」。
   */
  unchanged: boolean;
}

const lineKeyOf = (line: {
  eggGameId: number;
  grade: string;
  natures: readonly string[];
}): string => `${line.eggGameId}|${line.grade}|${[...line.natures].sort().join('/')}`;

/** 对比两份摘要的**覆盖**（忽略 revision / publishedAt / 账号名 / 导出时间）。 */
export function diffMotherResources(
  previous: MotherResourceDraft,
  next: MotherResourceDraft,
): MotherResourceDiff {
  const prev = byAccount(previous);
  const after = byAccount(next);
  const prevLines = linesByAccount(previous);
  const afterLines = linesByAccount(next);

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
    const beforeLineSet = prevLines.get(key) ?? new Set<string>();
    const currentLineSet = afterLines.get(key) ?? new Set<string>();
    const addedLines = [...currentLineSet].filter((line) => !beforeLineSet.has(line)).sort();
    const removedLines = [...beforeLineSet].filter((line) => !currentLineSet.has(line)).sort();
    if (added.length > 0 || removed.length > 0 || addedLines.length > 0 || removedLines.length > 0) {
      changedAccounts.push({
        accountKey: key,
        addedEggGameIds: added,
        removedEggGameIds: removed,
        addedLines,
        removedLines,
      });
    }
  }

  const beforeIds = unionIds(prev);
  const afterIds = unionIds(after);
  const addedEggGameIds = [...afterIds].filter((id) => !beforeIds.has(id)).sort((a, b) => a - b);
  const removedEggGameIds = [...beforeIds].filter((id) => !afterIds.has(id)).sort((a, b) => a - b);
  const beforeLineUnion = unionLines(prevLines);
  const afterLineUnion = unionLines(afterLines);
  const addedLines = [...afterLineUnion].filter((line) => !beforeLineUnion.has(line)).sort();
  const removedLines = [...beforeLineUnion].filter((line) => !afterLineUnion.has(line)).sort();

  return {
    addedEggGameIds,
    removedEggGameIds,
    addedAccounts,
    removedAccounts,
    changedAccounts,
    addedLines,
    removedLines,
    unchanged:
      // criteriaId 里带着产线口径（目标模式）：口径变了就不是同一份摘要。
      previous.criteriaId === next.criteriaId &&
      addedEggGameIds.length === 0 &&
      removedEggGameIds.length === 0 &&
      addedAccounts.length === 0 &&
      removedAccounts.length === 0 &&
      changedAccounts.length === 0 &&
      addedLines.length === 0 &&
      removedLines.length === 0,
  };
}

const byAccount = (resource: MotherResourceDraft): Map<string, Set<number>> =>
  new Map(
    resource.accounts.map((account) => [account.accountKey, new Set(canonicalEggGameIds(account.eggGameIds))]),
  );

const linesByAccount = (resource: MotherResourceDraft): Map<string, Set<string>> =>
  new Map(
    resource.accounts.map((account) => [
      account.accountKey,
      new Set(canonicalProductionLines(account.lines ?? []).map(lineKeyOf)),
    ]),
  );

const unionIds = (accounts: Map<string, Set<number>>): Set<number> => {
  const union = new Set<number>();
  for (const ids of accounts.values()) for (const id of ids) union.add(id);
  return union;
};

const unionLines = (accounts: Map<string, Set<string>>): Set<string> => {
  const union = new Set<string>();
  for (const lines of accounts.values()) for (const line of lines) union.add(line);
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
        lines: account.lines === undefined ? null : canonicalProductionLines(account.lines),
      }))
      .sort((a, b) => compareAccountKey(a.accountKey, b.accountKey)),
  });
}
