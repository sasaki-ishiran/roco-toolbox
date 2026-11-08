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

import type { SharedProductionLine } from './motherGroups';

export const PLAN_STATUSES = ['backlog', 'active', 'done'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  backlog: '想收',
  active: '进行中',
  done: '已完成',
};

/** 新建 / 批量导入一律落「想收」。 */
export const DEFAULT_PLAN_STATUS: PlanStatus = 'backlog';

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
  /**
   * 当前查看者：认领人自己看停在 3（已上窝），发布人看才合并成 4（待我确认）。
   * 不传按发布人视角，兼容旧调用。
   */
  viewerAccountId?: string;
}): PlanProgressStep {
  const { plan, demands, completions, viewerAccountId } = input;
  if (plan.status === 'done') return 5;
  const mine = demands.filter((row) => belongsToPlan(plan, row));
  if (mine.some((row) => row.placedAt != null)) {
    // 发布人（或不带视角）看到「待我确认」；其他人看到里程碑「已上窝」。
    return viewerAccountId && viewerAccountId !== plan.memberAccountId ? 3 : 4;
  }
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

/** 一条计划当前还没结单的需求条件（来自需求行）。 */
export interface PlanMatchTarget {
  nature: string;
  body: string;
  voice: string;
}

/** 档位 → 体型；与 `src/domain/petFilters.ts` 的 GRADE_BODY 同口径。 */
const GRADE_BODY: Record<SharedProductionLine['grade'], string> = {
  大婉: '大块头',
  小婉: '小体型',
  大粗: '大块头',
  小粗: '小体型',
};

/** 声音标签 → 可接受的档位；与 `src/domain/productionLines.ts` 的 VOICE_GRADES 同口径。 */
const VOICE_GRADES: Record<string, readonly SharedProductionLine['grade'][]> = {
  '+100': ['大婉', '小婉'],
  婉转声: ['大婉', '小婉'],
  '-100': ['大粗', '小粗'],
  粗嗓门: ['大粗', '小粗'],
};

/** 一条产线能否产出目标体型 / 声音 / 性格。 */
function lineSuppliesTarget(line: SharedProductionLine, target: PlanMatchTarget): boolean {
  if (target.body && GRADE_BODY[line.grade] !== target.body) return false;
  if (target.nature && !line.natures.includes(target.nature)) return false;
  if (!target.voice) return true;
  return (VOICE_GRADES[target.voice] ?? []).includes(line.grade);
}

/**
 * 组内广场置顶「你能补的」：我的产线能满足别人进行中的计划，按蛋去重。
 *
 * 2026-11-09 用户口径（回到 2026-10-28 的产线口径）：目标体型 / 声音 / 性格能产才算能补；
 * 只有旧摘要没带产线（`myLines === undefined`）时才退回「我号里有任意母本」。
 * `myLines` 为 `[]` 表示已发布但确实没有产线，此时一律不算能补。
 */
export function matchablePlanEggIds(input: {
  myAccountId: string;
  /** 我发布过的共享账号里出现过的蛋（只在旧数据兜底时使用）。 */
  myEggGameIds: readonly number[];
  /** 我在组内发布过的产线（多账号合并）；`undefined` = 旧摘要没带产线。 */
  myLines?: readonly SharedProductionLine[];
  plans: readonly (Pick<CollectionPlan, 'eggGameId' | 'memberAccountId' | 'status'> & {
    /** 这条计划还没结单的需求条件；为空表示还没发需求，只要是这颗蛋就行。 */
    demands?: readonly PlanMatchTarget[];
  })[];
}): number[] {
  const lineAware = input.myLines !== undefined;
  const linesByEgg = new Map<number, SharedProductionLine[]>();
  for (const line of input.myLines ?? []) {
    const list = linesByEgg.get(line.eggGameId) ?? [];
    list.push(line);
    linesByEgg.set(line.eggGameId, list);
  }
  const ownedEggs = new Set(input.myEggGameIds);
  const matched = new Set<number>();
  for (const plan of input.plans) {
    if (plan.status !== 'active') continue;
    if (plan.memberAccountId === input.myAccountId) continue;
    if (!lineAware) {
      if (ownedEggs.has(plan.eggGameId)) matched.add(plan.eggGameId);
      continue;
    }
    const lines = linesByEgg.get(plan.eggGameId) ?? [];
    if (lines.length === 0) continue;
    const targets = plan.demands ?? [];
    const supply =
      targets.length === 0 ||
      targets.some((target) => lines.some((line) => lineSuppliesTarget(line, target)));
    if (supply) matched.add(plan.eggGameId);
  }
  return [...matched].sort((a, b) => a - b);
}

/* ---------- 进行中计数 ---------- */

export function countActivePlans(
  plans: readonly Pick<CollectionPlan, 'status'>[],
): number {
  return plans.filter((plan) => plan.status === 'active').length;
}

/* ---------- 创建 / 批量导入 ---------- */

export interface PlanCreateDecision {
  /** 真正要新建的行：同一个蛋只出现一次。 */
  create: { eggGameId: number; status: 'backlog' | 'active' }[];
  /** 已有计划（任意状态）而跳过的条数。 */
  skipped: number;
  /** 跳过里属于「已完成」的条数，用于「已完成的 N 颗已跳过」。 */
  doneSkipped: number;
}

/**
 * 新建 / 批量导入的落库决策（同组同人同蛋唯一由 UNIQUE 兜底，这里只算状态）。
 *
 * - 已有计划（想收 / 进行中 / 已完成）一律跳过，不重复建、不覆盖别人的进度；
 * - `start = false`（添加想收、批量导入缺口）全部落「想收」；
 * - `start = true` 全部落「进行中」（2026-11-09 用户决策：进行中不设数量上限）。
 */
export function planCreateDecision(input: {
  eggGameIds: readonly number[];
  existing: readonly Pick<CollectionPlan, 'eggGameId' | 'status'>[];
  start: boolean;
}): PlanCreateDecision {
  const existing = new Map<number, PlanStatus>();
  for (const plan of input.existing) existing.set(plan.eggGameId, plan.status);

  const create: PlanCreateDecision['create'] = [];
  const seen = new Set<number>();
  let skipped = 0;
  let doneSkipped = 0;

  for (const eggGameId of input.eggGameIds) {
    if (seen.has(eggGameId)) continue;
    seen.add(eggGameId);
    const status = existing.get(eggGameId);
    if (status) {
      skipped += 1;
      if (status === 'done') doneSkipped += 1;
      continue;
    }
    create.push({ eggGameId, status: input.start ? 'active' : 'backlog' });
  }
  return { create, skipped, doneSkipped };
}

/* ---------- 点「开始」的结果 ---------- */

export type PlanStartOutcome = 'activate' | 'already-active' | 'done';

/**
 * 「开始」按钮的结果：想收 → 进行中（不设数量上限）；已经进行中 → 幂等；已完成 → 不允许回退。
 */
export function planStartOutcome(status: PlanStatus): PlanStartOutcome {
  if (status === 'done') return 'done';
  if (status === 'active') return 'already-active';
  return 'activate';
}
