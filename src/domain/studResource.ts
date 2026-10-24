/**
 * 种公共享摘要：从**原始账号快照**生成「本组目标槽位」的已覆盖 / 可迭代证据。
 *
 * 口径（2026-10-25 评审修正）：
 * - 单位是「个体自己的蛋组 × 性格 × 档位」，**不是** `eggGameId`（蛋物种与血脉蛋组可能不同）；
 * - `covered`：公 + 档位吻合 + 性格吻合 + 物种属于该蛋组；
 * - `breedable`：同一账号内「带目标性格且母方物种能出公的母」+「任意一只公」，
 *   与 `cellStateFor` 的 `breedable` 同义；可迭代不计入已收齐，也不代表现货；
 * - 一律按 `AccountSnapshot` 逐账号计算，不跨账号拼父母；不使用 `account` 显示名。
 */
import {
  STUD_RESOURCE_MAX_ACCOUNTS,
  STUD_RESOURCE_MAX_SLOTS_PER_ACCOUNT,
  studSlotSetIdOf,
  slotKeyOf,
  type CollectionGroupType,
  type SharedStudAccount,
  type StudResourceDraft,
  type StudSlotCoverage,
  type StudTargetConfig,
} from '../shared/collectionGroups';
import { MOTHER_CATALOG_VERSION_MAX, isCanonicalMotherAccountKey, isValidIsoTimestamp } from '../shared/motherGroups';
import { buildCanBreedMale } from './breedAbility';
import { isBreedableGroup } from './eggs';
import { accountKeyOf, type AccountSnapshot } from './parseBackup';
import { classifyGrade } from './petFilters';
import type { SpeciesEntry } from './types';

export type StudResourceErrorCode =
  | 'NO_SELECTED_ACCOUNTS'
  | 'INVALID_ACCOUNT_KEY'
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_EXPORTED_AT'
  | 'INVALID_CATALOG_VERSION'
  | 'TOO_MANY_ACCOUNTS'
  | 'TOO_MANY_SLOTS'
  | 'TARGET_NOT_READY';

export class StudResourceError extends Error {
  readonly code: StudResourceErrorCode;

  constructor(code: StudResourceErrorCode, message: string) {
    super(message);
    this.name = 'StudResourceError';
    this.code = code;
  }
}

export interface BuildStudResourceInput {
  snapshots: readonly AccountSnapshot[];
  selectedAccountKeys: readonly string[];
  species: readonly SpeciesEntry[];
  catalogVersion: string;
  target: StudTargetConfig;
  /** 组级目标修订；服务端会比对。 */
  targetRevision: number;
}

export const isStudTargetReady = (target: StudTargetConfig | null): target is StudTargetConfig =>
  target != null && target.kind === 'stud' && target.slots.length > 0;

const compareAccountKey = (a: string, b: string): number =>
  Number(a.slice(4)) - Number(b.slice(4)) || a.localeCompare(b);

/** 生成可发布的种公摘要；任何缺失账号 / 非法输入都抛错，不产出半份。 */
export function buildStudResource(input: BuildStudResourceInput): StudResourceDraft {
  const { snapshots, selectedAccountKeys, species, catalogVersion, target, targetRevision } = input;
  if (!isStudTargetReady(target)) {
    throw new StudResourceError('TARGET_NOT_READY', '本组目标还没确认');
  }
  if (catalogVersion.trim().length === 0 || catalogVersion.length > MOTHER_CATALOG_VERSION_MAX) {
    throw new StudResourceError('INVALID_CATALOG_VERSION', '图鉴版本无效');
  }
  if (target.catalogVersion && target.catalogVersion !== catalogVersion) {
    throw new StudResourceError('INVALID_CATALOG_VERSION', '图鉴已更新，请先更新本组目标');
  }

  const keys = [...new Set(selectedAccountKeys)];
  if (keys.length === 0) throw new StudResourceError('NO_SELECTED_ACCOUNTS', '没有选择要共享的游戏账号');
  if (keys.length > STUD_RESOURCE_MAX_ACCOUNTS) {
    throw new StudResourceError('TOO_MANY_ACCOUNTS', '共享的游戏账号超过上限');
  }
  for (const key of keys) {
    if (!isCanonicalMotherAccountKey(key)) {
      throw new StudResourceError('INVALID_ACCOUNT_KEY', `账号键不是规范的 uid 形式：${key}`);
    }
  }

  const snapshotsByKey = new Map<string, AccountSnapshot>();
  for (const snapshot of snapshots) {
    snapshotsByKey.set(snapshot.accountKey ?? accountKeyOf(snapshot), snapshot);
  }

  const eggGroupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    eggGroupsByGameId.set(entry.gameId, (entry.eggGroups ?? []).filter(isBreedableGroup));
  }
  const canBreedMale = buildCanBreedMale([...species]);

  const accounts: SharedStudAccount[] = keys.map((key) => {
    const snapshot = snapshotsByKey.get(key);
    if (!snapshot) {
      throw new StudResourceError('ACCOUNT_NOT_FOUND', `本机没有账号 ${key}，请先导入或云同步`);
    }
    if (!isValidIsoTimestamp(snapshot.exportedAt)) {
      throw new StudResourceError('INVALID_EXPORTED_AT', `账号 ${key} 的数据导出时间无效`);
    }

    const covered: StudSlotCoverage[] = [];
    const breedable: StudSlotCoverage[] = [];
    for (const slot of target.slots) {
      const matched = snapshot.pets.filter(
        (pet) =>
          (eggGroupsByGameId.get(pet.gameId) ?? []).includes(slot.groupId) &&
          classifyGrade(pet, target.mode) === slot.grade,
      );
      const carriers = matched.filter((pet) => pet.nature === slot.natureName);
      const males = matched.filter((pet) => pet.gender === '公');
      const stud = carriers.find((pet) => pet.gender === '公');
      if (stud) {
        covered.push({ groupId: slot.groupId, natureId: slot.natureId, grade: slot.grade, gameId: stud.gameId });
        continue;
      }
      const mother = carriers.find(
        (pet) => pet.gender === '母' && canBreedMale(pet),
      );
      // 同一快照 = 同一账号；这里仍按「本账号内存在任意一只公」判定，不跨账号
      if (mother && males.length > 0) {
        breedable.push({
          groupId: slot.groupId,
          natureId: slot.natureId,
          grade: slot.grade,
          gameId: mother.gameId,
        });
      }
    }
    if (covered.length + breedable.length > STUD_RESOURCE_MAX_SLOTS_PER_ACCOUNT) {
      throw new StudResourceError('TOO_MANY_SLOTS', `账号 ${key} 的覆盖格超过上限`);
    }

    return {
      accountKey: key,
      accountName: snapshot.accountName,
      sourceExportedAt: snapshot.exportedAt,
      covered: sortSlots(covered),
      breedable: sortSlots(breedable),
    };
  });
  accounts.sort((a, b) => compareAccountKey(a.accountKey, b.accountKey));

  return {
    schemaVersion: 1,
    kind: 'stud',
    mode: target.mode,
    catalogVersion,
    targetId: studSlotSetIdOf(target),
    targetRevision,
    accounts,
  };
}

const sortSlots = (slots: StudSlotCoverage[]): StudSlotCoverage[] =>
  [...slots].sort(
    (a, b) =>
      a.groupId - b.groupId ||
      a.natureId - b.natureId ||
      a.grade.localeCompare(b.grade),
  );

export interface StudResourceDiff {
  addedSlots: string[];
  removedSlots: string[];
  addedAccounts: string[];
  removedAccounts: string[];
  changedAccounts: Array<{ accountKey: string; addedSlots: string[]; removedSlots: string[] }>;
  unchanged: boolean;
}

const slotSetOfAccount = (account: SharedStudAccount): Set<string> =>
  new Set([...account.covered, ...account.breedable].map(slotKeyOf));

/** 对比两份摘要的覆盖（忽略 revision / 时间 / 账号名）。 */
export function diffStudResources(
  previous: StudResourceDraft,
  next: StudResourceDraft,
): StudResourceDiff {
  const prev = new Map(previous.accounts.map((account) => [account.accountKey, slotSetOfAccount(account)]));
  const after = new Map(next.accounts.map((account) => [account.accountKey, slotSetOfAccount(account)]));
  const addedAccounts = [...after.keys()].filter((key) => !prev.has(key)).sort(compareAccountKey);
  const removedAccounts = [...prev.keys()].filter((key) => !after.has(key)).sort(compareAccountKey);
  const changedAccounts: StudResourceDiff['changedAccounts'] = [];
  for (const key of [...after.keys()].filter((item) => prev.has(item)).sort(compareAccountKey)) {
    const before = prev.get(key) ?? new Set<string>();
    const current = after.get(key) ?? new Set<string>();
    const added = [...current].filter((slot) => !before.has(slot)).sort();
    const removed = [...before].filter((slot) => !current.has(slot)).sort();
    if (added.length > 0 || removed.length > 0) {
      changedAccounts.push({ accountKey: key, addedSlots: added, removedSlots: removed });
    }
  }
  const beforeAll = unionSlots(prev);
  const afterAll = unionSlots(after);
  const addedSlots = [...afterAll].filter((slot) => !beforeAll.has(slot)).sort();
  const removedSlots = [...beforeAll].filter((slot) => !afterAll.has(slot)).sort();
  return {
    addedSlots,
    removedSlots,
    addedAccounts,
    removedAccounts,
    changedAccounts,
    unchanged:
      addedSlots.length === 0 &&
      removedSlots.length === 0 &&
      addedAccounts.length === 0 &&
      removedAccounts.length === 0 &&
      changedAccounts.length === 0,
  };
}

const unionSlots = (accounts: Map<string, Set<string>>): Set<string> => {
  const union = new Set<string>();
  for (const slots of accounts.values()) for (const slot of slots) union.add(slot);
  return union;
};

export function studResourceSignature(resource: StudResourceDraft): string {
  return JSON.stringify({
    schemaVersion: resource.schemaVersion,
    kind: resource.kind,
    mode: resource.mode,
    catalogVersion: resource.catalogVersion,
    targetId: resource.targetId,
    targetRevision: resource.targetRevision,
    accounts: [...resource.accounts]
      .map((account) => ({
        accountKey: account.accountKey,
        accountName: account.accountName,
        sourceExportedAt: account.sourceExportedAt,
        covered: sortSlots(account.covered),
        breedable: sortSlots(account.breedable),
      }))
      .sort((a, b) => compareAccountKey(a.accountKey, b.accountKey)),
  });
}

/** 供界面展示：一只个体能补哪些槽位（已覆盖优先，其次可迭代）。 */
export function studClaimsOfTarget(
  target: StudTargetConfig,
  snapshot: AccountSnapshot,
  species: readonly SpeciesEntry[],
): { covered: StudSlotCoverage[]; breedable: StudSlotCoverage[] } {
  const resource = buildStudResource({
    snapshots: [snapshot],
    selectedAccountKeys: [snapshot.accountKey ?? accountKeyOf(snapshot)],
    species,
    catalogVersion: target.catalogVersion || 'local',
    target,
    targetRevision: 0,
  });
  return resource.accounts[0] ?? { accountKey: '', accountName: '', sourceExportedAt: '', covered: [], breedable: [] };
}

/** 组类型与目标必须一致；种公组目标为空时不能发布（服务端同样拒绝）。 */
export const canPublishStud = (
  groupType: CollectionGroupType,
  target: StudTargetConfig | null,
): boolean => groupType === 'stud' && isStudTargetReady(target);
