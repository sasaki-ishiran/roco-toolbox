import {
  ALL_MOTHERS_CRITERIA_ID,
  type MotherCoverageHolder,
  type MotherCoverageRow,
  type MotherGroupMember,
  type PublishedMotherResource,
} from '../shared/motherGroups';
import { isBreedableGroup } from './eggs';
import { speciesDisplayName } from './speciesName';
import type { SpeciesEntry } from './types';

/**
 * 多人母本共享：由已发布摘要派生「谁有、谁缺、谁未知」。
 *
 * 这里只派生目录，不持久化任何进度；也不产生交换任务或完成状态。
 * 未知（未发布 / 已停止共享 / 图鉴或口径不一致）**不能当成缺**——
 * 「已发布成员均无」与「小组都没有」是两句不同的话。
 */
export interface MotherSharingViews {
  /** 我缺的；自己的摘要不可比较时为 null（不是空数组）。 */
  missingForMe: MotherCoverageRow[] | null;
  /** 我能补谁的；自己的摘要不可比较时为 null。 */
  mineForOthers: MotherCoverageRow[] | null;
  all: MotherCoverageRow[];
}

export interface BuildMotherCoverageInput {
  species: readonly SpeciesEntry[];
  catalogVersion: string;
  members: readonly MotherGroupMember[];
  /** 本组口径；旧组 / 不传时按一期固定口径。 */
  criteriaId?: string;
}

/** 摘要是否可用于比较：口径标识与图鉴版本都必须和当前客户端一致。 */
export function isMotherResourceComparable(
  resource: PublishedMotherResource | null,
  catalogVersion: string,
  criteriaId: string = ALL_MOTHERS_CRITERIA_ID,
): boolean {
  return (
    resource != null &&
    resource.criteriaId === criteriaId &&
    resource.catalogVersion === catalogVersion
  );
}

const compareAccountKey = (a: string, b: string): number =>
  Number(a.slice(4)) - Number(b.slice(4)) || a.localeCompare(b);

export function buildMotherCoverage(input: BuildMotherCoverageInput): MotherCoverageRow[] {
  const { species, catalogVersion, members, criteriaId = ALL_MOTHERS_CRITERIA_ID } = input;

  // 目标全集：`eggGameId === gameId` 且至少有一个可孵蛋组。图鉴未知的 eggGameId 不生成行。
  const eggById = new Map<number, SpeciesEntry>();
  for (const entry of species) {
    if (entry.eggGameId !== entry.gameId) continue;
    if (!(entry.eggGroups ?? []).some(isBreedableGroup)) continue;
    eggById.set(entry.gameId, entry);
  }

  /** 成员 → 蛋 ID → 该成员在此蛋上的来源游戏账号（只算可比较的摘要）。 */
  const coverage = new Map<string, Map<number, string[]>>();
  for (const member of members) {
    const byEgg = new Map<number, Set<string>>();
    if (isMotherResourceComparable(member.resource, catalogVersion, criteriaId)) {
      for (const account of member.resource?.accounts ?? []) {
        for (const eggGameId of account.eggGameIds) {
          if (!eggById.has(eggGameId)) continue;
          const keys = byEgg.get(eggGameId) ?? new Set<string>();
          keys.add(account.accountKey);
          byEgg.set(eggGameId, keys);
        }
      }
    }
    coverage.set(
      member.accountId,
      new Map([...byEgg].map(([eggGameId, keys]) => [eggGameId, [...keys].sort(compareAccountKey)])),
    );
  }

  const rows: MotherCoverageRow[] = [];
  for (const entry of eggById.values()) {
    const holders: MotherCoverageHolder[] = [];
    const missingMemberIds: string[] = [];
    const unknownMemberIds: string[] = [];

    for (const member of members) {
      if (!isMotherResourceComparable(member.resource, catalogVersion, criteriaId)) {
        unknownMemberIds.push(member.accountId);
        continue;
      }
      const keys = coverage.get(member.accountId)?.get(entry.gameId);
      if (keys && keys.length > 0) holders.push({ accountId: member.accountId, accountKeys: keys });
      else missingMemberIds.push(member.accountId);
    }

    rows.push({
      eggGameId: entry.gameId,
      name: speciesDisplayName(entry, entry.name),
      holders,
      missingMemberIds,
      unknownMemberIds,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.eggGameId - b.eggGameId);
  return rows;
}

/**
 * 三视图。`comparableMemberIds` = 当前有效、口径与图鉴一致的成员集合；
 * 查看者不在其中时前两项为 `null`——不能用空数组伪装「已经算完、什么都不缺」。
 */
export function selectMotherSharingViews(
  rows: MotherCoverageRow[],
  viewerAccountId: string,
  comparableMemberIds: readonly string[],
): MotherSharingViews {
  const comparable = new Set(comparableMemberIds);
  if (!comparable.has(viewerAccountId)) {
    return { missingForMe: null, mineForOthers: null, all: rows };
  }

  const holds = (row: MotherCoverageRow): boolean =>
    row.holders.some((holder) => holder.accountId === viewerAccountId);

  const notMine = rows.filter((row) => !holds(row));
  // 「我缺的」：组内已有人拥有的排前面，已发布成员均无的排后面。
  const missingForMe = [
    ...notMine.filter((row) => row.holders.length > 0),
    ...notMine.filter((row) => row.holders.length === 0),
  ];

  const mineForOthers = rows.filter(
    (row) =>
      holds(row) && row.missingMemberIds.some((memberId) => comparable.has(memberId)),
  );

  return { missingForMe, mineForOthers, all: rows };
}
