import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NatureSelect } from './primitives/NatureSelect';
import { allNatureNames, eggGroupNames, targetNatureNames } from '../data/catalog';
import { GRADE_BODY, buildEggSearchIndex, gradeLabel, type TargetMode } from '../domain/petFilters';
import { buildMotherCoverage, isMotherResourceComparable, selectMotherSharingViews } from '../domain/motherSharing';
import {
  findBreedableSupply,
  findStudBreedableSupply,
  eggGroupIdOfDemand,
  groupFreshness,
  hasStockForDemand,
  hasStockForStudDemand,
  isStudDemandKey,
  memberFreshness,
  NATURE_CHANCE_LABELS,
  pairOptionsForEgg,
  type DemandPairOption,
} from '../domain/demandCriteria';
import {
  studPlacementOptions,
  type StudPlacementOption,
} from '../domain/demandPlacement';
import {
  findStudDemandCandidates,
  type StudDemandCandidate,
} from '../domain/studDemandCandidates';
import {
  buildLinesIndex,
  buildProductionIndex,
  buildProductionLines,
  linesIndexSuppliesTarget,
  type ProductionLine,
  type ProductionLinesIndex,
  type ProductionTarget,
} from '../domain/productionLines';
import {
  bodyMedalIconByLabel,
  GREEN_NEST_ICON,
  voiceMedalIconByLabel,
  voiceMedalLabel,
} from '../domain/petIcons';
import { isBreedableGroup } from '../domain/eggs';
import { requiredEggWeight } from '../domain/eggWeight';
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
  DEMAND_GENDERS,
  DEMAND_NATURE_MAX,
  DEMAND_VOICES,
  demandKeyOf,
  type CollectionDemand,
  type CollectionTaskRecord,
  type DemandBody,
  type DemandGender,
  type DemandVoice,
} from '../shared/collectionGroups';
import type { MotherTargetConfig } from '../shared/collectionGroups';
import { eggNatures, defaultEggNatures, type NatureOverrides } from '../domain/recommendedNatures';
import { completedDemandCounts } from '../domain/demandStats';
import {
  BODY_LABELS,
  DemandPublishSheet,
  GENDER_LABELS,
  VOICE_LABELS,
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
import { demandPickKey, pickEggIdOf, readDemandPicks, writeDemandPicks, type DemandPicks } from './demandPickStore';
import { completionReadKey, markCompletionRead, readCompletionRead } from './demandCompletionReadStore';

/**
 * 三页（我缺的 / 需求中心 / 共同寻找）共用一张卡：4 列 × 79 宽、卡高 104。
 * 323 = 375 屏宽 - 页面左右 32 - 区块左右 20；4×79 + 3×2 = 322，留 1px 余量。
 * 坐标来自 `需求卡-4列-重排版方案.html` 方案 C（用户 2026-11-01 定稿），1:1 落地，不做缩放换算。
 */
const DEMAND_CARD_SCALE = 1;
const DEMAND_CARD_W = 79;
const DEMAND_CARD_H = 104;
/** 卡片内各元素的最终坐标（单位 px，直接落地）。 */
const DEMAND_CARD_POS = {
  avatar: { left: 18, top: 7, scale: 0.95 },
  /** 性别 + 名字 + 形态后缀合成一行，整卡宽居中（2026-11-01 用户口径：两者强关联）。 */
  nameRow: { top: 49 },
  /** 两枚奖牌收在两个上角；满体重 / 满声音换蛋神 MAX / MIN 图。2026-11-01 用户手调：放大到 1.25 / 1.3。 */
  body: { left: 4, top: 4, scale: 1.25 },
  voice: { left: 61, top: 4, scale: 1.3 },
  /** 性格全部铺开：1~3 个一行，4~6 个自动换第二行（不再用 +N 角标）。 */
  nature: { top: 63 },
  /** 状态条：满宽、浅色半透明白底 + 细分隔线，贴卡片底部。 */
  action: { top: 87, height: 17 },
};

/** 卡片头像统一 44px（缩放 0.95 后视觉约 42px）。 */
const DEMAND_CARD_AVATAR_SIZE = 44;

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
  /** 这颗蛋按我自己的收集口径要收的性格；空数组 = 不按性格收（2026-10-29 代码审查 B5-M01 预存）。 */
  configuredNatures: string[];
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
  /**
   * 服务端聚合的已结单数（2026-11-01）：需求列表不再下发已完成行，
   * 优先用它；不传时退回按 demands 本地统计（兼容旧服务端 / 旧调用方）。
   */
  completedCounts?: Record<string, number>;
  /** 我承接的最近 N 条已完成（服务端给），供完成回执；不传时退回 demands 里的 done 行。 */
  myRecentCompleted?: CollectionDemand[];
  onPublishDemand?: (
    eggGameId: number,
    natures: string[],
    criteria: Pick<CollectionDemand, 'gender' | 'body' | 'voice' | 'requireGreenNest'>,
  ) => Promise<unknown>;
  onWithdrawDemand?: (
    eggGameId: number,
    criteria: Pick<CollectionDemand, 'nature' | 'gender' | 'body' | 'voice'>,
  ) => Promise<unknown>;
  onClaimDemand?: (demand: CollectionDemand) => Promise<unknown>;
  onReleaseDemand?: (demand: CollectionDemand) => Promise<unknown>;
  onCompleteDemand?: (demand: CollectionDemand) => Promise<unknown>;
  /**
   * 内嵌到「我的收集 / 组内广场」时锁定视图，并隐藏自己的视图切换。
   * 不传时保持原来的三视图行为（旧调用方 / 测试）。
   */
  viewLock?: 'missing' | 'mine';
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
  completedCounts: serverCompletedCounts,
  myRecentCompleted = [],
  onPublishDemand,
  onWithdrawDemand,
  onClaimDemand,
  onReleaseDemand,
  onCompleteDemand,
  viewLock,
}: MotherGroupResourcesProps) {
  // 临时查看状态按「身份 + 小组」隔离：换身份立即清空，切组不串条件（2026-10-24）
  const list = useGroupList(viewerAccountId, group.group.id);
  const setList = (patch: Partial<GroupListState>) =>
    setGroupList(viewerAccountId, group.group.id, patch);
  const { view, query, memberFilter, missingMembers, seekingMembers, onlyOwned, ignoreNatures } = list;
  const { targetNature, targetBody, targetVoice, targetKind, onlyGroupLine } = list;
  /** 勾了「不挑性格」就完全不管性格：缺口判定 / 发布都按 nature = '' 算。 */
  const natureFilter = ignoreNatures ? '' : targetNature;
  // 旧值兼容：`help`（旧的「我能补谁」）与 `all`（旧「小组资源」）都落到「需求中心」
  const effectiveView: ViewId = viewLock ?? (view === 'help' || view === 'all'
    ? 'mine'
    : view === 'mine' || view === 'seeking'
      ? view
      : 'missing');
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
  /**
   * 满体重 / 零体重单的接单二次确认（2026-11-01）：这类单要交付最大 / 最小蛋重的蛋，
   * 普通大块头 / 小不点父母也能接，先提醒一句再提交。值为 demandKey。
   */
  const [confirmClaim, setConfirmClaim] = useState<string | null>(null);
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

  // 体型 / 声音必须选一个（2026-10-30 用户口径）：老的本地筛选缓存里如果是「不限」，补回默认档位
  useEffect(() => {
    if (!targetBody) setList({ targetBody: '大块头' });
    if (!targetVoice) setList({ targetVoice: '+100' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetBody, targetVoice]);

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
   * 成员产线索引（2026-10-31）：`eggGameId → 档位 → 性格`。
   * 原来「200 颗蛋 × 成员 × 性格」每格都线性扫一遍该成员的全部产线（重账号上万条），
   * 切组和轮询都会被拖成秒级卡顿；压成索引后每次判定只是几次 Map / Set 命中。
   */
  const lineIndexByMember = useMemo(() => {
    const map = new Map<string, ProductionLinesIndex>();
    for (const [memberId, lines] of linesByMember) {
      if (lines != null) map.set(memberId, buildLinesIndex(lines));
    }
    return map;
  }, [linesByMember]);

  /**
   * 每颗蛋「我自己设定的收集性格」（2026-10-28 用户口径）：
   * 个人推荐性格优先，其次组目标；两边都没开 = 不按性格收（返回空数组）。
   */
  const configuredNaturesOf = (eggGameId: number): string[] => {
    if (natureOverrides !== undefined) return eggNatures(species, eggGameId, natureOverrides);
    if (target?.kind !== 'mother' || target.requireRecommendedNatures !== true) return [];
    return eggNatures(species, eggGameId, target.natureOverrides);
  };

  /**
   * 不挑性格的单：接单人默认按「推荐性格」给配对排序（2026-11-03 用户口径）。
   * 优先用自己 / 组里设定的收集性格，没设定就退回图鉴的推荐性格。
   */
  const pairPreferredNaturesOf = (eggGameId: number): string[] => {
    const configured = configuredNaturesOf(eggGameId);
    return configured.length > 0 ? configured : defaultEggNatures(species, eggGameId);
  };

  /** 产线判定的图鉴索引：只随 species 重建一次（2026-10-29 代码审查 B1-M02）。 */
  const productionIndex = useMemo(() => buildProductionIndex(species), [species]);

  /** 成员的产线能否满足目标（索引版）；旧摘要没有产线时返回 null，由调用方决定退化口径。 */
  const memberSupplies = (memberId: string, target: ProductionTarget): boolean | null => {
    if (linesByMember.get(memberId) == null) return null;
    return linesIndexSuppliesTarget(lineIndexByMember.get(memberId), target, productionIndex);
  };

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
    /** 这颗蛋要看的性格：勾了不挑就完全不管；否则手选的优先，再退回个人收集口径。 */
    const naturesOfRow = (configured: readonly string[]): string[] => {
      if (ignoreNatures) return [''];
      if (targetNature) return [targetNature];
      return configured.length > 0 ? [...configured] : [''];
    };
    const supplyOf = (memberId: string, eggGameId: number): boolean => {
      if (memberId === viewerAccountId && snapshots.length > 0) {
        return hasStockForDemand(
          snapshots,
          { eggGameId, nature: natureFilter, gender: '母', body: targetBody, voice: targetVoice },
          species,
        );
      }
      const lines = linesByMember.get(memberId);
      if (lines != null) {
        return (
          memberSupplies(memberId, {
            kind: 'mother',
            eggGameId,
            nature: natureFilter,
            body: targetBody,
            voice: targetVoice,
          }) === true
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
          natures.filter(
            (nature) =>
              memberSupplies(memberId, {
                kind: 'mother',
                eggGameId,
                nature,
                body: targetBody,
                voice: targetVoice,
              }) === true,
          ),
        );
      }
      // 旧摘要没有产线：分不清性格，按「有这只蛋」视为都能补
      return eggIdsOf.get(memberId)?.has(eggGameId) ? new Set(natures) : new Set();
    };

    return rows.map((row) => {
      const configuredNatures = configuredNaturesOf(row.eggGameId);
      const natures = naturesOfRow(configuredNatures);
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
        // viewer 已在循环外算过，直接复用（2026-10-29 代码审查 B5-M01）
        const supplied =
          member.accountId === viewerAccountId
            ? viewerSupplied
            : suppliedNaturesOf(member.accountId, row.eggGameId, natures);
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
        configuredNatures,
        canSupplyMissing:
          missingNatures.length > 0 &&
          [...suppliersByNature.values()].some((ids) => ids.length > 0),
      };
    });
  }, [
    rows,
    group.members,
    linesByMember,
    lineIndexByMember,
    viewerAccountId,
    snapshots,
    species,
    targetNature,
    ignoreNatures,
    natureFilter,
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
          nature: natureFilter,
          gender: '母' as const,
          body: targetBody,
          voice: targetVoice,
        },
        species,
      );
      if (supply.kind === 'breedable') result.add(row.eggGameId);
    }
    return result;
  }, [rows, snapshots, species, natureFilter, targetBody, targetVoice]);
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

  /** 种公页要按推荐逐条判定：先把产线压成索引，避免每条推荐都线性扫上万条（2026-10-31）。 */
  const viewerLineIndex = useMemo(() => buildLinesIndex(viewerLines), [viewerLines]);
  const groupLineIndex = useMemo(() => buildLinesIndex(groupLineInfo.lines), [groupLineInfo]);

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
  const seekingScope = useMemo(
    () =>
      seekingMembers.length > 0
        ? seekingMembers
        : group.members.map((member) => member.accountId),
    [seekingMembers, group.members],
  );
  /**
   * 共同寻找按「蛋」判定，不按「目标性格 + 体型 + 声音」判定（2026-11-01 用户口径）：
   * 组内任一成员的发布资源里含这颗蛋，就不再算共同缺口——与认领任务自动结束的口径一致。
   * `targetRows` 只用来带出性格等展示信息，是否算缺看 `rows` 的蛋级覆盖。
   */
  const coverageByEgg = useMemo(
    () => new Map(rows.map((row) => [row.eggGameId, row])),
    [rows],
  );
  // 共同寻找的筛选也要 memo：它原来在 render 体内每次重算 200 行（2026-10-31）
  const seekingRows = useMemo(
    () =>
      targetRows.filter((row) => {
        const coverage = coverageByEgg.get(row.eggGameId);
        if (!coverage) return false;
        return seekingScope.every(
          (id) =>
            coverage.missingMemberIds.includes(id) ||
            coverage.unknownMemberIds.includes(id),
        );
      }),
    [targetRows, coverageByEgg, seekingScope],
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
   * 组内有人发布过 → 可发；数据不全 → 黄边提示后仍可发；全员可比、数据新鲜且确实没人能补 → 红边沉底。
   *
   * 红边只看「有没有未发布 / 未更新 / 不可比的成员」，与当前目标筛选无关
   * （2026-10-29 代码审查 B5-H01：之前额外要求默认目标，选了性格 / 小不点后红边区会整段消失；
   *  之前也没把「超 7 天未更新」算进数据不全，旧数据成员可能被当成「确认没有」）。
   *
   * 每档内部再按「目标性格有没有收到一部分」沉底（2026-10-29 用户口径）：
   * 先看一个性格都还没收到的蛋，收了一半的往后沉；不跨分区。
   */
  const partiallyCollected = (row: TargetRow): boolean =>
    !ignoreNatures &&
    row.configuredNatures.length > 0 &&
    row.missingNatures.length < row.configuredNatures.length;
  const sinkPartiallyCollected = (list: TargetRow[]): TargetRow[] =>
    [...list].sort((a, b) => Number(partiallyCollected(a)) - Number(partiallyCollected(b)));

  const publishableRows = sinkPartiallyCollected(filtered.filter((row) => row.canSupplyMissing));
  const dataIncompleteRows = sinkPartiallyCollected(
    filtered.filter(
      (row) =>
        !row.canSupplyMissing &&
        (row.unknownMemberIds.length > 0 || groupFresh.stale > 0),
    ),
  );
  const blockedRows = sinkPartiallyCollected(
    filtered.filter(
      (row) =>
        !row.canSupplyMissing &&
        row.unknownMemberIds.length === 0 &&
        groupFresh.stale === 0,
    ),
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

  /**
   * 共同寻找卡片的状态文字（2026-11-01 用户口径）：卡上只显示状态，
   * 认领 / 释放 / 转交统一进二级页操作。
   */
  const seekingTaskLabelOf = (row: MotherCoverageRow): string => {
    if (tasksError) return '任务读取失败';
    if (!tasksConfirmed) return tasksLoading ? '核对发布状态…' : '待确认';
    const owner = taskOf(row)?.ownerAccountId;
    if (!owner) return '待认领';
    return owner === viewerAccountId ? '我认领了' : `认领：${nameOf(owner)}`;
  };
  const seekingTaskToneOf = (row: MotherCoverageRow): string => {
    if (tasksError) return 'text-rose-600';
    if (!tasksConfirmed) return tasksLoading ? 'text-slate-500' : 'text-amber-700';
    const owner = taskOf(row)?.ownerAccountId;
    if (!owner) return 'text-slate-500';
    return owner === viewerAccountId ? 'text-emerald-700' : 'text-slate-500';
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
  const myPublishedLineIndex = useMemo(
    () => (myPublishedLines == null ? null : buildLinesIndex(myPublishedLines)),
    [myPublishedLines],
  );

  /**
   * 「我能不能接」按需求缓存一次：发需求 / 接单后整页重渲染时，
   * 不再把同一批需求重新做一遍全量配对搜索（2026-10-31）。
   */
  const viewerSupplyCache = useMemo(
    () => new Map<string, boolean>(),
    [demands, snapshots, species, myPublishedLineIndex, productionIndex, rowByEgg],
  );

  /**
   * 本机是否能同账号孵出一对（母本 + 同档位公）。
   * 没导入本机数据时改用**自己已发布的产线**判断（2026-10-28 用户反馈：
   * 手机上没导入数据就接不了种公单）；旧摘要连产线都没有时，才退回「我有这颗蛋」。
   */
  const viewerCanSupply = (demand: CollectionDemand): boolean => {
    const key = `${demand.demanderAccountId}:${demandKeyOf(demand)}`;
    const cached = viewerSupplyCache.get(key);
    if (cached !== undefined) return cached;
    const value = computeViewerCanSupply(demand);
    viewerSupplyCache.set(key, value);
    return value;
  };

  const computeViewerCanSupply = (demand: CollectionDemand): boolean => {
    if (snapshots.length > 0) {
      return isStudDemandKey(demand.eggGameId)
        ? findStudBreedableSupply(snapshots, demand, species).kind !== 'none'
        : findBreedableSupply(snapshots, demand, species).kind !== 'none';
    }
    if (myPublishedLines != null) {
      if (isStudDemandKey(demand.eggGameId)) {
        return linesIndexSuppliesTarget(
          myPublishedLineIndex ?? undefined,
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
      return linesIndexSuppliesTarget(
        myPublishedLineIndex ?? undefined,
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

  /**
   * 这条需求「谁能接」（2026-10-30 用户口径）：
   * 按组内每个成员**已发布**的产线判断，排除需求方自己。
   * 用于「发布了没人接的」点开详情时告诉发布者该找谁。
   */
  const suppliersOfDemand = (demand: CollectionDemand): string[] => {
    const out: string[] = [];
    const stud = isStudDemandKey(demand.eggGameId);
    for (const member of group.members) {
      if (member.accountId === demand.demanderAccountId) continue;
      const target: ProductionTarget = stud
        ? {
            kind: 'stud',
            groupId: -demand.eggGameId,
            nature: demand.nature,
            body: demand.body,
            voice: demand.voice,
          }
        : {
            kind: 'mother',
            eggGameId: demand.eggGameId,
            nature: demand.nature,
            body: demand.body,
            voice: demand.voice,
          };
      const ok =
        !stud &&
        demand.gender === '公' &&
        productionIndex.maleCapableByGameId.get(demand.eggGameId) !== true
          ? false
          : memberSupplies(member.accountId, target) === true;
      if (ok) out.push(member.accountId);
    }
    return out;
  };

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
  const completedCounts = useMemo(() => {
    if (serverCompletedCounts && Object.keys(serverCompletedCounts).length > 0) {
      return new Map(Object.entries(serverCompletedCounts));
    }
    return completedDemandCounts(demands);
  }, [serverCompletedCounts, demands]);

  /**
   * 需求方结单后给承接人的回执（2026-10-30）：
   * 需求方点「完成」时不会推送，承接人下次打开小组页时在需求中心顶部提示，
   * 点「知道了」后写本机已读，之后只提示新的完成。
   */
  const [completionRead, setCompletionRead] = useState(() => readCompletionRead(viewerAccountId));
  useEffect(() => {
    setCompletionRead(readCompletionRead(viewerAccountId));
  }, [viewerAccountId, group.group.id]);
  /**
   * 已完成的来源（2026-11-01）：服务端「我承接的最近完成」优先，旧接口才从列表里的 done 行兜底。
   * 需求列表已经不再下发已完成行，仍从 `demands` 里找会让回执里的「孵出哪只」和结单数都变成空 / 0。
   */
  const completedSource =
    myRecentCompleted.length > 0
      ? myRecentCompleted
      : demands.filter((demand) => demand.status === 'done');

  const completionThanks = (() => {
    if (!viewerAccountId) return null;
    const unread = completedSource.filter(
      (demand) =>
        demand.status === 'done' &&
        demand.claimerAccountId === viewerAccountId &&
        !completionRead[completionReadKey(group.group.id, demand)],
    );
    if (unread.length === 0) return null;
    return {
      count: unread.length,
      names: [...new Set(unread.map((demand) => nameOf(demand.demanderAccountId)))],
      keys: unread.map((demand) => completionReadKey(group.group.id, demand)),
    };
  })();

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

    const mineOpen: CollectionDemand[] = [];
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
      // 自己发的单先单独成组（2026-10-30 用户口径），否则会被算进「发布了没人接的」
      if (demand.demanderAccountId === viewerAccountId) {
        mineOpen.push(demand);
      } else if (viewerCanSupply(demand)) {
        canClaim.push(demand);
      } else if (myDataStale) {
        // 我的数据旧 / 还没发布：不硬拦，放进「数据未更新，可能能接」让用户确认
        maybeClaim.push(demand);
      } else {
        unclaimed.push(demand);
      }
    }

    mineOpen.sort(byUpdated);
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
      mineOpen,
      mineClaimed,
      canClaim,
      maybeClaim,
      others,
      unclaimed,
      total:
        mineOpen.length +
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
          linesIndexSuppliesTarget(viewerLineIndex, target, productionIndex),
        );
        const groups = targets.map((target) => ({
          groupId: target.groupId,
          supplied: linesIndexSuppliesTarget(groupLineIndex, target, productionIndex),
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
    viewerLineIndex,
    groupLineIndex,
    groupLineInfo,
    species,
    targetMode,
  ]);

  /** 需求键：需求方 + 蛋 + 性格 + 性别 / 体型 / 声音；同蛋同性格的母/公是两条。 */
  const demandKey = (demand: CollectionDemand): string =>
    `${demand.demanderAccountId}:${demandKeyOf(demand)}`;

  /** 选蛋记忆的键带小组：同内容需求发到多个组时各自记各自的蛋（2026-11-01 审查 R2-3-M01）。 */
  const pickKeyOf = (demand: CollectionDemand): string =>
    demandPickKey(group.group.id, demand);

  /** 当前打开的需求；需求被刷新/删除后自动收起，不展示过期内容。 */
  const detailDemand = detailKey
    ? demands.find((demand) => demandKey(demand) === detailKey) ?? null
    : null;

  /** 本机选的「用哪颗蛋接这单」：种公需求只记蛋组，具体蛋由本机挑（2026-10-30）。 */
  const [demandPicks, setDemandPicks] = useState<DemandPicks>(() => readDemandPicks());
  /** 母本单「换个种公」：本机选第几组配对，只影响详情展示，不落盘。 */
  const [pairPicks, setPairPicks] = useState<Record<string, number>>({});

  /**
   * 需求详情里的配对选项（2026-10-30 用户口径：**必须按概率排序**）。
   *
   * - 种公单：交给 `studPlacementOptions`，与家园「接单上窝」同一套分配，只留最高概率档；
   * - 母本单：蛋是固定的，只算这颗蛋在我账号里的几组配对（最多 3 组），推荐用第一组。
   */
  /** 我承接的其它未完成需求：算「用这颗」候选时一起排，窝位 / 学院占用按真实情况来。 */
  const placementNeighbours = useMemo(
    () =>
      demands
        .filter((demand) => demand.status === 'claimed' && demand.claimerAccountId === viewerAccountId)
        .map((demand) => ({ ...demand, claimedAt: demand.updatedAt })),
    [demands, viewerAccountId],
  );

  const detailPairOptions = useMemo(() => {
    if (!detailDemand) {
      return { stud: [] as StudPlacementOption[], mother: [] as DemandPairOption[] };
    }
    if (isStudDemandKey(detailDemand.eggGameId)) {
      // 与家园「接单上窝」共用同一套分配（R2-8-N01）：候选就是真的能排上的组合
      const self = { ...detailDemand, claimedAt: detailDemand.updatedAt };
      const key = demandKey(detailDemand);
      const alongside = placementNeighbours.filter((demand) => demandKey(demand) !== key);
      return {
        stud: studPlacementOptions(snapshots, self, species, alongside),
        mother: [] as DemandPairOption[],
      };
    }
    return {
      stud: [] as StudPlacementOption[],
      mother: pairOptionsForEgg(
        snapshots,
        detailDemand,
        species,
        3,
        detailDemand.requireGreenNest === true,
        pairPreferredNaturesOf(detailDemand.eggGameId),
      ),
    };
  }, [detailDemand, snapshots, species, placementNeighbours, natureOverrides, target]);

  /**
   * 种公需求的候选蛋（2026-10-30 用户口径）：按组内已发布产线实时算，
   * 双蛋组优先。卡片用第一颗当代表头像，其余用角标标数量。
   */
  const studCandidatesByDemand = useMemo(() => {
    const map = new Map<string, StudDemandCandidate[]>();
    // 「数据不可比（口径 / 图鉴版本不匹配）」的成员按未知处理：不参与「谁能补我」的角标与代表蛋排序，
    // 与同页 `targetRows` / `memberSupplies` 的口径一致（2026-11-01 代码审查 R2-1-M05）。
    const members = group.members
      .filter((member) => isMotherResourceComparable(member.resource, catalogVersion, criteriaId))
      .map((member) => ({
        accountId: member.accountId,
        linesIndex: lineIndexByMember.get(member.accountId) ?? null,
        eggGameIds: new Set(
          (member.resource?.accounts ?? []).flatMap((account) => account.eggGameIds),
        ),
      }));
    for (const demand of demands) {
      if (!isStudDemandKey(demand.eggGameId)) continue;
      map.set(
        demandKey(demand),
        findStudDemandCandidates(
          {
            groupId: eggGroupIdOfDemand(demand.eggGameId),
            nature: demand.nature,
            body: demand.body,
            voice: demand.voice,
          },
          species,
          productionIndex,
          members,
        ),
      );
    }
    return map;
    // demandKey 是纯函数，依赖 demands 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demands, group.members, lineIndexByMember, productionIndex, species]);

  const candidatesOf = (demand: CollectionDemand): StudDemandCandidate[] =>
    isStudDemandKey(demand.eggGameId)
      ? studCandidatesByDemand.get(demandKey(demand)) ?? []
      : [];

  /** 卡片代表：我选过的那颗优先，否则双蛋组优先的第一颗。 */
  const representativeOf = (demand: CollectionDemand): StudDemandCandidate | null => {
    const list = candidatesOf(demand);
    if (list.length === 0) return null;
    const picked = pickEggIdOf(demandPicks[pickKeyOf(demand)]);
    return list.find((item) => item.eggGameId === picked) ?? list[0];
  };

  /** 结单回执里的说法：性格 + 性别 + · 精灵名字（形态），如「胆小♀·双灯鱼（海神球）」。 */
  const demandDeliveredLabel = (demand: CollectionDemand): string => {
    const gender = demand.gender === '公' ? '♂' : demand.gender === '母' ? '♀' : '';
    const eggName = isStudDemandKey(demand.eggGameId)
      ? representativeOf(demand)?.name ?? (eggGroupNames[-demand.eggGameId] ?? `蛋组${-demand.eggGameId}`)
      : (() => {
          const { base, form } = splitDisplayName(
            rowByEgg.get(demand.eggGameId)?.name ?? `蛋 ${demand.eggGameId}`,
          );
          return form ? `${base}（${form}）` : base;
        })();
    return `${demand.nature || '不挑'}${gender}·${eggName}`;
  };

  /** 我在这个组里已结的单数，以及按结单数排的组内名次（2026-10-30 用户口径）。 */
  const myCompletionStats = (() => {
    // 用与成员区同一份「已结单」聚合：需求列表里已经不再有 done 行，直接数列表会永远是 0
    const mine = viewerAccountId ? completedCounts.get(viewerAccountId) ?? 0 : 0;
    if (mine === 0) return { mine, rank: 0 };
    const rank = [...completedCounts.values()].filter((value) => value > mine).length + 1;
    return { mine, rank };
  })();

  /** 待感谢的已完成单各是什么精灵（最多列 3 条，多了用「等 N 单」）。 */
  const completionSamples = (() => {
    if (!completionThanks || !viewerAccountId) return [];
    return completedSource
      .filter(
        (demand) =>
          demand.status === 'done' &&
          demand.claimerAccountId === viewerAccountId &&
          !completionRead[completionReadKey(group.group.id, demand)],
      )
      .slice(0, 3)
      .map((demand) => demandDeliveredLabel(demand));
  })();


  /** 我选的组合（蛋 + 那一对亲本）；种公单里同蛋不同公要分开记。 */
  const pickDemandOption = (demand: CollectionDemand, option: StudPlacementOption) => {
    const next = {
      ...demandPicks,
      [pickKeyOf(demand)]: {
        eggGameId: option.eggGameId,
        motherCaptureId: option.motherPet.pet.captureId,
        fatherCaptureId: option.malePet.pet.captureId,
      },
    };
    setDemandPicks(next);
    writeDemandPicks(next);
  };

  /** 母本单选中的「母本 × 种公」也落本机记忆，家园按同一对排（2026-11-02）。 */
  const pickDemandPair = (demand: CollectionDemand, option: DemandPairOption) => {
    const next = {
      ...demandPicks,
      [pickKeyOf(demand)]: {
        eggGameId: demand.eggGameId,
        motherCaptureId: option.motherPet.pet.captureId,
        fatherCaptureId: option.malePet.pet.captureId,
      },
    };
    setDemandPicks(next);
    writeDemandPicks(next);
  };

  /** 我选中的那对（先按亲本精确匹配，再退回按蛋匹配）。 */
  const activeStudOption = (
    demand: CollectionDemand,
    list: readonly StudPlacementOption[],
  ): StudPlacementOption | null => {
    const picked = demandPicks[pickKeyOf(demand)];
    if (typeof picked === 'object' && picked) {
      const exact = list.find(
        (item) =>
          item.eggGameId === picked.eggGameId &&
          (!picked.motherCaptureId ||
            item.motherPet.pet.captureId === picked.motherCaptureId) &&
          (!picked.fatherCaptureId ||
            item.malePet.pet.captureId === picked.fatherCaptureId),
      );
      if (exact) return exact;
    }
    const eggGameId = pickEggIdOf(picked);
    return list.find((item) => item.eggGameId === eggGameId) ?? list[0] ?? null;
  };

  /** 母本单选中的那一对在候选里的位置：先按 demandPicks 精确匹配，匹配不到返回 null。 */
  const pickedPairIndex = (
    demand: CollectionDemand,
    list: readonly DemandPairOption[],
  ): number | null => {
    const picked = demandPicks[pickKeyOf(demand)];
    if (typeof picked !== 'object' || !picked) return null;
    const index = list.findIndex(
      (item) =>
        (!picked.motherCaptureId || item.motherPet.pet.captureId === picked.motherCaptureId) &&
        (!picked.fatherCaptureId || item.malePet.pet.captureId === picked.fatherCaptureId),
    );
    return index >= 0 ? index : null;
  };

  /** 候选蛋的可配蛋组名（去掉「组」字）：双蛋组写成「动物 × 拟人」（2026-10-30 用户口径）。 */
  const eggGroupLabelsOf = (eggGameId: number): string[] =>
    (speciesByGameId.get(eggGameId)?.eggGroups ?? [])
      .filter(isBreedableGroup)
      .map((groupId) => (eggGroupNames[groupId] ?? '').replace(/组$/, ''))
      .filter((label) => label.length > 0);

  /**
   * 需求详情里的配对建议（2026-10-28 用户要求「告诉我怎么配对」）：
   * 用本机背包找同账号能配的一对（母本 + 种公），找不到时说明还缺什么。
   */
  const demandPairing = (demand: CollectionDemand): ReactNode => {
    /**
     * 满体重 / 零体重单的交付要求（2026-11-01 用户口径）：直接写出要交付的蛋重，
     * 承接人不用再去查图鉴；绿窝只用标签表示，不写整句解释。
     */
    const deliveryLine = (eggName: string, requireGreenNest: boolean): ReactNode => {
      const target = requiredEggWeight(demand.body, eggName);
      if (!target) return null;
      return (
        <p
          className="flex flex-wrap items-center gap-1 px-1 text-[10px] leading-snug text-amber-700"
          data-testid="mother-demand-pair-delivery"
        >
          <span>
            需要交付{target.kind === 'max' ? '最大' : '最小'}蛋重 {target.weight} 的
          </span>
          {requireGreenNest ? (
            <span
              className="inline-flex items-center gap-[2px] rounded bg-lime-50 px-1 text-[9px] leading-[1.15] text-lime-700"
              title="要求这对亲本进学院小窝（性格 100%）"
            >
              <img src={GREEN_NEST_ICON} alt="" className="h-3 w-auto" />
              绿窝
            </span>
          ) : null}
          <span>【{eggName}】的蛋</span>
        </p>
      );
    };

    if (snapshots.length === 0) {
      /** 满体重 / 零体重单的交付要求与配对无关，没导入数据时也要写出来。 */
      const baseName = isStudDemandKey(demand.eggGameId)
        ? ''
        : splitDisplayName(rowByEgg.get(demand.eggGameId)?.name ?? `蛋 ${demand.eggGameId}`).base;
      return (
        <div className="space-y-1">
          {baseName ? deliveryLine(baseName, demand.requireGreenNest === true) : null}
          <p className="px-1 text-[11px] leading-snug text-slate-500">
            本机还没导入数据；导入后这里会直接给出用哪两只配窝。
          </p>
        </div>
      );
    }
    /** 亲本条件（体型 / 声音要双方都满足；性格只要一方带）。
     *  满体重 / 零体重按大块头 / 小不点匹配（2026-11-01 用户口径），文案也按这个写。 */
    const parentBodyLabel =
      demand.body === '满体重' ? '大块头' : demand.body === '零体重' ? '小不点' : demand.body;
    const gradeText = [
      parentBodyLabel ? `体型 ${parentBodyLabel}` : '',
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
      chance?: string,
      delivery?: ReactNode,
      /** 绿窝单：这一只要放进学院小窝（性格 100% 遗传），卡上打绿窝角标。 */
      greenNestPet?: OwnedPet | null,
    ): ReactNode => {
      const visible = items.filter(
        (item): item is { label: string; pet: OwnedPet } => item.pet != null,
      );
      if (visible.length < 2) return null;
      const motherPet = visible.find((item) => item.label === '母本')?.pet ?? visible[0].pet;
      const fatherPet = visible.find((item) => item.label === '种公')?.pet ?? visible[1].pet;
      const card = (pet: OwnedPet, roleLabel: string) => {
        const inGreenNest = greenNestPet != null && greenNestPet === pet;
        return (
          // 角标要露出卡片外，所以外面套一层 relative（与家园「接单上窝」一致）
          <div className="relative shrink-0" data-testid="mother-demand-pair-card-wrap">
            {inGreenNest ? (
              <span
                className="absolute -top-2 left-1 z-20 inline-flex items-center gap-[2px] rounded-full bg-emerald-600 px-1 text-[9px] font-bold leading-[1.3] text-white"
                data-testid="mother-demand-pair-green-nest"
                title="这只放进学院小窝（性格 100% 遗传）"
              >
                <img src={GREEN_NEST_ICON} alt="" className="h-[11px] w-auto" />
                绿窝
              </span>
            ) : null}
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
          </div>
        );
      };
      return (
        <div className="space-y-1" data-testid="mother-demand-pairing-text">
          {/* 满体重 / 零体重单写清要交付的蛋重；绿窝用标签表示，不再写整句说明（2026-11-01） */}
          {delivery}
          {chance ? (
            <p
              className="px-1 text-[10px] font-medium leading-snug text-emerald-700"
              data-testid="mother-demand-pair-chance"
            >
              {chance}
            </p>
          ) : null}
          {/* 卡片固定 160 宽，不跟着弹层缩；窄屏改为横向滚动，避免元素错位。
              pt-2 给绿窝角标留出露出空间（overflow-x-auto 会裁掉卡片外的绝对定位元素）。 */}
          <div className="overflow-x-auto pt-2">
            <div className="mx-auto flex w-max gap-2">
              {card(motherPet, '母本')}
              {card(fatherPet, '种公')}
            </div>
          </div>
        </div>
      );
    };

    /** 这对亲本大概能孵出多少符合要求的蛋：性格概率 × 性别概率（与家园同一口径）。 */
    const chanceText = (option: DemandPairOption, gender: string): string => {
      const factor = gender ? 0.5 : 1;
      const { natureChance } = option;
      // 绿窝单：性格由学院那只 100% 遗传（绿窝本身由卡片标签表示，这里只写概率口径）
      const natureLabel = option.greenNest
        ? '性格 100%'
        : (NATURE_CHANCE_LABELS[natureChance] ?? `性格 ${Math.round(natureChance * 100)}%`);
      const parts = gender ? [natureLabel, '性别 50%'] : [natureLabel];
      return `约 ${Math.round(natureChance * factor * 100)}% 概率满足这单（${parts.join(' × ')}）`;
    };


    /** 绿窝单里「谁进学院小窝」：自带目标性格的那只（母本优先）。 */
    const greenNestResidentOf = (option: DemandPairOption): OwnedPet | null =>
      option.greenNest
        ? option.motherPet.pet.nature === demand.nature
          ? option.motherPet.pet
          : option.malePet.pet
        : null;

    if (isStudDemandKey(demand.eggGameId)) {
      const groupName = eggGroupNames[-demand.eggGameId] ?? `蛋组${-demand.eggGameId}`;
      const active = activeStudOption(demand, detailPairOptions.stud);
      if (!active) {
        return (
          <p className="px-1 text-[11px] leading-snug text-slate-500" data-testid="mother-demand-pairing-text">
            本机暂时凑不出「{groupName}」的配对：需要同账号的母本 + 同蛋组公本
            {parentRule ? `（${parentRule}）` : ''}。
          </p>
        );
      }
      return pairs(
        [
          { label: '母本', pet: active.motherPet.pet },
          { label: '种公', pet: active.malePet.pet },
        ],
        chanceText(active, demand.gender),
        deliveryLine(active.name, demand.requireGreenNest === true),
        greenNestResidentOf(active),
      );
    }

    const list = detailPairOptions.mother;
    const savedIndex = pickedPairIndex(demand, list);
    const index =
      savedIndex ?? Math.min(pairPicks[demandKey(demand)] ?? 0, Math.max(0, list.length - 1));
    const active = list[index] ?? null;
    const eggName = splitDisplayName(
      rowByEgg.get(demand.eggGameId)?.name ?? `蛋 ${demand.eggGameId}`,
    ).base;
    if (!active) {
      return (
        <p className="px-1 text-[11px] leading-snug text-slate-500" data-testid="mother-demand-pairing-text">
          本机暂时凑不出能产「{eggName}」的一对：需要同账号的「{eggName}」母本 + 同蛋组公本
          {parentRule ? `（${parentRule}）` : ''}。
        </p>
      );
    }
    return pairs(
      [
        { label: '母本', pet: active.motherPet.pet },
        { label: '种公', pet: active.malePet.pet },
      ],
      chanceText(active, demand.gender),
      deliveryLine(eggName, demand.requireGreenNest === true),
      greenNestResidentOf(active),
    );
  };

  /** 概率配色跟家园一致：50% 绿 / 30% 黄 / 更低红。 */
  const chanceToneOf = (chance: number): string =>
    chance >= 0.5 ? 'text-emerald-700' : chance >= 0.3 ? 'text-amber-600' : 'text-rose-600';

  /**
   * 推荐配对下面的备选（2026-10-30 用户口径，2026-11-01 调整为「组合」口径）。
   *
   * - 种公单：列出**所有同概率档的「母本 × 种公」组合**（同一颗蛋配不同公也算不同组合），
   *   点「用这对」同时换卡片头像与推荐配对；
   * - 母本单：蛋是固定的，列出几组「母本 × 种公」；按母本限流保证每个可用母本至少出现一次，
   *   只有一组时也渲染，方便「选具体那一对」。
   */
  const demandAlternatives = (demand: CollectionDemand): ReactNode => {
    if (isStudDemandKey(demand.eggGameId)) {
      const list = detailPairOptions.stud;
      if (list.length < 2) return null;
      const active = activeStudOption(demand, list);
      /** 同一对亲本算一条（同蛋不同公是两条）。 */
      const keyOf = (item: StudPlacementOption): string =>
        `${item.motherPet.pet.captureId ?? item.motherPet.pet.gameId}|${
          item.malePet.pet.captureId ?? item.malePet.pet.gameId
        }`;
      const activeKey = active ? keyOf(active) : null;
      return (
        <div className="rounded-lg bg-slate-50 px-1 py-1.5" data-testid="mother-demand-stud-candidates">
          <h3 className="px-1 text-[11px] font-semibold text-slate-600">
            可用的母本 × 种公 · {list.length}
          </h3>
          <ul className="mt-1 space-y-1">
            {list.map((item, index) => {
              const on = keyOf(item) === activeKey;
              return (
                <li
                  key={keyOf(item)}
                  className="flex items-center gap-2 px-1"
                  data-testid={`stud-candidate-${item.eggGameId}-${index}`}
                >
                  <PetAvatar gameId={item.eggGameId} name={item.name} size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-[11px] font-medium text-slate-700">
                      <span className="truncate">
                        {item.motherPet.pet.name} × {item.malePet.pet.name}
                      </span>
                      <span
                        className="shrink-0 rounded bg-emerald-50 px-1 text-[9px] leading-tight text-emerald-700"
                        data-testid="stud-candidate-groups"
                      >
                        {eggGroupLabelsOf(item.eggGameId).slice(0, 2).join(' × ')}
                      </span>
                    </p>
                    <p
                      className={`truncate text-[10px] ${chanceToneOf(item.chance)}`}
                      data-testid="stud-candidate-chance"
                    >
                      {item.name} · 约 {Math.round(item.chance * 100)}%（
                      {NATURE_CHANCE_LABELS[item.natureChance] ?? '性格'} × 性别 50%）
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => pickDemandOption(demand, item)}
                    data-testid={`stud-candidate-pick-${item.eggGameId}-${index}`}
                    className={`min-h-[28px] shrink-0 rounded-md px-2 text-[11px] ${
                      on ? 'bg-emerald-600 text-white' : 'border border-emerald-500 text-emerald-700'
                    }`}
                  >
                    {on ? '已选' : '用这对'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    const list = detailPairOptions.mother;
    // 只有一组也要渲染：不挑性格时「选具体哪一对」就是点这里（2026-11-02）
    if (list.length < 1) return null;
    const savedIndex = pickedPairIndex(demand, list);
    const index = savedIndex ?? Math.min(pairPicks[demandKey(demand)] ?? 0, list.length - 1);
    const chanceOfPair = (natureChance: number) =>
      Math.round(natureChance * (demand.gender ? 0.5 : 1) * 100);
    const pairRowKey = (item: (typeof list)[number], position: number): string =>
      `${item.motherPet.pet.captureId ?? item.motherPet.pet.gameId}|${
        item.malePet.pet.captureId ?? item.malePet.pet.gameId
      }|${position}`;
    return (
      <div className="rounded-lg bg-slate-50 px-1 py-1.5" data-testid="mother-demand-pair-alternatives">
        <h3 className="px-1 text-[11px] font-semibold text-slate-600">换个配对</h3>
        <ul className="mt-1 space-y-1">
          {list.map((item, position) => {
            const on = position === index;
            const motherName = speciesDisplayName(
              speciesByGameId.get(item.motherPet.pet.gameId),
              item.motherPet.pet.name,
            );
            const maleName = speciesDisplayName(
              speciesByGameId.get(item.malePet.pet.gameId),
              item.malePet.pet.name,
            );
            return (
              <li
                key={pairRowKey(item, position)}
                className="flex items-center gap-2 px-1"
                data-testid={`mother-pair-option-${position}`}
              >
                <PetAvatar gameId={item.motherPet.pet.gameId} name={motherName} size={24} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-slate-700">
                    {motherName}
                    <span className="ml-0.5 text-[9px] text-slate-400">
                      {item.motherPet.pet.nature}
                    </span>
                    <span className="mx-1 text-slate-400">×</span>
                    {maleName}
                    <span className="ml-0.5 text-[9px] text-slate-400">
                      {item.malePet.pet.nature}
                    </span>
                  </p>
                  <p
                    className={`truncate text-[10px] ${chanceToneOf(chanceOfPair(item.natureChance) / 100)}`}
                  >
                    约 {chanceOfPair(item.natureChance)}%（
                    {NATURE_CHANCE_LABELS[item.natureChance] ?? '性格'} × 性别 50%）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    pickDemandPair(demand, item);
                    setPairPicks((current) => ({ ...current, [demandKey(demand)]: position }));
                  }}
                  data-testid={`mother-pair-pick-${position}`}
                  className={`min-h-[28px] shrink-0 rounded-md px-2 text-[11px] ${
                    on ? 'bg-emerald-600 text-white' : 'border border-emerald-500 text-emerald-700'
                  }`}
                >
                  {on ? '已选' : '用这对'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
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
    /**
     * 勾了「不挑性格」（2026-11-02 用户口径）：只要组内有我缺的母本的产线就能提需求，
     * 发布出去的就是一条「不挑性格」的需求；已经发过同样条件的不重复发。
     */
    if (ignoreNatures) {
      if (existing.has(`:母:${targetBody}:${targetVoice}`)) return null;
      return { eggGameId, name: base, natures: [] };
    }
    const rowMissing = targetRow?.missingNatures;
    // 目标性格已经收齐（或手选的那一个已经收到）→ 没有可发的了
    if (rowMissing && rowMissing.length === 0) return null;
    const missingNamed = (rowMissing ?? []).filter(Boolean);
    const preferred = targetRow?.configuredNatures ?? configuredNaturesOf(eggGameId);
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

  /** 二级页面里的「发需求」：面板常驻，这里只负责发布（2026-10-30 用户口径）。 */
  const publishResourceDemand = async (
    eggGameId: number,
    natures: string[],
    criteria: DemandCriteriaDraft,
  ) => {
    const ok = await confirmPublish([{ eggGameId, natures }], criteria);
    if (!ok) return;
    setPublishWarning('');
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
        if (!row) continue;
        // 只拦「当前筛选范围内」已有人持有：范围外有人有不再阻止认领，
        // 否则会出现「列表里看得到、点了却认不上」（2026-11-01 拍板 R2-3-U02）
        if (row.holders.some((holder) => seekingScope.includes(holder.accountId))) continue;
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
  ): Promise<boolean> => {
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
        return false;
      }
      const total = items.reduce((count, item) => count + Math.max(1, item.natures.length), 0);
      setDemandMessage(`已发布 ${total} 条需求`);
      setPublishItems(null);
      setPublishWarning('');
      setSelecting(false);
      setSelected([]);
      return true;
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

  /** 满体重 / 零体重单：接单前要提醒「交付的蛋必须满分」。 */
  const isEggWeightDemand = (demand: CollectionDemand): boolean =>
    demand.body === '满体重' || demand.body === '零体重';

  /** 接单入口：满体重 / 零体重单先换成确认块，其他单直接提交。 */
  const startClaim = (demand: CollectionDemand) => {
    if (isEggWeightDemand(demand)) {
      setConfirmClaim(demandKey(demand));
      return;
    }
    void runDemandAction('claim', demand);
  };

  /** 满体重 / 零体重单的接单确认（2026-11-01 用户口径）。 */
  const claimConfirmBlock = (demand: CollectionDemand): ReactNode => (
    <div className="flex w-full flex-col gap-1.5" data-testid="mother-demand-claim-confirm">
      <span className="text-[11px] leading-snug text-amber-700">
        本单需要交付{demand.body === '满体重' ? '最大' : '最小'}蛋重的蛋才能完成需求，是否接单？
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={demandBusy}
          onClick={() => setConfirmClaim(null)}
          data-testid="mother-demand-claim-confirm-cancel"
          className="min-h-[40px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          disabled={demandBusy}
          onClick={() => {
            setConfirmClaim(null);
            void runDemandAction('claim', demand);
          }}
          data-testid="mother-demand-claim-confirm-yes"
          className="min-h-[40px] flex-1 rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
        >
          确认接单
        </button>
      </div>
    </div>
  );

  /** 需求详情里的完成按钮：没检测到匹配个体时先换成「是否确认已完成」的二次确认 */
  const detailCompleteControl = (demand: CollectionDemand): ReactNode => {
    const key = demandKey(demand);
    if (confirmComplete === key) {
      return (
        <div className="flex w-full flex-col gap-1.5" data-testid="mother-demand-complete-confirm">
          <span className="text-[11px] leading-snug text-amber-700">背包里未检测到，确认已完成？</span>
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
              className="min-h-[40px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        disabled={demandBusy}
        onClick={() => void runDemandAction('complete', demand)}
        data-testid="mother-demand-complete"
        className="min-h-[40px] flex-1 rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
      >
        已完成 · 结单
      </button>
    );
  };

  /**
   * 需求详情底部的二级动作区（2026-11-01 用户口径）：
   * 卡片外面只展示状态，接单 / 放弃 / 撤回 / 完成都在这里点，避免滑动页面误触。
   */
  const demandDetailActions = (demand: CollectionDemand): ReactNode => {
    if (demand.status === 'done') return null;
    const key = demandKey(demand);
    if (demand.status === 'claimed') {
      if (demand.demanderAccountId === viewerAccountId) {
        // 已接单的单也要能撤回；提示放在同一操作区，不另开浮层（2026-11-01 审查 R2-3-H01）
        const confirming = confirmWithdraw === key;
        return (
          <div className="flex flex-col gap-1.5">
            {confirming ? (
              <span
                className="text-[11px] leading-snug text-rose-600"
                data-testid="mother-demand-withdraw-hint"
              >
                已有人接单，撤回会取消对方承接
              </span>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {detailCompleteControl(demand)}
              {confirming ? (
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
                    className="min-h-[40px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500 disabled:opacity-50"
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
                  撤回这条需求
                </button>
              )}
            </div>
          </div>
        );
      }
      if (demand.claimerAccountId === viewerAccountId) {
        return (
          <button
            type="button"
            disabled={demandBusy}
            onClick={() => void runDemandAction('release', demand)}
            data-testid="mother-demand-release"
            className="min-h-[40px] w-full rounded-lg border border-slate-200 text-sm text-slate-600 disabled:opacity-50"
          >
            放弃这单
          </button>
        );
      }
      return null;
    }
    if (demand.demanderAccountId === viewerAccountId) {
      if (confirmWithdraw === key) {
        return (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
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
                className="min-h-[40px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        );
      }
      return (
        <button
          type="button"
          disabled={demandBusy}
          onClick={() => setConfirmWithdraw(key)}
          data-testid="mother-demand-withdraw"
          className="min-h-[40px] w-full rounded-lg border border-slate-200 text-sm text-slate-500 disabled:opacity-50"
        >
          撤回这条需求
        </button>
      );
    }
    if (viewerCanSupply(demand)) {
      if (isEggWeightDemand(demand) && confirmClaim === key) {
        return claimConfirmBlock(demand);
      }
      return (
        <button
          type="button"
          disabled={demandBusy}
          onClick={() => startClaim(demand)}
          data-testid="mother-demand-claim"
          className="min-h-[40px] w-full rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
        >
          接单
        </button>
      );
    }
    if (myDataStale) {
      if (isEggWeightDemand(demand) && confirmClaim === key) {
        return claimConfirmBlock(demand);
      }
      return (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] leading-snug text-amber-700">
            你的数据超过 7 天或还没导入，系统无法确认；仍可先接单，对方会看到你的数据时间。
          </p>
          <button
            type="button"
            disabled={demandBusy}
            onClick={() => startClaim(demand)}
            data-testid="mother-demand-claim-stale"
            className="min-h-[40px] w-full rounded-lg border border-amber-500 text-sm font-medium text-amber-700 disabled:opacity-50"
          >
            仍要接单
          </button>
        </div>
      );
    }
    return null;
  };

  // 切视图 / 切组时退出选择态，避免把上一页的选中带过去
  useEffect(() => {
    setSelecting(false);
    setSelected([]);
    setDemandError('');
    setDemandMessage('');
    setTaskError('');
    setPublishItems(null);
    setPublishError('');
    setConfirmWithdraw(null);
    setConfirmStud(null);
    setConfirmComplete(null);
    setConfirmClaim(null);
    setResourceDetailEggId(null);
  }, [effectiveView, targetKind, group.group.id]);

  /** 需求卡：四段共用，只有动作不同；已完成的单不进列表。卡片只留 头像 + 名称 + 性格 + 动作。 */
  const renderDemandCard = (demand: CollectionDemand, actions: ReactNode): ReactNode => {
    const isStud = isStudDemandKey(demand.eggGameId);
    // 种公需求用组内产线里的一枚代表蛋当头像与标题（2026-10-30 用户口径；不再加数字角标）
    const representative = isStud ? representativeOf(demand) : null;
    const displayName = isStud
      ? representative?.name ?? (eggGroupNames[-demand.eggGameId] ?? `蛋组${-demand.eggGameId}`)
      : rowByEgg.get(demand.eggGameId)?.name ?? `蛋 ${demand.eggGameId}`;
    const base = isStud ? displayName : splitDisplayName(displayName).base;
    /**
     * 2026-11-01 用户定稿：卡片就是 79×104 真实尺寸（4 列），内部 1:1 绝对定位，
     * 不再有任何缩放/百分比换算（换算是前几轮错位的原因）。
     */
    const pos = DEMAND_CARD_POS;
    const bodyIcon = bodyMedalIconByLabel(demand.body);
    const voiceIcon = voiceMedalIconByLabel(demand.voice);
    return (
      <li
        key={demandKey(demand)}
        className="relative min-w-0 cursor-pointer overflow-hidden rounded-md bg-slate-50"
        style={{ height: DEMAND_CARD_H }}
        data-testid="mother-demand-row"
        data-demand-status={demand.status}
        onClick={() => setDetailKey(demandKey(demand))}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: DEMAND_CARD_W,
            height: DEMAND_CARD_H,
            transform: `scale(${DEMAND_CARD_SCALE})`,
          }}
        >
          <button
            type="button"
            aria-label={`查看${base}需求详情`}
            title="点击头像查看需求详情与配对"
            data-testid="mother-demand-open"
            onClick={(event) => {
              event.stopPropagation();
              setDetailKey(demandKey(demand));
            }}
            className="absolute origin-top-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            style={{
              left: pos.avatar.left,
              top: pos.avatar.top,
              transform: `scale(${pos.avatar.scale})`,
            }}
          >
            {isStud ? (
              representative ? (
                <span className="block" data-testid="mother-demand-stud-avatar">
                  <PetAvatar
                    gameId={representative.eggGameId}
                    name={representative.name}
                    size={DEMAND_CARD_AVATAR_SIZE}
                  />
                </span>
              ) : (
                <span className="block h-9 w-9" aria-hidden />
              )
            ) : (
              <PetAvatar
                gameId={demand.eggGameId}
                name={base}
                size={DEMAND_CARD_AVATAR_SIZE}
              />
            )}
          </button>

          {/* 性格全部展示（2026-11-01 用户口径）：满宽居中，1~3 个一行，4~6 个自动换行 */}
          <div
            className="absolute flex flex-wrap justify-center gap-[2px]"
            data-testid="mother-demand-natures"
            style={{ left: 0, top: pos.nature.top, width: DEMAND_CARD_W }}
          >
            <span className="inline-flex items-center whitespace-nowrap rounded bg-emerald-50 px-1 text-[9px] leading-[1.2] text-emerald-700">
              {demand.nature || '不挑'}
            </span>
            {demand.requireGreenNest ? (
              <span
                className="inline-flex items-center gap-[1px] whitespace-nowrap rounded bg-lime-50 px-1 text-[9px] leading-[1.2] text-lime-700"
                title="要求这对亲本进学院小窝（性格 100%）"
              >
                <img src={GREEN_NEST_ICON} alt="" className="h-[11px] w-auto" />
                绿窝
              </span>
            ) : null}
          </div>

          {/* 目标口径的两枚奖牌（体型 / 声音），和母本详情同一套图标（2026-10-30） */}
          {bodyIcon ? (
            <img
              src={bodyIcon}
              alt={demand.body}
              title={demand.body}
              className="absolute h-3 w-3 origin-top-left"
              style={{
                left: pos.body.left,
                top: pos.body.top,
                transform: `scale(${pos.body.scale})`,
              }}
              data-testid="mother-demand-body"
            />
          ) : null}
          {voiceIcon ? (
            <img
              src={voiceIcon}
              alt={voiceMedalLabel(demand.voice)}
              title={voiceMedalLabel(demand.voice)}
              className="absolute h-3 w-3 origin-top-left"
              style={{
                left: pos.voice.left,
                top: pos.voice.top,
                transform: `scale(${pos.voice.scale})`,
              }}
              data-testid="mother-demand-voice"
            />
          ) : null}

          {/* 性别 + 名字 + 形态后缀一行（2026-11-01 用户口径：两者强关联） */}
          <div
            className="absolute flex items-center justify-center"
            style={{ left: 0, top: pos.nameRow.top, width: DEMAND_CARD_W }}
          >
            <span className="flex min-w-0 items-center gap-[2px] px-1">
              <GenderMark
                gender={demand.gender === '公' || demand.gender === '母' ? demand.gender : '未知'}
              />
              <span className="min-w-0 truncate text-[10px] font-medium leading-none text-slate-700">
                <NameWithForm name={displayName} />
              </span>
            </span>
          </div>

          {/* 动作区按设计稿只占一行小字：把里面的按钮统一压成 9px 文本片，
              否则 min-h / 边框会把整块撑高，看起来就像「整张卡错位」；
              点动作按钮只做动作，不触发整卡打开的详情（2026-10-30） */}
          <div
            className="absolute flex items-center justify-center gap-1 whitespace-nowrap border-t border-slate-200 bg-transparent text-[9px] leading-[1.2] [&>button]:min-h-0 [&>button]:rounded-[3px] [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button]:text-[9px] [&>button]:leading-[1.2] [&>span]:text-[9px]"
            style={{ left: 0, top: pos.action.top, width: DEMAND_CARD_W, height: pos.action.height }}
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        </div>
      </li>
    );
  };

  const renderDemandGrid = (
    list: CollectionDemand[],
    actions: (demand: CollectionDemand) => ReactNode,
  ) => (
    <ul
      className="grid justify-center gap-x-[2px] gap-y-2"
      style={{ gridTemplateColumns: `repeat(${RESOURCE_GRID_COLUMNS}, minmax(0, ${DEMAND_CARD_W}px))` }}
    >
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

  const detailActions = detailDemand ? demandDetailActions(detailDemand) : null;

  return (
    <section
      className={
        viewLock ? 'space-y-1.5' : 'space-y-1.5 rounded-2xl bg-white p-2.5 shadow-sm'
      }
      data-testid="mother-resources"
      data-tour="group-demands"
    >
      {viewLock ? null : (
        <SegmentedControl
          label="小组资源视图"
          value={effectiveView}
          options={VIEWS.map((item) => ({ value: item.id, label: item.label }))}
          onValueChange={(next) => setList({ view: next as ViewId })}
          optionTestId={(value) => `mother-view-${value}`}
        />
      )}

      {viewLock ? null : (
        <p className="text-[10px] text-slate-400" data-testid="mother-data-freshness">
          数据完整度 {groupFresh.fresh}/{groupFresh.total}
          {groupFresh.stale > 0 ? ` · ${groupFresh.stale} 人超过 7 天未更新` : ''}
          {snapshots.length === 0 ? ' · 本机还没导入数据' : ''}
        </p>
      )}

      {completionThanks ? (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5"
          data-testid="demand-completion-thanks"
        >
          <p className="text-xs leading-relaxed text-emerald-800">
            <span className="font-semibold">有任务完成啦！</span>
            {completionThanks.names.join('、')} 成功孵出 {completionSamples.join('、')}
            {completionThanks.count > completionSamples.length
              ? ` 等 ${completionThanks.count} 单`
              : ''}
            ，可以重新接需求调窝了，目前结单 {myCompletionStats.mine} 条
            {myCompletionStats.rank > 0 ? `，组内排行第 ${myCompletionStats.rank} 名` : ''}
            ，继续加油喵！
          </p>
          <button
            type="button"
            onClick={() => {
              if (!viewerAccountId) return;
              setCompletionRead(markCompletionRead(viewerAccountId, completionThanks.keys));
            }}
            className="mt-1 min-h-[26px] rounded-lg border border-emerald-300 bg-white px-2 text-[11px] text-emerald-800"
            data-testid="demand-completion-thanks-ack"
          >
            知道了
          </button>
        </div>
      ) : null}

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
                label="推荐性格"
                value={natureFilter}
                emptyLabel="推荐性格"
                disabled={ignoreNatures}
                onValueChange={(value) => setList({ targetNature: value })}
                testId="mother-target-nature"
                menuTestId="mother-target-nature-options"
                optionTestId={(value) => `mother-target-nature-option-${value || 'any'}`}
                className="min-w-0 flex-1 [&>button]:w-full [&>button]:justify-between [&>button]:px-1.5 [&>button]:text-[11px]"
              />
              <InlineSelect
                label="体型"
                value={targetBody}
                options={PUBLISH_BODIES.map((value) => ({
                  value,
                  label: BODY_LABELS[value],
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
                options={PUBLISH_VOICES.map((value) => ({
                  value,
                  label: VOICE_LABELS[value],
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

      {/* 搜索 + 成员筛选 + 动作按钮同一行（2026-10-30 用户口径：筛选不要单独占一行） */}
      <div className="flex items-center gap-1.5">
        <SearchField
          className="min-w-0 flex-1 [&_input]:min-w-0"
          label={targetKind === 'stud' ? '搜索种公推荐' : '搜索小组资源'}
          value={query}
          onValueChange={(value) => setList({ query: value })}
          placeholder={
            targetKind === 'stud' ? '搜性格 / 蛋组 / 建议物种' : '搜母本 / 同血脉名称 / 图鉴号'
          }
          testId="mother-search"
        />
        <div className="flex shrink-0 items-center gap-1.5">
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
                checked={ignoreNatures}
                onChange={(event) => setList({ ignoreNatures: event.target.checked })}
                data-testid="mother-ignore-natures"
              />
              不挑性格
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
              {/* 内嵌到收集计划页时只保留「我接的 / 我能接的」：三个低频分组删掉（2026-11-08） */}
              {viewLock
                ? null
                : demandCenter.mineOpen.length > 0
                  ? demandSection(
                      'mine-open',
                      '我发布的',
                      demandCenter.mineOpen.length,
                      renderDemandGrid(demandCenter.mineOpen, () => (
                        <span className="text-slate-400">待承接</span>
                      )),
                    )
                  : null}
              {demandCenter.mineClaimed.length > 0
                ? demandSection(
                    'mine-claimed',
                    '我接的',
                    demandCenter.mineClaimed.length,
                    renderDemandGrid(demandCenter.mineClaimed, () => (
                      <span className="text-emerald-700">我接了</span>
                    )),
                  )
                : null}
              {demandCenter.canClaim.length > 0
                ? demandSection(
                    'can-claim',
                    '我能接的',
                    demandCenter.canClaim.length,
                    renderDemandGrid(demandCenter.canClaim, () => (
                      <span className="text-slate-400">待承接</span>
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
                      {renderDemandGrid(demandCenter.maybeClaim, () => (
                        <span className="text-slate-400">待承接</span>
                      ))}
                    </>,
                  )
                : null}
              {!viewLock && demandCenter.others.length > 0
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
                          {renderDemandGrid(groupItem.demands, () => (
                            <span className="text-slate-400">已接</span>
                          ))}
                        </div>
                      ))}
                    </div>,
                  )
                : null}
              {!viewLock && demandCenter.unclaimed.length > 0
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
                                // 与母本共用一套口径：结单后可以再发同款，只有「还没结束」才算已发到
                                // （2026-11-01 拍板 R2-3-U01；对象区别只是蛋组 / 单颗蛋）
                                demand.status !== 'done' &&
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
        <ul
          className="grid justify-center gap-x-[2px] gap-y-2"
          style={{ gridTemplateColumns: `repeat(${RESOURCE_GRID_COLUMNS}, minmax(0, ${DEMAND_CARD_W}px))` }}
        >
          {pageRows.map((row, index) => {
            // 瀑布流按整个列表的绝对位置判断分区标题。
            const absoluteIndex = index;
            // 勾了「不挑性格」就不再展示性格标签（缺口与发布都不看性格）
            const natures = ignoreNatures ? [] : row.configuredNatures;
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
            /**
             * 状态条上边线与卡片外框同色（2026-11-01 用户口径）：
             * 卡片按状态换边框色，状态条若固定用 slate，看起来像两块拼在一起。
             */
            const statusBorder = isSelected
              ? 'border-emerald-500'
              : selfBreedable
                ? 'border-sky-300'
                : blocked
                  ? 'border-rose-300'
                  : incomplete
                    ? 'border-amber-300'
                    : 'border-slate-200';
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
              onClick={() => {
                // 2026-10-30 用户口径：整卡任意位置都能点开详情，不用非点头像或「发需求」
                if (blocked) return;
                if (selecting) {
                  toggleSelect(selectionKey);
                  return;
                }
                // 我缺的 / 共同寻找都进二级页操作（2026-11-01：共同寻找的认领也收进详情）
                if (effectiveView === 'missing' || effectiveView === 'seeking') {
                  setResourceDetailEggId(row.eggGameId);
                }
              }}
              aria-disabled={blocked ? true : undefined}
              style={
                effectiveView === 'missing' || effectiveView === 'seeking'
                  ? { height: DEMAND_CARD_H }
                  : { minHeight: DEMAND_CARD_H }
              }
              className={`relative flex min-w-0 cursor-pointer flex-col items-center overflow-hidden rounded-md ${
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
                  {/* 2026-11-01 用户定稿：和需求卡同一套 79×104 坐标——
                      头像、两枚奖牌、性别 + 名字（含形态后缀）、性格全部展示、底部满宽状态条 */}
                  <div
                    className="relative overflow-hidden"
                    style={{ height: DEMAND_CARD_H, width: DEMAND_CARD_W }}
                  >
                    <div
                      className="relative origin-top-left"
                      style={{
                        height: DEMAND_CARD_H,
                        width: DEMAND_CARD_W,
                        transform: `scale(${DEMAND_CARD_SCALE})`,
                      }}
                    >
                  <div
                    className="pointer-events-none absolute inset-0"
                    data-testid="mother-resource-medals"
                  >
                    {bodyMedalIconByLabel(targetBody) ? (
                      <img
                        src={bodyMedalIconByLabel(targetBody)!}
                        alt={targetBody}
                        title={targetBody}
                        className="absolute h-3 w-3 origin-top-left"
                        style={{
                          left: DEMAND_CARD_POS.body.left,
                          top: DEMAND_CARD_POS.body.top,
                          transform: `scale(${DEMAND_CARD_POS.body.scale})`,
                        }}
                      />
                    ) : null}
                    {voiceMedalIconByLabel(targetVoice) ? (
                      <img
                        src={voiceMedalIconByLabel(targetVoice)!}
                        alt={voiceMedalLabel(targetVoice)}
                        title={voiceMedalLabel(targetVoice)}
                        className="absolute h-3 w-3 origin-top-left"
                        style={{
                          left: DEMAND_CARD_POS.voice.left,
                          top: DEMAND_CARD_POS.voice.top,
                          transform: `scale(${DEMAND_CARD_POS.voice.scale})`,
                        }}
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
                      className="absolute origin-top-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      style={{
                        left: DEMAND_CARD_POS.avatar.left,
                        top: DEMAND_CARD_POS.avatar.top,
                        transform: `scale(${DEMAND_CARD_POS.avatar.scale})`,
                      }}
                    >
                      <PetAvatar gameId={row.eggGameId} name={base} size={DEMAND_CARD_AVATAR_SIZE} />
                    </button>
                  ) : (
                    <span
                      className="absolute block origin-top-left"
                      style={{
                        left: DEMAND_CARD_POS.avatar.left,
                        top: DEMAND_CARD_POS.avatar.top,
                      }}
                    >
                      <PetAvatar gameId={row.eggGameId} name={base} size={DEMAND_CARD_AVATAR_SIZE} />
                    </span>
                  )}
                  {/* 性别 + 名字 + 形态后缀一行（2026-11-01 用户口径：两者强关联） */}
                  <div
                    className="absolute flex items-center justify-center"
                    style={{ left: 0, top: DEMAND_CARD_POS.nameRow.top, width: DEMAND_CARD_W }}
                    data-testid="mother-resource-name"
                  >
                    <span className="flex min-w-0 items-center gap-[2px] px-1">
                      <GenderMark gender="母" />
                      <span className="min-w-0 truncate text-[10px] font-medium leading-none text-slate-700">
                        <NameWithForm name={row.name} />
                      </span>
                    </span>
                  </div>
                  {natures.length > 0 ? (
                    <div
                      className="absolute flex flex-wrap justify-center gap-[2px]"
                      data-testid="mother-resource-natures"
                      style={{ left: 0, top: DEMAND_CARD_POS.nature.top, width: DEMAND_CARD_W }}
                    >
                      {natures.map((nature) => (
                        <span
                          key={nature}
                          className={`inline-flex items-center whitespace-nowrap rounded px-1 text-[9px] leading-[1.2] ${
                            effectiveView === 'missing' && missingSet.has(nature)
                              ? 'bg-rose-50 text-rose-600'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {nature}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {effectiveView === 'missing' ? (
                    <div
                      className={`absolute flex items-center justify-center gap-1 whitespace-nowrap border-t ${statusBorder} bg-transparent text-[9px] leading-[1.2] [&>button]:min-h-0 [&>button]:rounded-[3px] [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button]:text-[9px] [&>button]:leading-[1.2]`}
                      style={{
                        left: 0,
                        top: DEMAND_CARD_POS.action.top,
                        width: DEMAND_CARD_W,
                        height: DEMAND_CARD_POS.action.height,
                      }}
                    >
                      {myDemands.length > 0 ? (
                        <span
                          className="text-emerald-700"
                          data-testid="mother-demanded"
                        >
                          已发 {myDemands.length} 条
                        </span>
                      ) : (
                        <button
                          type="button"
                          data-testid="mother-resource-publish"
                          onClick={(event) => {
                            event.stopPropagation();
                            setResourceDetailEggId(row.eggGameId);
                          }}
                          className="text-emerald-700"
                        >
                          发需求
                        </button>
                      )}
                    </div>
                  ) : null}
                  {/* 共同寻找：卡片底部也只用状态栏显示状态，认领 / 释放 / 转交都进二级页（2026-11-01） */}
                  {effectiveView === 'seeking' ? (
                    <div
                      className={`absolute flex items-center justify-center gap-1 overflow-hidden border-t ${statusBorder} bg-transparent px-1 text-[9px] leading-[1.2]`}
                      style={{
                        left: 0,
                        top: DEMAND_CARD_POS.action.top,
                        width: DEMAND_CARD_W,
                        height: DEMAND_CARD_POS.action.height,
                      }}
                      data-testid="mother-task"
                      title={seekingTaskLabelOf(row)}
                    >
                      <span className={`truncate ${seekingTaskToneOf(row)}`}>
                        {seekingTaskLabelOf(row)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

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
        onClose={() => {
          setResourceDetailEggId(null);
          setPublishError('');
          setPublishWarning('');
        }}
        testId="mother-resource-detail"
        closeTestId="mother-resource-detail-close"
        backdropTestId="mother-resource-detail-backdrop"
      >
        {resourceDetailRow ? (() => {
          const eggGameId = resourceDetailRow.eggGameId;
          const { base } = splitDisplayName(resourceDetailRow.name);
          const natures = ignoreNatures ? [] : resourceDetailRow.configuredNatures;
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
          /** 面板常驻后不能再靠按钮写状态：没有可发性格时用一句提示说明原因。 */
          const publishBlockedReason = publishItem
            ? ''
            : blocked
              ? '组内暂时没人能补，发需求也大概率没人能接'
              : resourceDetailRow.missingNatures.length === 0
                ? '按你的收集口径已收齐'
                : '这些性格都已经发过需求；想改条件先撤回原需求';
          return (
            <div className="space-y-1 p-3" data-testid="mother-resource-detail-body">
              {/* 头部（2026-10-30 v2 用户调好的布局）：头像 / 名字 + 形态 / 第二行性格 + 两枚奖牌 /
                  右侧小方框「谁能补我」（信息简写，详细名单在需求面板里） */}
              <div className="flex items-start gap-2">
                <PetAvatar gameId={eggGameId} name={base} size={72} />
                <div className="min-w-0 flex-1 pt-[13px]">
                  <p className="truncate text-base font-semibold leading-tight text-slate-800">
                    <NameWithForm name={resourceDetailRow.name} />
                  </p>
                  <div
                    className="mt-[9px] flex min-w-0 items-center gap-1"
                    data-testid="mother-resource-detail-target"
                  >
                    {natures.length > 0 ? (
                      <span
                        className="flex min-w-0 flex-wrap items-center gap-0.5"
                        data-testid="mother-resource-detail-natures"
                      >
                        {natures.map((nature) => (
                          <span
                            key={nature}
                            className={`rounded px-1.5 py-0.5 text-[11px] leading-[1.35] ${
                              missingSet.has(nature)
                                ? 'bg-rose-50 text-rose-600'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                            title={missingSet.has(nature) ? '这个性格的母本还没收集到' : undefined}
                          >
                            {nature}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {/* 目标口径只用两枚奖牌（体型 / 声音），不写字标签（2026-10-30 用户口径） */}
                    {bodyMedalIconByLabel(targetBody) ? (
                      <img
                        src={bodyMedalIconByLabel(targetBody)!}
                        alt={targetBody}
                        title={targetBody}
                        className="h-[18px] w-[18px] shrink-0"
                      />
                    ) : null}
                    {voiceMedalIconByLabel(targetVoice) ? (
                      <img
                        src={voiceMedalIconByLabel(targetVoice)!}
                        alt={voiceMedalLabel(targetVoice)}
                        title={voiceMedalLabel(targetVoice)}
                        className="h-[18px] w-[18px] shrink-0"
                      />
                    ) : null}
                  </div>
                </div>

                <div
                  className="mt-[13px] w-[104px] shrink-0 rounded-lg bg-slate-50 px-1.5 py-1"
                  data-testid="mother-resource-detail-suppliers"
                >
                  <p className="text-[9px] font-semibold leading-tight text-slate-500">谁能补我</p>
                  {missingNatures.length > 0 ? (
                    <p
                      className="mt-0.5 truncate text-[9px] leading-tight text-rose-600"
                      title={`还缺：${missingNatures.join('、')}`}
                      data-testid="mother-resource-detail-missing-natures"
                    >
                      还缺：{missingNatures.join('、')}
                    </p>
                  ) : natures.length > 0 ? (
                    <p className="mt-0.5 text-[9px] leading-tight text-emerald-700">按口径已收齐</p>
                  ) : null}
                  {supplierLines.length > 0 ? (
                    supplierLines.map((line) => (
                      <p
                        key={line}
                        className="truncate text-[9px] leading-tight text-slate-700"
                        title={line}
                      >
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="truncate text-[9px] leading-tight text-slate-400">
                      {resourceDetailRow.unknownMemberIds.length > 0
                        ? '已发布的成员都补不了'
                        : '组内暂时没人能补'}
                    </p>
                  )}
                  {resourceDetailRow.unknownMemberIds.length > 0 ? (
                    <p className="truncate text-[9px] leading-tight text-slate-400">
                      {resourceDetailRow.unknownMemberIds.length} 人未发布 / 未更新
                    </p>
                  ) : null}
                </div>
              </div>

              {/* 「我的需求」只在我缺的里展示；共同寻找的二级页只留任务操作（2026-11-01） */}
              {effectiveView === 'missing' ? (
                <div
                  className="rounded-xl bg-slate-50 px-2.5 py-2"
                  data-testid="mother-resource-detail-demands"
                >
                <h3 className="text-[11px] font-semibold text-slate-500">
                  我的需求 · {resourceDetailDemands.length}
                </h3>
                {resourceDetailDemands.length === 0 ? (
                  <p className="mt-0.5 text-xs text-slate-400">这颗蛋还没发过需求。</p>
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
                        className="mt-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2"
                        data-testid="mother-resource-detail-demand"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <DemandCriteriaTags demand={demand} testId="mother-demand-natures" />
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
                                {/* 已被接单的单撤回会取消对方承接，必须写出来（2026-10-26a / B5-H02） */}
                                {demand.status === 'claimed' ? (
                                  <span
                                    className="w-full text-[11px] leading-snug text-rose-600"
                                    data-testid="mother-demand-withdraw-hint"
                                  >
                                    已有人接单，撤回会取消对方承接
                                  </span>
                                ) : null}
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
              ) : null}

              {/* 共同寻找：认领 / 释放 / 转交都放在二级页（2026-11-01 用户口径，卡片上只留状态） */}
              {effectiveView === 'seeking' ? (
                <div
                  className="rounded-xl bg-emerald-50/70 px-2.5 py-2"
                  data-testid="mother-resource-detail-task"
                >
                  <h3 className="text-[11px] font-semibold text-emerald-800">共同寻找 · 任务</h3>
                  <p className="mt-1 text-[11px] leading-snug text-slate-600">
                    {tasksError
                      ? `任务读取失败：${tasksError}`
                      : !tasksConfirmed
                        ? tasksLoading
                          ? '正在核对组员发布状态…'
                          : `待确认：${tasksPendingMemberIds.length} 人未发布/更新，暂不能认领`
                        : taskOf(resourceDetailRow)?.ownerAccountId
                          ? taskOf(resourceDetailRow)?.ownerAccountId === viewerAccountId
                            ? '我认领了这个任务'
                            : `负责人：${fullNameOf(taskOf(resourceDetailRow)?.ownerAccountId ?? '')}`
                          : '还没有人认领'}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {!tasksError && tasksConfirmed ? (
                      taskOf(resourceDetailRow)?.ownerAccountId ? (
                        <>
                          {taskOf(resourceDetailRow)?.ownerAccountId === viewerAccountId || isOwner ? (
                            <button
                              type="button"
                              disabled={busyKey === taskKeyOf(resourceDetailRow)}
                              onClick={() => void runTask(resourceDetailRow, 'release')}
                              data-testid="mother-task-release"
                              className="min-h-[32px] rounded-lg border border-slate-200 px-2 text-xs text-slate-500 disabled:opacity-50"
                            >
                              释放任务
                            </button>
                          ) : null}
                          {isOwner &&
                          onTransferTask &&
                          taskOf(resourceDetailRow)?.ownerAccountId !== viewerAccountId ? (
                            <InlineSelect
                              label="转交任务"
                              value=""
                              options={[
                                { value: '', label: '转交给…' },
                                ...group.members
                                  .filter(
                                    (member) =>
                                      member.accountId !== taskOf(resourceDetailRow)?.ownerAccountId,
                                  )
                                  .map((member) => ({
                                    value: member.accountId,
                                    label: labelOf(member),
                                  })),
                              ]}
                              onValueChange={(to) => void transferTo(resourceDetailRow, to)}
                              testId="mother-task-transfer"
                              menuTestId="mother-task-transfer-options"
                              className="max-w-[140px]"
                            />
                          ) : null}
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busyKey === taskKeyOf(resourceDetailRow)}
                          onClick={() => void runTask(resourceDetailRow, 'claim')}
                          data-testid="mother-task-claim"
                          className="min-h-[32px] rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {busyKey === taskKeyOf(resourceDetailRow) ? '认领中…' : '认领寻找'}
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* 发需求面板常驻展开（2026-10-30 用户口径：不再点「发需求」才展示下面的内容）。
                  共同寻找页不需要发需求，整块隐藏（2026-11-01 用户反馈：多余）。 */}
              {effectiveView === 'missing' ? (
                <ResourcePublishPanel
                  key={eggGameId}
                  eggGameId={eggGameId}
                  collected={natures.filter((nature) => !missingSet.has(nature))}
                  sent={resourceDetailDemands
                    .filter((demand) => demand.status !== 'done')
                    .map((demand) => demand.nature)}
                  defaultNatures={publishItem?.natures ?? []}
                  lockNature={ignoreNatures}
                  defaultCriteria={{ gender: '母', body: targetBody, voice: targetVoice }}
                  busy={demandBusy}
                  error={publishError}
                  warning={publishItem ? publishWarningFor([eggGameId]) : ''}
                  disabledReason={publishBlockedReason}
                  onCancel={() => {
                    setPublishError('');
                    setPublishWarning('');
                  }}
                  onConfirm={(picked, criteria) =>
                    void publishResourceDemand(eggGameId, picked, criteria)
                  }
                />
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
        footer={
          detailActions ? (
            <div className="space-y-1.5">
              {demandError ? (
                <p className="text-[11px] text-rose-600" data-testid="mother-demand-detail-error">
                  {demandError}
                </p>
              ) : null}
              {detailActions}
            </div>
          ) : null
        }
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
                  representativeOf(detailDemand) ? (
                    <PetAvatar
                      gameId={representativeOf(detailDemand)!.eggGameId}
                      name={representativeOf(detailDemand)!.name}
                      size={40}
                    />
                  ) : (
                    <span className="block h-10 w-10 shrink-0 rounded-md bg-slate-100" aria-hidden />
                  )
                ) : (
                  <PetAvatar gameId={detailDemand.eggGameId} name={base} size={40} />
                )}
                <div className="min-w-0 flex-1">
                  {/* 参照家园精灵卡：名字 + 性格 → 性别 + 奖牌 → 需求方 + 状态（2026-10-29 用户口径） */}
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 whitespace-nowrap text-sm font-medium leading-tight text-slate-800">
                      {isStud ? (
                        representativeOf(detailDemand)?.name ?? base
                      ) : (
                        <NameWithForm name={rowByEgg.get(detailDemand.eggGameId)?.name ?? base} />
                      )}
                    </span>
                    {isStud ? (
                      <span
                        className="shrink-0 text-[9px] leading-tight text-slate-400"
                        data-testid="mother-demand-detail-group"
                      >
                        {base}
                      </span>
                    ) : null}
                    {/* 不用卡片里的 NatureChips：它按整行宽度居中，会把名字挤成两行（2026-10-29） */}
                    <span
                      className="shrink-0 rounded bg-emerald-50 px-1 text-[9px] leading-[1.15] text-emerald-700"
                      data-testid="mother-demand-detail-natures"
                    >
                      {detailDemand.nature || '不挑'}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 flex items-center gap-1"
                    data-testid="mother-demand-detail-criteria"
                  >
                    <GenderMark
                      gender={
                        detailDemand.gender === '公' || detailDemand.gender === '母'
                          ? detailDemand.gender
                          : '未知'
                      }
                    />
                    {bodyMedalIconByLabel(detailDemand.body) ? (
                      <img
                        src={bodyMedalIconByLabel(detailDemand.body)!}
                        alt={detailDemand.body}
                        title={detailDemand.body}
                        className="h-4 w-4"
                      />
                    ) : null}
                    {voiceMedalIconByLabel(detailDemand.voice) ? (
                      <img
                        src={voiceMedalIconByLabel(detailDemand.voice)!}
                        alt={voiceMedalLabel(detailDemand.voice)}
                        title={voiceMedalLabel(detailDemand.voice)}
                        className="h-4 w-4"
                      />
                    ) : null}
                    {detailDemand.requireGreenNest ? (
                      <span
                        className="inline-flex items-center gap-[2px] rounded bg-lime-50 px-1 text-[10px] leading-[1.15] text-lime-700"
                        title="要求这对亲本进学院小窝（性格 100%）"
                        data-testid="mother-demand-detail-green-nest"
                      >
                        <img src={GREEN_NEST_ICON} alt="" className="h-3.5 w-auto" />
                        绿窝
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="min-w-0 truncate text-slate-700" data-testid="mother-demand-detail-demander">
                      需求方：{fullNameOf(detailDemand.demanderAccountId)}
                    </span>
                    <span className="shrink-0" data-testid="mother-demand-detail-status">
                      状态：{statusText}
                    </span>
                  </div>
                </div>
              </div>
              {/* 还没人接的单：直接列出组内「已发布产线」里能接的人（2026-10-30 用户口径） */}
              {detailDemand.status === 'open'
                ? (() => {
                    const ids = suppliersOfDemand(detailDemand);
                    return (
                      <div
                        className="rounded-lg bg-amber-50/70 px-1 py-1.5"
                        data-testid="mother-demand-detail-suppliers"
                      >
                        <h3 className="px-1 text-[11px] font-semibold text-amber-800">
                          谁能接 · {ids.length}
                        </h3>
                        <p className="px-1 text-[11px] leading-snug text-amber-900/80">
                          {ids.length > 0
                            ? ids.map((id) => fullNameOf(id)).join('、')
                            : '组内已发布的数据里暂时没人能接'}
                        </p>
                      </div>
                    );
                  })()
                : null}
              <div className="rounded-lg bg-emerald-50/70 px-0 py-1.5">
                <h3 className="px-1 text-[11px] font-semibold text-emerald-800">推荐配对</h3>
                <div className="mt-0.5" data-testid="mother-demand-detail-pairing">
                  {demandPairing(detailDemand)}
                </div>
              </div>
              {/* 推荐配对后的备选：种公单列「我自己能孵的蛋」，母本单只给几组「换个种公」（2026-10-30） */}
              {demandAlternatives(detailDemand)}
            </div>
          );
        })() : null}
      </ModalSurface>
    </section>
  );
}

/**
 * 名字 + 形态缩略（2026-10-29 用户口径）：卡片 / 详情里把形态小字跟在名字后面，
 * 例如「雪绒鸟·夏」「石冠王蜥·首领」；完整名字放 title 供悬停确认。
 */
function NameWithForm({ name }: { name: string }) {
  const { base, form } = splitDisplayName(name);
  if (!form) return <>{base}</>;
  return (
    <>
      {base}
      <i className="ml-0.5 align-baseline text-[8px] font-normal not-italic text-slate-400">
        ·{form}
      </i>
    </>
  );
}

/** 发需求面板：八大性格先出，其余收进「更多」；体型 / 声音必须选一个，不给「不限」。 */
const PUBLISH_PRIMARY_NATURES = targetNatureNames;
const PUBLISH_EXTRA_NATURES = allNatureNames.filter(
  (nature) => !PUBLISH_PRIMARY_NATURES.includes(nature),
);
const PUBLISH_BODIES = DEMAND_BODIES.filter((body) => body !== '');
const PUBLISH_VOICES = DEMAND_VOICES.filter((voice) => voice !== '');

interface ResourcePublishPanelProps {
  eggGameId: number;
  /** 已经收集到的性格（置灰）。 */
  collected: string[];
  /** 已经发过需求的性格（不可重复发）。 */
  sent: string[];
  defaultNatures: string[];
  /** 勾了「不挑性格」：性格整块锁死，发出去的需求不带性格要求。 */
  lockNature?: boolean;
  defaultCriteria: DemandCriteriaDraft;
  busy: boolean;
  error: string;
  warning: string;
  /** 没有可发性格时的原因；非空时禁止发布。 */
  disabledReason: string;
  onCancel: () => void;
  onConfirm: (natures: string[], criteria: DemandCriteriaDraft) => void;
}

/**
 * 母本详情里的就地发需求面板（2026-10-29，2026-10-30 改为常驻）。
 *
 * 之前点「发需求」会再开一层抽屉，变成三级界面；现在直接在这颗蛋的详情里展开，
 * 选完性格与口径就发布，不离开弹窗。2026-10-30 用户口径：面板不再需要点击展开，
 * 「更多」与普通性格格子同尺寸，点开再显示其余性格。
 */
function ResourcePublishPanel({
  eggGameId,
  collected,
  sent,
  defaultNatures,
  lockNature = false,
  defaultCriteria,
  busy,
  error,
  warning,
  disabledReason,
  onCancel,
  onConfirm,
}: ResourcePublishPanelProps) {
  const [picked, setPicked] = useState<string[]>(defaultNatures);
  const [more, setMore] = useState(false);
  const [gender, setGender] = useState<DemandGender>(defaultCriteria.gender);
  const [body, setBody] = useState<DemandBody>(defaultCriteria.body || PUBLISH_BODIES[0]);
  const [voice, setVoice] = useState<DemandVoice>(defaultCriteria.voice || PUBLISH_VOICES[0]);
  /** 是否要求绿窝（学院小窝，性格 100%）：默认不勾（2026-11-01 用户口径）。 */
  const [requireGreenNest, setRequireGreenNest] = useState(
    defaultCriteria.requireGreenNest ?? false,
  );

  const collectedSet = new Set(collected);
  const sentSet = new Set(sent);
  const sentKey = sent.join('|');
  // 发布成功后这条性格已发：从选中里移除，避免再次点「发布」重复发同一条
  useEffect(() => {
    setPicked((current) => current.filter((nature) => !sentSet.has(nature)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentKey]);
  const visible = more ? [...PUBLISH_PRIMARY_NATURES, ...PUBLISH_EXTRA_NATURES] : PUBLISH_PRIMARY_NATURES;

  const toggle = (nature: string) => {
    setPicked((current) =>
      current.includes(nature)
        ? current.filter((item) => item !== nature)
        : current.length >= DEMAND_NATURE_MAX
          ? current
          : [...current, nature],
    );
  };

  const optionRow = <T extends string>(
    label: string,
    values: readonly T[],
    current: T,
    labels: Record<T, string>,
    onPick: (value: T) => void,
    testPrefix: string,
  ) => (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-7 shrink-0 text-[11px] text-slate-400">{label}</span>
      {values.map((value) => (
        <button
          key={`${testPrefix}:${value || 'any'}`}
          type="button"
          aria-pressed={current === value}
          onClick={() => onPick(value)}
          data-testid={`${testPrefix}-${value || 'any'}`}
          className={`min-h-[26px] rounded-md border px-1.5 text-[11px] ${
            current === value
              ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
              : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  );

  // 勾了「不挑性格」：性格整块锁死，不参与发布（发出去的需求不带性格要求）
  const pickedNatures = lockNature ? [] : picked;
  const total = Math.max(1, pickedNatures.length);
  // 一个性格都没选也能发（= 不挑性格）；只有完全没有可发项时才禁用（2026-10-30）。
  // 绿窝必须指定性格：绿窝靠学院那只 100% 遗传，不挑性格就没有意义（2026-11-01 用户口径）。
  const greenNestNeedsNature = requireGreenNest && pickedNatures.length === 0;
  const publishable = !disabledReason && !greenNestNeedsNature;

  return (
    <div
      className="rounded-xl border border-emerald-100 bg-emerald-50 px-2.5 py-2"
      data-testid="mother-resource-publish-panel"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-600">发需求</h3>
        <span className="text-[10px] text-slate-400">
          {lockNature ? '不挑性格 = 1 条' : '1 个性格 = 1 条'}
        </span>
      </div>
      {lockNature ? (
        <p
          className="mt-1.5 rounded-lg bg-white px-2 py-1.5 text-[11px] text-slate-500"
          data-testid="mother-resource-publish-no-nature"
        >
          已勾「不挑性格」：发出去的需求不要求性格，只要组内有这颗蛋的母本产线就能接。
        </p>
      ) : (
      <div className="mt-1.5 grid grid-cols-3 gap-1" data-testid="mother-resource-publish-natures">
        {visible.map((nature) => {
          const done = collectedSet.has(nature);
          const already = sentSet.has(nature);
          const on = picked.includes(nature);
          return (
            <button
              key={nature}
              type="button"
              disabled={busy || done || already}
              aria-pressed={on}
              onClick={() => toggle(nature)}
              title={done ? '这个性格已经收到了' : already ? '这个性格已经发过需求' : undefined}
              data-testid={`demand-nature-${eggGameId}-${nature}`}
              className={`min-h-[30px] rounded-md border px-0.5 text-[11px] leading-tight ${
                done
                  ? 'border-slate-100 bg-slate-50 text-slate-300 line-through'
                  : already
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                    : on
                      ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              {nature}
              {already ? ' · 已发' : ''}
            </button>
          );
        })}
        {/* 「更多」与性格格子同尺寸（2026-10-30 用户口径），点开才显示其余性格 */}
        {PUBLISH_EXTRA_NATURES.length > 0 ? (
          <button
            type="button"
            onClick={() => setMore((value) => !value)}
            aria-expanded={more}
            data-testid="mother-resource-publish-more"
            className="min-h-[30px] rounded-md border border-dashed border-slate-300 bg-white px-0.5 text-[11px] leading-tight text-slate-500"
          >
            {more ? '收起 ▴' : `更多 +${PUBLISH_EXTRA_NATURES.length}`}
          </button>
        ) : null}
      </div>
      )}
      <div className="mt-1.5 space-y-1">
        {optionRow('性别', DEMAND_GENDERS, gender, GENDER_LABELS, setGender, 'mother-publish-gender')}
        {optionRow('体型', PUBLISH_BODIES, body, BODY_LABELS, setBody, 'mother-publish-body')}
        {optionRow('声音', PUBLISH_VOICES, voice, VOICE_LABELS, setVoice, 'mother-publish-voice')}
        <label
          className="flex min-h-[26px] items-center gap-1.5 text-[11px] text-slate-500"
          data-testid="mother-resource-green-nest"
        >
          <input
            type="checkbox"
            checked={requireGreenNest}
            onChange={(event) => setRequireGreenNest(event.target.checked)}
            className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
          />
          是否要求绿窝
          <img src={GREEN_NEST_ICON} alt="" className="h-[15px] w-auto" />
        </label>
      </div>
      {greenNestNeedsNature ? (
        <p
          className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-800"
          data-testid="mother-resource-green-nest-needs-nature"
        >
          要求绿窝需要先选一个性格：学院小窝靠那只自带目标性格 100% 遗传，不挑性格发不了绿窝。
        </p>
      ) : null}
      {warning ? (
        <p
          className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-800"
          data-testid="mother-resource-publish-warning"
        >
          {warning}
        </p>
      ) : null}
      {disabledReason ? (
        <p
          className="mt-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[10px] leading-snug text-slate-500"
          data-testid="mother-resource-publish-disabled"
        >
          {disabledReason}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1 text-[10px] text-rose-600" data-testid="mother-resource-publish-error">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPicked(defaultNatures.filter((nature) => !sentSet.has(nature) && !collectedSet.has(nature)));
            onCancel();
          }}
          data-testid="mother-resource-publish-cancel"
          className="min-h-[34px] flex-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy || !publishable}
          onClick={() => onConfirm(pickedNatures, { gender, body, voice, requireGreenNest })}
          data-testid="mother-resource-publish-confirm"
          className="min-h-[34px] flex-[2] rounded-lg bg-emerald-600 text-xs font-medium text-white disabled:bg-slate-200 disabled:text-slate-500"
        >
          {busy
            ? '发布中…'
            : pickedNatures.length > 0
              ? `发布 ${total} 条需求`
              : '发布（不挑性格）'}
        </button>
      </div>
    </div>
  );
}

/**
 * 需求四个条件的彩色标签（2026-10-30 用户口径）：性别 → 体型 → 声音 → 性格，
 * 每个维度一种颜色；没有要求的维度用灰色「不挑 / 不限」。
 */
function DemandCriteriaTags({ demand, testId }: { demand: CollectionDemand; testId?: string }) {
  // 性别沿用 GenderMark 的口径：母粉、公蓝；声音改用琥珀色，避免和「公」撞色。
  const genderTone = demand.gender === '公' ? 'bg-sky-50 text-sky-700' : 'bg-pink-50 text-pink-700';
  const rows: Array<{ key: string; text: string; tone: string; filled: boolean; icon?: string }> = [
    { key: 'gender', text: GENDER_LABELS[demand.gender], tone: genderTone, filled: Boolean(demand.gender) },
    { key: 'body', text: BODY_LABELS[demand.body], tone: 'bg-emerald-50 text-emerald-700', filled: Boolean(demand.body) },
    { key: 'voice', text: VOICE_LABELS[demand.voice], tone: 'bg-amber-50 text-amber-700', filled: Boolean(demand.voice) },
    { key: 'nature', text: demand.nature || '不挑', tone: 'bg-violet-50 text-violet-700', filled: Boolean(demand.nature) },
    ...(demand.requireGreenNest
      ? [
          {
            key: 'nest',
            text: '要求绿窝',
            tone: 'bg-lime-50 text-lime-700',
            filled: true,
            icon: GREEN_NEST_ICON,
          },
        ]
      : []),
  ];
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid={testId}>
      {rows.map((row) => (
        <span
          key={row.key}
          className={`inline-flex items-center gap-[2px] whitespace-nowrap rounded px-1 py-0.5 text-[10px] leading-[1.15] ${
            row.filled ? row.tone : 'bg-slate-100 text-slate-500'
          }`}
          data-testid={`demand-criteria-${row.key}`}
        >
          {row.icon ? <img src={row.icon} alt="" className="h-[12px] w-auto" /> : null}
          {row.text}
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
