import type { CollectionDemand } from '../shared/collectionGroups';

/**
 * 已结单：本组内 `status = done` 且承接人是该成员的需求条数（全时段）。
 *
 * 只统计已确认完成的单，不看需求方；已完成的需求不允许撤回，否则这个数会倒退。
 * 被移除的成员不再出现在成员列表里，但他当年结的单仍计入承接人的累计。
 */
export function completedDemandCounts(
  demands: readonly CollectionDemand[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const demand of demands) {
    if (demand.status !== 'done' || !demand.claimerAccountId) continue;
    counts.set(demand.claimerAccountId, (counts.get(demand.claimerAccountId) ?? 0) + 1);
  }
  return counts;
}
