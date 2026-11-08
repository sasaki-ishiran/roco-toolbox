import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PLAN_STATUS,
  PLAN_STATUS_LABELS,
  canApplyPlanEvent,
  canDeletePlan,
  countActivePlans,
  matchablePlanEggIds,
  planCreateDecision,
  planNeedsConfirm,
  planProgressStep,
  planStartOutcome,
  planStatusAfter,
  shouldAutoCompletePlan,
  type PlanCompletionLike,
  type PlanDemandLike,
} from './collectionPlans';

const plan = (overrides: Partial<{
  id: string;
  memberAccountId: string;
  eggGameId: number;
  status: 'backlog' | 'active' | 'done';
}> = {}) => ({
  id: 'plan-1',
  groupId: 'g1',
  memberAccountId: 'me',
  eggGameId: 101,
  note: '',
  status: 'active' as const,
  version: 0,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const demand = (overrides: Partial<PlanDemandLike> = {}): PlanDemandLike => ({
  eggGameId: 101,
  demanderAccountId: 'me',
  status: 'open',
  placedAt: null,
  ...overrides,
});

const completion = (overrides: Partial<PlanCompletionLike> = {}): PlanCompletionLike => ({
  eggGameId: 101,
  demanderAccountId: 'me',
  ...overrides,
});

describe('收集计划状态机', () => {
  test('新建计划默认落在「想收」', () => {
    expect(DEFAULT_PLAN_STATUS).toBe('backlog');
    expect(PLAN_STATUS_LABELS.backlog).toBe('想收');
    expect(PLAN_STATUS_LABELS.active).toBe('进行中');
    expect(PLAN_STATUS_LABELS.done).toBe('已完成');
  });

  test('开始：想收 → 进行中；进行中保持；已完成不再变化', () => {
    expect(planStatusAfter('backlog', 'start')).toBe('active');
    expect(planStatusAfter('active', 'start')).toBe('active');
    expect(planStatusAfter('done', 'start')).toBe('done');
    expect(canApplyPlanEvent('backlog', 'start')).toBe(true);
    expect(canApplyPlanEvent('done', 'start')).toBe(false);
  });

  test('发需求自动进行中：想收 → 进行中，已完成不动', () => {
    expect(planStatusAfter('backlog', 'publish-demand')).toBe('active');
    expect(planStatusAfter('active', 'publish-demand')).toBe('active');
    expect(planStatusAfter('done', 'publish-demand')).toBe('done');
    expect(canApplyPlanEvent('backlog', 'publish-demand')).toBe(true);
    expect(canApplyPlanEvent('done', 'publish-demand')).toBe(false);
  });

  test('手动完成：想收 / 进行中都能直接完成；已完成不再变化', () => {
    expect(planStatusAfter('active', 'complete')).toBe('done');
    expect(planStatusAfter('backlog', 'complete')).toBe('done');
    expect(canApplyPlanEvent('active', 'complete')).toBe(true);
    expect(canApplyPlanEvent('backlog', 'complete')).toBe(true);
    expect(canApplyPlanEvent('done', 'complete')).toBe(false);
  });

  test('想收直接完成的路径合法：手里已有这颗蛋时不用先点开始', () => {
    expect(canApplyPlanEvent('backlog', 'start')).toBe(true);
    expect(planStatusAfter('backlog', 'complete')).toBe('done');
    // 完成后徽标流按实际数据走：直接第 5 步，不会因为跳过开始而错乱
    expect(
      planProgressStep({ plan: plan({ status: 'done' }), demands: [], completions: [] }),
    ).toBe(5);
  });

  test('删除是物理删除：任何状态都能删', () => {
    expect(canDeletePlan('backlog')).toBe(true);
    expect(canDeletePlan('active')).toBe(true);
    expect(canDeletePlan('done')).toBe(true);
  });
});

describe('「全部结单才完成」的自动完成判定', () => {
  test('进行中 + 已无未结单需求 + 至少一条已完成 → 自动完成', () => {
    expect(
      shouldAutoCompletePlan({
        plan: plan(),
        demands: [],
        completions: [completion()],
      }),
    ).toBe(true);
  });

  test('还有待承接 / 已接单的需求 → 不完成', () => {
    expect(
      shouldAutoCompletePlan({
        plan: plan(),
        demands: [demand({ status: 'open' })],
        completions: [completion()],
      }),
    ).toBe(false);
    expect(
      shouldAutoCompletePlan({
        plan: plan(),
        demands: [demand({ status: 'claimed' })],
        completions: [completion()],
      }),
    ).toBe(false);
  });

  test('需求全撤回（没有任何已完成归档）→ 不完成', () => {
    expect(
      shouldAutoCompletePlan({ plan: plan(), demands: [], completions: [] }),
    ).toBe(false);
  });

  test('只有想收 / 已完成状态不参与自动完成', () => {
    expect(
      shouldAutoCompletePlan({
        plan: plan({ status: 'backlog' }),
        demands: [],
        completions: [completion()],
      }),
    ).toBe(false);
    expect(
      shouldAutoCompletePlan({
        plan: plan({ status: 'done' }),
        demands: [],
        completions: [completion()],
      }),
    ).toBe(false);
  });

  test('别人 / 别的蛋的需求不挡我的计划完成', () => {
    expect(
      shouldAutoCompletePlan({
        plan: plan(),
        demands: [demand({ demanderAccountId: 'other' }), demand({ eggGameId: 202 })],
        completions: [completion()],
      }),
    ).toBe(true);
  });
});

describe('计划卡状态徽标流（0 未发需求 / 1 待接单 / 2 已认领 / 4 待我确认 / 5 已完成）', () => {
  test('已完成计划固定第 5 步', () => {
    expect(planProgressStep({ plan: plan({ status: 'done' }), demands: [], completions: [] })).toBe(5);
  });

  test('没有需求也没有归档 → 0（还没发需求）', () => {
    expect(planProgressStep({ plan: plan(), demands: [], completions: [] })).toBe(0);
  });

  test('有待承接需求 → 1', () => {
    expect(planProgressStep({ plan: plan(), demands: [demand()], completions: [] })).toBe(1);
  });

  test('已认领但还没上窝 → 2', () => {
    expect(
      planProgressStep({
        plan: plan(),
        demands: [demand({ status: 'claimed', placedAt: null })],
        completions: [],
      }),
    ).toBe(2);
  });

  test('已上窝直接进入第 4 步「待我确认」并高亮', () => {
    const step = planProgressStep({
      plan: plan(),
      demands: [demand({ status: 'claimed', placedAt: 1730000000000 })],
      completions: [],
    });
    expect(step).toBe(4);
    expect(planNeedsConfirm(step)).toBe(true);
    expect(planNeedsConfirm(2)).toBe(false);
  });

  test('多条需求时按最靠后的可操作状态显示：已上窝 > 已认领 > 待接单', () => {
    expect(
      planProgressStep({
        plan: plan(),
        demands: [
          demand({ status: 'open' }),
          demand({ status: 'claimed', placedAt: 1730000000000 }),
        ],
        completions: [],
      }),
    ).toBe(4);
    expect(
      planProgressStep({
        plan: plan(),
        demands: [demand({ status: 'open' }), demand({ status: 'claimed' })],
        completions: [],
      }),
    ).toBe(2);
  });

  test('已上窝的视角差异：发布人看「待我确认」，认领人看停在「已上窝」', () => {
    const placed = {
      plan: plan({ memberAccountId: 'owner' }),
      demands: [demand({ demanderAccountId: 'owner', status: 'claimed' as const, placedAt: 1730000000000 })],
      completions: [],
    };
    // 发布人（或不带视角）→ 4
    expect(planProgressStep(placed)).toBe(4);
    expect(planProgressStep({ ...placed, viewerAccountId: 'owner' })).toBe(4);
    // 认领人 / 旁人 → 3（已上窝），不提前看到「待我确认」
    expect(planProgressStep({ ...placed, viewerAccountId: 'claimer' })).toBe(3);
    expect(planNeedsConfirm(3)).toBe(false);
  });

  test('有归档但又被重新发单 → 优先显示待接单', () => {
    expect(
      planProgressStep({
        plan: plan(),
        demands: [demand({ status: 'open' })],
        completions: [completion()],
      }),
    ).toBe(1);
  });

  test('进行中但没有未结单需求、只有历史归档 → 0，不显示假「已完成」', () => {
    expect(
      planProgressStep({ plan: plan(), demands: [], completions: [completion()] }),
    ).toBe(0);
  });

  test('别人的需求不算进我的徽标流', () => {
    expect(
      planProgressStep({
        plan: plan(),
        demands: [demand({ demanderAccountId: 'other', status: 'claimed', placedAt: 1 })],
        completions: [],
      }),
    ).toBe(0);
  });
});

describe('「你能补的」匹配口径', () => {
  test('只匹配别人进行中的计划，按蛋去重排序', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [101, 202],
        plans: [
          plan({ id: 'p1', memberAccountId: 'other', eggGameId: 202 }),
          plan({ id: 'p2', memberAccountId: 'other-2', eggGameId: 202 }),
          plan({ id: 'p3', memberAccountId: 'other', eggGameId: 101 }),
          plan({ id: 'p4', memberAccountId: 'me', eggGameId: 101 }),
        ],
      }),
    ).toEqual([101, 202]);
  });

  test('想收 / 已完成的计划不进「你能补的」', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [101, 202],
        plans: [
          plan({ id: 'p1', memberAccountId: 'other', eggGameId: 101, status: 'backlog' }),
          plan({ id: 'p2', memberAccountId: 'other', eggGameId: 202, status: 'done' }),
        ],
      }),
    ).toEqual([]);
  });

  test('我不产出的蛋不出现；没有已发布资源时为空', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [101],
        plans: [plan({ id: 'p1', memberAccountId: 'other', eggGameId: 202 })],
      }),
    ).toEqual([]);
    expect(
      matchablePlanEggIds({ myAccountId: 'me', myEggGameIds: [], plans: [plan()] }),
    ).toEqual([]);
  });
});

describe('「你能补的」按产线判定（2026-11-09 用户口径）', () => {
  const otherPlan = (
    eggGameId: number,
    demands?: Array<{ nature: string; body: string; voice: string }>,
  ) => ({ ...plan({ eggGameId, memberAccountId: 'other' }), ...(demands ? { demands } : {}) });

  test('有产线但目标性格产不出 → 不算能补', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [101],
        myLines: [{ eggGameId: 101, grade: '大婉', natures: ['固执'] }],
        plans: [otherPlan(101, [{ nature: '胆小', body: '', voice: '' }])],
      }),
    ).toEqual([]);
  });

  test('体型 / 声音 / 性格都能产 → 算能补（产线优先于蛋 id）', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        // 故意不给 myEggGameIds：产线在时只看产线
        myEggGameIds: [],
        myLines: [{ eggGameId: 101, grade: '大婉', natures: ['固执'] }],
        plans: [otherPlan(101, [{ nature: '固执', body: '大块头', voice: '+100' }])],
      }),
    ).toEqual([101]);
  });

  test('体型对不上 → 不算能补', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [101],
        myLines: [{ eggGameId: 101, grade: '小婉', natures: ['固执'] }],
        plans: [otherPlan(101, [{ nature: '固执', body: '大块头', voice: '' }])],
      }),
    ).toEqual([]);
  });

  test('还没发需求：只要这条产线能产这颗蛋就算能补', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [],
        myLines: [{ eggGameId: 101, grade: '小粗', natures: ['固执'] }],
        plans: [otherPlan(101, [])],
      }),
    ).toEqual([101]);
  });

  test('已发布但没有产线（空数组）→ 一律不算能补', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [101],
        myLines: [],
        plans: [otherPlan(101, [])],
      }),
    ).toEqual([]);
  });

  test('旧摘要没带产线（undefined）→ 退回「我号里有任意母本」', () => {
    expect(
      matchablePlanEggIds({
        myAccountId: 'me',
        myEggGameIds: [101],
        plans: [otherPlan(101, [{ nature: '胆小', body: '大块头', voice: '+100' }])],
      }),
    ).toEqual([101]);
  });
});

describe('进行中计划计数（不设数量上限）', () => {
  test('只数进行中：想收 / 已完成不计数', () => {
    const plans = [
      plan({ id: 'p1', status: 'active' }),
      plan({ id: 'p2', status: 'backlog' }),
      plan({ id: 'p3', status: 'done' }),
    ];
    expect(countActivePlans(plans)).toBe(1);
  });

  test('超过 8 条也继续计数，不做截断', () => {
    const plans = Array.from({ length: 12 }, (_, index) => plan({ id: `p${index}`, status: 'active' }));
    expect(countActivePlans(plans)).toBe(12);
  });
});

describe('创建 / 批量导入的落库决策', () => {
  test('默认全部落想收，重复的蛋只建一条', () => {
    const decision = planCreateDecision({
      eggGameIds: [101, 102, 101],
      existing: [],
      start: false,
    });
    expect(decision.create).toEqual([
      { eggGameId: 101, status: 'backlog' },
      { eggGameId: 102, status: 'backlog' },
    ]);
    expect(decision.skipped).toBe(0);
  });

  test('已存在的计划一律跳过，已完成的单独计数', () => {
    const decision = planCreateDecision({
      eggGameIds: [101, 102, 103],
      existing: [
        { eggGameId: 101, status: 'done' },
        { eggGameId: 102, status: 'active' },
      ],
      start: false,
    });
    expect(decision.create).toEqual([{ eggGameId: 103, status: 'backlog' }]);
    expect(decision.skipped).toBe(2);
    expect(decision.doneSkipped).toBe(1);
  });

  test('start = true 时全部落进行中，已有多少条进行中都不影响', () => {
    const active = Array.from({ length: 8 }, (_, index) =>
      plan({ id: `p${index}`, eggGameId: 200 + index, status: 'active' }),
    );
    const decision = planCreateDecision({
      eggGameIds: [101, 102, 103],
      existing: active,
      start: true,
    });
    expect(decision.create).toEqual([
      { eggGameId: 101, status: 'active' },
      { eggGameId: 102, status: 'active' },
      { eggGameId: 103, status: 'active' },
    ]);
  });
});

describe('点「开始」的结果', () => {
  test('想收 → 进行中；进行中幂等；已完成不允许回退', () => {
    expect(planStartOutcome('backlog')).toBe('activate');
    expect(planStartOutcome('active')).toBe('already-active');
    expect(planStartOutcome('done')).toBe('done');
  });
});
