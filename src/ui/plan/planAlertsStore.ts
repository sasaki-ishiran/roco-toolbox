import type { CollectionPlanView } from '../../api/collectionGroups';

/**
 * 应用内提醒（2026-11-08）。
 *
 * 口径：`待我确认 + 新提供` 的合计，落到「小组」页签的红点数字。
 * 已读状态只记本机（`roco.planAlertsSeen:<accountId>:<groupId>`），不新增服务端表；
 * 服务端算不出的东西（例如跨设备已读）这轮不做。
 */
const SEEN_KEY = 'roco.planAlertsSeen:';

export interface PlanAlertCounts {
  /** 我发布的计划里等你确认收货的条数。 */
  needsConfirm: number;
  /** 上次离开小组页之后新增的「别人愿意提供」条数。 */
  newOffers: number;
  total: number;
}

/** 上次读到提醒的时间；没有记录按 0（历史上所有提供都算新）。 */
export function readPlanAlertSeen(accountId: string | null, groupId: string | null): number {
  if (!accountId || !groupId || typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(`${SEEN_KEY}${accountId}:${groupId}`);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function savePlanAlertSeen(
  accountId: string | null,
  groupId: string | null,
  at = Date.now(),
): void {
  if (!accountId || !groupId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${SEEN_KEY}${accountId}:${groupId}`, String(at));
  } catch {
    // 记不住只影响红点何时消失，不影响计划本身
  }
}

export function planAlertCounts(
  plans: readonly CollectionPlanView[],
  viewerAccountId: string,
  seenAt: number,
): PlanAlertCounts {
  if (!viewerAccountId) return { needsConfirm: 0, newOffers: 0, total: 0 };
  const mine = plans.filter(
    (plan) => plan.memberAccountId === viewerAccountId && plan.status === 'active',
  );
  const needsConfirm = mine.filter(
    (plan) => plan.needsConfirm || plan.progressStep >= 4,
  ).length;
  const newOffers = mine.reduce(
    (sum, plan) =>
      sum +
      plan.offers.filter(
        (offer) => offer.offerAccountId !== viewerAccountId && offer.updatedAt > seenAt,
      ).length,
    0,
  );
  return { needsConfirm, newOffers, total: needsConfirm + newOffers };
}

/* ---------- 页签红点（模块级外部 store，TabNav 直接订阅） ---------- */

let badge = 0;
const listeners = new Set<() => void>();

export function publishPlanAlertBadge(next: number): void {
  const value = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
  if (value === badge) return;
  badge = value;
  for (const listener of listeners) listener();
}

export function subscribePlanAlertBadge(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlanAlertBadge(): number {
  return badge;
}
