import type { CollectionPlanDemandView, CollectionPlanView } from '../../api/collectionGroups';

/** 卡面五步：与需求闭环一致；想收不画点。 */
export const PLAN_STEP_LABELS = ['待接单', '已认领', '已上窝', '待我确认', '已完成'] as const;

export type PlanTone = 'amber' | 'green' | 'sky' | 'slate';

/** 形态缩略名：去掉「的样子 / 形态 / 分支」，默认形态不显示，最多 4 字。 */
export function shortFormLabel(form: string | null | undefined): string {
  if (!form) return '';
  const trimmed = form.trim();
  if (!trimmed) return '';
  if (trimmed === '本来的样子' || trimmed === '平常的样子') return '';
  return trimmed.replace(/(的样子|形态|分支)$/, '').slice(0, 4);
}

/** 卡面五步当前高亮下标；-1 = 五个点都不亮（还没发需求）。 */
export function planStepIndex(plan: Pick<CollectionPlanView, 'progressStep' | 'status'>): number {
  if (plan.status === 'done') return 4;
  if (plan.progressStep >= 1) return Math.min(4, plan.progressStep - 1);
  return -1;
}

export function planTone(
  plan: Pick<CollectionPlanView, 'progressStep' | 'status'>,
): PlanTone {
  if (plan.status === 'backlog') return 'slate';
  if (plan.status === 'done' || plan.progressStep >= 5) return 'green';
  if (plan.progressStep >= 4) return 'amber';
  if (plan.progressStep >= 1) return 'sky';
  return 'slate';
}

/** 一句进度：卡面只留事实，不写解释。 */
export function planProgressText(
  plan: Pick<CollectionPlanView, 'progressStep' | 'status' | 'needsConfirm'>,
): string {
  if (plan.status === 'backlog') return '想收 · 还没开始';
  if (plan.status === 'done' || plan.progressStep >= 5) return '已完成';
  if (plan.needsConfirm) return '等你确认收货';
  switch (plan.progressStep) {
    case 1:
      return '等组里接单';
    case 2:
      return '已有人认领';
    case 4:
      return '等你确认收货';
    default:
      return '还没发需求';
  }
}

/** 主操作：高频动作留在卡面（开始 / 确认），其余进二级页。 */
export function planActionLabel(
  plan: Pick<CollectionPlanView, 'progressStep' | 'status' | 'needsConfirm'>,
): string {
  if (plan.status === 'done' || plan.progressStep >= 5) return '看详情';
  if (plan.status === 'backlog') return '开始';
  if (plan.needsConfirm || plan.progressStep >= 4) return '去确认';
  if (plan.progressStep >= 1) return '看进度';
  return '发需求';
}

export type PlanActionKind = 'start' | 'publish' | 'progress' | 'confirm' | 'detail';

export function planActionKind(
  plan: Pick<CollectionPlanView, 'progressStep' | 'status' | 'needsConfirm'>,
): PlanActionKind {
  const label = planActionLabel(plan);
  if (label === '开始') return 'start';
  if (label === '发需求') return 'publish';
  if (label === '去确认') return 'confirm';
  if (label === '看进度') return 'progress';
  return 'detail';
}

/** 「我的收集」排序：待我确认 > 待接单 > 已认领 / 已上窝 > 进行中无进展 > 想收。 */
export function planSortRank(
  plan: Pick<CollectionPlanView, 'progressStep' | 'status' | 'needsConfirm'>,
): number {
  if (plan.status === 'done') return 5;
  if (plan.status === 'backlog') return 4;
  if (plan.needsConfirm || plan.progressStep >= 4) return 0;
  if (plan.progressStep >= 2) return 2;
  if (plan.progressStep >= 1) return 1;
  return 3;
}

export function sortPlansForMe(plans: readonly CollectionPlanView[]): CollectionPlanView[] {
  return [...plans].sort(
    (a, b) =>
      planSortRank(a) - planSortRank(b) ||
      b.updatedAt - a.updatedAt ||
      a.eggGameId - b.eggGameId,
  );
}

/** 卡面角标用当前那条需求（优先已认领），没有需求就不画角标。 */
export function demandForCard(plan: CollectionPlanView): CollectionPlanDemandView | null {
  if (plan.demands.length === 0) return null;
  return plan.demands.find((demand) => demand.status === 'claimed') ?? plan.demands[0] ?? null;
}

/** 本次需求对应的性格（卡面只显示这些，其余进详情）。 */
export function demandNatures(plan: CollectionPlanView): string[] {
  return [...new Set(plan.demands.map((demand) => demand.nature).filter(Boolean))];
}

/** 推进超时阈值：先用 2 天，做成常量便于调（2026-11-08 用户口径）。 */
export const PLAN_STALE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 停在同一状态多少天；未超阈值返回 0。 */
export function planStaleDays(
  plan: Pick<CollectionPlanView, 'status' | 'updatedAt'>,
  now = Date.now(),
): number {
  if (plan.status !== 'active') return 0;
  const days = Math.floor((now - plan.updatedAt) / DAY_MS);
  return days >= PLAN_STALE_DAYS ? days : 0;
}

export interface PlanReason {
  text: string;
  tone: PlanTone;
}

/**
 * 卡面第二行：一句话说「谁 + 停在哪 + 多久」。
 *
 * 不再写「已认领 → 已上窝」这种历史轨迹：需求方只关心现在卡在哪、该谁动。
 */
export function planReason(
  plan: CollectionPlanView,
  viewerAccountId: string,
  memberName: (accountId: string) => string,
  _now = Date.now(),
): PlanReason {
  if (plan.status === 'backlog') return { text: '想收 · 还没开始', tone: 'slate' };
  if (plan.status === 'done') return { text: '已完成', tone: 'green' };

  const demand = demandForCard(plan);
  const claimer = demand?.claimerAccountId ?? null;
  const mine = plan.memberAccountId === viewerAccountId;
  const claimerName = claimer ? memberName(claimer) : '';

  if (demand?.placedAt) {
    return mine
      ? { text: `${claimerName} 已上窝 · 等你确认`, tone: 'amber' }
      : { text: `${claimerName} 已上窝 · 等发布人结单`, tone: 'sky' };
  }
  if (claimer) {
    // 停了几天由卡面角标统一表达，这里不重复写天数。
    return { text: `${claimerName} 已认领`, tone: 'sky' };
  }
  if (demand) {
    return { text: '待接单', tone: 'sky' };
  }
  return { text: '还没发需求', tone: 'slate' };
}

export interface PlanPill {
  text: string;
  tone: PlanTone;
}

/** 卡面角标：N 人可提供（发布方不用点详情就知道有人愿意给）、超时提示。 */
export function planPills(
  plan: CollectionPlanView,
  viewerAccountId: string,
  now = Date.now(),
): PlanPill[] {
  const pills: PlanPill[] = [];
  if (plan.memberAccountId === viewerAccountId && plan.status === 'active') {
    const offers = plan.offers.filter((offer) => offer.offerAccountId !== viewerAccountId);
    if (offers.length > 0) pills.push({ text: `${offers.length} 人可提供`, tone: 'green' });
  }
  const stale = planStaleDays(plan, now);
  if (stale > 0 && !plan.needsConfirm && plan.progressStep < 4) {
    const demand = demandForCard(plan);
    pills.push({
      text: demand?.claimerAccountId ? `${stale} 天没上窝` : `${stale} 天没人接`,
      tone: 'amber',
    });
  }
  return pills;
}

/** 卡面细进度条：4 段（待接单 → 已认领 → 已上窝 → 待我确认），完成变绿、当前琥珀。 */
export type PlanBarState = 'done' | 'current' | 'todo';

export function planBarSegments(
  plan: Pick<CollectionPlanView, 'progressStep' | 'status' | 'needsConfirm'>,
): PlanBarState[] {
  const states: PlanBarState[] = ['todo', 'todo', 'todo', 'todo'];
  if (plan.status === 'backlog' || plan.progressStep <= 0) return states;
  if (plan.status === 'done' || plan.progressStep >= 5) {
    return ['done', 'done', 'done', 'done'];
  }
  // 待我确认 / 已上窝都算走到第 4 段
  const step = plan.needsConfirm || plan.progressStep >= 4 ? 4 : plan.progressStep;
  return states.map((_, index) =>
    index < step - 1 ? 'done' : index === step - 1 ? 'current' : 'todo',
  );
}

export interface NatureRow {
  name: string;
  active: boolean;
}

export interface NatureColumn {
  rows: NatureRow[];
  more: number;
}

/**
 * 右上角性格列：最多 3 行。
 * - 本次需求对应的性格排最前（一定显示、一定高亮）；
 * - 其余按推荐性格顺序跟在后面；
 * - 超过 3 个收成「+N」，不把卡撑破。
 */
export function buildNatureColumn(
  natures: readonly string[],
  activeNatures: readonly string[] = [],
  max = 3,
): NatureColumn {
  const base = [...new Set(natures.filter((name) => name.trim().length > 0))];
  const active = [...new Set(activeNatures.filter((name) => name.trim().length > 0))];
  const list = [...new Set([...active.filter((name) => !base.includes(name)), ...base])];
  if (list.length === 0) return { rows: [], more: 0 };
  const shown = list.length <= max ? list : list.slice(0, max - 1);
  return {
    rows: shown.map((name) => ({ name, active: active.includes(name) })),
    more: list.length - shown.length,
  };
}
