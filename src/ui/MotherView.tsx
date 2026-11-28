import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GRADE_BODY, GRADE_VOICE, type MotherGroup, type TargetMode } from '../domain/petFilters';
import type { OwnedPet } from '../domain/types';
import { species as catalogSpecies } from '../data/catalog';
import {
  effectiveMotherVoices,
  isChainCollected as chainCollectedBy,
  isQualifiedMother as isQualifiedMotherBy,
  motherVoicesForMode,
  type MotherCriteria,
} from '../domain/motherCriteria';
import { useTabletLandscape, useWideLandscape } from './useWideLandscape';import { PetAvatar } from './PetAvatar';
import { PetCardLayout, type PetCardStatus } from './PetCardLayout';
import { shouldUseThreeColumnsEstimated } from './motherColumnLayout';
import { SearchField } from './primitives/SearchField';
import { InlineMultiSelect } from './primitives/InlineMultiSelect';
import { SegmentedControl } from './primitives/SegmentedControl';
import { setPersonalQuery, usePersonalList } from './listViewStore';
import {
  getMotherCriteria,
  setMotherCriteria,
  useMotherCriteria,
} from './motherCriteriaStore';
import {
  mergeMotherPlan,
  toggleMotherPlan,
  useMotherPlan,
} from './motherPlanStore';
import { createNaturesResolver, eggNatures } from '../domain/recommendedNatures';
import { useNatureOverrides } from './natureOverrideStore';
import { RecommendedNatureEditor } from './RecommendedNatureEditor';
import { MotherCriteriaMedals, selectedGradesFor } from './MotherCriteriaMedals';
import { findMotherGapFill, type GapFill } from '../domain/gapFill';
import type { MotherNestAccount } from '../domain/motherNest';
import { GapFillDialog, type GapTargetView } from './GapFillDialog';
import { MotherCollectingView } from './plan/MotherCollectingView';
import type { NavigationIntent } from './navigation';

/** 未收集母本的跨号/本号补法摘要（卡片角标与顶部统计共用）。 */
export interface MotherFillRoute {
  /** 真实概率：性格 × 出母 */
  chance: number;
  /** 跨号来源；本号直配为空 */
  sourceAccount?: string;
  /** 本号自己配（true）还是别的号传蛋（false） */
  self: boolean;
}

/** 点「查看」带到精灵背包的筛选：进化链名 + 标签（不再带身高范围，见 jumpBase）。 */
export interface MotherInventoryJump {
  name: string;
  tags: string[];
}

export interface MotherViewProps {
  owned: OwnedPet[];
  /** 蛋搜索索引（`egg:<蛋物种 gameId>` → 归属这颗蛋的全部形态名 + 图鉴号） */
  searchIndex: Map<string, string>;
  eggGroupNames: Record<number, string>;
  motherGroups: MotherGroup[];
  mode: TargetMode;
  /** 从收集页直达的状态（未收集 / 收集中 / 已收集）；计划分区独立展示 */
  status?: 'missing' | 'collecting' | 'collected';
  /** 点卡片底部「查看」：带到精灵背包的筛选条件 */
  onOpenInventory?: (jump: MotherInventoryJump) => void;
  /** 母本配窝建议（与看板同一份口径）：未收集卡点开悬浮窗时找「本号直配 / 跨号传蛋」 */
  motherSuggestions?: ReadonlyMap<string, MotherNestAccount>;
  /** 当前选中的号（悬浮窗按号的顺序找线） */
  accountNames?: readonly string[];
  /** 悬浮窗目标卡：目标说明与奖牌图标 */
  gapTarget?: {
    label: string;
    bodyMedal: string | null;
    /** 声音目标标签（+100 / -100 / 婉转声 / 粗嗓门）：悬浮窗按它区分满分与双牌 */
    voiceTarget?: string | null;
    voiceDb: number | null;
    weightPercent: number | null;
  };
  /** 悬浮窗里的「去求蛋」：打开小组求助 */
  onSeekHelp?: () => void;
  /** 收集中页发布/查看小组需求 */
  onNavigate?: (intent: NavigationIntent) => void;
  /** 收集页右侧筛选栏是否收起：收起后才考虑把蛋组排成三列（2026-11-21 用户口径） */
  filterCollapsed?: boolean;
}

/** 链清单的收/未收开关（2026-10-06 用户拍板：由「只看未收集」开关改成两态分段） */
const CHAIN_FILTERS = [
  { value: 'uncollected', label: '未收集' },
  { value: 'collecting', label: '收集中' },
  { value: 'collected', label: '已收集' },
] as const;
type ChainFilter = (typeof CHAIN_FILTERS)[number]['value'];
/** 没有推荐性格时的稳定空数组：避免每次查表都新建（保持引用一致） */
const EMPTY_NATURES: readonly string[] = [];
const INITIAL_CHAIN_SECTIONS = 2;
const CHAIN_SECTION_BATCH = 5;

/**
 * 渐进渲染（2026-11-25 P1，用户口径：平板横着用）。
 *
 * 横屏「首屏多给蛋组」的内容**不削减**（宽横屏仍到 10 组、4:3 横屏 6 组），但不在首帧一次挂完：
 * 首帧只挂 `FIRST_PAINT_SECTIONS` 组（和手机一个量级，点进去立刻有东西、没有长任务），
 * 其余在空闲时间一片 1～2 组补上，补的过程中用等高骨架占位，页面高度不跳。
 */
const FIRST_PAINT_SECTIONS = 2;
/** 一次空闲追加最多几张卡 / 几个组：追加本身也不能变成长任务 */
const IDLE_SLICE_MAX_CARDS = 20;
const IDLE_SLICE_MAX_SECTIONS = 2;
/**
 * 骨架高度：**和分区自己声明的占位高度一致**（`containIntrinsicSize: 'auto 180px'`）。
 *
 * 分区带 `content-visibility: auto`，没滚到视口里时浏览器按 180px 占位；
 * 骨架也取 180px，那么「骨架 → 真分区」这一步在屏外高度完全不变，滚动条不会跳。
 */
const SECTION_SKELETON_HEIGHT_PX = 180;

/**
 * 空闲调度：有 `requestIdleCallback` 就用（带 300ms 超时兜底），
 * 没有就退回 `setTimeout(0)`（jsdom、老 WebView）。返回值用于取消。
 */
function scheduleIdleTask(run: () => void): () => void {
  const scope = globalThis as unknown as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof scope.requestIdleCallback === 'function') {
    const handle = scope.requestIdleCallback(run, { timeout: 300 });
    return () => scope.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(run, 0);
  return () => window.clearTimeout(timer);
}

/**
 * 母本视角：
 *
 * - **已收集**：按满分四档各自一节（与看板的四档计数同口径），行是两列紧凑卡（PetCard）；
 * - **计划收集**：用户从「待补齐母本」里挑出来的待办（存 localStorage / 随备份走），
 *   自动判定达成（该链已有合格母本）并支持「清除已达成」；
 * - **待补齐母本**：所有还没有合格母本的链（无母本 ∪ 有母本但不够档），
 *   默认收起、可搜索、勾选即加入计划；
 * - **收集中**（2026-11-20 好友 UI）：挑中的链按收集计划卡展示求蛋进度，
 *   与小组需求联动，可直接发布 / 查看。
 */
export function MotherView({
  owned,
  searchIndex,
  eggGroupNames,
  motherGroups,
  mode,
  status,
  onOpenInventory,
  motherSuggestions,
  accountNames = [],
  gapTarget,
  onSeekHelp,
  onNavigate,
  filterCollapsed = false,
}: MotherViewProps) {
  /** 「未收集母本怎么补」悬浮窗（2026-11-19 用户口径）：与看板共用同一块内容 */
  const [gapDialog, setGapDialog] = useState<{ chainKey: string; target: GapTargetView; fill: GapFill } | null>(
    null,
  );
  const plan = useMotherPlan();
  const criteria = useMotherCriteria();
  const natureOverrides = useNatureOverrides();
  /** 推荐性格解析器：蛋覆盖 → 图鉴 PVP → 种族值兜底（与小组同一口径） */
  const naturesOf = useMemo(
    () => createNaturesResolver({ species: catalogSpecies, overrides: natureOverrides }),
    [natureOverrides],
  );
  const [natureEditorOpen, setNatureEditorOpen] = useState(false);
  // 搜索是本次会话的临时查看条件（切页保留、重启清空）
  const query = usePersonalList('mothers').query;
  const setQuery = (value: string) => setPersonalQuery('mothers', value);
  // 默认看「未收集」（待补齐才是主场景；看板「母本全收集」卡跳过来也是它）
  const [chainFilter, setChainFilter] = useState<ChainFilter>('uncollected');
  /**
   * 首屏蛋组数（2026-11-21 用户口径）：宽横屏 10 组；4:3 这类 1000px 起的横屏给 6 组，
   * 避免只渲染 2 组、半屏空白；竖屏仍是 2 组。
   */
  const wideLandscape = useWideLandscape();
  const tabletLandscape = useTabletLandscape();
  const initialSections = wideLandscape
    ? 10
    : tabletLandscape
      ? 6
      : INITIAL_CHAIN_SECTIONS;

  // 收集页的「未收集 / 收集中 / 已收集」直达：同步到本页的状态开关
  useEffect(() => {
    if (status === 'missing') setChainFilter('uncollected');
    else if (status === 'collecting') setChainFilter('collecting');
    else if (status === 'collected') setChainFilter('collected');
  }, [status]);

  /**
   * 声音选项随目标模式联动（2026-10-05 用户拍板）：
   * 追满分 → +100 / -100；追双牌 → 婉转声 / 粗嗓门。
   * 模式切换后若旧选择与此模式无交集，重置为该模式的默认全选（避免隐藏选项仍在暗中过滤）。
   */
  const modeVoices = motherVoicesForMode(mode);
  const activeVoices = effectiveMotherVoices(criteria.voices, mode);
  useEffect(() => {
    if (criteria.voices.length > 0 && !criteria.voices.some((voice) => modeVoices.includes(voice))) {
      setMotherCriteria({ ...getMotherCriteria(), voices: [...modeVoices] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /**
   * 统一的「母本达标 = 已收集」口径（2026-10-05 用户拍板）。
   *
   * 定义本身在领域层 `src/domain/motherCriteria.ts`（看板「母本全收集」卡共用同一份），
   * 这里只是把当前模式下的有效声音选择传进去。
   */
  const effectiveCriteria: MotherCriteria = {
    bodies: criteria.bodies,
    voices: activeVoices,
    grades: criteria.grades,
    targetMode: mode,
    recommendedNatures: criteria.recommendedNatures === true,
  };
  const isQualifiedMother = (pet: OwnedPet): boolean =>
    isQualifiedMotherBy(pet, effectiveCriteria, naturesOf);
  const isChainCollected = (group: MotherGroup): boolean =>
    chainCollectedBy(group, owned, effectiveCriteria, naturesOf);

  /**
   * 「查看」带到精灵背包的公共条件：按钮上显示的那一档奖牌（强制单选）。
   *
   * 体型按**奖牌 或 身高到顶 / 到底**取并集，与母本达标口径（`breedingBodyGradeOf`）一致：
   * - 有奖牌：真实数据里存在身高不是 100% / 0% 的个体（如大块头 98.48%），只按身高筛会漏；
   * - 无奖牌：身高 100% / 0% 也算大块头 / 小不点，只按奖牌标签筛会漏。
   * 两个标签同属 body 类，`filterByTags` 内取并集，所以不再额外设身高范围。
   */
  const jumpBase = useMemo(() => {
    const grade = selectedGradesFor(criteria, mode)[0] ?? '大婉';
    const body = GRADE_BODY[grade];
    const voice =
      mode === 'medal' ? GRADE_VOICE[grade] : GRADE_VOICE[grade] === '婉转声' ? '+100' : '-100';
    const heightTag = body === '大块头' ? 'body:满身高' : 'body:零身高';
    return {
      tags: ['gender:母', `body:${body}`, heightTag, `voice:${voice}`],
    };
  }, [criteria, mode]);

  const plannedSet = useMemo(() => new Set(plan), [plan]);

  const targetBody = criteria.bodies.includes('小不点') && !criteria.bodies.includes('大块头')
    ? '小不点'
    : '大块头';
  const targetVoice =
    mode === 'perfect'
      ? activeVoices.includes('-100') && !activeVoices.includes('+100')
        ? '-100'
        : '+100'
      : activeVoices.includes('粗嗓门') && !activeVoices.includes('婉转声')
        ? '粗嗓门'
        : '婉转声';

  /**
   * 每颗蛋的推荐性格：**一次建表**，行渲染 / 缺口汇总 / 悬浮窗都查这一份
   * （2026-11-25 P3：原来每渲染一次就按行现算一遍 `eggNatures`，
   * `defaultEggNatures` 内部是 665 条线性扫，165 行一帧 11～21ms；
   * 见 docs/分析-收集页卡顿-2026-11-25.md）。
   */
  const naturesByEgg = useMemo(() => {
    const map = new Map<number, readonly string[]>();
    for (const group of motherGroups) {
      map.set(group.eggGameId, eggNatures(catalogSpecies, group.eggGameId, natureOverrides));
    }
    return map;
  }, [motherGroups, natureOverrides]);
  const naturesOfEgg = (eggGameId: number): readonly string[] =>
    naturesByEgg.get(eggGameId) ?? EMPTY_NATURES;

  const missingNaturesByEgg = useMemo(() => {
    const map = new Map<number, readonly string[]>();
    for (const group of motherGroups) {
      const natures = naturesByEgg.get(group.eggGameId) ?? EMPTY_NATURES;
      map.set(
        group.eggGameId,
        natures.filter(
          (nature) =>
            !group.memberIndexes.some(
              (index) =>
                owned[index]?.nature === nature &&
                isQualifiedMother(owned[index]),
            ),
        ),
      );
    }
    return map;
  }, [motherGroups, owned, criteria, activeVoices.join(','), naturesOf, naturesByEgg]);

  /** 搜索（进化链全员命中）+ 蛋组筛选：同时作用于已收集 / 计划 / 待补齐 */
  const keyword = query.trim().toLowerCase();
  const [eggGroupFilter, setEggGroupFilter] = useState<string[]>([]);
  /** 空态判断用：有没有主动筛过（决定「清除筛选」是否可点） */
  const hasFilter = keyword.length > 0 || eggGroupFilter.length > 0;

  /** 蛋组筛选选项：按母本链实际覆盖的蛋组给（带链数） */
  const eggGroupOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const group of motherGroups) {
      for (const groupId of group.eggGroups) counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([groupId, count]) => ({
        value: String(groupId),
        label: `${eggGroupNames[groupId] ?? `蛋组${groupId}`} (${count})`,
      }));
  }, [motherGroups, eggGroupNames]);

  const matchedGroups = useMemo(
    () =>
      motherGroups.filter((group) => {
        if (keyword) {
          const text =
            searchIndex.get(group.chainKey) ??
            `${group.formLabel} ${group.number}`.toLowerCase();
          if (!text.includes(keyword)) return false;
        }
        if (eggGroupFilter.length > 0) {
          const picked = new Set(eggGroupFilter);
          if (!group.eggGroups.some((groupId) => picked.has(String(groupId)))) return false;
        }
        return true;
      }),
    [motherGroups, keyword, searchIndex, eggGroupFilter],
  );

  /** 归属这颗蛋的合格母本（可能多只，含火神这类已进化形态） */
  const mothersOf = (group: MotherGroup): OwnedPet[] =>
    group.memberIndexes.map((i) => owned[i]).filter(isQualifiedMother);

  /** 命中链总数 / 已收集数（列表顶部给一行整体进度） */
  const collectedChainCount = matchedGroups.filter(isChainCollected).length;

  /**
   * 未收集母本的可补路线（2026-11-24 用户口径，A+B）：
   *
   * - 账号筛选只决定“看哪个号”，不能决定“谁能补”；建议本身已经用全部账号算过，
   *   这里按选中的目标号汇总；
   * - 本号直配（pairings）和跨号传蛋（tasks）都算可补；同一条蛋取概率最高的一条；
   * - “其他号可补”只数跨号来源，用于顶部统计；卡片角标本号/跨号都显示。
   */
  const accountKey = accountNames.join('\u0000');
  const fillRoutes = useMemo(() => {
    const map = new Map<number, MotherFillRoute>();
    const suggestions = motherSuggestions ?? new Map();
    for (const account of accountKey ? accountKey.split('\u0000') : []) {
      const entry = suggestions.get(account);
      if (!entry) continue;
      for (const pairing of entry.pairings) {
        const current = map.get(pairing.eggGameId);
        if (!current || pairing.motherGain > current.chance) {
          map.set(pairing.eggGameId, { chance: pairing.motherGain, self: true });
        }
      }
      for (const task of entry.tasks) {
        const current = map.get(task.eggGameId);
        if (!current || task.chance > current.chance) {
          map.set(task.eggGameId, {
            chance: task.chance,
            sourceAccount: task.sourceAccount,
            self: false,
          });
        }
      }
    }
    return map;
  }, [motherSuggestions, accountKey]);

  /** 当前筛选下未收集、且其他号有跨号传蛋线的蛋数（同一条蛋只算一次） */
  const otherFillCount = useMemo(() => {
    const suggestions = motherSuggestions ?? new Map();
    const uncollected = new Set(
      matchedGroups.filter((group) => !isChainCollected(group)).map((group) => group.eggGameId),
    );
    const eggs = new Set<number>();
    for (const account of accountKey ? accountKey.split('\u0000') : []) {
      const entry = suggestions.get(account);
      if (!entry) continue;
      for (const task of entry.tasks) {
        if (uncollected.has(task.eggGameId)) eggs.add(task.eggGameId);
      }
    }
    return eggs.size;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motherSuggestions, accountKey, matchedGroups, owned, criteria, activeVoices.join(','), naturesOf]);

  /**
   * 链清单（按蛋组分区、图鉴号排序；每行四张精灵卡）：
   * 按**主蛋组**（链的最小可孵蛋组）分区，组内按图鉴号排序；每条链一行。
   */
  const chainSections = useMemo(() => {
    /**
     * 分母口径（2026-11-22 用户拍板，未收集 / 已收集共用）：
     * - 分母 = **该蛋组内有多少只精灵**（按链算，不按性格分摊），不是"当前筛出来几条"；
     * - 开了「只算推荐性格」→ 分母只算**有推荐性格的精灵**；
     * - 分子 = 该蛋组**实际已收集**的数量，与筛选无关。
     */
    const recommendedOnly = criteria.recommendedNatures === true;
    const hasNatureTarget = (group: MotherGroup) => naturesOfEgg(group.eggGameId).length > 0;
    const byGroup = new Map<number, MotherGroup[]>();
    for (const group of matchedGroups) {
      const primary = group.eggGroups[0];
      if (primary === undefined) continue;
      const bucket = byGroup.get(primary) ?? [];
      bucket.push(group);
      byGroup.set(primary, bucket);
    }
    const sections: Array<{
      groupId: number;
      label: string;
      collected: number;
      total: number;
      groups: MotherGroup[];
    }> = [];
    for (const [groupId, all] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
      // 计划中的蛋组仍留在「未收集」清单里，用淡蓝卡表示进度（2026-11-21 用户口径）
      const rows = all.filter((group) => {
        const collected = isChainCollected(group);
        return chainFilter === 'collected' ? collected : !collected;
      });
      if (rows.length === 0) continue;
      sections.push({
        groupId,
        label: eggGroupNames[groupId] ?? `蛋组${groupId}`,
        collected: all.filter(isChainCollected).length,
        total: recommendedOnly ? all.filter(hasNatureTarget).length : all.length,
        groups: [...rows].sort(
          (a, b) => a.number.localeCompare(b.number) || a.formLabel.localeCompare(b.formLabel),
        ),
      });
    }
    return sections;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedGroups, chainFilter, owned, criteria, activeVoices.join(','), naturesOf, plannedSet, natureOverrides, eggGroupNames]);
  /**
   * 目标组数（横屏 10 / 6，竖屏 2）与「已经挂上」的组数分开：
   * 首帧只挂 `FIRST_PAINT_SECTIONS` 组，其余靠下面的空闲任务补齐到目标。
   *
   * 2026-11-26 PERF-01：**筛选签名一变，就在这一次渲染里直接按首帧窗口取数**，不等 useEffect。
   * 原来重置写在 effect 里，换筛选/搜索后的**第一次提交**还会按上一次的组数（宽横屏 10）
   * 把新结果整屏铺一遍，再塌回 2 组 + 骨架长回来 —— 宽横屏下每敲一个字抖一次，
   * 那次整屏提交也白付了一遍成本（见 `docs/code-review/2026-11-26/R-04-性能与死代码.md` PERF-01）。
   */
  const sectionsKey = `${chainFilter}|${keyword}|${eggGroupFilter.join(',')}|${initialSections}`;
  const firstPaintWindow = {
    requested: Math.max(initialSections, FIRST_PAINT_SECTIONS),
    mounted: Math.min(initialSections, FIRST_PAINT_SECTIONS),
  };
  const [sectionWindow, setSectionWindow] = useState(() => ({
    key: sectionsKey,
    ...firstPaintWindow,
  }));
  const sectionWindowStale = sectionWindow.key !== sectionsKey;
  if (sectionWindowStale) {
    // 渲染期同步（React「渲染期调整 state」写法）：这次按旧窗口的渲染结果会被丢弃，
    // 立刻按新签名重渲染 —— 所以第一次提交就已经是首帧组数，不会先整屏再塌。
    setSectionWindow({ key: sectionsKey, ...firstPaintWindow });
  }
  const requestedSections = sectionWindowStale ? firstPaintWindow.requested : sectionWindow.requested;
  const mountedSections = sectionWindowStale ? firstPaintWindow.mounted : sectionWindow.mounted;

  /** 空闲追加：一片最多 2 组 / 20 张卡，补到目标组数就停 */
  useEffect(() => {
    if (chainFilter === 'collecting' || mountedSections >= requestedSections) return;
    const cardsOf = (index: number) => chainSections[index]?.groups.length ?? 0;
    const nextMounted = (current: number): number => {
      let count = current;
      let cards = 0;
      while (count < requestedSections && count - current < IDLE_SLICE_MAX_SECTIONS) {
        const sectionCards = cardsOf(count);
        if (count > current && cards + sectionCards > IDLE_SLICE_MAX_CARDS) break;
        cards += sectionCards;
        count += 1;
      }
      return Math.min(requestedSections, count);
    };
    return scheduleIdleTask(() =>
      setSectionWindow((current) =>
        // 片还没跑就换了筛选：这次作废（新签名会自己从首帧窗口重来）
        current.key === sectionsKey ? { ...current, mounted: nextMounted(current.mounted) } : current,
      ),
    );
  }, [chainFilter, mountedSections, requestedSections, chainSections, sectionsKey]);

  const visibleChainSections = chainSections.slice(0, mountedSections);
  /** 目标组数内、还没挂上的：先用等高骨架占位（追加时页面不跳） */
  const pendingChainSections = chainSections.slice(mountedSections, requestedSections);
  const hiddenChainSections = Math.max(0, chainSections.length - requestedSections);

  /**
   * 三列蛋组（2026-11-21 用户口径）：收起筛选且屏幕够宽时，
   * 只有「两列一屏放不下全部蛋组」才排三列；两列能一屏放下就保持两列大卡。
   *
   * P4（2026-11-27）：不再在 useLayoutEffect 里临时改两列、逐个
   * getBoundingClientRect 量真实高度（≥1200px 宽横屏一次收起筛选要 149.5ms，
   * 因为测量本身便宜但引起整页重排贵）。改用估算高度：分区高度 = header 30px
   * + ceil(链数/4) × 108px，gap 固定 8px，列表顶部按视口 15% 估算。
   *
   * 仍然留在 useLayoutEffect：估算只是算术，不读 DOM 就不会强制重排；
   * 放回 layout 阶段才能保持「收起/展开筛选时列数在第一帧就是对的」，不会 2 列闪一下再跳 3 列。
   */
  const [threeColumns, setThreeColumns] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const chainListRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onResize = () => setLayoutTick((tick) => tick + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useLayoutEffect(() => {
    if (!filterCollapsed || chainFilter === 'collecting') {
      setThreeColumns(false);
      return;
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setThreeColumns(false);
      return;
    }
    if (!window.matchMedia('(orientation: landscape) and (min-width: 1200px)').matches) {
      setThreeColumns(false);
      return;
    }
    // 还有「显示更多蛋组」= 两列本来就没展示完全部蛋组
    if (hiddenChainSections > 0) {
      setThreeColumns(true);
      return;
    }
    setThreeColumns(
      shouldUseThreeColumnsEstimated({
        sectionGroupCounts: chainSections.map((section) => section.groups.length),
        viewportHeight: window.innerHeight,
        listTopRatio: 0.15,
      }),
    );
    // layoutTick 只在 resize 时变化，用于重算；chainListRef 不再需要读 DOM
  }, [filterCollapsed, chainFilter, chainSections, hiddenChainSections, layoutTick, plan.length]);

  /** 打开「未收集母本怎么补」悬浮窗：目标卡用当前目标奖牌，路线按本号优先找 */
  const openGapFor = (group: MotherGroup) => {
    if (!gapTarget) return;
    const name = group.formLabel || '未知精灵';
    setGapDialog({
      chainKey: group.chainKey,
      target: {
        kind: 'mother',
        name,
        number: group.number,
        gameId: group.eggGameId,
        natures: [...naturesOfEgg(group.eggGameId)],
        eggGroupLabels: group.eggGroups.map((groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`),
        tag: '未收集',
        targetLabel: gapTarget.label,
        bodyMedal: gapTarget.bodyMedal,
        voiceTarget: gapTarget.voiceTarget ?? null,
        voiceDb: gapTarget.voiceDb,
        weightPercent: gapTarget.weightPercent,
      },
      fill: findMotherGapFill(group.eggGameId, motherSuggestions ?? new Map(), accountNames),
    });
  };

  return (
    <div className="collection-layout" data-tour="collection-mothers">
      <div className="collection-rail space-y-2">
      {/* 搜索 + 蛋组筛选同一行：蛋组用页内下拉多选，不再单开一段面板（2026-10-25 用户要求） */}
      <div className="flex items-center gap-1.5">
        <SearchField
          className="min-w-0 flex-1"
          label="搜索母本"
          value={query}
          onValueChange={setQuery}
          placeholder="搜索母本名称或图鉴号（支持进化链）"
          testId="mother-search"
        />
        <InlineMultiSelect
          label="蛋组筛选"
          values={eggGroupFilter}
          options={eggGroupOptions}
          onValuesChange={setEggGroupFilter}
          allLabel="全部蛋组"
          unit="个蛋组"
          testId="mother-egg-group-filter"
          menuTestId="mother-egg-group-options"
          optionTestId={(value) => `mother-egg-filter-option-${value || 'all'}`}
          align="right"
          className="max-w-[116px] shrink-0"
        />
      </div>

      {/* 母本页的奖牌组合只读母本自己的口径（2026-11-22 用户口径：判定跟所选档位走，
          覆盖度目标与母本判定互不影响），不再传 syncTargetGrade 跟看板目标联动 */}
      <MotherCriteriaMedals testIdPrefix="mother-criteria" />
        <div className="flex flex-wrap items-center justify-between gap-1 px-1">
          <span className="text-[11px] text-slate-400" data-testid="mother-chain-summary">
            共 {matchedGroups.length} 条链 · 已收集 {collectedChainCount}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <button
              type="button"
              aria-pressed={criteria.recommendedNatures === true}
              onClick={() =>
                setMotherCriteria({ ...criteria, recommendedNatures: criteria.recommendedNatures !== true })
              }
              data-testid="mother-recommended-only"
              className={`min-h-[28px] rounded-lg border px-1.5 text-[11px] ${
                criteria.recommendedNatures
                  ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              只算推荐性格
            </button>
            <button
              type="button"
              onClick={() => setNatureEditorOpen(true)}
              data-testid="mother-nature-editor"
              className="min-h-[28px] rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] text-slate-500"
            >
              编辑推荐性格
            </button>
            <SegmentedControl
              label="母本收集状态"
              value={chainFilter}
              options={CHAIN_FILTERS.map((item) => ({ value: item.value, label: item.label }))}
              onValueChange={(next) => setChainFilter(next as ChainFilter)}
              optionTestId={(value) => `mother-chain-filter-${value}`}
              className="w-[186px]"
            />
          </div>
        </div>
        {otherFillCount > 0 && chainFilter === 'uncollected' ? (
          <p
            className="mx-1 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-700"
            data-testid="mother-fill-summary"
          >
            未收集 {matchedGroups.length - collectedChainCount} · 其他号可补 {otherFillCount}
          </p>
        ) : null}
      </div>

      <div className="collection-main space-y-2">
      {/* 链清单按蛋组分区，每行四只；收集中使用同一母本卡但不按蛋组分区 */}
      <section
        ref={chainListRef}
        className="space-y-2"
        data-testid={chainFilter === 'collecting' ? 'mother-collecting-shell' : 'mother-chain-list'}
        data-three-columns={threeColumns ? 'true' : undefined}
      >
        {chainFilter === 'collecting' ? (
          <MotherCollectingView
            motherGroups={motherGroups}
            missingNaturesByEgg={missingNaturesByEgg}
            eggGroupNames={eggGroupNames}
            targetBody={targetBody}
            targetVoice={targetVoice}
            mode={mode}
            onNavigate={onNavigate ?? (() => {})}
          />
        ) : chainSections.length === 0 ? (
          /* 已收集空态给两个出口：筛没了 → 清除筛选；真没有 → 去未收集挑计划（2026-11-22） */
          <div
            className="rounded-2xl bg-white p-3 shadow-sm"
            data-testid="mother-chain-empty"
          >
            <p className="text-xs text-slate-400">
              {chainFilter === 'collected'
                ? '当前筛选下没有已收集的母本链。'
                : '当前筛选下没有匹配的母本链。'}
            </p>
            {chainFilter === 'collected' ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={!hasFilter}
                  onClick={() => {
                    setQuery('');
                    setEggGroupFilter([]);
                  }}
                  data-testid="mother-chain-empty-clear"
                  className="min-h-[32px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 disabled:text-slate-300"
                >
                  清除筛选
                </button>
                <button
                  type="button"
                  onClick={() => setChainFilter('uncollected')}
                  data-testid="mother-chain-empty-uncollected"
                  className="min-h-[32px] rounded-lg border border-emerald-500 bg-emerald-50 px-3 text-xs font-medium text-emerald-700"
                >
                  去未收集挑计划
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          visibleChainSections.map((section) => (
            <div
              key={section.groupId}
              className="overflow-hidden rounded-2xl bg-white shadow-sm"
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 180px' }}
              data-testid={`mother-chain-group-${section.groupId}`}
            >
              <p className="flex items-center justify-between bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500">
                <span>{section.label}</span>
                {/* 分子 = 已收集数，分母 = 该蛋组精灵数（只算推荐性格时只算有推荐性格的）（2026-11-22） */}
                <span className="text-slate-400">
                  已收集 {section.collected}/{section.total}
                  {section.total === 0 ? (
                    /* 开了「只算推荐性格」而本组没有推荐性格数据：链还在，只是没有数据可算（2026-11-22 用户口径：保留、说清楚） */
                    <span className="ml-1 text-amber-600" data-testid="mother-section-nodata">
                      本组暂无推荐性格数据
                    </span>
                  ) : null}
                </span>
              </p>
              <ul
                className="grid grid-cols-4 gap-1"
                data-testid={`mother-chain-group-list-${section.groupId}`}
              >
                {section.groups.map((group) => (
                  <MotherEggRow
                    key={group.chainKey}
                    eggName={group.formLabel || '未知精灵'}
                    eggGameId={group.eggGameId}
                    number={group.number}
                    recommendedNatures={naturesOfEgg(group.eggGameId)}
                    mothers={mothersOf(group)}
                    eggGroupLabels={group.eggGroups.map(
                      (groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`,
                    )}
                    planned={plannedSet.has(group.chainKey)}
                    onTogglePlan={() => toggleMotherPlan(group.chainKey)}
                    jumpBase={jumpBase}
                    fill={fillRoutes.get(group.eggGameId) ?? null}
                    onOpenInventory={onOpenInventory}
                    onOpenGap={gapTarget ? () => openGapFor(group) : undefined}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
        {/*
          目标组数内还没挂上的分区：等高骨架占位（2026-11-25 P1）。
          高度与分区自己声明的占位高度（containIntrinsicSize 180px）一致，
          所以「骨架 → 真分区」在屏外高度不变，追加时页面不跳。
        */}
        {chainFilter !== 'collecting'
          ? pendingChainSections.map((section) => (
              <div
                key={`skeleton-${section.groupId}`}
                className="overflow-hidden rounded-2xl bg-white shadow-sm"
                style={{ height: `${SECTION_SKELETON_HEIGHT_PX}px` }}
                data-testid="mother-chain-skeleton"
                aria-hidden
              />
            ))
          : null}
        {chainFilter !== 'collecting' && hiddenChainSections > 0 ? (
          <button
            type="button"
            onClick={() => {
              // 用户主动点的：目标组数和已挂组数一起加，立刻给出结果，不再等空闲片
              const nextRequested = Math.min(
                chainSections.length,
                requestedSections + CHAIN_SECTION_BATCH,
              );
              setSectionWindow({ key: sectionsKey, requested: nextRequested, mounted: nextRequested });
            }}
            className="min-h-[36px] w-full rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600"
            data-testid="mother-chain-show-more"
          >
            显示更多蛋组（{hiddenChainSections}）
          </button>
        ) : null}
      </section>

      </div>

      <GapFillDialog
        target={gapDialog?.target ?? null}
        fill={gapDialog?.fill ?? null}
        eyebrow="母本缺口 · 怎么补"
        targetReady={gapTarget != null && gapTarget.label !== '目标未选'}
        onClose={() => setGapDialog(null)}
        onSeekHelp={() => {
          // 去求蛋 = 跳小组页，悬浮窗顺手关掉，回来不会挡着列表
          setGapDialog(null);
          onSeekHelp?.();
        }}
        onAddToPlan={() => {
          if (gapDialog) mergeMotherPlan([gapDialog.chainKey]);
          setGapDialog(null);
        }}
      />

      <RecommendedNatureEditor open={natureEditorOpen} onClose={() => setNatureEditorOpen(false)} />
    </div>
  );
}

/**
 * 母本清单卡片（四列）：已收集点「查看」跳精灵背包，未收集可加入计划。
 */
function MotherEggRow({
  eggName,
  eggGameId,
  number,
  recommendedNatures,
  mothers,
  eggGroupLabels,
  planned,
  onTogglePlan,
  jumpBase,
  fill,
  onOpenInventory,
  onOpenGap,
}: {
  eggName: string;
  eggGameId: number;
  number: string;
  recommendedNatures: readonly string[];
  mothers: OwnedPet[];
  eggGroupLabels: string[];
  planned: boolean;
  onTogglePlan: () => void;
  jumpBase: { tags: string[] };
  /** 这条未收集母本怎么补（本号直配 / 其他号传蛋）；null = 没有过线的线 */
  fill?: MotherFillRoute | null;
  onOpenInventory?: (jump: MotherInventoryJump) => void;
  /** 未收集的卡点开「怎么补」悬浮窗 */
  onOpenGap?: () => void;
}) {
  const collected = mothers.length > 0;
  const collectedNatures = new Set(mothers.map((mother) => mother.nature));
  // 只带卡片上显示为绿色的推荐性格：点「查看」就是看这几只已经达标母本的性格
  const natureTags = recommendedNatures
    .filter((nature) => collectedNatures.has(nature))
    .map((nature) => `nature:${nature}`);

  /**
   * 底色（2026-11-24 用户口径）：未收集白底 / 计划中淡蓝 / 已收集淡绿 /
   * 可补浅绿（本号或其他号有能补的线）。计划中的卡仍用淡蓝，不抢计划状态。
   */
  const cardStatus: PetCardStatus = collected
    ? 'collected'
    : planned
      ? 'planned'
      : fill
        ? 'fillable'
        : 'uncollected';

  return (
    <li data-testid="mother-chain-row" data-mother-status={cardStatus} className="min-w-0">
      <PetCardLayout
        name={eggName}
        number={number}
        eggGroups={eggGroupLabels}
        natures={recommendedNatures}
        natureCollected={(nature) => collectedNatures.has(nature)}
        size="gap"
        status={cardStatus}
        fitName
        avatar={<PetAvatar gameId={eggGameId} name={eggName} size={48} />}
        eggGroupsTestId="mother-card-egg-groups"
        naturesTestId="mother-card-natures"
        title={collected || !onOpenGap ? eggName : `${eggName} · 点卡片看怎么补`}
        onClick={collected ? undefined : onOpenGap}
        footer={
          collected ? (
            <button
              type="button"
              onClick={() =>
                onOpenInventory?.({
                  name: eggName,
                  tags: [...jumpBase.tags, ...natureTags],
                })
              }
              data-testid="mother-chain-open"
              className="h-full w-full truncate bg-emerald-50 px-1 text-center text-[10px] font-medium leading-[18px] text-emerald-700"
            >
              查看
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                // 卡片本身是「怎么补」入口，点底部的计划按钮不要顺手把悬浮窗也打开
                event.stopPropagation();
                onTogglePlan();
              }}
              className={`h-full w-full truncate px-1 text-center text-[10px] leading-[18px] ${
                planned
                  ? 'bg-sky-50 font-medium text-sky-700'
                  : 'bg-emerald-50 font-medium text-emerald-700'
              }`}
              data-testid="mother-plan-toggle"
              aria-pressed={planned}
            >
              {planned ? '已计划' : '计划'}
            </button>
          )
        }
      />
    </li>
  );
}



