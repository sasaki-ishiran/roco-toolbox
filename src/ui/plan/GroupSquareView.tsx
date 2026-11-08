import { useMemo } from 'react';
import type { CollectionPlansResponse, CollectionPlanView } from '../../api/collectionGroups';
import type { SpeciesEntry } from '../../domain/types';
import { PlanCard, type PlanCardAction, type PlanCardActionKind } from './PlanCard';
import { planPills, planReason, sortPlansForMe } from './planCardModel';

export interface GroupSquareViewProps {
  viewerAccountId: string;
  data: CollectionPlansResponse | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  species: readonly SpeciesEntry[];
  onOpenPlan: (plan: CollectionPlanView) => void;
  onAction: (plan: CollectionPlanView, kind: PlanCardActionKind) => void;
}

/** 需求条件是否更严：多条性格 / 极端体型声音视为「可能不符」，排在能接的后面。 */
function hasStrictConditions(plan: CollectionPlanView): boolean {
  return (
    plan.demands.length > 1 ||
    plan.demands.some(
      (demand) =>
        demand.body === '满体重' || demand.body === '零体重' || demand.voice === '-100',
    )
  );
}

/**
 * 组内广场（2026-11-08）。
 *
 * 硬约束：和「我的收集」共用同一套两列卡（`PlanCard`），不单列、不横卡。
 * 广场只多三样东西：分区、排序、卡面理由/角标。
 *
 * 三个分区按「我要不要动手」排：
 * 1. 需要你处理：我接的单（还没上窝 / 停太久）；
 * 2. 你能接的：别人还没人接的计划，按「我号里有蛋 > 图鉴有要现孵 > 条件可能不符」排；
 * 3. 其他人在收：已经被别人接走的计划，只看不动。
 */
export function GroupSquareView({
  viewerAccountId,
  data,
  loading,
  error,
  busy,
  species,
  onOpenPlan,
  onAction,
}: GroupSquareViewProps) {
  const now = Date.now();

  const memberName = (accountId: string) =>
    data?.members.find((member) => member.accountId === accountId)?.displayName ?? '组员';

  const { needsYou, canTake, others } = useMemo(() => {
    const active = (data?.plans ?? []).filter(
      (plan) => plan.memberAccountId !== viewerAccountId && plan.status === 'active',
    );
    const matchable = new Set(data?.matchableEggIds ?? []);
    // 按「需求」分区，不是按计划：一条计划里只要还有没人接的需求，就仍然可接。
    const needsYou: CollectionPlanView[] = [];
    const canTake: CollectionPlanView[] = [];
    const others: CollectionPlanView[] = [];
    for (const plan of active) {
      const mineClaimed = plan.demands.some(
        (demand) => demand.claimerAccountId === viewerAccountId,
      );
      const stillOpen = plan.demands.some((demand) => !demand.claimerAccountId);
      if (mineClaimed) {
        needsYou.push(plan);
      } else if (plan.demands.length === 0 || stillOpen) {
        // 没有需求的计划也放这里：动作给「我可提供」，不再点出假报错。
        canTake.push(plan);
      } else {
        others.push(plan);
      }
    }
    const tier = (plan: CollectionPlanView) =>
      matchable.has(plan.eggGameId) ? 1 : hasStrictConditions(plan) ? 3 : 2;
    return {
      needsYou: sortPlansForMe(needsYou),
      canTake: sortPlansForMe(canTake).sort((a, b) => tier(a) - tier(b)),
      others: sortPlansForMe(others),
    };
  }, [data, viewerAccountId]);

  const matchable = useMemo(
    () => new Set(data?.matchableEggIds ?? []),
    [data?.matchableEggIds],
  );

  const cageReason = (plan: CollectionPlanView): string => {
    if (matchable.has(plan.eggGameId)) return '我号里有这颗蛋';
    return hasStrictConditions(plan) ? '条件可能不符' : '图鉴里有、需要现孵';
  };

  const cardProps = (plan: CollectionPlanView, action: PlanCardAction, emphasis = false) => ({
    plan,
    species,
    natures: plan.demands.map((demand) => demand.nature).filter(Boolean),
    pills: planPills(plan, viewerAccountId, now),
    action,
    emphasis,
    onOpen: onOpenPlan,
    onAction,
  });

  if (loading && !data) {
    return (
      <section data-testid="group-square" className="p-3 text-xs text-slate-400">
        正在读组内计划…
      </section>
    );
  }

  const total = needsYou.length + canTake.length + others.length;

  return (
    <section data-testid="group-square" className="flex flex-col gap-3 p-3">
      {error ? (
        <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] text-rose-600">{error}</p>
      ) : null}

      {needsYou.length > 0 ? (
        <div data-testid="group-square-needs-you">
          <SectionTitle
            title="需要你处理"
            count={needsYou.length}
            tone="text-amber-700"
            hint="你接的单"
          />
          <div className="grid grid-cols-2 gap-2">
            {needsYou.map((plan) => {
              const demand = plan.demands.find(
                (item) => item.claimerAccountId === viewerAccountId,
              );
              const reason = demand?.placedAt
                ? '你已上窝 · 等发布人确认'
                : '你已接单 · 还没上窝';
              return (
                <PlanCard
                  key={plan.id}
                  {...cardProps(
                    plan,
                    { label: '已接单 · 撤回', kind: 'release', variant: 'outline' },
                    true,
                  )}
                  reason={reason}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {canTake.length > 0 ? (
        <div data-testid="group-square-can-take">
          <SectionTitle
            title="你能接的"
            count={canTake.length}
            tone="text-emerald-700"
            hint="按匹配度排"
          />
          <div className="grid grid-cols-2 gap-2">
            {canTake.map((plan) => {
              const noDemand = plan.demands.length === 0;
              return (
                <PlanCard
                  key={plan.id}
                  {...cardProps(
                    plan,
                    noDemand
                      ? { label: '我可提供', kind: 'offer', variant: 'outline' }
                      : { label: '接单', kind: 'claim', variant: 'primary' },
                  )}
                  reason={
                    noDemand
                      ? planReason(plan, viewerAccountId, memberName, now).text
                      : cageReason(plan)
                  }
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {others.length > 0 ? (
        <div data-testid="group-square-others">
          <SectionTitle title="其他人在收" count={others.length} tone="text-slate-500" />
          <div className="grid grid-cols-2 gap-2">
            {others.map((plan) => (
              <PlanCard
                key={plan.id}
                {...cardProps(plan, { label: '看详情', kind: 'detail', variant: 'muted' })}
                reason={planReason(plan, viewerAccountId, memberName, now).text}
              />
            ))}
          </div>
        </div>
      ) : null}

      {total === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
          组里暂时没有别人在收
        </p>
      ) : null}

      {busy ? <p className="text-[10px] text-slate-400">正在提交…</p> : null}
    </section>
  );
}

function SectionTitle({
  title,
  count,
  tone,
  hint,
}: {
  title: string;
  count: number;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline gap-1.5">
      <span className={`text-xs font-semibold ${tone}`}>{title}</span>
      <span className="text-[11px] text-slate-400">{count} 条</span>
      {hint ? <span className="ml-auto text-[10px] text-slate-400">{hint}</span> : null}
    </div>
  );
}
