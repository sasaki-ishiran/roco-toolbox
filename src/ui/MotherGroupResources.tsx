import { useEffect, useMemo, useState } from 'react';
import { buildEggSearchIndex } from '../domain/petFilters';
import { buildMotherCoverage, isMotherResourceComparable, selectMotherSharingViews } from '../domain/motherSharing';
import type { SpeciesEntry } from '../domain/types';
import type {
  MotherCoverageRow,
  MotherGroupDetail,
  MotherGroupMember,
} from '../shared/motherGroups';
import type {
  CollectionDemand,
  CollectionTaskRecord,
} from '../shared/collectionGroups';
import { motherTargetLabel, type MotherTargetConfig } from '../shared/collectionGroups';
import { eggNatures, defaultEggNatures } from '../domain/recommendedNatures';
import { DemandPublishSheet, type DemandPublishItem } from './DemandPublishSheet';
import { ensureGroupSession, setGroupList, useGroupList, type GroupListState } from './listViewStore';
import { InlineSelect } from './primitives/InlineSelect';
import { InlineMultiSelect } from './primitives/InlineMultiSelect';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';

type ViewId = 'missing' | 'mine' | 'seeking';

/**
 * 三视图（2026-10-25 用户改口径）：主用途是「看自己缺的 / 给别人孵 / 大家缺的一起认领」，
 * 组整体完成度不重要，所以把原来的「小组资源」换成「我能补的」。
 */
const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: 'missing', label: '我缺的' },
  { id: 'mine', label: '我能补的' },
  { id: 'seeking', label: '共同寻找' },
];

export interface MotherGroupResourcesProps {
  group: MotherGroupDetail;
  viewerAccountId: string;
  species: SpeciesEntry[];
  catalogVersion: string;
  /** 本组口径；旧组 / 不传时按一期固定口径。 */
  criteriaId?: string;
  /** 本组目标：用来显示真实口径（模式 / 体型 / 声音 / 推荐性格），不传时退回一期文案。 */
  target?: MotherTargetConfig | null;
  /** 共同寻找的任务与确认状态；不传时只看资源。 */
  tasks?: CollectionTaskRecord[];
  tasksConfirmed?: boolean;
  tasksPendingMemberIds?: string[];
  tasksLoading?: boolean;
  tasksError?: string;
  isOwner?: boolean;
  onClaimTask?: (targetKey: string) => Promise<void>;
  onReleaseTask?: (targetKey: string) => Promise<void>;
  onTransferTask?: (targetKey: string, toAccountId: string) => Promise<void>;
  /** 组内需求（2026-10-26）：我缺的用来发需求，我能补的用来承接。 */
  demands?: CollectionDemand[];
  onPublishDemand?: (eggGameId: number, natures: string[]) => Promise<unknown>;
  onWithdrawDemand?: (eggGameId: number, nature: string) => Promise<unknown>;
  onClaimDemand?: (demand: CollectionDemand) => Promise<unknown>;
  onReleaseDemand?: (demand: CollectionDemand) => Promise<unknown>;
  onCompleteDemand?: (demand: CollectionDemand) => Promise<unknown>;
}

/**
 * 小组资源三视图。
 *
 * 「我缺的」= 我没发布过的目标；组内已有人拥有的排前面。
 * 未发布 / 已停止共享 / 图鉴或口径不兼容的成员是**未知**，不能算成「缺」——
 * 有未知成员时「小组都没有」必须改写成「已发布成员均无，另 N 人待发布/更新」。
 */
export function MotherGroupResources({
  group,
  viewerAccountId,
  species,
  catalogVersion,
  criteriaId,
  target = null,
  tasks = [],
  tasksConfirmed = false,
  tasksPendingMemberIds = [],
  tasksLoading = false,
  tasksError = '',
  isOwner = false,
  onClaimTask,
  onReleaseTask,
  onTransferTask,
  demands = [],
  onPublishDemand,
  onWithdrawDemand,
  onClaimDemand,
  onReleaseDemand,
  onCompleteDemand,
}: MotherGroupResourcesProps) {
  // 临时查看状态按「身份 + 小组」隔离：换身份立即清空，切组不串条件（2026-10-24）
  const list = useGroupList(viewerAccountId, group.group.id);
  const setList = (patch: Partial<GroupListState>) =>
    setGroupList(viewerAccountId, group.group.id, patch);
  const { view, query, memberFilter, seekingMembers, onlyOwned, onlyDemanded } = list;
  // 旧值兼容：`help`（旧的「我能补谁」）与 `all`（旧「小组资源」）都落到「我能补的」
  const effectiveView: ViewId = view === 'help' || view === 'all'
    ? 'mine'
    : view === 'mine' || view === 'seeking'
      ? view
      : 'missing';
  const [busyKey, setBusyKey] = useState('');
  const [taskError, setTaskError] = useState('');
  /** 批量选择（2026-10-26）：发需求 / 接单 / 认领 共用同一套选择态。 */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [demandBusy, setDemandBusy] = useState(false);
  const [demandMessage, setDemandMessage] = useState('');
  const [demandError, setDemandError] = useState('');
  /** 发需求前的性格确认弹层（2026-10-26 用户补：发需求时要能选性格）。 */
  const [publishItems, setPublishItems] = useState<DemandPublishItem[] | null>(null);
  const [publishError, setPublishError] = useState('');
  /** 撤回的二次确认：值为「蛋:性格」，避免手误把已被人接的单撤回（2026-10-26）。 */
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null);

  useEffect(() => {
    ensureGroupSession(viewerAccountId);
  }, [viewerAccountId]);

  useEffect(() => {
    if (memberFilter && !group.members.some((member) => member.accountId === memberFilter)) {
      setList({ memberFilter: '' });
    }
    const alive = new Set(group.members.map((member) => member.accountId));
    const kept = seekingMembers.filter((id) => alive.has(id));
    if (kept.length !== seekingMembers.length) setList({ seekingMembers: kept });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.members, memberFilter, seekingMembers]);

  const rows = useMemo(
    () => buildMotherCoverage({ species, catalogVersion, members: group.members, criteriaId }),
    [species, catalogVersion, group.members, criteriaId],
  );
  const comparableIds = useMemo(
    () =>
      group.members
        .filter((member) => isMotherResourceComparable(member.resource, catalogVersion, criteriaId))
        .map((member) => member.accountId),
    [group.members, catalogVersion, criteriaId],
  );
  const views = useMemo(
    () => selectMotherSharingViews(rows, viewerAccountId, comparableIds),
    [rows, viewerAccountId, comparableIds],
  );
  const searchIndex = useMemo(() => buildEggSearchIndex(species), [species]);

  const memberById = useMemo(
    () => new Map(group.members.map((member) => [member.accountId, member])),
    [group.members],
  );
  const labelOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of group.members) {
      counts.set(member.displayName, (counts.get(member.displayName) ?? 0) + 1);
    }
    return (member: MotherGroupMember): string =>
      (counts.get(member.displayName) ?? 0) > 1
        ? `${member.displayName}·${member.accountId.slice(0, 4)}`
        : member.displayName;
  }, [group.members]);

  /**
   * 共同寻找 = 选中的人都缺的精灵（交集），空选择 = 全组成员。
   *
   * 2026-10-25 用户口径：组里进了个几乎全收集的人时，不能让他一个人「补齐」共同寻找；
   * 把范围收缩到「我们几个」，看的才是我们真的一起要去找的东西。
   */
  const seekingScope =
    seekingMembers.length > 0
      ? seekingMembers
      : group.members.map((member) => member.accountId);
  const seekingRows = rows.filter((row) =>
    seekingScope.every(
      (id) =>
        row.missingMemberIds.includes(id) || row.unknownMemberIds.includes(id),
    ),
  );

  /** 我发过需求的蛋（供「只看我发的需求」筛选，早于卡片渲染计算）。 */
  const myDemandedEggs = useMemo(
    () =>
      new Set(
        demands
          .filter((demand) => demand.demanderAccountId === viewerAccountId)
          .map((demand) => demand.eggGameId),
      ),
    [demands, viewerAccountId],
  );
  /** 我还没结束的需求：即使我已经拿到这只蛋，也要保留卡片才能撤回/确认完成。 */
  const myUnfinishedDemandedEggs = useMemo(
    () =>
      new Set(
        demands
          .filter(
            (demand) =>
              demand.demanderAccountId === viewerAccountId && demand.status !== 'done',
          )
          .map((demand) => demand.eggGameId),
      ),
    [demands, viewerAccountId],
  );

  const missingRows = views.missingForMe;
  const missingEggIds = new Set((missingRows ?? []).map((row) => row.eggGameId));
  // 「我缺的」原本排除我已有的蛋；但发过需求的蛋一旦被自己获得，需求卡和撤回入口会一起消失。
  // 这里把「我有未结束需求」的蛋补回列表，动作仍走同一套需求卡。
  const demandedExtras =
    missingRows == null
      ? []
      : rows.filter(
          (row) =>
            myUnfinishedDemandedEggs.has(row.eggGameId) && !missingEggIds.has(row.eggGameId),
        );
  const currentRows =
    effectiveView === 'missing'
      ? missingRows == null
        ? null
        : [...missingRows, ...demandedExtras]
      : effectiveView === 'mine'
        ? views.mineForOthers
        : seekingRows;

  const filtered = (currentRows ?? []).filter((row) => {
    if (onlyOwned && row.holders.length === 0) return false;
    if (onlyDemanded && !myDemandedEggs.has(row.eggGameId)) return false;
    // 「共同寻找」的成员范围由 seekingMembers 决定；memberFilter 只服务「我缺的 / 我能补的」，
    // 否则在「我缺的」选了 B 再切过来，会用「B 是否拥有」把共同缺口筛空，而筛选控件又是隐藏的。
    if (memberFilter && effectiveView !== 'seeking') {
      // 我缺的：按「谁有」筛；我能补的：按「缺这只的人」筛
      // （选莱茵 = 看我能补给莱茵哪些，2026-10-25 用户口径）
      const related =
        effectiveView === 'mine'
          ? row.missingMemberIds.includes(memberFilter)
          : row.holders.some((holder) => holder.accountId === memberFilter);
      if (!related) return false;
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return (
      row.name.toLowerCase().includes(keyword) ||
      (searchIndex.get(`egg:${row.eggGameId}`) ?? '').includes(keyword)
    );
  });

  /** 谁有：一个名字一行（2026-10-26 用户口径：多人拥有时不再用「、」挤在一行）。 */
  const holderNames = (row: MotherCoverageRow): string[] =>
    row.holders.map((holder) => {
      const member = memberById.get(holder.accountId);
      return member ? cardName(labelOf(member)) : holder.accountId.slice(0, 6);
    });

  const taskKeyOf = (row: MotherCoverageRow): string => `mother:${row.eggGameId}`;
  const taskOf = (row: MotherCoverageRow): CollectionTaskRecord | undefined =>
    tasks.find((task) => task.targetKey === taskKeyOf(row));
  const nameOf = (accountId: string): string => {
    const member = memberById.get(accountId);
    return member ? cardName(labelOf(member)) : accountId.slice(0, 6);
  };
  const runTask = async (row: MotherCoverageRow, action: 'claim' | 'release') => {
    const handler = action === 'claim' ? onClaimTask : onReleaseTask;
    if (!handler || busyKey) return;
    const key = taskKeyOf(row);
    setBusyKey(key);
    setTaskError('');
    try {
      await handler(key);
    } catch (failure) {
      setTaskError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusyKey('');
    }
  };

  const transferTo = async (row: MotherCoverageRow, toAccountId: string) => {
    if (!onTransferTask || busyKey || !toAccountId) return;
    const key = taskKeyOf(row);
    setBusyKey(key);
    setTaskError('');
    try {
      await onTransferTask(key, toAccountId);
    } catch (failure) {
      setTaskError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusyKey('');
    }
  };

  /**
   * 每个蛋在本组要求什么性格（2026-10-25 用户口径：直接标在可立鸡这类条目上，
   * 看到就知道该孵什么性格给对方）。只有本组开了「要求推荐性格」才显示。
   */
  const requiredNaturesOf = (eggGameId: number): string[] => {
    if (target?.kind !== 'mother' || target.requireRecommendedNatures !== true) return [];
    return eggNatures(species, eggGameId, target.natureOverrides);
  };

  /* ---------- 需求承接（2026-10-26） ---------- */

  const rowByEgg = useMemo(() => new Map(rows.map((row) => [row.eggGameId, row])), [rows]);

  const iHoldEgg = (eggGameId: number): boolean =>
    rowByEgg.get(eggGameId)?.holders.some((holder) => holder.accountId === viewerAccountId) ??
    false;

  /** 我发过的需求：蛋 → 该蛋下的每一条（一个性格一条）。 */
  const myDemandsByEgg = useMemo(() => {
    const map = new Map<number, CollectionDemand[]>();
    for (const demand of demands) {
      if (demand.demanderAccountId !== viewerAccountId) continue;
      const list = map.get(demand.eggGameId) ?? [];
      list.push(demand);
      map.set(demand.eggGameId, list);
    }
    return map;
  }, [demands, viewerAccountId]);

  /**
   * 承接中心（= 我能补的）：只列**别人明确发布的需求**里我能孵的，不再用旧缺口兜底
   * （2026-10-26 用户口径）。没有需求就显示空态提示。
   */
  const intake = useMemo(() => {
    const order = { open: 0, claimed: 1, done: 2 } as const;
    return demands
      .filter(
        (demand) =>
          demand.demanderAccountId !== viewerAccountId && iHoldEgg(demand.eggGameId),
      )
      .sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demands, rowByEgg, viewerAccountId]);

  /** 需求键：需求方 + 蛋 + 性格（一个性格一条，2026-10-26）。 */
  const demandKey = (demand: CollectionDemand): string =>
    `${demand.demanderAccountId}:${demand.eggGameId}:${demand.nature}`;

  /** 承接中心在当前搜索 / 需求方筛选下的列表。 */
  const intakeFiltered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return intake.filter((demand) => {
      if (memberFilter && demand.demanderAccountId !== memberFilter) return false;
      if (!keyword) return true;
      const name = rowByEgg.get(demand.eggGameId)?.name ?? '';
      return (
        name.toLowerCase().includes(keyword) ||
        (searchIndex.get(`egg:${demand.eggGameId}`) ?? '').includes(keyword)
      );
    });
  }, [intake, memberFilter, query, rowByEgg, searchIndex]);

  /** 当前视图实际渲染的条目数：按钮可用性与计数必须跟渲染列表同源。 */
  const visibleCount = effectiveView === 'mine' ? intakeFiltered.length : filtered.length;

  /** 资源卡的选择键按蛋；需求卡在卡片里直接用 demandKey。 */
  const selectionKeyOf = (eggGameId: number): string => String(eggGameId);

  const toggleSelect = (key: string) => {
    setSelected((keys) =>
      keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key],
    );
  };

  const exitSelecting = () => {
    setSelecting(false);
    setSelected([]);
    setDemandError('');
  };

  const actionLabel =
    effectiveView === 'missing' ? '发需求' : effectiveView === 'mine' ? '接单' : '认领';

  const runBulk = async () => {
    if (selected.length === 0 || demandBusy) return;
    setDemandBusy(true);
    setDemandError('');
    setDemandMessage('');
    try {
      if (effectiveView === 'missing') {
        // 先弹性格确认，发布放到 confirmPublish 里做（2026-10-26）
        const items = selected
          .map((key) => {
            const eggGameId = Number(key);
            const row = rowByEgg.get(eggGameId);
            const { base, form } = splitDisplayName(row?.name ?? `蛋 ${eggGameId}`);
            // 已经发过的性格不能再带进来：服务端 upsert 会把已接单重置成待承接、并清掉接单人
            const existing = new Set(
              (myDemandsByEgg.get(eggGameId) ?? [])
                .filter((demand) => demand.status !== 'done')
                .map((demand) => demand.nature),
            );
            const preferred = requiredNaturesOf(eggGameId);
            const candidates = preferred.length > 0
              ? preferred
              : defaultEggNatures(species, eggGameId);
            const natures = candidates.filter((nature) => !existing.has(nature));
            // 只在「本来有可发性格、但全部都发过了」时跳过；没有默认性格仍允许不挑性格发布
            if (candidates.length > 0 && natures.length === 0) return null;
            return {
              eggGameId,
              name: form ? `${base} ${form}` : base,
              natures,
            };
          })
          .filter((item): item is { eggGameId: number; name: string; natures: string[] } => item !== null);
        if (items.length === 0) {
          setDemandMessage('这些蛋的性格都已经发过需求了；要改性格请先撤回原需求');
          return;
        }
        setPublishItems(items);
        setPublishError('');
        return;
      }
      if (effectiveView === 'mine') {
        let claimed = 0;
        for (const key of selected) {
          const demand = intake.find((item) => demandKey(item) === key);
          if (demand && demand.status === 'open') {
            await onClaimDemand?.(demand);
            claimed += 1;
          }
        }
        setDemandMessage(claimed > 0 ? `已接 ${claimed} 单` : '选中的单都已被接走，刷新后再看');
      } else {
        // 共同寻找只能认领「全员确认无来源、且还没有负责人」的行
        if (!tasksConfirmed) throw new Error('还有成员未发布/更新，暂时不能认领');
        let claimed = 0;
        for (const key of selected) {
          const eggGameId = Number(key);
          const row = seekingRows.find((item) => item.eggGameId === eggGameId);
          if (!row || row.holders.length > 0) continue;
          const task = tasks.find(
            (item) => item.targetKey === `mother:${eggGameId}` && item.status !== 'closed',
          );
          if (task?.ownerAccountId) continue;
          await onClaimTask?.(`mother:${eggGameId}`);
          claimed += 1;
        }
        setDemandMessage(
          claimed > 0 ? `已认领 ${claimed} 项` : '选中的项都已有负责人或已有来源，未新增认领',
        );
      }
      setSelecting(false);
      setSelected([]);
    } catch (failure) {
      setDemandError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setDemandBusy(false);
    }
  };

  /** 性格确认后真正发布需求。 */
  const confirmPublish = async (items: Array<{ eggGameId: number; natures: string[] }>) => {
    setDemandBusy(true);
    setPublishError('');
    try {
      for (const item of items) await onPublishDemand?.(item.eggGameId, item.natures);
      const total = items.reduce((count, item) => count + Math.max(1, item.natures.length), 0);
      setDemandMessage(`已发布 ${total} 条需求`);
      setPublishItems(null);
      setSelecting(false);
      setSelected([]);
    } catch (failure) {
      setPublishError(failure instanceof Error ? failure.message : '发布失败，请稍后再试');
    } finally {
      setDemandBusy(false);
    }
  };

  /** 单条需求操作：接单 / 放弃 / 完成确认 / 撤回。 */
  const runDemandAction = async (
    action: 'claim' | 'release' | 'complete' | 'withdraw',
    demand: CollectionDemand,
  ) => {
    if (demandBusy) return;
    setDemandBusy(true);
    setDemandError('');
    setDemandMessage('');
    try {
      if (action === 'withdraw') {
        await onWithdrawDemand?.(demand.eggGameId, demand.nature);
        setDemandMessage('已撤回这条需求');
        setConfirmWithdraw(null);
      } else {
        const handler =
          action === 'claim'
            ? onClaimDemand
            : action === 'release'
              ? onReleaseDemand
              : onCompleteDemand;
        await handler?.(demand);
        setDemandMessage(action === 'claim' ? '已接单' : action === 'release' ? '已放弃' : '已完成');
      }
    } catch (failure) {
      setDemandError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setDemandBusy(false);
    }
  };

  // 切视图 / 切组时退出选择态，避免把上一页的选中带过去
  useEffect(() => {
    setSelecting(false);
    setSelected([]);
    setDemandError('');
    setDemandMessage('');
    setPublishItems(null);
    setPublishError('');
    setConfirmWithdraw(null);
  }, [effectiveView, group.group.id]);

  return (
    <section className="space-y-1.5 rounded-2xl bg-white p-2.5 shadow-sm" data-testid="mother-resources">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">小组资源</h2>
        <span className="text-[11px] text-slate-400" data-testid="mother-criteria">
          小组口径：{target ? motherTargetLabel(target) : '母 · 大块头 · +100dB'}
        </span>
      </div>

      <SegmentedControl
        label="小组资源视图"
        value={effectiveView}
        options={VIEWS.map((item) => ({ value: item.id, label: item.label }))}
        onValueChange={(next) => setList({ view: next as ViewId })}
        optionTestId={(value) => `mother-view-${value}`}
      />

      {taskError ? (
        <p className="text-xs text-rose-600" data-testid="mother-task-error">{taskError}</p>
      ) : null}

      {effectiveView !== 'mine' && currentRows === null ? (
        <StateNotice
          kind="incomparable"
          title="不能计算我的缺口"
          description="我的资源尚未发布，或图鉴/口径与当前版本不一致；发布或更新后再看这一页。"
          testId="mother-view-unknown-self"
        />
      ) : null}

      {/* 搜索 / 筛选 / 动作按钮同一行；动作按钮在三个视图分别是 发需求 / 接单 / 认领（2026-10-26） */}
      <div className="flex items-center gap-1.5">
        <SearchField
          className="min-w-0 flex-1"
          label="搜索小组资源"
          value={query}
          onValueChange={(value) => setList({ query: value })}
          placeholder="搜母本 / 同血脉名称 / 图鉴号"
          testId="mother-search"
        />
        {effectiveView === 'seeking' ? (
          <InlineMultiSelect
            label="共同寻找范围"
            values={seekingMembers}
            options={group.members.map((member) => ({
              value: member.accountId,
              label: labelOf(member),
            }))}
            onValuesChange={(values) => setList({ seekingMembers: values })}
            allLabel="全组成员"
            testId="mother-seeking-members"
            menuTestId="mother-seeking-member-options"
            optionTestId={(value) => `mother-seeking-member-${value || 'all'}`}
            align="right"
            className="max-w-[104px] shrink-0"
          />
        ) : (
          <InlineSelect
            label={effectiveView === 'mine' ? '筛选需求方' : '筛选成员'}
            value={memberFilter}
            options={[
              { value: '', label: effectiveView === 'mine' ? '全部需求方' : '全部成员' },
              ...group.members.map((member) => ({
                value: member.accountId,
                label: labelOf(member),
              })),
            ]}
            onValueChange={(value) => setList({ memberFilter: value })}
            testId="mother-member-filter"
            menuTestId="mother-member-options"
            align="right"
            className="max-w-[104px] shrink-0"
          />
        )}
        <button
          type="button"
          onClick={() => {
            if (!selecting) {
              setSelecting(true);
              setSelected([]);
              setDemandError('');
              setDemandMessage('');
              return;
            }
            if (selected.length === 0) {
              exitSelecting();
              return;
            }
            void runBulk();
          }}
          disabled={demandBusy || (!selecting && visibleCount === 0)}
          data-testid="mother-select-action"
          className={`min-h-[32px] shrink-0 rounded-lg px-2 text-xs font-medium disabled:opacity-40 ${
            selecting && selected.length > 0
              ? 'bg-emerald-600 text-white'
              : 'border border-emerald-500 text-emerald-700'
          }`}
        >
          {demandBusy
            ? '处理中…'
            : !selecting
              ? actionLabel
              : selected.length === 0
                ? '取消'
                : `${actionLabel} ${selected.length} 项`}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        {effectiveView === 'mine' ? (
          <p className="text-[11px] text-slate-400">只列组员已发布、你能孵的需求单</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={onlyOwned}
                onChange={(event) => setList({ onlyOwned: event.target.checked })}
                data-testid="mother-only-owned"
              />
              只看组内有人拥有
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={onlyDemanded}
                onChange={(event) => setList({ onlyDemanded: event.target.checked })}
                data-testid="mother-only-demanded"
              />
              只看我发的需求
            </label>
          </div>
        )}
        <p className="text-[11px] text-slate-400" data-testid="mother-resource-count">
          {selecting ? `已选 ${selected.length} 项` : `当前页 ${visibleCount} 项`}
        </p>
      </div>
      {demandError ? (
        <p className="text-[11px] text-rose-600" data-testid="mother-demand-error">{demandError}</p>
      ) : null}
      {demandMessage ? (
        <p className="text-[11px] text-emerald-700" data-testid="mother-demand-message">{demandMessage}</p>
      ) : null}

      {/* 我能补的 = 需求承接中心：只列别人已发布、我能孵的需求（2026-10-26 用户口径） */}
      {effectiveView === 'mine' ? (
        views.mineForOthers === null ? (
          <StateNotice
            kind="incomparable"
            title="不能计算你能接的单"
            description="你还没向本组发布资源，或图鉴/口径与当前版本不一致；发布或更新后才能判断哪些需求你能承接。"
            testId="mother-intake-unknown-self"
          />
        ) : intakeFiltered.length === 0 ? (
          <StateNotice
            kind="empty-data"
            title="当前没有组员发布需求"
            description="组员在「我缺的」里发需求后，这里会出现你能承接的单子。"
            testId="mother-intake-empty"
          />
        ) : (
          <ul className="grid grid-cols-2 items-stretch gap-1">
            {intakeFiltered.map((demand) => {
              const row = rowByEgg.get(demand.eggGameId);
              const { base, form } = splitDisplayName(row?.name ?? `蛋 ${demand.eggGameId}`);
              const key = demandKey(demand);
              const isSelected = selected.includes(key);
              const claimedByMe = demand.claimerAccountId === viewerAccountId;
              return (
                <li
                  key={key}
                  onClick={() => selecting && toggleSelect(key)}
                  className={`flex h-full min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 ${
                    isSelected ? 'bg-emerald-50 ring-1 ring-emerald-500' : 'bg-slate-50'
                  } ${selecting ? 'cursor-pointer' : ''}`}
                  data-testid="mother-demand-row"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex min-w-0 flex-col gap-0.5 break-words">
                      <span className="text-[11px] font-medium leading-[1.25] text-slate-700">
                        {base}
                        {form ? (
                          <span className="ml-0.5 text-[10px] font-normal text-slate-400">{form}</span>
                        ) : null}
                      </span>
                      <p className="break-words text-[10px] leading-[1.25] text-slate-500" data-testid="mother-demand-requester">
                        {nameOf(demand.demanderAccountId)} 想要
                      </p>
                      <div className="flex flex-wrap items-center gap-1 text-[10px]">
                        {demand.status === 'done' ? (
                          <span className="text-slate-400">已完成</span>
                        ) : demand.status === 'claimed' ? (
                          claimedByMe ? (
                            <>
                              <span className="text-emerald-700">我接了</span>
                              <button
                                type="button"
                                onClick={() => void runDemandAction('release', demand)}
                                data-testid="mother-demand-release"
                                className="min-h-[22px] rounded border border-slate-200 px-1 text-slate-500"
                              >
                                放弃
                              </button>
                            </>
                          ) : (
                            <span className="text-slate-400">已接：{nameOf(demand.claimerAccountId ?? '')}</span>
                          )
                        ) : selecting ? (
                          <span className={isSelected ? 'text-emerald-700' : 'text-slate-400'}>
                            {isSelected ? '已选' : '点一下选中'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void runDemandAction('claim', demand)}
                            data-testid="mother-demand-claim"
                            className="min-h-[22px] rounded border border-emerald-500 px-1 font-medium text-emerald-700"
                          >
                            接单
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded bg-emerald-50 px-1 text-[10px] leading-[1.15] text-emerald-700">
                      {demand.nature || '不挑'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : currentRows !== null ? (
        <>
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">
              {effectiveView === 'seeking'
                ? '选中的人没有共同缺的母本'
                : '这一页没有条目'}
            </p>
          ) : (
        <ul
          className={`grid items-stretch gap-1 ${
            effectiveView === 'seeking' ? 'grid-cols-2' : 'grid-cols-3'
          }`}
        >
          {filtered.map((row) => {
            const natures = requiredNaturesOf(row.eggGameId);
            const { base, form } = splitDisplayName(row.name);
            const selectionKey = selectionKeyOf(row.eggGameId);
            const isSelected = selected.includes(selectionKey);
            const myDemands = myDemandsByEgg.get(row.eggGameId) ?? [];
            return (
            <li
              key={row.eggGameId}
              onClick={() => selecting && toggleSelect(selectionKey)}
              className={`flex h-full min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 ${
                isSelected ? 'bg-emerald-50 ring-1 ring-emerald-500' : 'bg-slate-50'
              } ${selecting ? 'cursor-pointer' : ''}`}
              data-testid="mother-resource-row"
            >
              {/* 左右两栏：左边名称 + 状态纵向排，右边性格竖排。
                  这样性格有 2 个时卡片仍是两行，不会把状态挤到第三行（2026-10-26） */}
              <div className="flex items-start justify-between gap-1">
                <div className="flex min-w-0 flex-col gap-0.5 break-words">
                  <span className="text-[11px] font-medium leading-[1.25] text-slate-700">
                    {base}
                    {form ? (
                      <span className="ml-0.5 text-[10px] font-normal text-slate-400" data-testid="mother-resource-form">
                        {form}
                      </span>
                    ) : null}
                  </span>
                  {row.holders.length > 0 ? (
                    <p
                      className="flex flex-col break-words text-[10px] leading-[1.25] text-emerald-700"
                      data-testid="mother-resource-holders"
                    >
                      {holderNames(row).map((holder, index) => (
                        <span key={`${holder}-${index}`} className="break-words">
                          {holder}
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="break-words text-[10px] leading-[1.25] text-slate-400" data-testid="mother-resource-none">
                      组内无
                      {row.unknownMemberIds.length > 0
                        ? `，另 ${row.unknownMemberIds.length} 人待发布`
                        : ''}
                    </p>
                  )}
                  {myDemands.length > 0 ? (
                    <div className="flex flex-col gap-0.5 text-[10px] leading-[1.25]" data-testid="mother-demanded">
                      {myDemands.map((demand) => {
                        const withdrawKey = `${demand.eggGameId}:${demand.nature}`;
                        const confirming = confirmWithdraw === withdrawKey;
                        return (
                          <div key={demand.nature} className="flex flex-wrap items-center gap-1">
                            <span className="text-slate-500">{demand.nature || '不挑'}</span>
                            {demand.status === 'done' ? (
                              <span className="text-slate-400">已完成</span>
                            ) : demand.status === 'claimed' ? (
                              <>
                                <span className="text-emerald-700">
                                  {nameOf(demand.claimerAccountId ?? '')}接了
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void runDemandAction('complete', demand)}
                                  data-testid="mother-demand-complete"
                                  className="min-h-[20px] rounded border border-emerald-500 px-1 text-emerald-700"
                                >
                                  完成
                                </button>
                              </>
                            ) : (
                              <span className="text-slate-400">待承接</span>
                            )}
                            {confirming ? (
                              <>
                                <span className="text-rose-600" data-testid="mother-demand-withdraw-hint">
                                  {demand.status === 'claimed'
                                    ? '已有人接单，撤回会取消对方承接'
                                    : '确认撤回？'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void runDemandAction('withdraw', demand)}
                                  data-testid="mother-demand-withdraw-confirm"
                                  className="min-h-[20px] rounded border border-rose-500 px-1 text-rose-600"
                                >
                                  确认
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmWithdraw(null)}
                                  data-testid="mother-demand-withdraw-cancel"
                                  className="min-h-[20px] rounded border border-slate-200 px-1 text-slate-500"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmWithdraw(withdrawKey)}
                                data-testid="mother-demand-withdraw"
                                className="min-h-[20px] rounded border border-slate-200 px-1 text-slate-500"
                              >
                                撤回
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <NaturesStack natures={natures} testId="mother-resource-natures" />
              </div>
              {effectiveView === 'seeking' ? (
                <div className="mt-auto w-full border-t border-slate-200 pt-1 text-[10px]" data-testid="mother-task">
                  {tasksError ? (
                    <span className="text-rose-600">任务读取失败：{tasksError}</span>
                  ) : !tasksConfirmed ? (
                    tasksLoading ? (
                      <span className="text-slate-500">正在核对组员发布状态…</span>
                    ) : (
                      <span className="text-amber-700">
                        待确认：{tasksPendingMemberIds.length} 人未发布/更新，暂不能认领
                      </span>
                    )
                  ) : taskOf(row)?.ownerAccountId ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <span
                        className={
                          taskOf(row)?.ownerAccountId === viewerAccountId
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }
                      >
                        {taskOf(row)?.ownerAccountId === viewerAccountId
                          ? '我认领了'
                          : `负责人：${nameOf(taskOf(row)?.ownerAccountId ?? '')}`}
                      </span>
                      {taskOf(row)?.ownerAccountId === viewerAccountId || isOwner ? (
                        <button
                          type="button"
                          disabled={busyKey === taskKeyOf(row)}
                          onClick={() => void runTask(row, 'release')}
                          data-testid="mother-task-release"
                          className="min-h-[22px] rounded border border-slate-200 px-1 text-slate-500 disabled:opacity-50"
                        >
                          释放
                        </button>
                      ) : null}
                      {isOwner &&
                      onTransferTask &&
                      taskOf(row)?.ownerAccountId !== viewerAccountId ? (
                        <InlineSelect
                          label="转交任务"
                          value=""
                          options={[
                            { value: '', label: '转交…' },
                            ...group.members
                              .filter((member) => member.accountId !== taskOf(row)?.ownerAccountId)
                              .map((member) => ({
                                value: member.accountId,
                                label: labelOf(member),
                              })),
                          ]}
                          onValueChange={(to) => void transferTo(row, to)}
                          testId="mother-task-transfer"
                          menuTestId="mother-task-transfer-options"
                          className="max-w-[100px]"
                        />
                      ) : null}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyKey === taskKeyOf(row)}
                      onClick={() => void runTask(row, 'claim')}
                      data-testid="mother-task-claim"
                      className="min-h-[22px] rounded border border-emerald-500 px-1 font-medium text-emerald-700 disabled:opacity-50"
                    >
                      认领寻找
                    </button>
                  )}
                </div>
              ) : null}
            </li>
            );
          })}
        </ul>
          )}
        </>
      ) : null}
      <DemandPublishSheet
        open={publishItems !== null}
        items={publishItems ?? []}
        busy={demandBusy}
        error={publishError}
        onClose={() => {
          setPublishItems(null);
          setPublishError('');
        }}
        onConfirm={(items) => void confirmPublish(items)}
      />
    </section>
  );
}

/**
 * 性格竖排（2026-10-26 用户口径）：右上角一个一行，最多显示 2 个。
 *
 * 超出部分原来是纯文字 `+N`，现在做成和性格同样式的绿色小卡片 + 下拉三角，
 * 点开看全部、再点「收起」恢复；展开时卡片（及同排卡片，靠 grid items-stretch）自然变高。
 */
function NaturesStack({ natures, testId }: { natures: string[]; testId?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (natures.length === 0) return null;
  const collapsed = natures.slice(0, 2);
  const extra = natures.length - collapsed.length;
  const shown = expanded ? natures : collapsed;
  const chip = 'rounded bg-emerald-50 px-1 text-[10px] leading-[1.15] text-emerald-700';
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5" data-testid={testId}>
      {shown.map((nature) => (
        <span key={nature} className={chip}>
          {nature}
        </span>
      ))}
      {/* +N 单独占一行（2026-10-26 用户口径），不再是紧跟性格的小尾巴 */}
      {!expanded && extra > 0 ? (
        <button
          type="button"
          aria-expanded={false}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(true);
          }}
          data-testid="mother-nature-more"
          className={`${chip} flex items-center gap-0.5`}
        >
          +{extra} <span aria-hidden>▾</span>
        </button>
      ) : null}
      {expanded && extra > 0 ? (
        <button
          type="button"
          aria-expanded
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(false);
          }}
          data-testid="mother-nature-collapse"
          className="flex items-center gap-0.5 text-[9px] leading-[1.15] text-slate-400"
        >
          收起 <span aria-hidden>▴</span>
        </button>
      ) : null}
    </span>
  );
}

/** 卡片里的昵称最多 6 个字，超出用省略号——避免长昵称把卡片撑丑（2026-10-26）。 */
const CARD_NAME_MAX = 6;
function cardName(text: string): string {
  const chars = [...text];
  return chars.length > CARD_NAME_MAX ? `${chars.slice(0, CARD_NAME_MAX).join('')}…` : text;
}

/**
 * 名字拆成「基础名 + 形态」（2026-10-25 用户要求缩略）。
 *
 * 图鉴显示名形如 `蹦蹦种子_海神球形态`：真正要认的是基础名，形态是次要信息。
 * 所以基础名正常字号、形态小字跟在后面，并去掉末尾重复的「形态 / 的样子」，
 * 避免长形态把整行撑开。没有 `_` 的名字原样返回。
 */
function splitDisplayName(name: string): { base: string; form: string } {
  const index = name.indexOf('_');
  if (index <= 0) return { base: name, form: '' };
  const raw = name.slice(index + 1);
  const form = raw.replace(/(的样子|形态)$/, '') || raw;
  return { base: name.slice(0, index), form };
}
