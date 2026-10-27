import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NatureSelect } from './primitives/NatureSelect';
import { eggGroupNames } from '../data/catalog';
import { GRADE_BODY, buildEggSearchIndex, gradeLabel, type TargetMode } from '../domain/petFilters';
import { buildMotherCoverage, isMotherResourceComparable, selectMotherSharingViews } from '../domain/motherSharing';
import {
  findBreedableSupply,
  findStudBreedableSupply,
  groupFreshness,
  hasStockForDemand,
  hasStockForStudDemand,
  isStudDemandKey,
  memberFreshness,
} from '../domain/demandCriteria';
import {
  buildProductionLines,
  linesSupplyTarget,
  type ProductionLine,
} from '../domain/productionLines';
import { bodyMedalIconByLabel, voiceMedalIconByLabel, voiceMedalLabel } from '../domain/petIcons';
import type { StudRecommendation } from '../domain/suggestions';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { SpeciesEntry } from '../domain/types';
import type {
  MotherCoverageRow,
  MotherGroupDetail,
  MotherGroupMember,
} from '../shared/motherGroups';
import type {
  CollectionDemand,
  CollectionTaskRecord,
  DemandBody,
  DemandVoice,
} from '../shared/collectionGroups';
import { demandKeyOf } from '../shared/collectionGroups';
import type { MotherTargetConfig } from '../shared/collectionGroups';
import { eggNatures, defaultEggNatures, type NatureOverrides } from '../domain/recommendedNatures';
import { completedDemandCounts } from '../domain/demandStats';
import {
  DemandPublishSheet,
  type DemandCriteriaDraft,
  type DemandPublishItem,
} from './DemandPublishSheet';
import { ensureGroupSession, setGroupList, useGroupList, type GroupListState } from './listViewStore';
import { InlineSelect } from './primitives/InlineSelect';
import { PetAvatar } from './PetAvatar';
import { InlineMultiSelect } from './primitives/InlineMultiSelect';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';

type ViewId = 'missing' | 'mine' | 'seeking';

/**
 * 三视图（2026-10-26 用户改口径）：我缺的看能发什么需求，需求中心看所有人的接单，
 * 共同寻找大家一起认领。原来的「我能补的」改名为「需求中心」。
 */
const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: 'missing', label: '我缺的' },
  { id: 'mine', label: '需求中心' },
  { id: 'seeking', label: '共同寻找' },
];

/** 批量发需求时最多同时发几条：比串行快很多，又不至于触发服务端写限流。 */
const DEMAND_PUBLISH_CONCURRENCY = 4;

/** 我缺的卡片网格固定 4 列；一页 6 行 = 24 项。 */
const RESOURCE_GRID_COLUMNS = 4;
const MISSING_PAGE_ROWS = 6;
const MISSING_PAGE_SIZE = RESOURCE_GRID_COLUMNS * MISSING_PAGE_ROWS;

export interface MotherGroupResourcesProps {
  group: MotherGroupDetail;
  viewerAccountId: string;
  species: SpeciesEntry[];
  catalogVersion: string;
  /** 本机背包：用来判断我是否已有现货、能否同账号可孵、结单是否真的匹配。 */
  snapshots?: readonly AccountSnapshot[];
  /** 本组口径；旧组 / 不传时按一期固定口径。 */
  criteriaId?: string;
  /** 本组目标：用来显示真实口径（模式 / 体型 / 声音 / 推荐性格），不传时退回一期文案。 */
  target?: MotherTargetConfig | null;
  /** 优质种公推荐（与看板同源）；种公页使用。 */
  recommendations?: StudRecommendation[];
  /** 全局目标模式（推荐档位的展示与产线档位）。 */
  targetMode?: TargetMode;
  /** 个人推荐性格覆盖：母本卡片显示「我的目标」；不传时退回组目标。 */
  natureOverrides?: NatureOverrides;
  /** 当前种公目标有多少个蛋组；0 = 还没设目标，不能误报「已全通」。 */
  studGroupCount?: number;
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
  /** 组内需求（2026-10-26）：我缺的用来发需求，需求中心用来承接与督促。 */
  demands?: CollectionDemand[];
  onPublishDemand?: (
    eggGameId: number,
    natures: string[],
    criteria: Pick<CollectionDemand, 'gender' | 'body' | 'voice'>,
  ) => Promise<unknown>;
  onWithdrawDemand?: (
    eggGameId: number,
    criteria: Pick<CollectionDemand, 'nature' | 'gender' | 'body' | 'voice'>,
  ) => Promise<unknown>;
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
  snapshots = [],
  criteriaId,
  target = null,
  recommendations = [],
  targetMode = 'perfect',
  natureOverrides,
  studGroupCount = 0,
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
  const { targetNature, targetBody, targetVoice, targetKind, onlyGroupLine } = list;
  // 旧值兼容：`help`（旧的「我能补谁」）与 `all`（旧「小组资源」）都落到「需求中心」
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
  const [publishWarning, setPublishWarning] = useState('');
  /** 撤回的二次确认：值为「蛋:性格」，避免手误把已被人接的单撤回（2026-10-26）。 */
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null);
  /** 种公需求发布前的确认：未发布成员可能能产时，先问一句。 */
  const [confirmStud, setConfirmStud] = useState<{ recId: string; groupId: number } | null>(null);
  /**
   * 完成需求的二次确认（2026-10-28）：本地快照没匹配到个体时先问「是否已完成」，
   * 用户可能刚拿到蛋、还没重新采集导入。值为 demandKey。
   */
  const [confirmComplete, setConfirmComplete] = useState<string | null>(null);
  /** 「我缺的」分页：一页 6 行（4 列）；筛选 / 切视图后回到第 1 页。 */
  const [missingPage, setMissingPage] = useState(1);

  useEffect(() => {
    ensureGroupSession(viewerAccountId);
  }, [viewerAccountId]);

  useEffect(() => {
    setMissingPage(1);
  }, [
    effectiveView,
    targetKind,
    targetNature,
    targetBody,
    targetVoice,
    memberFilter,
    query,
    onlyOwned,
    onlyDemanded,
  ]);

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
  const groupFresh = useMemo(() => groupFreshness(group.members), [group.members]);
  const myMember = group.members.find((member) => member.accountId === viewerAccountId) ?? null;
  const myFreshness = myMember ? memberFreshness(myMember) : null;

  /** 当前目标口径；空字段 = 不挑 / 不限，后续匹配会自动跳过。 */
  // 母本页固定要母；公母筛选已去掉（种公需求在「种公」页单独走）。
  const criteriaOfRow = (row: MotherCoverageRow) => ({
    eggGameId: row.eggGameId,
    nature: targetNature,
    gender: '母' as const,
    body: targetBody,
    voice: targetVoice,
  });

  /**
   * 「我缺的」以本机背包为准：有完全匹配的个体就不算缺。
   * 没导入本机数据时退回旧的母本覆盖口径，并提示数据未更新。
   */
  const targetMissingRows = useMemo(() => {
    if (snapshots.length === 0) return views.missingForMe;
    return rows.filter((row) => !hasStockForDemand(snapshots, criteriaOfRow(row), species));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, snapshots, species, targetNature, targetBody, targetVoice, views.missingForMe]);

  /**
   * 「自己能产」：背包里没有现货，但同账号有可孵的一对（母本 + 同档位公）。
   * 这些蛋仍然展示，让人知道缺口在哪；但不能发需求，提示去覆盖度看可迭代。
   */
  const selfBreedableEggIds = useMemo(() => {
    const result = new Set<number>();
    if (snapshots.length === 0) return result;
    for (const row of rows) {
      const supply = findBreedableSupply(
        snapshots,
        {
          eggGameId: row.eggGameId,
          nature: targetNature,
          gender: '母' as const,
          body: targetBody,
          voice: targetVoice,
        },
        species,
      );
      if (supply.kind === 'breedable') result.add(row.eggGameId);
    }
    return result;
  }, [rows, snapshots, species, targetNature, targetBody, targetVoice]);
  /** 本机产线（种公页「自己能产」用）；按当前模式、同账号、双方同档位计算。 */
  const viewerLines = useMemo(() => {
    if (snapshots.length > 0) {
      return buildProductionLines({ snapshots, species, mode: targetMode }).flatMap(
        (account) => account.lines,
      );
    }
    // 本机没数据时，退回自己已发布的产线（至少不会把「自己能产」误判成组内没人能产）。
    return myMember?.resource?.accounts.flatMap((account) => account.lines ?? []) ?? [];
  }, [snapshots, species, targetMode, myMember]);

  /**
   * 组内其他成员的产线。
   * `lines === undefined`（旧摘要）算「未知」，不能用它下「组内没人能产」的结论。
   */
  const groupLineInfo = useMemo(() => {
    const lines: ProductionLine[] = [];
    const unknownMemberIds: string[] = [];
    for (const member of group.members) {
      if (member.accountId === viewerAccountId) continue;
      if (!isMotherResourceComparable(member.resource, catalogVersion, criteriaId)) {
        unknownMemberIds.push(member.accountId);
        continue;
      }
      let unknown = false;
      for (const account of member.resource?.accounts ?? []) {
        if (account.lines === undefined) {
          unknown = true;
          continue;
        }
        lines.push(...account.lines);
      }
      if (unknown) unknownMemberIds.push(member.accountId);
    }
    return { lines, unknownMemberIds };
  }, [group.members, viewerAccountId, catalogVersion, criteriaId]);

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

  const missingRows = targetMissingRows;
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
      : effectiveView === 'seeking'
        ? seekingRows
        : null;

  const filtered = (currentRows ?? []).filter((row) => {
    if (onlyOwned && row.holders.length === 0) return false;
    if (onlyDemanded && !myDemandedEggs.has(row.eggGameId)) return false;
    // 「共同寻找」的成员范围由 seekingMembers 决定；memberFilter 只服务「我缺的」，
    // 否则在「我缺的」选了 B 再切过来，会用「B 是否拥有」把共同缺口筛空，而筛选控件又是隐藏的。
    if (memberFilter && effectiveView !== 'seeking') {
      // 我缺的：按「谁有」筛
      if (!row.holders.some((holder) => holder.accountId === memberFilter)) return false;
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return (
      row.name.toLowerCase().includes(keyword) ||
      (searchIndex.get(`egg:${row.eggGameId}`) ?? '').includes(keyword)
    );
  });

  /**
   * 「我缺的」分三档（2026-10-27 数据新鲜度软校验）：
   * 组内有人发布过 → 可发；数据不全 → 黄边提示后仍可发；全新鲜且确实没有 → 红边沉底。
   */
  const isDefaultTarget =
    !targetNature && targetBody === '大块头' && targetVoice === '+100';
  const publishableRows = filtered.filter((row) => row.holders.length > 0);
  const dataIncompleteRows = filtered.filter(
    (row) => row.holders.length === 0 && (!isDefaultTarget || row.unknownMemberIds.length > 0),
  );
  const blockedRows = filtered.filter(
    (row) =>
      row.holders.length === 0 &&
      isDefaultTarget &&
      row.unknownMemberIds.length === 0,
  );
  const blockedEggIds = new Set(blockedRows.map((row) => row.eggGameId));
  const dataIncompleteEggIds = new Set(dataIncompleteRows.map((row) => row.eggGameId));
  /** 渲染顺序固定：可发 → 数据不全 → 确认没有。 */
  const listRows =
    effectiveView === 'missing'
      ? [...publishableRows, ...dataIncompleteRows, ...blockedRows]
      : filtered;

  // 「我缺的」一页 6 行；页码越界时（筛选后条数变少）自动落到最后一页。
  const missingTotalPages = Math.max(1, Math.ceil(listRows.length / MISSING_PAGE_SIZE));
  const missingCurrentPage = Math.min(missingPage, missingTotalPages);
  const missingPageOffset = (missingCurrentPage - 1) * MISSING_PAGE_SIZE;
  const pageRows =
    effectiveView === 'missing'
      ? listRows.slice(missingPageOffset, missingPageOffset + MISSING_PAGE_SIZE)
      : listRows;

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
    // 个人推荐性格优先（2026-10-27 用户口径：母本按用户自己定的性格展示）；
    // 直接渲染组件、没传个人覆盖时，退回组目标那份。
    if (natureOverrides !== undefined) return eggNatures(species, eggGameId, natureOverrides);
    if (target?.kind !== 'mother' || target.requireRecommendedNatures !== true) return [];
    return eggNatures(species, eggGameId, target.natureOverrides);
  };

  /* ---------- 需求承接（2026-10-26） ---------- */

  const rowByEgg = useMemo(() => new Map(rows.map((row) => [row.eggGameId, row])), [rows]);

  const iHoldEgg = (eggGameId: number): boolean =>
    rowByEgg.get(eggGameId)?.holders.some((holder) => holder.accountId === viewerAccountId) ??
    false;

  /** 本机是否有现货 / 同账号可孵；没导入数据时退回旧的「我有这颗蛋」口径。 */
  const viewerCanSupply = (demand: CollectionDemand): boolean => {
    if (isStudDemandKey(demand.eggGameId)) {
      return snapshots.length > 0 && findStudBreedableSupply(snapshots, demand, species).kind !== 'none';
    }
    if (snapshots.length > 0) {
      return findBreedableSupply(snapshots, demand, species).kind !== 'none';
    }
    return iHoldEgg(demand.eggGameId);
  };
  const myDataStale = myFreshness == null || myFreshness.stale;

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

  /** 已结单：按承接人累计（全时段）。成员区与需求中心共用同一口径。 */
  const completedCounts = useMemo(() => completedDemandCounts(demands), [demands]);

  /**
   * 需求中心（原「我能补的」，2026-10-26 用户口径）：
   * 我接的 → 我能接的 → 其他人接的（按承接人分组，带已结单数）→ 发布了没人接的。
   * 已完成的单不进列表，只进「已结单」计数。
   */
  const demandCenter = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const match = (demand: CollectionDemand): boolean => {
      if (memberFilter && demand.demanderAccountId !== memberFilter) return false;
      if (!keyword) return true;
      if (isStudDemandKey(demand.eggGameId)) {
        const group = eggGroupNames[-demand.eggGameId] ?? '';
        return `${group} ${demand.nature}`.toLowerCase().includes(keyword);
      }
      const name = rowByEgg.get(demand.eggGameId)?.name ?? '';
      return (
        name.toLowerCase().includes(keyword) ||
        (searchIndex.get(`egg:${demand.eggGameId}`) ?? '').includes(keyword)
      );
    };
    const byUpdated = (a: CollectionDemand, b: CollectionDemand) => b.updatedAt - a.updatedAt;

    const mineClaimed: CollectionDemand[] = [];
    const canClaim: CollectionDemand[] = [];
    const maybeClaim: CollectionDemand[] = [];
    const unclaimed: CollectionDemand[] = [];
    const byClaimer = new Map<string, CollectionDemand[]>();

    for (const demand of demands) {
      if (!match(demand)) continue;
      if (demand.status === 'claimed') {
        if (demand.claimerAccountId === viewerAccountId) {
          mineClaimed.push(demand);
        } else if (demand.claimerAccountId && memberById.has(demand.claimerAccountId)) {
          const list = byClaimer.get(demand.claimerAccountId) ?? [];
          list.push(demand);
          byClaimer.set(demand.claimerAccountId, list);
        }
        continue;
      }
      if (demand.status !== 'open') continue;
      if (demand.demanderAccountId !== viewerAccountId && viewerCanSupply(demand)) {
        canClaim.push(demand);
      } else if (demand.demanderAccountId !== viewerAccountId && myDataStale) {
        // 我的数据旧 / 还没发布：不硬拦，放进「数据未更新，可能能接」让用户确认
        maybeClaim.push(demand);
      } else {
        unclaimed.push(demand);
      }
    }

    mineClaimed.sort(byUpdated);
    canClaim.sort(byUpdated);
    maybeClaim.sort(byUpdated);
    unclaimed.sort(byUpdated);

    const others = group.members
      .filter((member) => (byClaimer.get(member.accountId)?.length ?? 0) > 0)
      .map((member) => ({
        accountId: member.accountId,
        name: labelOf(member),
        completed: completedCounts.get(member.accountId) ?? 0,
        demands: (byClaimer.get(member.accountId) ?? []).sort(byUpdated),
      }));

    return {
      mineClaimed,
      canClaim,
      maybeClaim,
      others,
      unclaimed,
      total:
        mineClaimed.length +
        canClaim.length +
        maybeClaim.length +
        unclaimed.length +
        others.reduce((sum, item) => sum + item.demands.length, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    demands,
    memberFilter,
    query,
    rowByEgg,
    searchIndex,
    viewerAccountId,
    group.members,
    memberById,
    completedCounts,
    snapshots,
    species,
    myDataStale,
  ]);

  /** 种公推荐 → 组内产线状态（不含自己；自己单独用 viewerLines 判断）。 */
  const studRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return recommendations
      .map((rec) => {
        const targets = rec.groupIds.map((groupId) => ({
          kind: 'stud' as const,
          groupId,
          nature: rec.natureName,
          body: GRADE_BODY[rec.grade],
          voice:
            targetMode === 'medal'
              ? rec.grade === '大婉' || rec.grade === '小婉'
                ? '婉转声'
                : '粗嗓门'
              : rec.grade === '大婉' || rec.grade === '小婉'
                ? '+100'
                : '-100',
        }));
        const self = targets.some((target) =>
          linesSupplyTarget(viewerLines, target, species, targetMode),
        );
        const groups = targets.map((target) => ({
          groupId: target.groupId,
          supplied: linesSupplyTarget(groupLineInfo.lines, target, species, targetMode),
        }));
        return {
          rec,
          targets,
          self,
          groups,
          groupCan: groups.some((group) => group.supplied),
          unknown: groupLineInfo.unknownMemberIds.length,
        };
      })
      .filter((row) => !onlyGroupLine || row.groupCan)
      .filter((row) => {
        if (!keyword) return true;
        return (
          row.rec.displayName.toLowerCase().includes(keyword) ||
          row.rec.natureName.includes(keyword) ||
          row.rec.groupLabels.some((label) => label.toLowerCase().includes(keyword))
        );
      });
  }, [
    recommendations,
    query,
    onlyGroupLine,
    viewerLines,
    groupLineInfo,
    species,
    targetMode,
  ]);

  /** 需求键：需求方 + 蛋 + 性格 + 性别 / 体型 / 声音；同蛋同性格的母/公是两条。 */
  const demandKey = (demand: CollectionDemand): string =>
    `${demand.demanderAccountId}:${demandKeyOf(demand)}`;

  /** 当前视图实际可发需求的条目数：按钮可用性与计数必须跟渲染列表同源。 */
  const selectableMissingRows = filtered.filter(
    (row) => !blockedEggIds.has(row.eggGameId) && !selfBreedableEggIds.has(row.eggGameId),
  );
  const visibleCount =
    effectiveView === 'mine'
      ? demandCenter.total
      : effectiveView === 'missing'
        ? targetKind === 'stud'
          ? studRows.length
          : selectableMissingRows.length
        : filtered.length;

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

  const actionLabel = effectiveView === 'missing' ? '发需求' : '认领';

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
            // 全新鲜且确认没有来源的蛋不参与发需求（防状态过期后被带上）
            if (blockedEggIds.has(eggGameId)) return null;
            // 自己能产的蛋也不发需求（防状态过期后被带上）
            if (selfBreedableEggIds.has(eggGameId)) return null;
            const row = rowByEgg.get(eggGameId);
            const { base, form } = splitDisplayName(row?.name ?? `蛋 ${eggGameId}`);
            // 已发过的「同性格 + 同性别 / 体型 / 声音」不能再带进来：
            // 新接口不会覆盖，但重复发只会得到原行，提示「已发过」更清楚。
            const existing = new Set(
              (myDemandsByEgg.get(eggGameId) ?? [])
                .filter((demand) => demand.status !== 'done')
                .map(
                  (demand) =>
                    `${demand.nature}:${demand.gender}:${demand.body}:${demand.voice}`,
                ),
            );
            const preferred = requiredNaturesOf(eggGameId);
            const candidates = preferred.length > 0
              ? preferred
              : defaultEggNatures(species, eggGameId);
            const currentKey = (nature: string) =>
              `${nature}:母:${targetBody}:${targetVoice}`;
            const natures = candidates.filter((nature) => !existing.has(currentKey(nature)));
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
          setDemandMessage('这些蛋的性格都已经发过需求了；要改条件请先撤回原需求');
          return;
        }
        const hasIncomplete = selected.some((key) =>
          dataIncompleteEggIds.has(Number(key)),
        );
        setPublishWarning(
          hasIncomplete
            ? groupFresh.stale > 0
              ? `有 ${groupFresh.stale} 人超过 7 天未更新，可能有人能孵但没发布。仍要发布？`
              : '有人还没发布资源，可能有人能孵但没发布。仍要发布？'
            : '',
        );
        setPublishItems(items);
        setPublishError('');
        return;
      }
      if (effectiveView === 'mine') return;
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
      setSelecting(false);
      setSelected([]);
    } catch (failure) {
      setDemandError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setDemandBusy(false);
    }
  };

  /** 种公需求：用负数蛋组 id 发到现有需求表；性别固定公。 */
  const publishStudDemand = async (
    row: (typeof studRows)[number],
    groupId: number,
  ) => {
    if (!onPublishDemand || demandBusy) return;
    const target = row.targets.find((item) => item.groupId === groupId);
    if (!target) return;
    setDemandBusy(true);
    setDemandError('');
    setDemandMessage('');
    try {
      await onPublishDemand(-groupId, [row.rec.natureName], {
        gender: '公',
        body: target.body as DemandBody,
        voice: target.voice as DemandVoice,
      });
      setDemandMessage('已发布种公需求');
      setConfirmStud(null);
    } catch (failure) {
      setDemandError(failure instanceof Error ? failure.message : '发布失败，请稍后再试');
    } finally {
      setDemandBusy(false);
    }
  };

  /**
   * 性格 / 目标口径确认后真正发布需求。
   *
   * 每颗蛋是一条独立请求；之前逐条 `await`，选 10 颗蛋就要排队 10 个来回，
   * 手机上会卡在「发布中…」很久。这里最多同时发 4 条，既快又不会打爆写限流。
   */
  const confirmPublish = async (
    items: Array<{ eggGameId: number; natures: string[] }>,
    criteria: DemandCriteriaDraft,
  ) => {
    setDemandBusy(true);
    setPublishError('');
    try {
      const failures: unknown[] = [];
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const item = items[next];
          next += 1;
          try {
            await onPublishDemand?.(item.eggGameId, item.natures, criteria);
          } catch (failure) {
            failures.push(failure);
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(DEMAND_PUBLISH_CONCURRENCY, items.length) }, () => worker()),
      );
      if (failures.length > 0) {
        const reason = failures[0] instanceof Error ? failures[0].message : '发布失败，请稍后再试';
        setPublishError(
          `${failures.length} 颗蛋发布失败：${reason}。已成功的不会重复，可以直接重试。`,
        );
        return;
      }
      const total = items.reduce((count, item) => count + Math.max(1, item.natures.length), 0);
      setDemandMessage(`已发布 ${total} 条需求`);
      setPublishItems(null);
      setPublishWarning('');
      setSelecting(false);
      setSelected([]);
    } finally {
      setDemandBusy(false);
    }
  };

  /**
   * 单条需求操作：接单 / 放弃 / 完成确认 / 撤回。
   *
   * `forceComplete`：用户在「背包未检测到」的确认框里点了「已完成」——`isStockEnough` 里
   * 只有本地快照，用户可能刚拿到蛋还没来得及重新采集导入，所以允许跳过本地校验直接结单。
   */
  const runDemandAction = async (
    action: 'claim' | 'release' | 'complete' | 'withdraw',
    demand: CollectionDemand,
    forceComplete = false,
  ) => {
    if (demandBusy) return;
    setDemandBusy(true);
    setDemandError('');
    setDemandMessage('');
    try {
      if (action === 'withdraw') {
        await onWithdrawDemand?.(demand.eggGameId, demand);
        setDemandMessage('已撤回这条需求');
        setConfirmWithdraw(null);
      } else {
        // 手动完成默认仍要求在背包里找到完全匹配的个体；找不到时先弹确认（见 requestComplete）
        if (action === 'complete' && !forceComplete) {
          const enough = isStudDemandKey(demand.eggGameId)
            ? hasStockForStudDemand(snapshots, demand, species)
            : hasStockForDemand(snapshots, demand, species);
          if (!enough) {
            setConfirmComplete(demandKey(demand));
            return;
          }
        }
        const handler =
          action === 'claim'
            ? onClaimDemand
            : action === 'release'
              ? onReleaseDemand
              : onCompleteDemand;
        await handler?.(demand);
        setConfirmComplete(null);
        setDemandMessage(action === 'claim' ? '已接单' : action === 'release' ? '已放弃' : '已完成');
      }
    } catch (failure) {
      setDemandError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setDemandBusy(false);
    }
  };

  /** 完成按钮：没检测到匹配个体时先换成「是否确认已完成」的二次确认 */
  const completeControl = (demand: CollectionDemand): ReactNode => {
    const key = demandKey(demand);
    if (confirmComplete === key) {
      return (
        <span className="flex flex-wrap items-center gap-1" data-testid="mother-demand-complete-confirm">
          <span className="text-[9px] leading-[1.3] text-amber-700">背包里未检测到，确认已完成？</span>
          <button
            type="button"
            disabled={demandBusy}
            onClick={() => void runDemandAction('complete', demand, true)}
            data-testid="mother-demand-complete-confirm-yes"
            className="rounded px-1 text-[9px] font-medium leading-[1.3] text-emerald-700 ring-1 ring-emerald-400 disabled:opacity-50"
          >
            已完成
          </button>
          <button
            type="button"
            disabled={demandBusy}
            onClick={() => setConfirmComplete(null)}
            data-testid="mother-demand-complete-cancel"
            className="rounded px-1 text-[9px] leading-[1.3] text-slate-500 ring-1 ring-slate-200 disabled:opacity-50"
          >
            取消
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        disabled={demandBusy}
        onClick={() => void runDemandAction('complete', demand)}
        data-testid="mother-demand-complete"
        className="rounded px-1 text-[9px] leading-[1.3] text-emerald-700 ring-1 ring-emerald-400 disabled:opacity-50"
      >
        完成
      </button>
    );
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
    setConfirmStud(null);
    setConfirmComplete(null);
  }, [effectiveView, targetKind, group.group.id]);

  /** 需求卡：四段共用，只有动作不同；已完成的单不进列表。卡片只留 头像 + 名称 + 性格 + 动作。 */
  const renderDemandCard = (demand: CollectionDemand, actions: ReactNode): ReactNode => {
    const isStud = isStudDemandKey(demand.eggGameId);
    const { base, form } = isStud
      ? { base: eggGroupNames[-demand.eggGameId] ?? `蛋组${-demand.eggGameId}`, form: '' }
      : splitDisplayName(rowByEgg.get(demand.eggGameId)?.name ?? `蛋 ${demand.eggGameId}`);
    return (
      <li
        key={demandKey(demand)}
        className="flex h-full min-w-0 flex-col items-center gap-0.5 rounded-md bg-slate-50 px-1 py-1"
        data-testid="mother-demand-row"
        data-demand-status={demand.status}
      >
        <div className="relative flex w-full justify-center">
          <div
            className="pointer-events-none absolute inset-0"
            data-testid="mother-demand-medals"
          >
            {bodyMedalIconByLabel(demand.body) ? (
              <img
                src={bodyMedalIconByLabel(demand.body)!}
                alt={demand.body}
                title={demand.body}
                className="absolute left-0 top-0 h-3.5 w-3.5"
              />
            ) : null}
            {voiceMedalIconByLabel(demand.voice) ? (
              <img
                src={voiceMedalIconByLabel(demand.voice)!}
                alt={voiceMedalLabel(demand.voice)}
                title={voiceMedalLabel(demand.voice)}
                className="absolute right-0 top-0 h-3.5 w-3.5"
              />
            ) : null}
          </div>
          {isStud ? (
            <span className="block h-10 w-10" aria-hidden />
          ) : (
            <PetAvatar gameId={demand.eggGameId} name={base} size={40} />
          )}
        </div>
        <span className="w-full break-words text-center text-[10px] font-medium leading-tight text-slate-700">
          {base}
          {form ? <span className="block text-[9px] font-normal text-slate-400">{form}</span> : null}
        </span>
        <NatureChips natures={[demand.nature || '不挑']} testId="mother-demand-natures" />
        <div className="mt-auto flex flex-wrap items-center justify-center gap-1 text-[10px]">{actions}</div>
      </li>
    );
  };

  const renderDemandGrid = (
    list: CollectionDemand[],
    actions: (demand: CollectionDemand) => ReactNode,
  ) => (
    <ul className="grid grid-cols-4 items-stretch gap-1">
      {list.map((demand) => renderDemandCard(demand, actions(demand)))}
    </ul>
  );

  const demandSection = (id: string, title: string, count: number, body: ReactNode) => (
    <section className="space-y-1" data-testid={`demand-section-${id}`}>
      <div className="flex items-baseline gap-1.5 pt-1">
        <h3 className="text-[11px] font-semibold text-slate-600">{title}</h3>
        <span className="text-[10px] text-slate-400">{count}</span>
      </div>
      {body}
    </section>
  );

  return (
    <section className="space-y-1.5 rounded-2xl bg-white p-2.5 shadow-sm" data-testid="mother-resources">
      <SegmentedControl
        label="小组资源视图"
        value={effectiveView}
        options={VIEWS.map((item) => ({ value: item.id, label: item.label }))}
        onValueChange={(next) => setList({ view: next as ViewId })}
        optionTestId={(value) => `mother-view-${value}`}
      />

      <p className="text-[10px] text-slate-400" data-testid="mother-data-freshness">
        数据完整度 {groupFresh.fresh}/{groupFresh.total}
        {groupFresh.stale > 0 ? ` · ${groupFresh.stale} 人超过 7 天未更新` : ''}
        {snapshots.length === 0 ? ' · 本机还没导入数据' : ''}
      </p>

      {effectiveView === 'missing' ? (
        <>
          <div className="flex items-center gap-1.5" data-testid="missing-kind-filter">
            <SegmentedControl
              label="我缺的类型"
              value={targetKind}
              options={[
                { value: 'stud', label: '种公' },
                { value: 'mother', label: '母本' },
              ]}
              onValueChange={(next) => setList({ targetKind: next as 'mother' | 'stud' })}
              optionTestId={(value) => `missing-kind-${value}`}
            />
            {targetKind === 'stud' ? (
              <span className="text-[10px] text-slate-400">按蛋组收，物种不限</span>
            ) : null}
          </div>
          {targetKind === 'mother' ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="mother-target-filter">
          <NatureSelect
            label="性格"
            value={targetNature}
            onValueChange={(value) => setList({ targetNature: value })}
            testId="mother-target-nature"
            menuTestId="mother-target-nature-options"
            optionTestId={(value) => `mother-target-nature-option-${value || 'any'}`}
            className="max-w-[88px]"
          />
          <InlineSelect
            label="体型"
            value={targetBody}
            options={[
              { value: '大块头', label: '大块头' },
              { value: '', label: '不限' },
            ]}
            onValueChange={(value) => setList({ targetBody: value as DemandBody })}
            testId="mother-target-body"
            menuTestId="mother-target-body-options"
            className="max-w-[88px]"
          />
          <InlineSelect
            label="声音"
            value={targetVoice}
            options={[
              { value: '+100', label: '+100' },
              { value: '', label: '不限' },
            ]}
            onValueChange={(value) => setList({ targetVoice: value as DemandVoice })}
            testId="mother-target-voice"
            menuTestId="mother-target-voice-options"
            className="max-w-[78px]"
          />
        </div>
          ) : null}
        </>
      ) : null}

      {taskError ? (
        <p className="text-xs text-rose-600" data-testid="mother-task-error">{taskError}</p>
      ) : null}

      {effectiveView !== 'mine' &&
      !(effectiveView === 'missing' && targetKind === 'stud') &&
      currentRows === null ? (
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
          label={targetKind === 'stud' ? '搜索种公推荐' : '搜索小组资源'}
          value={query}
          onValueChange={(value) => setList({ query: value })}
          placeholder={
            targetKind === 'stud' ? '搜性格 / 蛋组 / 建议物种' : '搜母本 / 同血脉名称 / 图鉴号'
          }
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
        ) : effectiveView === 'missing' && targetKind === 'stud' ? null : (
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
        {effectiveView !== 'mine' &&
        !(effectiveView === 'missing' && targetKind === 'stud') ? (
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
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        {effectiveView === 'mine' ? null : effectiveView === 'missing' && targetKind === 'stud' ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={onlyGroupLine}
                onChange={(event) => setList({ onlyGroupLine: event.target.checked })}
                data-testid="stud-only-group-line"
              />
              只看组内能产
            </label>
          </div>
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
          {selecting
            ? `已选 ${selected.length} 项`
            : effectiveView === 'mine'
              ? `共 ${visibleCount} 条`
              : effectiveView === 'missing'
                ? targetKind === 'stud'
                  ? `推荐 ${visibleCount} 项`
                  : `可发需求 ${visibleCount} 项`
                : `当前页 ${visibleCount} 项`}
        </p>
      </div>
      {demandError ? (
        <p className="text-[11px] text-rose-600" data-testid="mother-demand-error">{demandError}</p>
      ) : null}
      {demandMessage ? (
        <p className="text-[11px] text-emerald-700" data-testid="mother-demand-message">{demandMessage}</p>
      ) : null}

      {/* 需求中心：我接的 → 我能接的 → 其他人接的（按承接人）→ 发布了没人接的 */}
      {effectiveView === 'mine' ? (
        <>
          {views.mineForOthers === null ? (
            <p className="text-[11px] text-amber-700" data-testid="mother-intake-unknown-self">
              你还没向本组发布资源，暂时无法判断哪些单你能接。
            </p>
          ) : null}
          {demands.length === 0 ? (
            <StateNotice
              kind="empty-data"
              title="当前没有组员发布需求"
              description="组员在「我缺的」里发需求后，这里会按「我接的 / 我能接的 / 其他人接的 / 没人接的」出现。"
              testId="mother-intake-empty"
            />
          ) : demandCenter.total === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400" data-testid="mother-intake-no-match">
              没有匹配的需求
            </p>
          ) : (
            <>
              {demandCenter.mineClaimed.length > 0
                ? demandSection(
                    'mine-claimed',
                    '我接的',
                    demandCenter.mineClaimed.length,
                    renderDemandGrid(demandCenter.mineClaimed, (demand) => (
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
                    )),
                  )
                : null}
              {demandCenter.canClaim.length > 0
                ? demandSection(
                    'can-claim',
                    '我能接的',
                    demandCenter.canClaim.length,
                    renderDemandGrid(demandCenter.canClaim, (demand) => (
                      <button
                        type="button"
                        onClick={() => void runDemandAction('claim', demand)}
                        data-testid="mother-demand-claim"
                        className="min-h-[22px] rounded border border-emerald-500 px-1 font-medium text-emerald-700"
                      >
                        接单
                      </button>
                    )),
                  )
                : null}
              {demandCenter.maybeClaim.length > 0
                ? demandSection(
                    'maybe-claim',
                    '数据未更新，可能能接',
                    demandCenter.maybeClaim.length,
                    <>
                      <p className="text-[10px] leading-snug text-amber-700">
                        你的数据超过 7 天或还没导入，系统无法确认；建议先导入。仍可先接单，对方会看到你的数据时间。
                      </p>
                      {renderDemandGrid(demandCenter.maybeClaim, (demand) => (
                        <button
                          type="button"
                          onClick={() => void runDemandAction('claim', demand)}
                          data-testid="mother-demand-claim-stale"
                          className="min-h-[22px] rounded border border-amber-500 px-1 font-medium text-amber-700"
                        >
                          仍要接单
                        </button>
                      ))}
                    </>,
                  )
                : null}
              {demandCenter.others.length > 0
                ? demandSection(
                    'others-claimed',
                    '其他人接的',
                    demandCenter.others.reduce((sum, item) => sum + item.demands.length, 0),
                    <div className="space-y-1.5">
                      {demandCenter.others.map((groupItem) => (
                        <div key={groupItem.accountId}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[11px] text-slate-600">{groupItem.name}</span>
                            <span
                              className="rounded bg-emerald-50 px-1 text-[9px] leading-[1.2] text-emerald-700"
                              data-testid="mother-completed-count"
                            >
                              已结 {groupItem.completed} 单
                            </span>
                          </div>
                          {renderDemandGrid(groupItem.demands, (demand) =>
                            demand.demanderAccountId === viewerAccountId ? (
                              completeControl(demand)
                            ) : (
                              <span className="text-slate-400">已接</span>
                            ),
                          )}
                        </div>
                      ))}
                    </div>,
                  )
                : null}
              {demandCenter.unclaimed.length > 0
                ? demandSection(
                    'unclaimed',
                    '发布了没人接的',
                    demandCenter.unclaimed.length,
                    renderDemandGrid(demandCenter.unclaimed, () => (
                      <span className="text-slate-400">待承接</span>
                    )),
                  )
                : null}
            </>
          )}
        </>
      ) : effectiveView === 'missing' && targetKind === 'stud' ? (
        <>
          {recommendations.length === 0 ? (
            snapshots.length === 0 ? (
              <StateNotice
                kind="empty-data"
                title="先导入本机数据"
                description="导入后才知道你自己的种公缺口，也才能判断组内产线能不能补。"
                testId="stud-empty-no-data"
              />
            ) : (
              <StateNotice
                kind="empty-data"
                title={studGroupCount === 0 ? '还没设置种公目标' : '种公网络已全通'}
                description={
                  studGroupCount === 0
                    ? '先在看板 / 覆盖度里勾蛋组和性格，再回来看种公缺口。'
                    : '当前种公目标没有要补的缺口。'
                }
                testId="stud-empty-all-passed"
              />
            )
          ) : studRows.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400" data-testid="stud-no-match">
              没有匹配的种公推荐
            </p>
          ) : (
            <ul className="grid grid-cols-2 items-stretch gap-1" data-testid="stud-recommendations">
              {studRows.map((row) => {
                const { rec } = row;
                const confirming = confirmStud?.recId === rec.id;
                return (
                  <li
                    key={rec.id}
                    className="rounded-md bg-slate-50 px-1.5 py-1"
                    data-testid="stud-recommendation"
                  >
                    <div className="flex items-start gap-1">
                      <PetAvatar gameId={rec.gameId} name={rec.displayName} size={32} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="break-words text-[11px] font-medium leading-[1.25] text-slate-700">
                          {rec.natureName}
                          {rec.displayName}
                        </span>
                        <p className="text-[10px] leading-[1.25] text-slate-500">
                          {gradeLabel(rec.grade, targetMode)} · 补 {rec.groupIds.length} 组 ·{' '}
                          {rec.groupLabels.join(' × ')}
                        </p>
                        <p
                          className={`text-[10px] leading-[1.25] ${
                            row.self
                              ? 'text-sky-700'
                              : row.groupCan
                                ? 'text-emerald-700'
                                : row.unknown > 0
                                  ? 'text-amber-700'
                                  : 'text-rose-600'
                          }`}
                          data-testid="stud-supply-status"
                        >
                          {row.self
                            ? '自己能产 · 去覆盖度看可迭代'
                            : row.groupCan
                              ? '组内有人能产'
                              : row.unknown > 0
                                ? `组内暂无，另有 ${row.unknown} 人未发布`
                                : '组内没人能产'}
                        </p>
                        {confirming && confirmStud ? (
                          <div
                            className="rounded bg-amber-50 px-1 py-0.5 text-[10px] leading-snug text-amber-800"
                            data-testid="stud-publish-warning"
                          >
                            组内还有 {row.unknown} 人未发布，当前已发布组员不能满足你的需求，是否还要发布需求？
                            <div className="mt-0.5 flex gap-1">
                              <button
                                type="button"
                                disabled={demandBusy}
                                onClick={() => void publishStudDemand(row, confirmStud.groupId)}
                                data-testid="stud-publish-confirm"
                                className="min-h-[22px] rounded border border-amber-500 px-1 font-medium text-amber-800 disabled:opacity-40"
                              >
                                仍要发布
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmStud(null)}
                                data-testid="stud-publish-cancel"
                                className="min-h-[22px] rounded border border-slate-200 px-1 text-slate-500"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {!row.self ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.groups.map((group) => {
                          const groupName =
                            eggGroupNames[group.groupId] ?? `蛋组${group.groupId}`;
                          const target = row.targets.find(
                            (item) => item.groupId === group.groupId,
                          );
                          const already =
                            target != null &&
                            demands.some(
                              (demand) =>
                                demand.demanderAccountId === viewerAccountId &&
                                demand.eggGameId === -group.groupId &&
                                demand.nature === rec.natureName &&
                                demand.body === target.body &&
                                demand.voice === target.voice,
                            );
                          const disabled =
                            demandBusy || (!group.supplied && row.unknown === 0);
                          if (already) {
                            return (
                              <span
                                key={group.groupId}
                                className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] leading-[24px] text-emerald-700"
                                data-testid={`stud-demanded-${group.groupId}`}
                              >
                                已发到 {groupName}
                              </span>
                            );
                          }
                          return (
                            <button
                              key={group.groupId}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                if (!group.supplied && row.unknown > 0) {
                                  setConfirmStud({ recId: rec.id, groupId: group.groupId });
                                  return;
                                }
                                void publishStudDemand(row, group.groupId);
                              }}
                              data-testid={`stud-publish-${group.groupId}`}
                              className={`min-h-[26px] rounded border px-1.5 text-[10px] ${
                                disabled
                                  ? 'border-slate-200 text-slate-300'
                                  : group.supplied
                                    ? 'border-emerald-500 font-medium text-emerald-700'
                                    : 'border-amber-400 text-amber-700'
                              }`}
                            >
                              {group.supplied ? `发到 ${groupName}` : `仍要发到 ${groupName}`}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : currentRows !== null ? (
        <>
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">
              {effectiveView === 'seeking'
                ? '选中的人没有共同缺的母本'
                : '这一页没有条目'}
            </p>
          ) : (
        <ul className="grid grid-cols-4 items-stretch gap-1">
          {pageRows.map((row, index) => {
            // 分页后 index 是页内序号；分区标题要按整个列表的绝对位置判断。
            const absoluteIndex = (effectiveView === 'missing' ? missingPageOffset : 0) + index;
            const natures = requiredNaturesOf(row.eggGameId);
            const { base, form } = splitDisplayName(row.name);
            const selectionKey = selectionKeyOf(row.eggGameId);
            const isSelected = selected.includes(selectionKey);
            const myDemands = myDemandsByEgg.get(row.eggGameId) ?? [];
            const blocked = effectiveView === 'missing' && blockedEggIds.has(row.eggGameId);
            const selfBreedable =
              effectiveView === 'missing' && selfBreedableEggIds.has(row.eggGameId);
            const incomplete =
              effectiveView === 'missing' && dataIncompleteEggIds.has(row.eggGameId);
            const showIncompleteDivider =
              incomplete && absoluteIndex === publishableRows.length;
            const showBlockedDivider =
              blocked && absoluteIndex === publishableRows.length + dataIncompleteRows.length;
            return (
            <Fragment key={row.eggGameId}>
            {showIncompleteDivider ? (
              <li
                className="col-span-full border-t border-dashed border-amber-200 pt-1.5 text-[11px] font-medium text-amber-700"
                data-testid="mother-incomplete-section"
              >
                数据不全 · 可能有人能孵 · {dataIncompleteRows.length}
              </li>
            ) : null}
            {showBlockedDivider ? (
              <li
                className="col-span-full border-t border-dashed border-slate-200 pt-1.5 text-[11px] font-medium text-slate-400"
                data-testid="mother-blocked-section"
              >
                组内暂时孵不了 · {blockedRows.length}
              </li>
            ) : null}
            <li
              onClick={() => selecting && !blocked && !selfBreedable && toggleSelect(selectionKey)}
              aria-disabled={blocked || selfBreedable ? true : undefined}
              className={`flex h-full min-w-0 flex-col items-center gap-0.5 rounded-md px-1 py-1 ${
                isSelected
                  ? 'bg-emerald-50 ring-1 ring-emerald-500'
                  : selfBreedable
                    ? 'bg-sky-50/60 ring-1 ring-inset ring-sky-300'
                    : blocked
                      ? 'bg-white ring-1 ring-inset ring-rose-300'
                      : incomplete
                        ? 'bg-amber-50/60 ring-1 ring-inset ring-amber-300'
                        : 'bg-slate-50'
              } ${selecting && !blocked && !selfBreedable ? 'cursor-pointer' : ''}`}
              data-testid="mother-resource-row"
              data-blocked={blocked ? 'true' : undefined}
              data-self-breedable={selfBreedable ? 'true' : undefined}
              data-incomplete={incomplete ? 'true' : undefined}
            >
              {/* 2026-10-28 用户口径：体型奖牌在左上角、声音奖牌在右上角；头像固定居中；
                  性格全部展示在名字下面，性格再多也不会把头像顶下去（同排头像始终对齐） */}
              <div className="relative flex w-full justify-center">
                <div
                  className="pointer-events-none absolute inset-0"
                  data-testid="mother-resource-medals"
                >
                  {bodyMedalIconByLabel(targetBody) ? (
                    <img
                      src={bodyMedalIconByLabel(targetBody)!}
                      alt={targetBody}
                      title={targetBody}
                      className="absolute left-0 top-0 h-3.5 w-3.5"
                    />
                  ) : null}
                  {voiceMedalIconByLabel(targetVoice) ? (
                    <img
                      src={voiceMedalIconByLabel(targetVoice)!}
                      alt={voiceMedalLabel(targetVoice)}
                      title={voiceMedalLabel(targetVoice)}
                      className="absolute right-0 top-0 h-3.5 w-3.5"
                    />
                  ) : null}
                </div>
                <PetAvatar gameId={row.eggGameId} name={base} size={40} />
              </div>
              <span
                className="w-full break-words text-center text-[10px] font-medium leading-tight text-slate-700"
                data-testid="mother-resource-name"
              >
                {base}
                {form ? (
                  <span className="block text-[9px] font-normal text-slate-400" data-testid="mother-resource-form">
                    {form}
                  </span>
                ) : null}
              </span>
              <NatureChips natures={natures} testId="mother-resource-natures" />
                  {myDemands.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-center gap-1" data-testid="mother-demanded">
                      {myDemands.map((demand) => {
                        const withdrawKey = demandKey(demand);
                        const confirming = confirmWithdraw === withdrawKey;
                        return (
                          <Fragment key={demandKey(demand)}>
                            {demand.status === 'claimed' ? (
                              completeControl(demand)
                            ) : null}
                            {demand.status !== 'done' ? (
                              confirming ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void runDemandAction('withdraw', demand)}
                                    data-testid="mother-demand-withdraw-confirm"
                                    className="rounded px-1 text-[9px] leading-[1.3] text-rose-600 ring-1 ring-rose-300"
                                  >
                                    确认撤回
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmWithdraw(null)}
                                    data-testid="mother-demand-withdraw-cancel"
                                    className="rounded px-1 text-[9px] leading-[1.3] text-slate-500 ring-1 ring-slate-200"
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmWithdraw(withdrawKey)}
                                  data-testid="mother-demand-withdraw"
                                  className="px-1 text-[9px] leading-[1.3] text-slate-400 underline underline-offset-2"
                                >
                                  撤回
                                </button>
                              )
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </div>
                  ) : null}
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
            </Fragment>
            );
          })}
        </ul>
          )}
          {effectiveView === 'missing' && missingTotalPages > 1 ? (
            <nav
              className="mt-2 flex items-center justify-center gap-2 text-[11px] text-slate-500"
              data-testid="mother-pagination"
            >
              <button
                type="button"
                disabled={missingCurrentPage === 1}
                onClick={() => setMissingPage(Math.max(1, missingCurrentPage - 1))}
                data-testid="mother-page-prev"
                className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 disabled:opacity-40"
              >
                上一页
              </button>
              <span data-testid="mother-page-indicator">
                第 {missingCurrentPage} / {missingTotalPages} 页
              </span>
              <button
                type="button"
                disabled={missingCurrentPage === missingTotalPages}
                onClick={() =>
                  setMissingPage(Math.min(missingTotalPages, missingCurrentPage + 1))
                }
                data-testid="mother-page-next"
                className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 disabled:opacity-40"
              >
                下一页
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
      <DemandPublishSheet
        open={publishItems !== null}
        items={publishItems ?? []}
        busy={demandBusy}
        error={publishError}
        warning={publishWarning}
        defaultCriteria={{
          gender: '母',
          body: targetBody,
          voice: targetVoice,
        }}
        onClose={() => {
          setPublishItems(null);
          setPublishError('');
          setPublishWarning('');
        }}
        onConfirm={(items, criteria) => void confirmPublish(items, criteria)}
      />
    </section>
  );
}

/**
 * 目标性格（2026-10-28 用户口径）：**全部展示、不收起**，横向自动换行。
 *
 * 放在头像与名称**下面**而不是右上角：性格数量变化不再改动头像位置，
 * 同排卡片头像始终对齐。
 */
function NatureChips({ natures, testId }: { natures: string[]; testId?: string }) {
  if (natures.length === 0) return null;
  const chip = 'rounded bg-emerald-50 px-1 text-[9px] leading-[1.15] text-emerald-700';
  return (
    <span className="flex w-full flex-wrap justify-center gap-0.5" data-testid={testId}>
      {natures.map((nature) => (
        <span key={nature} className={chip}>
          {nature}
        </span>
      ))}
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
