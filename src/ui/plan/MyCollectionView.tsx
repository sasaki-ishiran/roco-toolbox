import { useMemo, useState } from 'react';
import type { CollectionPlansResponse, CollectionPlanView } from '../../api/collectionGroups';
import type { SpeciesEntry } from '../../domain/types';
import { PlanCard, type PlanCardActionKind } from './PlanCard';
import { demandNatures, planPills, planReason, sortPlansForMe } from './planCardModel';

export interface MyCollectionViewProps {
  viewerAccountId: string;
  data: CollectionPlansResponse | null;
  loading: boolean;
  error: string | null;
  species: readonly SpeciesEntry[];
  /** 全部缺口的蛋 id（覆盖引擎算好，批量导入用）。 */
  gapEggIds: readonly number[];
  /** 上次离开小组页的时间：之后新增的「我能提供」算新提供。 */
  alertSeenAt: number;
  busy: boolean;
  onOpenPlan: (plan: CollectionPlanView) => void;
  onAction: (plan: CollectionPlanView, kind: PlanCardActionKind) => void;
  onBulkImport: () => void;
  onOpenGaps: () => void;
}

/**
 * 我的收集：只回答「我的计划推进到哪了」。
 * - 进行中上限 8 条，按「待我确认 > 待接单 > 已认领/已上窝 > 无进展 > 想收」排；
 * - 想收默认折叠，批量导入全部缺口放在折叠区里；
 * - 全量缺口是次要入口，不在主列表里铺开。
 */
export function MyCollectionView({
  viewerAccountId,
  data,
  loading,
  error,
  species,
  gapEggIds,
  alertSeenAt,
  busy,
  onOpenPlan,
  onAction,
  onBulkImport,
  onOpenGaps,
}: MyCollectionViewProps) {
  const [wishOpen, setWishOpen] = useState(false);
  const now = Date.now();

  const mine = useMemo(
    () => (data?.plans ?? []).filter((plan) => plan.memberAccountId === viewerAccountId),
    [data, viewerAccountId],
  );
  const active = useMemo(
    () =>
      sortPlansForMe(mine.filter((plan) => plan.status === 'active')).slice(0, 8),
    [mine],
  );
  const backlog = useMemo(
    () => mine.filter((plan) => plan.status === 'backlog'),
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

  const renderCard = (plan: CollectionPlanView) => (
    <PlanCard
      key={plan.id}
      plan={plan}
      species={species}
      natures={demandNatures(plan)}
      reason={planReason(plan, viewerAccountId, memberName, now).text}
      pills={planPills(plan, viewerAccountId, now)}
      onOpen={onOpenPlan}
      onAction={onAction}
    />
  );

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
          onClick={onOpenGaps}
          className="ml-auto rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500"
          data-testid="my-collection-add"
        >
          添加想收
        </button>
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] text-rose-600">{error}</p>
      ) : null}

      {active.length === 0 && backlog.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center">
          <p className="text-xs text-slate-400">还没有计划</p>
          <button
            type="button"
            onClick={onOpenGaps}
            className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
            data-testid="my-collection-empty-add"
          >
            从全部缺口挑一颗
          </button>
        </div>
      ) : null}

      {active.length > 0 ? (
        <div className="grid grid-cols-2 gap-2" data-testid="my-collection-active">
          {active.map(renderCard)}
        </div>
      ) : null}

      {backlog.length > 0 ? (
        <div data-testid="my-collection-wish">
          <button
            type="button"
            onClick={() => setWishOpen((open) => !open)}
            className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-left"
            aria-expanded={wishOpen}
          >
            <span className="text-xs font-semibold text-slate-600">想收</span>
            <span className="text-[11px] text-slate-400">{backlog.length}</span>
            <span className="ml-auto text-[11px] text-slate-400">
              {wishOpen ? '收起' : '展开'}
            </span>
          </button>
          {wishOpen ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {backlog.map(renderCard)}
              </div>
              <button
                type="button"
                disabled={busy || gapEggIds.length === 0}
                onClick={onBulkImport}
                className="mt-2 w-full rounded-lg border border-emerald-200 py-1.5 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
                data-testid="my-collection-bulk-import"
              >
                {gapEggIds.length > 0
                  ? `批量导入全部缺口（${gapEggIds.length}）`
                  : '没有可导入的缺口'}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpenGaps}
        className="self-start text-[11px] text-slate-400 underline underline-offset-2"
        data-testid="my-collection-all-gaps"
      >
        全部缺口（次要入口）
      </button>
    </section>
  );
}
