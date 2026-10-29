import type { CollectionDemand } from '../shared/collectionGroups';

/** 接单方「你承接的需求已完成」提示。 */
export interface DemandCompletionNotice {
  /** 本次需要提示的单数；0 = 没有新完成（首次见到时只用来记已读水位）。 */
  count: number;
  /** 需求方昵称：去重、跳过查不到的。 */
  demanderNames: string[];
  /** 看完后的已读水位（最大完成时间）。 */
  watermark: number;
}

/**
 * 计算接单方尚未看过的「已完成」需求。
 *
 * 只认 `status = 'done'` 且承接人是自己的单；`seenAt` 为 `null` 表示本机第一次见到这个组，
 * 此时不把历史当成新消息，只返回水位让调用方记下来。
 */
export function newDemandCompletionNotice(
  demands: readonly CollectionDemand[],
  claimerAccountId: string,
  seenAt: number | null,
  nameOf: (accountId: string) => string | null,
): DemandCompletionNotice | null {
  const mine = demands.filter(
    (demand) => demand.status === 'done' && demand.claimerAccountId === claimerAccountId,
  );
  if (mine.length === 0) return null;
  const watermark = Math.max(...mine.map((demand) => demand.updatedAt));
  if (seenAt == null) return { count: 0, demanderNames: [], watermark };
  const fresh = mine.filter((demand) => demand.updatedAt > seenAt);
  if (fresh.length === 0) return { count: 0, demanderNames: [], watermark };
  const demanderNames: string[] = [];
  for (const demand of fresh) {
    const name = nameOf(demand.demanderAccountId);
    if (name && !demanderNames.includes(name)) demanderNames.push(name);
  }
  return { count: fresh.length, demanderNames, watermark };
}

export interface DemandCompletionDecision {
  /** 要弹出的提示；null = 不提示。 */
  notice: DemandCompletionNotice | null;
  /** 要写入的已读水位；null = 不需要写。 */
  markSeenAt: number | null;
}

/**
 * 决定「这次要不要提示、要不要推进已读水位」。
 *
 * 第一次见到某个组（`seenAt == null`）只记水位、不把历史当成新消息，但**必须留下初始化标记**：
 * 否则「这个组还没有任何已完成单」时什么都不写，之后第一条完成单会继续被当成历史吞掉
 * （2026-10-29 审查 B6-M01）。
 */
export function resolveDemandCompletionNotice(
  demands: readonly CollectionDemand[],
  claimerAccountId: string,
  seenAt: number | null,
  nameOf: (accountId: string) => string | null,
  now: number = Date.now(),
): DemandCompletionDecision {
  const computed = newDemandCompletionNotice(demands, claimerAccountId, seenAt, nameOf);
  if (seenAt == null) {
    // 水位取「现在」，保证本次之前完成的单都算已读，之后完成的单才提示。
    return { notice: null, markSeenAt: Math.max(computed?.watermark ?? 0, now) };
  }
  if (!computed || computed.count === 0) return { notice: null, markSeenAt: null };
  return { notice: computed, markSeenAt: null };
}
