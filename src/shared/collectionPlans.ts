/**
 * 收集计划（2026-11-08 整合重构第一批 C1）：跨端类型、常量与纯领域规则。
 *
 * 「收集计划」是成员在小组内的收集心愿：按蛋（物种 / 进化链）粗粒度，
 * 同一成员在同一组同一颗蛋只有一条，状态在「想收 → 进行中 → 已完成」之间流转。
 * 与 `collectionGroups.ts` 里的需求（蛋 + 性格 + 性别 + 体型 + 声音）是两层：
 * 一条计划可以先后发多条需求，计划是否完成看这颗蛋的需求是不是「全部结单」。
 *
 * Functions 会直接类型导入本文件，因此**不能有 React / DOM / IndexedDB 依赖**，
 * 也不能 import `src/domain/*`（那里依赖图鉴与浏览器数据）。
 * 表定义见 `functions/schema.sql` 的 `>>> collection-plans (2026-11-08)` 区块。
 */

export const PLAN_STATUSES = ['backlog', 'active', 'done'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  backlog: '想收',
  active: '进行中',
  done: '已完成',
};

/** 新建 / 批量导入一律落「想收」。 */
export const DEFAULT_PLAN_STATUS: PlanStatus = 'backlog';

/** 一位成员在同一组最多同时进行 8 条计划；「想收」不占额度。 */
export const MAX_ACTIVE_PLANS = 8;

export interface CollectionPlan {
  id: string;
  groupId: string;
  memberAccountId: string;
  /** 蛋的 gameId（物种 / 进化链级）。 */
  eggGameId: number;
  note: string;
  status: PlanStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanOffer {
  id: string;
  groupId: string;
  planId: string;
  offerAccountId: string;
  note: string;
  /** 一期只有 pending（标记即生效），留给后续「已提供 / 已谢绝」。 */
  status: 'pending';
  createdAt: number;
  updatedAt: number;
}

/* ---------- 状态机 ---------- */

export const PLAN_EVENTS = ['start', 'publish-demand', 'complete'] as const;
/** start = 点「开始」；publish-demand = 给这条计划发需求；complete = 手动完成。 */
export type PlanEvent = (typeof PLAN_EVENTS)[number];

/** 该事件在当前状态下是否允许（已完成是不可逆终态）。 */
export function canApplyPlanEvent(status: PlanStatus, event: PlanEvent): boolean {
  if (status === 'done') return false;
  switch (event) {
    case 'start':
    case 'publish-demand':
      // 想收 → 进行中；进行中重复操作无副作用
      return true;
    case 'complete':
      // 想收也能直接完成（用户手里已经有这颗蛋时，不该被迫先点「开始」）
      return true;
  }
}

/** 事件后的状态；不允许的事件原样返回（调用方应先用 canApplyPlanEvent 判断）。 */
export function planStatusAfter(status: PlanStatus, event: PlanEvent): PlanStatus {
  if (!canApplyPlanEvent(status, event)) return status;
  if (event === 'complete') return 'done';
  return 'active';
}

/** 删除 = 物理删除（plan_offers 级联清理），任何状态都能删。 */
export function canDeletePlan(status: PlanStatus): boolean {
  void status;
  return true;
}

/* ---------- 「全部结单才完成」 ---------- */

/** 需求表里仍未结单的行（open / claimed）；已完成的行已搬进归档表。 */
export interface PlanDemandLike {
  eggGameId: number;
  demanderAccountId: string;
  status: 'open' | 'claimed';
  /** 非空 = 认领人已标记「已上窝」，发布人应看到「待我确认」。 */
  placedAt?: number | null;
}

export interface PlanCompletionLike {
  eggGameId: number;
  demanderAccountId: string;
}

const belongsToPlan = (
  plan: Pick<CollectionPlan, 'memberAccountId' | 'eggGameId'>,
  row: { demanderAccountId: string; eggGameId: number },
): boolean =>
  row.demanderAccountId === plan.memberAccountId && row.eggGameId === plan.eggGameId;

/**
 * 计划是否该自动完成：进行中 + 这颗蛋已没有任何未结单需求 + 至少一条已完成归档。
 *
 * 「中途撤回不算完成」：撤回会把需求行删掉，因此全撤回时归档为 0，不会触发自动完成。
 */
export function shouldAutoCompletePlan(input: {
  plan: Pick<CollectionPlan, 'status' | 'memberAccountId' | 'eggGameId'>;
  /** 组内仍未结单的需求（不需要预先按蛋过滤）。 */
  demands: readonly PlanDemandLike[];
  /** 该成员这颗蛋的已完成归档（不需要预先过滤）。 */
  completions: readonly PlanCompletionLike[];
}): boolean {
  const { plan, demands, completions } = input;
  if (plan.status !== 'active') return false;
  if (demands.some((row) => belongsToPlan(plan, row))) return false;
  return completions.some((row) => belongsToPlan(plan, row));
}

/* ---------- 计划卡状态徽标流 ---------- */

/**
 * 徽标流步骤：
 * 0 还没发需求 → 1 待接单 → 2 已认领 → 3 已上窝（里程碑）→ 4 待我确认（高亮）→ 5 已完成。
 *
 * 已上窝直接返回 4：第 3 步只作为已走过的里程碑展示，不单独停留。
 */
export type PlanProgressStep = 0 | 1 | 2 | 3 | 4 | 5;

export const PLAN_PROGRESS_LABELS = [
  '还没发需求',
  '待接单',
  '已认领',
  '已上窝',
  '待我确认',
  '已完成',
] as const;

export function planProgressStep(input: {
  plan: Pick<CollectionPlan, 'status' | 'memberAccountId' | 'eggGameId'>;
  demands: readonly PlanDemandLike[];
  completions: readonly PlanCompletionLike[];
}): PlanProgressStep {
  const { plan, demands, completions } = input;
  if (plan.status === 'done') return 5;
  const mine = demands.filter((row) => belongsToPlan(plan, row));
  if (mine.some((row) => row.placedAt != null)) return 4;
  if (mine.some((row) => row.status === 'claimed')) return 2;
  if (mine.length > 0) return 1;
  if (completions.some((row) => belongsToPlan(plan, row))) return 5;
  return 0;
}

/** 第 4 步需要发布人点「确认收货」，界面上要高亮。 */
export function planNeedsConfirm(step: PlanProgressStep): boolean {
  return step === 4;
}

/* ---------- 「你能补的」匹配 ---------- */

/**
 * 组内广场置顶「你能补的」：我的已发布资源包含这颗蛋 × 别人进行中的计划，按蛋去重。
 *
 * 不区分性格 / 性别 / 体型 / 声音——那是发需求时的事，这里只回答「这颗蛋你有」。
 */
export function matchablePlanEggIds(input: {
  myAccountId: string;
  /** 我发布过的共享账号里出现过的蛋（可重复）。 */
  myEggGameIds: readonly number[];
  plans: readonly Pick<CollectionPlan, 'eggGameId' | 'memberAccountId' | 'status'>[];
}): number[] {
  const mine = new Set(input.myEggGameIds);
  const matched = new Set<number>();
  for (const plan of input.plans) {
    if (plan.status !== 'active') continue;
    if (plan.memberAccountId === input.myAccountId) continue;
    if (!mine.has(plan.eggGameId)) continue;
    matched.add(plan.eggGameId);
  }
  return [...matched].sort((a, b) => a - b);
}

/* ---------- 进行中上限 ---------- */

export function countActivePlans(
  plans: readonly Pick<CollectionPlan, 'status'>[],
): number {
  return plans.filter((plan) => plan.status === 'active').length;
}

/** 当前已有 `activeCount` 条进行中时，还能不能再开始一条。 */
export function canActivatePlan(activeCount: number): boolean {
  const count = Number.isFinite(activeCount) ? Math.max(0, Math.floor(activeCount)) : 0;
  return count < MAX_ACTIVE_PLANS;
}

/* ---------- 创建 / 批量导入 ---------- */

/** 满 8 条时给用户的那一句提示（不报错，只说明落到了「想收」）。 */
export const PLAN_OVERFLOW_NOTICE = '进行中已满 8 条，已放进想收';

export interface PlanCreateDecision {
  /** 真正要新建的行：同一个蛋只出现一次。 */
  create: { eggGameId: number; status: 'backlog' | 'active' }[];
  /** 已有计划（任意状态）而跳过的条数。 */
  skipped: number;
  /** 跳过里属于「已完成」的条数，用于「已完成的 N 颗已跳过」。 */
  doneSkipped: number;
  /** 想直接开始、但进行中已满 8 条而落到「想收」的条数。 */
  overflow: number;
}

/**
 * 新建 / 批量导入的落库决策（同组同人同蛋唯一由 UNIQUE 兜底，这里只算状态）。
 *
 * - 已有计划（想收 / 进行中 / 已完成）一律跳过，不重复建、不覆盖别人的进度；
 * - `start = false`（添加想收、批量导入缺口）全部落「想收」；
 * - `start = true` 时按剩余额度把前几条置为「进行中」，多出来的落「想收」并计入 `overflow`。
 */
export function planCreateDecision(input: {
  eggGameIds: readonly number[];
  existing: readonly Pick<CollectionPlan, 'eggGameId' | 'status'>[];
  start: boolean;
  activeCount: number;
}): PlanCreateDecision {
  const existing = new Map<number, PlanStatus>();
  for (const plan of input.existing) existing.set(plan.eggGameId, plan.status);

  let available = canActivatePlan(input.activeCount)
    ? MAX_ACTIVE_PLANS - Math.max(0, Math.floor(input.activeCount))
    : 0;
  const create: PlanCreateDecision['create'] = [];
  const seen = new Set<number>();
  let skipped = 0;
  let doneSkipped = 0;
  let overflow = 0;

  for (const eggGameId of input.eggGameIds) {
    if (seen.has(eggGameId)) continue;
    seen.add(eggGameId);
    const status = existing.get(eggGameId);
    if (status) {
      skipped += 1;
      if (status === 'done') doneSkipped += 1;
      continue;
    }
    if (input.start && available > 0) {
      create.push({ eggGameId, status: 'active' });
      available -= 1;
    } else {
      create.push({ eggGameId, status: 'backlog' });
      if (input.start) overflow += 1;
    }
  }
  return { create, skipped, doneSkipped, overflow };
}

/* ---------- 点「开始」的结果 ---------- */

export type PlanStartOutcome = 'activate' | 'already-active' | 'overflow' | 'done';

/**
 * 「开始」按钮的结果：想收且还有额度 → 进行中；额度用满 → 留在想收并提示；
 * 已经进行中 → 幂等；已完成 → 不允许回退。
 */
export function planStartOutcome(status: PlanStatus, activeCount: number): PlanStartOutcome {
  if (status === 'done') return 'done';
  if (status === 'active') return 'already-active';
  return canActivatePlan(activeCount) ? 'activate' : 'overflow';
}
