/**
 * 种公组：由已发布摘要派生「谁覆盖了哪个槽位、谁缺、谁未知」。
 *
 * 与母本共享同一条原则：未发布 / 停止共享 / 目标修订或图鉴不一致 = 未知，
 * 不能当成「缺」。「可迭代」单独列出，不算已覆盖。
 */
import {
  slotKeyOf,
  studSlotSetIdOf,
  type CollectionGroupMember,
  type PublishedStudResource,
  type StudTargetConfig,
} from '../shared/collectionGroups';

export interface StudHolder {
  accountId: string;
  accountKeys: string[];
}

export interface StudSlotRow {
  key: string;
  groupId: number;
  natureId: number;
  natureName: string;
  grade: string;
  /** 真实公精灵覆盖的成员与来源账号。 */
  holders: StudHolder[];
  /** 只能自己孵（母 + 公）的成员；不计入已覆盖。 */
  breedableHolders: StudHolder[];
  missingMemberIds: string[];
  unknownMemberIds: string[];
}

export interface StudSharingViews {
  missingForMe: StudSlotRow[] | null;
  mineForOthers: StudSlotRow[] | null;
  all: StudSlotRow[];
}

/** 摘要能否与当前组目标比较：目标集合、修订、模式、图鉴版本必须全部一致。 */
export function isStudResourceComparable(
  resource: PublishedStudResource | null,
  target: StudTargetConfig,
  targetRevision: number,
  catalogVersion: string,
): boolean {
  return (
    resource != null &&
    resource.kind === 'stud' &&
    resource.targetId === studSlotSetIdOf(target) &&
    resource.targetRevision === targetRevision &&
    resource.mode === target.mode &&
    resource.catalogVersion === catalogVersion
  );
}

const compareAccountKey = (a: string, b: string): number =>
  Number(a.slice(4)) - Number(b.slice(4)) || a.localeCompare(b);

export function isStudMemberComparable(
  member: CollectionGroupMember,
  target: StudTargetConfig,
  targetRevision: number,
  catalogVersion: string,
): boolean {
  return isStudResourceComparable(member.studResource, target, targetRevision, catalogVersion);
}

export function buildStudCoverage(input: {
  target: StudTargetConfig;
  targetRevision: number;
  catalogVersion: string;
  members: readonly CollectionGroupMember[];
}): StudSlotRow[] {
  const { target, targetRevision, catalogVersion, members } = input;
  const comparableIds = new Set(
    members
      .filter((member) => isStudMemberComparable(member, target, targetRevision, catalogVersion))
      .map((member) => member.accountId),
  );
  // 每个成员只解析一次摘要：槽位键 → 来源账号。避免「槽位 × 成员 × 账号 × 槽位」全量比较。
  const indexed = new Map<
    string,
    { covered: Map<string, string[]>; breedable: Map<string, string[]> }
  >();
  const indexSlots = (
    accounts: PublishedStudResource['accounts'],
    field: 'covered' | 'breedable',
  ): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const account of accounts) {
      for (const item of account[field]) {
        const key = slotKeyOf(item);
        const list = map.get(key);
        if (list) list.push(account.accountKey);
        else map.set(key, [account.accountKey]);
      }
    }
    return map;
  };
  for (const member of members) {
    if (!comparableIds.has(member.accountId)) continue;
    const resource = member.studResource as PublishedStudResource;
    indexed.set(member.accountId, {
      covered: indexSlots(resource.accounts, 'covered'),
      breedable: indexSlots(resource.accounts, 'breedable'),
    });
  }

  return target.slots.map((slot) => {
    const key = slotKeyOf(slot);
    const holders: StudHolder[] = [];
    const breedableHolders: StudHolder[] = [];
    const missingMemberIds: string[] = [];
    const unknownMemberIds: string[] = [];

    for (const member of members) {
      const index = indexed.get(member.accountId);
      if (!index) {
        unknownMemberIds.push(member.accountId);
        continue;
      }
      const covered = index.covered.get(key);
      const breedable = index.breedable.get(key);
      if (covered && covered.length > 0) {
        holders.push({
          accountId: member.accountId,
          accountKeys: [...covered].sort(compareAccountKey),
        });
      } else if (breedable && breedable.length > 0) {
        breedableHolders.push({
          accountId: member.accountId,
          accountKeys: [...breedable].sort(compareAccountKey),
        });
      } else {
        missingMemberIds.push(member.accountId);
      }
    }

    return {
      key,
      groupId: slot.groupId,
      natureId: slot.natureId,
      natureName: slot.natureName,
      grade: slot.grade,
      holders,
      breedableHolders,
      missingMemberIds,
      unknownMemberIds,
    };
  });
}

/** 三视图；查看者不可比较时前两项为 null（不是空数组）。 */
export function selectStudSharingViews(
  rows: StudSlotRow[],
  viewerAccountId: string,
  comparableMemberIds: readonly string[],
): StudSharingViews {
  const comparable = new Set(comparableMemberIds);
  if (!comparable.has(viewerAccountId)) {
    return { missingForMe: null, mineForOthers: null, all: rows };
  }
  const holds = (row: StudSlotRow): boolean =>
    row.holders.some((holder) => holder.accountId === viewerAccountId);

  const notMine = rows.filter((row) => !holds(row));
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

/** 目标槽位分组（按蛋组），供摘要展示。 */
export function groupRowsByGroupId(
  rows: readonly StudSlotRow[],
): Array<{ groupId: number; rows: StudSlotRow[] }> {
  const map = new Map<number, StudSlotRow[]>();
  for (const row of rows) {
    const list = map.get(row.groupId) ?? [];
    list.push(row);
    map.set(row.groupId, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([groupId, list]) => ({ groupId, rows: list }));
}
