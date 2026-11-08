import { useMemo, useState, type ReactNode } from 'react';
import type { CollectionPlansResponse, CollectionPlanView } from '../../api/collectionGroups';
import type { SpeciesEntry } from '../../domain/types';
import type { NatureOverrides } from '../../domain/recommendedNatures';
import { PlanCard, type PlanCardActionKind } from './PlanCard';
import {
  demandNatures,
  formatPlanConditions,
  planConditions,
  planPills,
  planReason,
  sortPlansForMe,
} from './planCardModel';

export interface MyCollectionViewProps {
  viewerAccountId: string;
  data: CollectionPlansResponse | null;
  loading: boolean;
  error: string | null;
  species: readonly SpeciesEntry[];
  /** 个人推荐性格覆盖：想收卡没有需求时，用它算缺口性格。 */
  natureOverrides?: NatureOverrides;
  /** 上次离开小组页的时间：之后新增的「我能提供」算新提供。 */
  alertSeenAt: number;
  onOpenPlan: (plan: CollectionPlanView) => void;
  onAction: (plan: CollectionPlanView, kind: PlanCardActionKind) => void;
  /** 主按钮「添加想收」：打开选蛋弹层（多选落想收）。 */
  onAddWish: () => void;
  /** 全部缺口：独立入口（盘货 + 发需求），不作为添加想收的落点。 */
  onOpenGaps: () => void;
}

/**
 * 我的收集：只回答「我的计划推进到哪了」。
 * - 进行中不设数量上限（2026-11-09 用户决策），按「待我确认 > 待接单 > 已认领/已上窝 > 无进展」排；
 * - 想收默认折叠；没有需求时卡面条件行用「口径默认值 + 这颗蛋的目标性格」，不留空白；
 * - 添加想收走选蛋弹层（多选落想收）；全部缺口是独立入口，只做盘货 + 发需求。
 */
export function MyCollectionView({
  viewerAccountId,
  data,
  loading,
  error,
  species,
  natureOverrides,
  alertSeenAt,
  onOpenPlan,
  onAction,
  onAddWish,
  onOpenGaps,
}: MyCollectionViewProps) {
  const [wishOpen, setWishOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const now = Date.now();

  const mine = useMemo(
    () => (data?.plans ?? []).filter((plan) => plan.memberAccountId === viewerAccountId),
    [data, viewerAccountId],
  );
  const active = useMemo(
    () => sortPlansForMe(mine.filter((plan) => plan.status === 'active')),
    [mine],
  );
  const backlog = useMemo(
    () => mine.filter((plan) => plan.status === 'backlog'),
    [mine],
  );
  /** 已完成回看：只陈列历史，不参与上面的排序与提醒口径。 */
  const done = useMemo(
    () => mine.filter((plan) => plan.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt),
    [mine],
  );

  const memberName = (accountId: string) =>
    data?.members.find((member) => member.accountId === accountId)?.displayName ?? '组员';

  /** 待确认 X · 新提供 Y：卡面角标的来源，也是「小组」tab 红点的口径。 */
  const needsConfirm = active.filter((plan) => plan.needsConfirm || plan.progressStep >= 4).length;
  const newOffers = active.reduce(
    (sum, plan) =>
      sum +
      plan.offers.filter(
        (offer) => offer.offerAccountId !== viewerAccountId && offer.updatedAt > alertSeenAt,
      ).length,
    0,
  );

  const renderCard = (plan: CollectionPlanView) => {
    const conditions = planConditions(plan, { species, overrides: natureOverrides });
    // 想收且还没发需求：第二行换成条件行（口径默认值），性格列用这颗蛋的目标性格。
    const wishOnly = plan.status === 'backlog' && plan.demands.length === 0;
    return (
      <PlanCard
        key={plan.id}
        plan={plan}
        species={species}
        natures={wishOnly ? conditions.natures : demandNatures(plan)}
        reason={
          wishOnly
            ? formatPlanConditions(conditions, { missingNatures: conditions.natures })
            : planReason(plan, viewerAccountId, memberName, now).text
        }
        pills={planPills(plan, viewerAccountId, now)}
        onOpen={onOpenPlan}
        onAction={onAction}
      />
    );
  };

  if (loading && !data) {
    return (
      <section data-testid="my-collection" className="p-3 text-xs text-slate-400">
        正在读计划…
      </section>
    );
  }

  return (
    <section data-testid="my-collection" className="flex flex-col gap-3 p-3">
      <header className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-slate-800">我的收集</h3>
        <span className="text-[11px] text-slate-400" data-testid="my-collection-counts">
          {needsConfirm > 0 ? `待确认 ${needsConfirm}` : '待确认 0'}
          {' · '}
          {newOffers > 0 ? `新提供 ${newOffers}` : '新提供 0'}
        </span>
        <button
          type="button"
          onClick={onAddWish}
          className="ml-auto rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500"
          data-testid="my-collection-add"
        >
          添加想收
        </button>
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] text-rose-600">{error}</p>
      ) : null}

      {active.length === 0 && backlog.length === 0 && done.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center">
          <p className="text-xs text-slate-400">还没有计划</p>
          <button
            type="button"
            onClick={onAddWish}
            className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
            data-testid="my-collection-empty-add"
          >
            添加想收
          </button>
        </div>
      ) : null}

      {active.length > 0 ? (
        <div className="grid grid-cols-2 gap-2" data-testid="my-collection-active">
          {active.map(renderCard)}
        </div>
      ) : null}

      {backlog.length > 0 ? (
        <FoldSection
          testId="my-collection-wish"
          title="想收"
          count={backlog.length}
          open={wishOpen}
          onToggle={() => setWishOpen((open) => !open)}
        >
          <div className="mt-2 grid grid-cols-2 gap-2">
            {backlog.map(renderCard)}
          </div>
        </FoldSection>
      ) : null}

      {done.length > 0 ? (
        <FoldSection
          testId="my-collection-done"
          title="已完成"
          count={done.length}
          open={doneOpen}
          onToggle={() => setDoneOpen((open) => !open)}
        >
          <div className="mt-2 grid grid-cols-2 gap-2">
            {done.map(renderCard)}
          </div>
        </FoldSection>
      ) : null}

      <button
        type="button"
        onClick={onOpenGaps}
        className="self-start text-[11px] text-slate-400 underline underline-offset-2"
        data-testid="my-collection-all-gaps"
      >
        全部缺口
      </button>
    </section>
  );
}

/** 「想收 / 已完成」共用同一个折叠壳，避免两套观感。 */
function FoldSection({
  testId,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  testId: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold text-slate-600">{title}</span>
        <span className="text-[11px] text-slate-400">{count}</span>
        <span className="ml-auto text-[11px] text-slate-400">{open ? '收起' : '展开'}</span>
      </button>
      {open ? children : null}
    </div>
  );
}
