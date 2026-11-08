import { useEffect, useMemo, useState } from 'react';
import {
  buildMotherCoverage,
  isMotherResourceComparable,
  selectMotherSharingViews,
} from '../../domain/motherSharing';
import { eggNatures } from '../../domain/recommendedNatures';
import { demandKeyOf } from '../../shared/collectionGroups';
import {
  markCollectionDemandPlaced,
  type CollectionPlanDemandView,
  type CollectionPlanView,
} from '../../api/collectionGroups';
import { MotherGroupsApiError } from '../../api/motherGroups';
import { trackPlacementMark } from '../../api/analytics';
import type { MotherGroupResourcesProps } from '../MotherGroupResources';
import { MotherGroupResources } from '../MotherGroupResources';
import { DemandPublishSheet, type DemandPublishItem } from '../DemandPublishSheet';
import { placementRowKey, togglePlacementMark } from '../demandPlacementStore';
import { GroupSquareView } from './GroupSquareView';
import { MyCollectionView } from './MyCollectionView';
import { PlanDetailSheet } from './PlanDetailSheet';
import { useCollectionPlans } from './useCollectionPlans';
import {
  planAlertCounts,
  publishPlanAlertBadge,
  readPlanAlertSeen,
  savePlanAlertSeen,
} from './planAlertsStore';
import type { PlanCardActionKind } from './PlanCard';

type HubTab = 'mine' | 'square';

/** 一次创建请求最多 50 颗蛋（服务端 PLAN_EGGS_MAX），批量导入按批切。 */
const BULK_CHUNK = 50;

export interface GroupPlanHubProps extends MotherGroupResourcesProps {
  /** 当前身份在组里的显示名（「我发布的」筛选用不到，留作扩展）。 */
  className?: string;
}

/**
 * 小组页主视图（2026-11-08）：我的收集 / 组内广场两个 tab。
 *
 * 这里只做编排：计划数据来自 `useCollectionPlans`，需求闭环仍复用
 * `MotherGroupResources`（锁定到「需求中心」/「我缺的」两个视图），
 * 避免把 3.6k 行的老组件一次拆完还丢功能。
 */
export function GroupPlanHub({ className, ...resources }: GroupPlanHubProps) {
  const plans = useCollectionPlans(resources.group.group.id);
  const [tab, setTab] = useState<HubTab>('mine');
  const [gapsOpen, setGapsOpen] = useState(false);
  const [loopOpen, setLoopOpen] = useState(false);
  const [detailPlan, setDetailPlan] = useState<CollectionPlanView | null>(null);
  const [publishPlan, setPublishPlan] = useState<CollectionPlanView | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  const { species, catalogVersion, group, viewerAccountId } = resources;
  const groupId = group.group.id;

  /** 进页面时读一次已读水位：标题里的「新提供」按这次进入前的状态算。 */
  const [alertSeenAt] = useState(() => readPlanAlertSeen(viewerAccountId, groupId));
  const alertCounts = useMemo(
    () => planAlertCounts(plans.data?.plans ?? [], viewerAccountId, alertSeenAt),
    [plans.data?.plans, viewerAccountId, alertSeenAt],
  );
  useEffect(() => {
    publishPlanAlertBadge(alertCounts.total);
  }, [alertCounts.total]);
  // 离开小组页即视为已读（只记本机）；下次进来只提醒之后新增的。
  useEffect(
    () => () => {
      savePlanAlertSeen(viewerAccountId, groupId);
    },
    [viewerAccountId, groupId],
  );

  /** 被移出小组不能静默：接口明确拒绝时给一句人话，而不是只显示原始报错。 */
  const removedNotice =
    plans.error && /403|404|不在|移出|无权|权限|成员/.test(plans.error)
      ? '你已不在这个小组（可能被组长移出），下面的数据可能已经不能操作。'
      : null;

  /** 全部缺口：我缺的蛋（覆盖引擎算），批量导入与「全部缺口」入口共用。 */
  const gapEggIds = useMemo(() => {
    const rows = buildMotherCoverage({
      species,
      catalogVersion,
      members: group.members,
      criteriaId: resources.criteriaId,
    });
    const comparableIds = group.members
      .filter((member) =>
        isMotherResourceComparable(member.resource, catalogVersion, resources.criteriaId),
      )
      .map((member) => member.accountId);
    const views = selectMotherSharingViews(rows, viewerAccountId, comparableIds);
    return (views.missingForMe ?? []).map((row) => row.eggGameId);
  }, [species, catalogVersion, group.members, resources.criteriaId, viewerAccountId]);

  const speciesName = (eggGameId: number) =>
    species.find((entry) => entry.gameId === eggGameId)?.name ?? `#${eggGameId}`;

  const detail = detailPlan
    ? // 计划列表刷新后指针要跟着换，避免二级页显示旧数据。
      ((plans.data?.plans ?? []).find((item) => item.id === detailPlan.id) ?? detailPlan)
    : null;

  const closeDetail = () => setDetailPlan(null);

  /** 动作失败要让用户看到原因，不能静默吞掉。 */
  const messageOf = (failure: unknown) =>
    failure instanceof Error && failure.message ? failure.message : '操作失败，请稍后重试';
  const safe = (task: Promise<unknown>) => {
    void task.catch((failure) => setLocalNotice(messageOf(failure)));
  };

  /** 计划里的需求视图 → 需求中心那条完整记录（接单 / 撤回 / 上窝都要它）。 */
  const findDemandOf = (plan: CollectionPlanView, demandView: CollectionPlanDemandView) => {
    const key = [plan.eggGameId, demandView.nature, demandView.gender, demandView.body, demandView.voice].join(':');
    return resources.demands?.find((item) => demandKeyOf(item) === key) ?? null;
  };

  /** 认领 / 撤回 / 上窝：一键执行，不弹确认。 */
  const handleSquareAction = async (
    plan: CollectionPlanView,
    kind: 'claim' | 'release' | 'place',
  ) => {
    setLocalNotice(null);
    const demandView =
      kind === 'release' || kind === 'place'
        ? plan.demands.find((item) => item.claimerAccountId === viewerAccountId)
        : (plan.demands.find((item) => !item.claimerAccountId) ?? plan.demands[0]);
    if (!demandView) {
      setLocalNotice('需求列表还没同步，稍后重试');
      await plans.refresh();
      return;
    }
    const demand = findDemandOf(plan, demandView);

    if (kind === 'claim') {
      if (!demand || !resources.onClaimDemand) {
        setLocalNotice('需求列表还没同步，稍后重试');
        await plans.refresh();
        return;
      }
      await resources.onClaimDemand(demand);
      await plans.refresh();
      setLocalNotice('已接单 · 可在卡面撤回');
      return;
    }

    if (kind === 'release') {
      if (!demand || !resources.onReleaseDemand) {
        setLocalNotice('需求列表还没同步，稍后重试');
        await plans.refresh();
        return;
      }
      await resources.onReleaseDemand(demand);
      await plans.refresh();
      return;
    }

    // 已上窝：接通服务端，发布方才能走到第 4 步「待我确认」。
    try {
      await markCollectionDemandPlaced(groupId, {
        demanderAccountId: plan.memberAccountId,
        eggGameId: plan.eggGameId,
        nature: demandView.nature,
        gender: demandView.gender,
        body: demandView.body,
        voice: demandView.voice,
        accountKey: null,
      });
      trackPlacementMark(1);
    } catch (failure) {
      // 旧服务端没有 placement 接口：退回本机勾选，历史结单 / 归档数据不受影响。
      if (failure instanceof MotherGroupsApiError && failure.status === 404) {
        togglePlacementMark(
          viewerAccountId,
          placementRowKey({
            groupId,
            demanderAccountId: plan.memberAccountId,
            eggGameId: plan.eggGameId,
            nature: demandView.nature,
            gender: demandView.gender,
            body: demandView.body,
            voice: demandView.voice,
            claimedAt: demand?.updatedAt,
          }),
          true,
        );
        setLocalNotice('当前服务端还不支持「已上窝」，已先记在本机');
      } else {
        throw failure;
      }
    }
    await plans.refresh();
  };

  const handleAction = async (plan: CollectionPlanView, kind: PlanCardActionKind) => {
    setLocalNotice(null);
    try {
      switch (kind) {
        case 'start': {
          const result = await plans.actions.start(plan);
          if (result.notice) setLocalNotice(result.notice);
          return;
        }
        case 'publish':
          openPublish(plan);
          return;
        case 'claim':
        case 'release':
        case 'place':
          await handleSquareAction(plan, kind);
          return;
        case 'offer':
        case 'offered':
          setDetailPlan(plan);
          return;
        case 'confirm': {
          const demandView = plan.demands.find((item) => item.status === 'claimed');
          if (!demandView) {
            setLocalNotice('需求列表还没同步，稍后重试');
            await plans.refresh();
            return;
          }
          const demand = findDemandOf(plan, demandView);
          if (!demand || !resources.onCompleteDemand) {
            setLocalNotice('需求列表还没同步，稍后重试');
            await plans.refresh();
            return;
          }
          await resources.onCompleteDemand(demand);
          await plans.refresh();
          return;
        }
        default:
          setDetailPlan(plan);
      }
    } catch (failure) {
      setLocalNotice(messageOf(failure));
    }
  };

  const bulkImport = async () => {
    if (gapEggIds.length === 0) return;
    setLocalNotice(null);
    try {
      let created = 0;
      let skipped = 0;
      for (let index = 0; index < gapEggIds.length; index += BULK_CHUNK) {
        const result = await plans.actions.create({
          eggGameIds: gapEggIds.slice(index, index + BULK_CHUNK),
          bulk: true,
        });
        created += result.plans.length;
        skipped += result.skipped;
      }
      setLocalNotice(
        skipped > 0 ? `导入 ${created} 条，跳过 ${skipped} 条已存在` : `导入 ${created} 条`,
      );
    } catch (failure) {
      setLocalNotice(messageOf(failure));
    }
  };

  const openPublish = (plan: CollectionPlanView) => {
    setPublishError('');
    setPublishPlan(plan);
  };

  const publishItems: DemandPublishItem[] = publishPlan
    ? [
        {
          eggGameId: publishPlan.eggGameId,
          name: speciesName(publishPlan.eggGameId),
          natures: eggNatures(species, publishPlan.eggGameId, resources.natureOverrides),
        },
      ]
    : [];

  return (
    <section className={className ?? 'space-y-2'} data-testid="group-plan-hub">
      {removedNotice ? (
        <p
          className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] text-rose-700"
          data-testid="plan-hub-removed"
        >
          {removedNotice}
        </p>
      ) : null}
      <div className="flex rounded-xl bg-slate-100 p-0.5" data-testid="group-plan-hub-tabs">
        {(
          [
            { id: 'mine', label: '我的收集' },
            { id: 'square', label: '组内广场' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            data-testid={`plan-hub-tab-${item.id}`}
            className={`min-h-[32px] flex-1 rounded-lg text-xs ${
              tab === item.id ? 'bg-white font-semibold text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {plans.notice ?? localNotice ? (
        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800" data-testid="plan-hub-notice">
          {(localNotice ?? plans.notice) as string}
          <button
            type="button"
            onClick={() => {
              setLocalNotice(null);
              plans.clearNotice();
            }}
            className="ml-2 underline"
          >
            知道了
          </button>
        </p>
      ) : null}

      {tab === 'mine' ? (
        <div className="rounded-2xl bg-white shadow-sm">
          <MyCollectionView
            viewerAccountId={viewerAccountId}
            data={plans.data}
            loading={plans.loading}
            error={plans.error ?? null}
            species={species}
            gapEggIds={gapEggIds}
            alertSeenAt={alertSeenAt}
            busy={plans.busy}
            onOpenPlan={setDetailPlan}
            onAction={(plan, kind) => void handleAction(plan, kind)}
            onBulkImport={() => void bulkImport()}
            onOpenGaps={() => setGapsOpen((open) => !open)}
          />
          {gapsOpen ? (
            <div className="border-t border-slate-100 p-2" data-testid="my-collection-gaps">
              <MotherGroupResources {...resources} viewLock="missing" />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-2xl bg-white shadow-sm">
            <GroupSquareView
              viewerAccountId={viewerAccountId}
              data={plans.data}
              loading={plans.loading}
              error={plans.error ?? null}
              busy={plans.busy}
              species={species}
              onOpenPlan={setDetailPlan}
              onAction={(plan, kind) => void handleAction(plan, kind)}
            />
          </div>
          <div className="rounded-2xl bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setLoopOpen((open) => !open)}
              aria-expanded={loopOpen}
              data-testid="group-square-loop-toggle"
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs"
            >
              <span className="font-medium text-slate-700">接单与结单</span>
              <span className="text-[11px] text-slate-400">
                {resources.demands?.length ?? 0} 条需求 · {loopOpen ? '收起' : '展开'}
              </span>
            </button>
            {loopOpen ? (
              <div className="border-t border-slate-100 p-2">
                <MotherGroupResources {...resources} viewLock="mine" />
              </div>
            ) : null}
          </div>
        </div>
      )}

      <PlanDetailSheet
        plan={detail}
        species={species}
        members={plans.data?.members ?? group.members.map((member) => ({
          accountId: member.accountId,
          displayName: member.displayName,
        }))}
        viewerAccountId={viewerAccountId}
        onClose={closeDetail}
        onStart={(plan) => safe(plans.actions.start(plan))}
        onComplete={(plan) => safe(plans.actions.complete(plan))}
        onDelete={(plan) => {
          closeDetail();
          safe(plans.actions.remove(plan));
        }}
        onSaveOffer={(plan, note) => safe(plans.actions.offer(plan, note))}
        onWithdrawOffer={(plan) => safe(plans.actions.withdrawOffer(plan))}
        onPublishDemand={(plan) => {
          closeDetail();
          openPublish(plan);
        }}
        onPlaceDemand={(plan) => void handleAction(plan, 'place')}
      />

      <DemandPublishSheet
        open={publishPlan != null}
        items={publishItems}
        busy={publishing}
        error={publishError}
        onClose={() => setPublishPlan(null)}
        onConfirm={(items, criteria) => {
          setPublishing(true);
          setPublishError('');
          void (async () => {
            try {
              for (const item of items) {
                await resources.onPublishDemand?.(item.eggGameId, item.natures, criteria);
              }
              setPublishPlan(null);
              await plans.refresh();
            } catch (failure) {
              setPublishError(
                failure instanceof Error && failure.message ? failure.message : '发需求失败',
              );
            } finally {
              setPublishing(false);
            }
          })();
        }}
      />
    </section>
  );
}
