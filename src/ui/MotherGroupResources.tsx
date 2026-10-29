import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  buildProductionIndex,
  buildProductionLines,
  linesSupplyTarget,
  type ProductionLine,
} from '../domain/productionLines';
import { bodyMedalIconByLabel, voiceMedalIconByLabel, voiceMedalLabel } from '../domain/petIcons';
import { boxLabel } from '../domain/coverageDetail';
import { speciesDisplayName } from '../domain/speciesName';
import type { StudRecommendation } from '../domain/suggestions';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import type {
  MotherCoverageRow,
  MotherGroupDetail,
  MotherGroupMember,
} from '../shared/motherGroups';
import {
  DEMAND_BODIES,
  DEMAND_VOICES,
  demandKeyOf,
  type CollectionDemand,
  type CollectionTaskRecord,
  type DemandBody,
  type DemandVoice,
} from '../shared/collectionGroups';
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
import { ModalSurface } from './primitives/ModalSurface';
import { PetCompactCard } from './PetCompactCard';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';
import { GenderMark } from './GenderMark';

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

/** 「我缺的」/「共同寻找」用的行：额外带上按性格拆分的缺口与可补成员。 */
interface TargetRow extends MotherCoverageRow {
  /** 我在这颗蛋上还缺的收集性格；空数组 = 已收齐。 */
  missingNatures: string[];
  /** 每个还没收集的性格分别谁能补；没按性格收时键为空串。 */
  suppliersByNature: Map<string, string[]>;
  /** 是否有人能补「我还没收集的性格」（不是「有这颗蛋」）。 */
  canSupplyMissing: boolean;
}

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
  const { view, query, memberFilter, missingMembers, seekingMembers, onlyOwned, onlyDemanded } = list;
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
  /** 需求详情（2026-10-28）：点击卡片上的「查看」看是谁发的、该怎么配对。 */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  /** 「我缺的」二级页面：点头像进入，把发需求 / 完成 / 撤回放到大按钮里操作。 */
  const [resourceDetailEggId, setResourceDetailEggId] = useState<number | null>(null);
  /** 「我缺的」瀑布流：先出 24 项，滚到底自动追加；筛选 / 切视图后重置。 */
  const [missingVisible, setMissingVisible] = useState(MISSING_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureGroupSession(viewerAccountId);
  }, [viewerAccountId]);

  useEffect(() => {
    setMissingVisible(MISSING_PAGE_SIZE);
  }, [
    effectiveView,
    targetKind,
    targetNature,
    targetBody,
    targetVoice,
    memberFilter,
    missingMembers,
    query,
    onlyOwned,
    onlyDemanded,
  ]);

  useEffect(() => {
    if (memberFilter && !group.members.some((member) => member.accountId === memberFilter)) {
      setList({ memberFilter: '' });
    }
    const alive = new Set(group.members.map((member) => member.accountId));
    const keptMissing = missingMembers.filter((id) => alive.has(id));
    if (keptMissing.length !== missingMembers.length) setList({ missingMembers: keptMissing });
    const kept = seekingMembers.filter((id) => alive.has(id));
    if (kept.length !== seekingMembers.length) setList({ seekingMembers: kept });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.members, memberFilter, missingMembers, seekingMembers]);

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
  /**
   * 组内成员的产线：新摘要才有 `lines`；旧摘要没有时返回 null，只能退回任意母本口径。
   */
  const linesByMember = useMemo(() => {
    const map = new Map<string, ProductionLine[] | null>();
    for (const member of group.members) {
      if (!isMotherResourceComparable(member.resource, catalogVersion, criteriaId)) {
        map.set(member.accountId, null);
        continue;
      }
      const accounts = member.resource?.accounts ?? [];
      map.set(
        member.accountId,
        accounts.some((account) => account.lines === undefined)
          ? null
          : accounts.flatMap((account) => account.lines ?? []),
      );
    }
    return map;
  }, [group.members, catalogVersion, criteriaId]);

  /**
   * 每颗蛋「我自己设定的收集性格」（2026-10-28 用户口径）：
   * 个人推荐性格优先，其次组目标；两边都没开 = 不按性格收（返回空数组）。
   */
  const configuredNaturesOf = (eggGameId: number): string[] => {
    if (natureOverrides !== undefined) return eggNatures(species, eggGameId, natureOverrides);
    if (target?.kind !== 'mother' || target.requireRecommendedNatures !== true) return [];
    return eggNatures(species, eggGameId, target.natureOverrides);
  };

  /** 产线判定的图鉴索引：只随 species 重建一次（2026-10-29 代码审查 B1-M02）。 */
  const productionIndex = useMemo(() => buildProductionIndex(species), [species]);

  /**
   * 2026-10-28 用户口径：组内其他人的「有没有」按产线判断——
   * 目标体型 / 声音 / 性格能产才算有；旧摘要没产线时退回任意母本。
   *
   * 性格不再用顶部「不限」一刀切：没手选性格时，按每颗蛋自己设定的收集性格逐个判断。
   * 否则「我有一只 天真 优优」会被当成目标性格的母本也齐了，缺口显示 0。
   */
  const targetRows = useMemo<TargetRow[]>(() => {
    const eggIdsOf = new Map<string, Set<number>>();
    for (const member of group.members) {
      eggIdsOf.set(
        member.accountId,
        new Set((member.resource?.accounts ?? []).flatMap((account) => account.eggGameIds)),
      );
    }
    /** 这颗蛋要看的性格：手选的优先；否则用个人收集口径；都没有 = 不限（''）。 */
    const naturesOfRow = (eggGameId: number): string[] => {
      if (targetNature) return [targetNature];
      const configured = configuredNaturesOf(eggGameId);
      return configured.length > 0 ? configured : [''];
    };
    const supplyOf = (memberId: string, eggGameId: number): boolean => {
      if (memberId === viewerAccountId && snapshots.length > 0) {
        return hasStockForDemand(
          snapshots,
          { eggGameId, nature: targetNature, gender: '母', body: targetBody, voice: targetVoice },
          species,
        );
      }
      const lines = linesByMember.get(memberId);
      if (lines != null) {
        return linesSupplyTarget(
          lines,
          { kind: 'mother', eggGameId, nature: targetNature, body: targetBody, voice: targetVoice },
          productionIndex,
        );
      }
      // 旧摘要没有产线：退回「有没有这只蛋的任意母本」
      return eggIdsOf.get(memberId)?.has(eggGameId) ?? false;
    };
    /** 这个成员能提供哪些目标性格（不限性格时 '' 表示「有任意一只」）。 */
    const suppliedNaturesOf = (
      memberId: string,
      eggGameId: number,
      natures: readonly string[],
    ): Set<string> => {
      if (natures.length === 1 && natures[0] === '') {
        return supplyOf(memberId, eggGameId) ? new Set(['']) : new Set();
      }
      if (memberId === viewerAccountId && snapshots.length > 0) {
        return new Set(
          natures.filter((nature) =>
            hasStockForDemand(
              snapshots,
              { eggGameId, nature, gender: '母', body: targetBody, voice: targetVoice },
              species,
            ),
          ),
        );
      }
      const lines = linesByMember.get(memberId);
      if (lines != null) {
        return new Set(
          natures.filter((nature) =>
            linesSupplyTarget(
              lines,
              { kind: 'mother', eggGameId, nature, body: targetBody, voice: targetVoice },
              productionIndex,
            ),
          ),
        );
      }
      // 旧摘要没有产线：分不清性格，按「有这只蛋」视为都能补
      return eggIdsOf.get(memberId)?.has(eggGameId) ? new Set(natures) : new Set();
    };

    return rows.map((row) => {
      const natures = naturesOfRow(row.eggGameId);
      const viewerSupplied = suppliedNaturesOf(viewerAccountId, row.eggGameId, natures);
      const missingNatures = natures.filter((nature) => !viewerSupplied.has(nature));
      const holders: MotherCoverageRow['holders'] = [];
      const missingMemberIds: string[] = [];
      const unknownMemberIds: string[] = [];
      /** 每个还没收集的性格分别谁能补；未按性格收时键为空串。 */
      const suppliersByNature = new Map<string, string[]>();
      for (const member of group.members) {
        if (!isMotherResourceComparable(member.resource, catalogVersion, criteriaId)) {
          unknownMemberIds.push(member.accountId);
          continue;
        }
        const supplied = suppliedNaturesOf(member.accountId, row.eggGameId, natures);
        if (supplied.size > 0) {
          const previous = row.holders.find((holder) => holder.accountId === member.accountId);
          holders.push({ accountId: member.accountId, accountKeys: previous?.accountKeys ?? [] });
          if (member.accountId !== viewerAccountId) {
            for (const nature of missingNatures) {
              if (!supplied.has(nature)) continue;
              const list = suppliersByNature.get(nature) ?? [];
              list.push(member.accountId);
              suppliersByNature.set(nature, list);
            }
          }
        } else {
          missingMemberIds.push(member.accountId);
        }
      }
      return {
        ...row,
        holders,
        missingMemberIds,
        unknownMemberIds,
        missingNatures,
        suppliersByNature,
        canSupplyMissing:
          missingNatures.length > 0 &&
          [...suppliersByNature.values()].some((ids) => ids.length > 0),
      };
    });
  }, [
    rows,
    group.members,
    linesByMember,
    viewerAccountId,
    snapshots,
    species,
    targetNature,
    targetBody,
    targetVoice,
    productionIndex,
    catalogVersion,
    criteriaId,
    natureOverrides,
    target,
  ]);

  const views = useMemo(
    () => selectMotherSharingViews(targetRows, viewerAccountId, comparableIds),
    [targetRows, viewerAccountId, comparableIds],
  );
  const groupFresh = useMemo(() => groupFreshness(group.members), [group.members]);
  const myMember = group.members.find((member) => member.accountId === viewerAccountId) ?? null;
  const myFreshness = myMember ? memberFreshness(myMember) : null;

  /**
   * 「我缺的」：按每颗蛋自己设定的收集性格逐个判断（2026-10-28 用户口径）。
   * 只有部分性格没收集时也算缺，卡片会标出还缺哪几个性格；
   * 自己还没发布、也没导入数据时返回 null（不能计算）。
   */
  const targetMissingRows = useMemo<TargetRow[] | null>(() => {
    if (snapshots.length === 0 && !comparableIds.includes(viewerAccountId)) {
      return null;
    }
    return targetRows.filter((row) => row.missingNatures.length > 0);
  }, [targetRows, snapshots.length, comparableIds, viewerAccountId]);

  /**
   * 「自己能产」：背包里没有现货，但同账号有可孵的一对（母本 + 同档位公）。
   * 只作为提示（蓝边 + 说明），**不再限制发需求**（2026-10-29 用户口径：自己可孵也能发）。
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
  const speciesByGameId = useMemo(
    () => new Map(species.map((entry) => [entry.gameId, entry])),
    [species],
  );

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
  const seekingRows = targetRows.filter((row) =>
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
  const demandedExtras: TargetRow[] =
    missingRows == null
      ? []
      : targetRows.filter(
          (row) =>
            myUnfinishedDemandedEggs.has(row.eggGameId) && !missingEggIds.has(row.eggGameId),
        );
  const currentRows: TargetRow[] | null =
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
    // 「我缺的」：勾了几个人就取并集——其中任意一人能补就算命中（2026-10-28 用户口径）。
    // 「共同寻找」的范围由 seekingMembers 决定，这里不掺和。
    if (effectiveView === 'missing' && missingMembers.length > 0) {
      // 只按「能补我还没收集的性格」筛；仅有这颗蛋但补不了缺口的人不算
      const supplierIds = [...row.suppliersByNature.values()].flat();
      if (!supplierIds.some((accountId) => missingMembers.includes(accountId))) return false;
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
  const publishableRows = filtered.filter((row) => row.canSupplyMissing);
  const dataIncompleteRows = filtered.filter(
    (row) => !row.canSupplyMissing && (!isDefaultTarget || row.unknownMemberIds.length > 0),
  );
  const blockedRows = filtered.filter(
    (row) =>
      !row.canSupplyMissing &&
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

  // 「我缺的」瀑布流：不再翻页，滚到底自动追加，筛掉的分区也不会整页跳走。
  const hasMoreRows = effectiveView === 'missing' && listRows.length > missingVisible;
  const pageRows =
    effectiveView === 'missing' ? listRows.slice(0, missingVisible) : listRows;

  // 滚到底部的哨兵进入视口就追加一屏；IntersectionObserver 不可用时仍可点「加载更多」。
  useEffect(() => {
    if (!hasMoreRows) return;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMissingVisible((value) => Math.min(value + MISSING_PAGE_SIZE, listRows.length));
        }
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreRows, missingVisible, listRows.length]);

  const taskKeyOf = (row: MotherCoverageRow): string => `mother:${row.eggGameId}`;
  const taskOf = (row: MotherCoverageRow): CollectionTaskRecord | undefined =>
    tasks.find((task) => task.targetKey === taskKeyOf(row));
  const nameOf = (accountId: string): string => {
    const member = memberById.get(accountId);
    return member ? cardName(labelOf(member)) : accountId.slice(0, 6);
  };
  /** 详情弹层不截断昵称，尽量写全，避免「不知道是谁」。 */
  const fullNameOf = (accountId: string): string => {
    const member = memberById.get(accountId);
    return member ? labelOf(member) : '已退出的成员';
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

  /* ---------- 需求承接（2026-10-26） ---------- */

  const rowByEgg = useMemo(() => new Map(rows.map((row) => [row.eggGameId, row])), [rows]);

  const iHoldEgg = (eggGameId: number): boolean =>
    rowByEgg.get(eggGameId)?.holders.some((holder) => holder.accountId === viewerAccountId) ??
    false;

  /** 本机自己的已发布产线：手机上没导入本地数据时，也能判断「我能接什么」。 */
  const myPublishedLines = useMemo(() => {
    if (!isMotherResourceComparable(myMember?.resource ?? null, catalogVersion, criteriaId)) return null;
    const accounts = myMember?.resource?.accounts ?? [];
    if (accounts.length === 0) return null;
    // 旧摘要没有产线字段，分不清性格 / 档位，只能退回旧口径
    if (accounts.some((account) => account.lines === undefined)) return null;
    return accounts.flatMap((account) => account.lines ?? []);
  }, [myMember, catalogVersion, criteriaId]);

  /**
   * 本机是否能同账号孵出一对（母本 + 同档位公）。
   * 没导入本机数据时改用**自己已发布的产线**判断（2026-10-28 用户反馈：
   * 手机上没导入数据就接不了种公单）；旧摘要连产线都没有时，才退回「我有这颗蛋」。
   */
  const viewerCanSupply = (demand: CollectionDemand): boolean => {
    if (snapshots.length > 0) {
      return isStudDemandKey(demand.eggGameId)
        ? findStudBreedableSupply(snapshots, demand, species).kind !== 'none'
        : findBreedableSupply(snapshots, demand, species).kind !== 'none';
    }
    if (myPublishedLines != null) {
      if (isStudDemandKey(demand.eggGameId)) {
        return linesSupplyTarget(
          myPublishedLines,
          {
            kind: 'stud',
            groupId: -demand.eggGameId,
            nature: demand.nature,
            body: demand.body,
            voice: demand.voice,
          },
          productionIndex,
        );
      }
      // 需求要公时，该蛋物种必须能出公
      if (demand.gender === '公') {
        if (productionIndex.maleCapableByGameId.get(demand.eggGameId) !== true) return false;
      }
      return linesSupplyTarget(
        myPublishedLines,
        {
          kind: 'mother',
          eggGameId: demand.eggGameId,
          nature: demand.nature,
          body: demand.body,
          voice: demand.voice,
        },
        productionIndex,
      );
    }
    return !isStudDemandKey(demand.eggGameId) && iHoldEgg(demand.eggGameId);
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
    myPublishedLines,
    species,
    targetMode,
    myDataStale,
  ]);

  /** 「我缺的」二级页面展示的蛋：按当前目标口径重新取一遍谁能补。 */
  const resourceDetailRow =
    resourceDetailEggId == null
      ? null
      : targetRows.find((row) => row.eggGameId === resourceDetailEggId) ?? null;
  const resourceDetailDemands =
    resourceDetailEggId == null ? [] : myDemandsByEgg.get(resourceDetailEggId) ?? [];

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
          linesSupplyTarget(viewerLines, target, productionIndex),
        );
        const groups = targets.map((target) => ({
          groupId: target.groupId,
          supplied: linesSupplyTarget(groupLineInfo.lines, target, productionIndex),
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
    productionIndex,
    viewerLines,
    groupLineInfo,
    species,
    targetMode,
  ]);

  /** 需求键：需求方 + 蛋 + 性格 + 性别 / 体型 / 声音；同蛋同性格的母/公是两条。 */
  const demandKey = (demand: CollectionDemand): string =>
    `${demand.demanderAccountId}:${demandKeyOf(demand)}`;

  /** 当前打开的需求；需求被刷新/删除后自动收起，不展示过期内容。 */
  const detailDemand = detailKey
    ? demands.find((demand) => demandKey(demand) === detailKey) ?? null
    : null;

  /**
   * 需求详情里的配对建议（2026-10-28 用户要求「告诉我怎么配对」）：
   * 用本机背包找同账号能配的一对（母本 + 种公），找不到时说明还缺什么。
   */
  const demandPairing = (demand: CollectionDemand): ReactNode => {
    if (snapshots.length === 0) {
      return (
        <p className="px-1 text-[11px] leading-snug text-slate-500">
          本机还没导入数据；导入后这里会直接给出用哪两只配窝。
        </p>
      );
    }
    /** 亲本条件（体型 / 声音要双方都满足；性格只要一方带）。 */
    const gradeText = [
      demand.body ? `体型 ${demand.body}` : '',
      demand.voice ? `声音 ${demand.voice}` : '',
    ]
      .filter(Boolean)
      .join('、');
    const parentRule = [
      gradeText ? `${gradeText} 双方都要满足` : '',
      demand.nature ? `性格 ${demand.nature} 至少一方带` : '',
    ]
      .filter(Boolean)
      .join('；');
    const nameOfPet = (pet: OwnedPet): string =>
      speciesDisplayName(speciesByGameId.get(pet.gameId), pet.name);
    /**
     * 推荐配对（2026-10-29 用户口径）：需求中心改用**家园同款精灵卡**，
     * 一公一母并排；角色用左下角标签区分，底部写账号 · 盒位。
     */
    const pairs = (
      items: Array<{ label: string; pet: OwnedPet | null | undefined }>,
      advice: string,
    ): ReactNode => {
      const visible = items.filter(
        (item): item is { label: string; pet: OwnedPet } => item.pet != null,
      );
      if (visible.length < 2) return null;
      const motherPet = visible.find((item) => item.label === '母本')?.pet ?? visible[0].pet;
      const fatherPet = visible.find((item) => item.label === '种公')?.pet ?? visible[1].pet;
      const card = (pet: OwnedPet, roleLabel: string) => (
        <PetCompactCard
          gameId={pet.gameId}
          name={nameOfPet(pet)}
          gender={pet.gender}
          nature={pet.nature}
          medalBody={pet.medalBody}
          voiceDb={pet.voiceDb}
          heightPercent={pet.heightPercent}
          weightPercent={pet.weightPercent}
          eggGroups={speciesByGameId.get(pet.gameId)?.eggGroups ?? []}
          isShiny={pet.isShiny}
          isColorful={pet.isColorful}
          footer={`${pet.account} · ${boxLabel(pet)}`}
          roleLabel={roleLabel}
          variant="demand"
          testId="mother-demand-pair-card"
        />
      );
      return (
        <div className="space-y-1" data-testid="mother-demand-pairing-text">
          <p className="px-1 text-[10px] leading-snug text-emerald-800" data-testid="mother-demand-pair-advice">
            {advice}
          </p>
          {/* 卡片固定 160 宽，不跟着弹层缩；窄屏改为横向滚动，避免元素错位。 */}
          <div className="overflow-x-auto">
            <div className="mx-auto flex w-max gap-2">
              {card(motherPet, '母本')}
              {card(fatherPet, '种公')}
            </div>
          </div>
        </div>
      );
    };

    if (isStudDemandKey(demand.eggGameId)) {
      const supply = findStudBreedableSupply(snapshots, demand, species);
      const groupName = eggGroupNames[-demand.eggGameId] ?? `蛋组${-demand.eggGameId}`;
      if (supply.kind === 'breedable') {
        return (
          pairs(
            [
              { label: '母本', pet: supply.motherPet?.pet },
              { label: '种公', pet: supply.malePet?.pet },
            ],
            `用这两只同账号配对，可孵出「${groupName}」蛋。`,
          ) ?? (
            <p className="px-1 text-[11px] leading-snug text-slate-500">
              本机暂时凑不出「{groupName}」的配对。
            </p>
          )
        );
      }
      return (
        <p className="px-1 text-[11px] leading-snug text-slate-500" data-testid="mother-demand-pairing-text">
          本机暂时凑不出「{groupName}」的配对：需要同账号的母本 + 同蛋组公本
          {parentRule ? `（${parentRule}）` : ''}。
        </p>
      );
    }

    const supply = findBreedableSupply(snapshots, demand, species);
    const eggName = splitDisplayName(
      rowByEgg.get(demand.eggGameId)?.name ?? `蛋 ${demand.eggGameId}`,
    ).base;
    if (supply.kind === 'breedable') {
      return (
        pairs(
          [
            { label: '母本', pet: supply.motherPet?.pet },
            { label: '种公', pet: supply.malePet?.pet },
          ],
          `用这两只同账号配对，可孵出「${eggName}」。`,
        ) ?? (
          <p className="px-1 text-[11px] leading-snug text-slate-500">
            本机暂时凑不出能产「{eggName}」的一对。
          </p>
        )
      );
    }
    return (
      <p className="px-1 text-[11px] leading-snug text-slate-500" data-testid="mother-demand-pairing-text">
        本机暂时凑不出能产「{eggName}」的一对：需要同账号的「{eggName}」母本 + 同蛋组公本
        {parentRule ? `（${parentRule}）` : ''}。
      </p>
    );
  };

  /** 当前视图实际可发需求的条目数：按钮可用性与计数必须跟渲染列表同源。 */
  const selectableMissingRows = filtered.filter(
    (row) => !blockedEggIds.has(row.eggGameId),
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

  /** 单颗蛋的默认发布项：已发过的同性格跳过；没有可发性格时返回 null。 */
  const missingPublishItem = (eggGameId: number): DemandPublishItem | null => {
    // 全新鲜且确认没有来源的蛋不发需求（防状态过期后被带上）；自己能产不再拦。
    if (blockedEggIds.has(eggGameId)) return null;
    const row = rowByEgg.get(eggGameId);
    const { base } = splitDisplayName(row?.name ?? `蛋 ${eggGameId}`);
    // 已发过的「同性格 + 同性别 / 体型 / 声音」不能再带进来：
    // 新接口不会覆盖，但重复发只会得到原行，提示「已发过」更清楚。
    const existing = new Set(
      (myDemandsByEgg.get(eggGameId) ?? [])
        .filter((demand) => demand.status !== 'done')
        .map((demand) => `${demand.nature}:${demand.gender}:${demand.body}:${demand.voice}`),
    );
    const targetRow = targetRows.find((row) => row.eggGameId === eggGameId);
    const rowMissing = targetRow?.missingNatures;
    // 目标性格已经收齐（或手选的那一个已经收到）→ 没有可发的了
    if (rowMissing && rowMissing.length === 0) return null;
    const missingNamed = (rowMissing ?? []).filter(Boolean);
    const preferred = configuredNaturesOf(eggGameId);
    // 只发「我还缺的性格」；没有按性格收时再退回默认推荐
    const candidates = missingNamed.length > 0
      ? missingNamed
      : preferred.length > 0
        ? preferred
        : defaultEggNatures(species, eggGameId);
    const natures = candidates.filter(
      (nature) => !existing.has(`${nature}:母:${targetBody}:${targetVoice}`),
    );
    // 只在「本来有可发性格、但全部都发过了」时跳过；没有默认性格仍允许不挑性格发布
    if (candidates.length > 0 && natures.length === 0) return null;
    return { eggGameId, name: base, natures };
  };

  /** 发布前的数据不全提示；只在一部分蛋属于「数据不全」时出现。 */
  const publishWarningFor = (eggGameIds: number[]): string => {
    if (!eggGameIds.some((eggGameId) => dataIncompleteEggIds.has(eggGameId))) return '';
    return groupFresh.stale > 0
      ? `有 ${groupFresh.stale} 人超过 7 天未更新，可能有人能孵但没发布。仍要发布？`
      : '有人还没发布资源，可能有人能孵但没发布。仍要发布？';
  };

  /** 二级页面里的「发需求」：直接为这颗蛋打开性格确认弹层。 */
  const publishResourceDemand = (eggGameId: number) => {
    const item = missingPublishItem(eggGameId);
    if (!item) {
      setDemandMessage(
        blockedEggIds.has(eggGameId)
          ? '组内暂时确认没人能补你缺的性格，发需求也大概率没人能接'
          : '这颗蛋的性格都已经发过需求了；要改条件请先撤回原需求',
      );
      return;
    }
    setPublishWarning(publishWarningFor([eggGameId]));
    setPublishError('');
    setPublishItems([item]);
  };

  const runBulk = async () => {
    if (selected.length === 0 || demandBusy) return;
    setDemandBusy(true);
    setDemandError('');
    setDemandMessage('');
    try {
      if (effectiveView === 'missing') {
        // 先弹性格确认，发布放到 confirmPublish 里做（2026-10-26）
        const items = selected
          .map((key) => missingPublishItem(Number(key)))
          .filter((item): item is DemandPublishItem => item !== null);
        if (items.length === 0) {
          setDemandMessage('这些蛋的性格都已经发过需求了；要改条件请先撤回原需求');
          return;
        }
        setPublishWarning(publishWarningFor(selected.map(Number)));
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
    setResourceDetailEggId(null);
  }, [effectiveView, targetKind, group.group.id]);

  /** 需求卡：四段共用，只有动作不同；已完成的单不进列表。卡片只留 头像 + 名称 + 性格 + 动作。 */
  const renderDemandCard = (demand: CollectionDemand, actions: ReactNode): ReactNode => {
    const isStud = isStudDemandKey(demand.eggGameId);
    const base = isStud
      ? (eggGroupNames[-demand.eggGameId] ?? `蛋组${-demand.eggGameId}`)
      : splitDisplayName(rowByEgg.get(demand.eggGameId)?.name ?? `蛋 ${demand.eggGameId}`).base;
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
          <button
            type="button"
            aria-label={`查看${base}需求详情`}
            title="点击头像查看需求详情与配对"
            data-testid="mother-demand-open"
            onClick={(event) => {
              event.stopPropagation();
              setDetailKey(demandKey(demand));
            }}
            className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {isStud ? (
              <span className="block h-10 w-10" aria-hidden />
            ) : (
              <PetAvatar gameId={demand.eggGameId} name={base} size={40} />
            )}
          </button>
        </div>
        <span className="w-full break-words text-center text-[10px] font-medium leading-tight text-slate-700">
          {base}
        </span>
        <div className="flex w-full items-center justify-center gap-0.5">
          <NatureChips natures={[demand.nature || '不挑']} testId="mother-demand-natures" />
          <GenderMark
            gender={demand.gender === '公' || demand.gender === '母' ? demand.gender : '未知'}
          />
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-center gap-1 text-[10px]">
          {actions}
        </div>
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
        <div className="flex flex-nowrap items-center gap-1" data-testid="missing-kind-filter">
          <SegmentedControl
            label="我缺的类型"
            value={targetKind}
            options={[
              { value: 'stud', label: '种公' },
              { value: 'mother', label: '母本' },
            ]}
            onValueChange={(next) => setList({ targetKind: next as 'mother' | 'stud' })}
            optionTestId={(value) => `missing-kind-${value}`}
            className="w-[100px] shrink-0"
          />
          {targetKind === 'mother' ? (
            <div className="flex min-w-0 flex-1 items-center gap-1" data-testid="mother-target-filter">
              <NatureSelect
                label="性格"
                value={targetNature}
                onValueChange={(value) => setList({ targetNature: value })}
                testId="mother-target-nature"
                menuTestId="mother-target-nature-options"
                optionTestId={(value) => `mother-target-nature-option-${value || 'any'}`}
                className="min-w-0 flex-1 [&>button]:w-full [&>button]:justify-between [&>button]:px-1.5 [&>button]:text-[11px]"
              />
              <InlineSelect
                label="体型"
                value={targetBody}
                options={DEMAND_BODIES.map((value) => ({
                  value,
                  label: value || '不限',
                }))}
                onValueChange={(value) => setList({ targetBody: value as DemandBody })}
                testId="mother-target-body"
                menuTestId="mother-target-body-options"
                optionTestId={(value) => `mother-target-body-option-${value || 'any'}`}
                className="min-w-0 flex-1 [&>button]:w-full [&>button]:justify-between [&>button]:px-1.5 [&>button]:text-[11px]"
              />
              <InlineSelect
                label="声音"
                value={targetVoice}
                options={DEMAND_VOICES.map((value) => ({
                  value,
                  label: value || '不限',
                }))}
                onValueChange={(value) => setList({ targetVoice: value as DemandVoice })}
                testId="mother-target-voice"
                menuTestId="mother-target-voice-options"
                optionTestId={(value) => `mother-target-voice-option-${value || 'any'}`}
                className="min-w-0 flex-1 [&>button]:w-full [&>button]:justify-between [&>button]:px-1.5 [&>button]:text-[11px]"
              />
            </div>
          ) : (
            <span className="truncate text-[10px] text-slate-400">按蛋组收，物种不限</span>
          )}
        </div>
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

      {/* 搜索框独占一行（产品规范）；成员筛选与动作按钮放到下一行，不挤输入宽度。 */}
      <div className="space-y-1.5">
        <SearchField
          className="w-full"
          label={targetKind === 'stud' ? '搜索种公推荐' : '搜索小组资源'}
          value={query}
          onValueChange={(value) => setList({ query: value })}
          placeholder={
            targetKind === 'stud' ? '搜性格 / 蛋组 / 建议物种' : '搜母本 / 同血脉名称 / 图鉴号'
          }
          testId="mother-search"
        />
        <div className="flex items-center gap-1.5">
        {effectiveView === 'seeking' ? (
          <InlineMultiSelect
            key="seeking-members"
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
        ) : effectiveView === 'missing' && targetKind === 'stud' ? null : effectiveView === 'missing' ? (
          <InlineMultiSelect
            key="missing-members"
            label="筛选能补我的成员"
            values={missingMembers}
            options={group.members.map((member) => ({
              value: member.accountId,
              label: labelOf(member),
            }))}
            onValuesChange={(values) => setList({ missingMembers: values })}
            allLabel="全部成员"
            unit="人"
            testId="mother-member-filter"
            menuTestId="mother-member-options"
            optionTestId={(value) => `mother-member-${value || 'all'}`}
            align="right"
            className="max-w-[104px] shrink-0"
          />
        ) : (
          <InlineSelect
            key="demand-members"
            label="筛选需求方"
            value={memberFilter}
            options={[
              { value: '', label: '全部需求方' },
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
            className={`min-h-[38px] shrink-0 rounded-lg px-2.5 text-xs font-medium disabled:opacity-40 ${
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
                            ? '自己能产 · 也可以发需求'
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
            // 瀑布流按整个列表的绝对位置判断分区标题。
            const absoluteIndex = index;
            const natures = configuredNaturesOf(row.eggGameId);
            const { base } = splitDisplayName(row.name);
            const selectionKey = selectionKeyOf(row.eggGameId);
            const isSelected = selected.includes(selectionKey);
            const myDemands = myDemandsByEgg.get(row.eggGameId) ?? [];
            const missingSet = new Set(row.missingNatures.filter(Boolean));
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
                数据不全 · 可能有人能补 · {dataIncompleteRows.length}
              </li>
            ) : null}
            {showBlockedDivider ? (
              <li
                className="col-span-full border-t border-dashed border-slate-200 pt-1.5 text-[11px] font-medium text-slate-400"
                data-testid="mother-blocked-section"
              >
                组内暂时补不了 · {blockedRows.length}
              </li>
            ) : null}
            <li
              onClick={() => selecting && !blocked && toggleSelect(selectionKey)}
              aria-disabled={blocked ? true : undefined}
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
              } ${selecting && !blocked ? 'cursor-pointer' : ''}`}
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
                {effectiveView === 'missing' ? (
                  <button
                    type="button"
                    aria-label={`查看${base}的详情与操作`}
                    title="点击头像查看详情与操作"
                    data-testid="mother-resource-open"
                    onClick={(event) => {
                      // 批量选择时点头像仍然只是勾选，不打断选择流程
                      if (selecting) return;
                      event.stopPropagation();
                      setResourceDetailEggId(row.eggGameId);
                    }}
                    className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <PetAvatar gameId={row.eggGameId} name={base} size={40} />
                  </button>
                ) : (
                  <PetAvatar gameId={row.eggGameId} name={base} size={40} />
                )}
              </div>
              <span
                className="w-full break-words text-center text-[10px] font-medium leading-tight text-slate-700"
                data-testid="mother-resource-name"
              >
                {base}
              </span>
              <NatureChips
                natures={natures}
                testId="mother-resource-natures"
                missing={effectiveView === 'missing' ? missingSet : undefined}
              />
              {myDemands.length > 0 ? (
                effectiveView === 'missing' ? (
                  // 2026-10-28 用户口径：卡片上的按钮太小、多性格容易点错，
                  // 卡片只保留一句概要，具体的完成 / 撤回 / 发需求都放到点头像的二级页面。
                  <span
                    className="w-full text-center text-[10px] leading-tight text-emerald-700"
                    data-testid="mother-demanded"
                  >
                    已发 {myDemands.length} 条 · 点头像操作
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center justify-center gap-1" data-testid="mother-demanded">
                    {myDemands.map((demand) => {
                      const withdrawKey = demandKey(demand);
                      const confirming = confirmWithdraw === withdrawKey;
                      return (
                        <Fragment key={demandKey(demand)}>
                          {demand.status === 'claimed' ? completeControl(demand) : null}
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
                )
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
          {effectiveView === 'missing' && hasMoreRows ? (
            <div
              ref={loadMoreRef}
              className="mt-2 py-2 text-center text-[10px] text-slate-400"
              data-testid="mother-load-more"
            >
              已显示 {pageRows.length} / {listRows.length} 项，继续下滑自动加载
              <button
                type="button"
                onClick={() =>
                  setMissingVisible((value) =>
                    Math.min(value + MISSING_PAGE_SIZE, listRows.length),
                  )
                }
                className="ml-1 rounded-lg border border-slate-200 px-2 py-1"
                data-testid="mother-load-more-button"
              >
                加载更多
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <ModalSurface
        open={resourceDetailRow !== null}
        title="母本详情"
        onClose={() => setResourceDetailEggId(null)}
        testId="mother-resource-detail"
        closeTestId="mother-resource-detail-close"
        backdropTestId="mother-resource-detail-backdrop"
      >
        {resourceDetailRow ? (() => {
          const eggGameId = resourceDetailRow.eggGameId;
          const { base } = splitDisplayName(resourceDetailRow.name);
          const natures = configuredNaturesOf(eggGameId);
          const missingNatures = resourceDetailRow.missingNatures.filter(Boolean);
          const missingSet = new Set(missingNatures);
          const supplierLines = [...resourceDetailRow.suppliersByNature.entries()].map(
            ([nature, ids]) => {
              const names = ids.map((accountId) => fullNameOf(accountId)).join('、');
              return nature ? `${nature}：${names}` : `${names} 能补`;
            },
          );
          const publishItem = missingPublishItem(eggGameId);
          const blocked = blockedEggIds.has(eggGameId);
          const publishLabel = blocked
            ? '组内暂时没人能补'
            : publishItem
              ? publishItem.natures.length > 0
                ? `发需求 · ${publishItem.natures.join(' / ')}`
                : '发需求（不挑性格）'
              : resourceDetailRow.missingNatures.length === 0
                ? '按你的收集口径已收齐'
                : '这些性格都已经发过需求';
          return (
            <div className="space-y-3 p-3" data-testid="mother-resource-detail-body">
              <div className="flex items-start gap-2.5">
                <PetAvatar gameId={eggGameId} name={base} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-semibold text-slate-800">
                    {base}
                  </p>
                  <NatureChips
                    natures={natures}
                    testId="mother-resource-detail-natures"
                    missing={missingSet}
                  />
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    目标：性格 {targetNature || '不限'} · 体型 {targetBody || '不限'} · 声音{' '}
                    {targetVoice || '不限'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-2.5 py-2" data-testid="mother-resource-detail-suppliers">
                <h3 className="text-[11px] font-semibold text-slate-600">谁能补我</h3>
                {missingNatures.length > 0 ? (
                  <p
                    className="mt-0.5 text-xs leading-snug text-rose-600"
                    data-testid="mother-resource-detail-missing-natures"
                  >
                    还缺：{missingNatures.join('、')}
                  </p>
                ) : natures.length > 0 ? (
                  <p className="mt-0.5 text-xs leading-snug text-emerald-700">
                    按你的收集口径已经收齐。
                  </p>
                ) : null}
                <div className="mt-0.5 space-y-0.5">
                  {supplierLines.length > 0 ? (
                    supplierLines.map((line) => (
                      <p key={line} className="text-xs leading-snug text-slate-700">
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs leading-snug text-slate-500">
                      {resourceDetailRow.unknownMemberIds.length > 0
                        ? `已发布的成员都补不了；另有 ${resourceDetailRow.unknownMemberIds.length} 人未发布 / 未更新`
                        : '组内暂时没人能补'}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5" data-testid="mother-resource-detail-demands">
                <h3 className="text-[11px] font-semibold text-slate-600">
                  我的需求 · {resourceDetailDemands.length}
                </h3>
                {resourceDetailDemands.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
                    这颗蛋还没发过需求。
                  </p>
                ) : (
                  resourceDetailDemands.map((demand) => {
                    // 结单后可以再发同款：done 行与新行会同时存在，key 必须能区分
                    const key =
                      demand.status === 'done'
                        ? `${demandKey(demand)}@done:${demand.updatedAt}`
                        : demandKey(demand);
                    const claimed = demand.status === 'claimed';
                    const statusLabel =
                      demand.status === 'claimed'
                        ? demand.claimerAccountId === viewerAccountId
                          ? '我接了'
                          : demand.claimerAccountId
                            ? `${fullNameOf(demand.claimerAccountId)} 接了`
                            : '已被接单'
                        : demand.status === 'done'
                          ? '已完成'
                          : '待承接';
                    return (
                      <div
                        key={key}
                        className="rounded-xl border border-slate-200 px-2.5 py-2"
                        data-testid="mother-resource-detail-demand"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <NatureChips natures={[demand.nature || '不挑']} testId="mother-demand-natures" />
                          <span
                            className={`shrink-0 text-[11px] ${
                              claimed ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {claimed ? (
                            confirmComplete === key ? (
                              <div className="flex w-full flex-col gap-1.5" data-testid="mother-demand-complete-confirm">
                                <span className="text-[11px] leading-snug text-amber-700">
                                  背包里未检测到，确认已完成？
                                </span>
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    disabled={demandBusy}
                                    onClick={() => void runDemandAction('complete', demand, true)}
                                    data-testid="mother-demand-complete-confirm-yes"
                                    className="min-h-[40px] flex-1 rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
                                  >
                                    已完成
                                  </button>
                                  <button
                                    type="button"
                                    disabled={demandBusy}
                                    onClick={() => setConfirmComplete(null)}
                                    data-testid="mother-demand-complete-cancel"
                                    className="min-h-[40px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={demandBusy}
                                onClick={() => void runDemandAction('complete', demand)}
                                data-testid="mother-demand-complete"
                                className="min-h-[40px] flex-1 rounded-lg border border-emerald-500 text-sm font-medium text-emerald-700 disabled:opacity-50"
                              >
                                完成
                              </button>
                            )
                          ) : null}
                          {demand.status !== 'done' ? (
                            confirmWithdraw === key ? (
                              <>
                                <button
                                  type="button"
                                  disabled={demandBusy}
                                  onClick={() => void runDemandAction('withdraw', demand)}
                                  data-testid="mother-demand-withdraw-confirm"
                                  className="min-h-[40px] flex-1 rounded-lg border border-rose-300 text-sm font-medium text-rose-600 disabled:opacity-50"
                                >
                                  确认撤回
                                </button>
                                <button
                                  type="button"
                                  disabled={demandBusy}
                                  onClick={() => setConfirmWithdraw(null)}
                                  data-testid="mother-demand-withdraw-cancel"
                                  className="min-h-[40px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={demandBusy}
                                onClick={() => setConfirmWithdraw(key)}
                                data-testid="mother-demand-withdraw"
                                className="min-h-[40px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500 disabled:opacity-50"
                              >
                                撤回
                              </button>
                            )
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                disabled={!publishItem || demandBusy}
                onClick={() => publishResourceDemand(eggGameId)}
                data-testid="mother-resource-publish"
                className="min-h-[44px] w-full rounded-xl bg-emerald-600 text-sm font-medium text-white disabled:bg-slate-200 disabled:text-slate-500"
              >
                {publishLabel}
              </button>
              {!publishItem && !blocked ? (
                <p className="text-[11px] leading-snug text-slate-400">
                  想改条件，先撤回对应的需求再重新发。
                </p>
              ) : null}
            </div>
          );
        })() : null}
      </ModalSurface>
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
      <ModalSurface
        open={detailDemand !== null}
        title="需求详情"
        onClose={() => setDetailKey(null)}
        testId="mother-demand-detail"
        closeTestId="mother-demand-detail-close"
        backdropTestId="mother-demand-detail-backdrop"
      >
        {detailDemand ? (() => {
          const isStud = isStudDemandKey(detailDemand.eggGameId);
          const base = isStud
            ? (eggGroupNames[-detailDemand.eggGameId] ?? `蛋组${-detailDemand.eggGameId}`)
            : splitDisplayName(
                rowByEgg.get(detailDemand.eggGameId)?.name ?? `蛋 ${detailDemand.eggGameId}`,
              ).base;
          const statusText =
            detailDemand.status === 'claimed'
              ? detailDemand.claimerAccountId === viewerAccountId
                ? '我接了'
                : detailDemand.claimerAccountId
                  ? `${fullNameOf(detailDemand.claimerAccountId)} 接了`
                  : '已被接单'
              : detailDemand.status === 'done'
                ? '已完成'
                : '待承接';
          return (
            <div className="space-y-1.5 py-1" data-testid="mother-demand-detail-body">
              <div className="flex items-start gap-2 px-1">
                {isStud ? (
                  <span className="block h-10 w-10 shrink-0 rounded-md bg-slate-100" aria-hidden />
                ) : (
                  <PetAvatar gameId={detailDemand.eggGameId} name={base} size={40} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium leading-tight text-slate-800">
                    {base}
                  </p>
                  <div className="mt-0.5 flex items-center gap-0.5">
                    <NatureChips
                      natures={[detailDemand.nature || '不挑']}
                      testId="mother-demand-detail-natures"
                    />
                    <GenderMark
                      gender={
                        detailDemand.gender === '公' || detailDemand.gender === '母'
                          ? detailDemand.gender
                          : '未知'
                      }
                    />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500" data-testid="mother-demand-detail-criteria">
                    性别 {detailDemand.gender || '不挑'} · 体型 {detailDemand.body || '不限'} · 声音{' '}
                    {detailDemand.voice || '不限'}
                  </p>
                </div>
              </div>
              <div className="mx-1 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                <span className="min-w-0 truncate text-[11px] text-slate-700" data-testid="mother-demand-detail-demander">
                  需求方：{fullNameOf(detailDemand.demanderAccountId)}
                </span>
                <span className="shrink-0 text-[11px] text-slate-500" data-testid="mother-demand-detail-status">
                  状态：{statusText}
                </span>
              </div>
              <div className="rounded-lg bg-emerald-50/70 px-0 py-1.5">
                <h3 className="px-1 text-[11px] font-semibold text-emerald-800">推荐配对</h3>
                <div className="mt-0.5" data-testid="mother-demand-detail-pairing">
                  {demandPairing(detailDemand)}
                </div>
              </div>
            </div>
          );
        })() : null}
      </ModalSurface>
    </section>
  );
}

/**
 * 目标性格（2026-10-28 用户口径）：**全部展示、不收起**，横向自动换行。
 *
 * 放在头像与名称**下面**而不是右上角：性格数量变化不再改动头像位置，
 * 同排卡片头像始终对齐。
 * `missing` 里的性格标红：表示这个性格的母本还没收集到（2026-10-28 用户口径）。
 */
function NatureChips({
  natures,
  testId,
  missing,
}: {
  natures: string[];
  testId?: string;
  missing?: ReadonlySet<string>;
}) {
  if (natures.length === 0) return null;
  const chip = 'rounded bg-emerald-50 px-1 text-[9px] leading-[1.15] text-emerald-700';
  const missingChip = 'rounded bg-rose-50 px-1 text-[9px] leading-[1.15] text-rose-600';
  return (
    <span className="flex w-full flex-wrap justify-center gap-0.5" data-testid={testId}>
      {natures.map((nature) => (
        <span
          key={nature}
          className={missing?.has(nature) ? missingChip : chip}
          title={missing?.has(nature) ? '这个性格的母本还没收集到' : undefined}
        >
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
