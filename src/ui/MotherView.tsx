import { useEffect, useMemo, useState } from 'react';
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
import { PetAvatar } from './PetAvatar';
import { PetCardLayout } from './PetCardLayout';
import { SearchField } from './primitives/SearchField';
import { InlineMultiSelect } from './primitives/InlineMultiSelect';
import { SegmentedControl } from './primitives/SegmentedControl';
import { setPersonalQuery, usePersonalList } from './listViewStore';
import {
  getMotherCriteria,
  setMotherCriteria,
  useMotherCriteria,
} from './motherCriteriaStore';
import { createNaturesResolver, eggNatures } from '../domain/recommendedNatures';
import { useNatureOverrides } from './natureOverrideStore';
import { RecommendedNatureEditor } from './RecommendedNatureEditor';
import { MotherCriteriaMedals, selectedGradesFor } from './MotherCriteriaMedals';
import { findMotherGapFill, type GapFill } from '../domain/gapFill';
import type { MotherNestAccount } from '../domain/motherNest';
import { GapFillDialog, type GapTargetView } from './GapFillDialog';

/** 点已收集卡带到精灵背包的筛选：进化链名 + 标签（不再带身高范围，见 jumpBase）。 */
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
  /** 从收集页直达的状态（未收集 / 已收集）；'plan' 仅为旧导航兼容，本页不再有计划分区 */
  status?: 'missing' | 'collected' | 'plan';
  /** 点已收集卡：带到精灵背包的筛选条件 */
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
}

/** 链清单的收/未收开关（2026-10-06 用户拍板：由「只看未收集」开关改成两态分段） */
const CHAIN_FILTERS = [
  { value: 'uncollected', label: '未收集' },
  { value: 'collected', label: '已收集' },
] as const;
type ChainFilter = (typeof CHAIN_FILTERS)[number]['value'];

/**
 * 母本视角：
 *
 * - **已收集**：按满分四档各自一节（与看板的四档计数同口径），行是两列紧凑卡（PetCard）；
 * - **待补齐母本**：所有还没有合格母本的链（无母本 ∪ 有母本但不够档），
 *   默认收起、可搜索。
 *
 * 2026-11-20：本页的「计划收集」整段与卡片底部「计划 / 已计划」按钮移除。
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
}: MotherViewProps) {
  /** 「未收集母本怎么补」悬浮窗（2026-11-19 用户口径）：与看板共用同一块内容 */
  const [gapDialog, setGapDialog] = useState<{ chainKey: string; target: GapTargetView; fill: GapFill } | null>(
    null,
  );
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

  // 收集页的「未收集 / 已收集」直达：同步到本页的状态开关
  useEffect(() => {
    if (status === 'missing') setChainFilter('uncollected');
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
   * 已收集卡带到精灵背包的公共条件：当前那一档奖牌（强制单选）。
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

  /** 搜索（进化链全员命中）+ 蛋组筛选：同时作用于已收集 / 未收集 */
  const keyword = query.trim().toLowerCase();
  const [eggGroupFilter, setEggGroupFilter] = useState<string[]>([]);

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
   * 链清单（按蛋组分区、图鉴号排序；每行四张精灵卡）：
   * 按**主蛋组**（链的最小可孵蛋组）分区，组内按图鉴号排序；每条链一行。
   */
  const chainSections = useMemo(() => {
    const list = matchedGroups.filter((group) =>
      chainFilter === 'uncollected' ? !isChainCollected(group) : isChainCollected(group),
    );
    const byGroup = new Map<number, MotherGroup[]>();
    for (const group of list) {
      const primary = group.eggGroups[0];
      if (primary === undefined) continue;
      const bucket = byGroup.get(primary) ?? [];
      bucket.push(group);
      byGroup.set(primary, bucket);
    }
    return [...byGroup.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([groupId, groups]) => ({
        groupId,
        label: eggGroupNames[groupId] ?? `蛋组${groupId}`,
        collected: groups.filter(isChainCollected).length,
        total: groups.length,
        groups: [...groups].sort(
          (a, b) => a.number.localeCompare(b.number) || a.formLabel.localeCompare(b.formLabel),
        ),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedGroups, chainFilter, owned, criteria, activeVoices.join(','), naturesOf]);

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
        natures: eggNatures(catalogSpecies, group.eggGameId, natureOverrides),
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
    <div className="space-y-2" data-tour="collection-mothers">
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

      <MotherCriteriaMedals testIdPrefix="mother-criteria" syncTargetGrade />

      {/* 链清单按蛋组分区，每行四只；搜索即刻看到已收集 / 未收集 */}
      <section className="space-y-2" data-testid="mother-chain-list">
        <div className="flex flex-wrap items-center justify-between gap-1 px-1">
          <span className="text-[11px] text-slate-400" data-testid="mother-chain-summary">
            共 {matchedGroups.length} 条链 · 已收集 {collectedChainCount}
          </span>
          <div className="flex shrink-0 items-center gap-1">
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
              className="w-[124px]"
            />
          </div>
        </div>
        {chainSections.length === 0 ? (
          <p
            className="rounded-2xl bg-white p-3 text-xs text-slate-400 shadow-sm"
            data-testid="mother-chain-empty"
          >
            当前筛选下没有匹配的母本链。
          </p>
        ) : (
          chainSections.map((section) => (
            <div
              key={section.groupId}
              className="overflow-hidden rounded-2xl bg-white shadow-sm"
              data-testid={`mother-chain-group-${section.groupId}`}
            >
              <p className="flex items-center justify-between bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500">
                <span>{section.label}</span>
                <span className="text-slate-400">
                  已收集 {section.collected}/{section.total}
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
                    recommendedNatures={eggNatures(catalogSpecies, group.eggGameId, natureOverrides)}
                    mothers={mothersOf(group)}
                    eggGroupLabels={group.eggGroups.map(
                      (groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`,
                    )}
                    jumpBase={jumpBase}
                    onOpenInventory={onOpenInventory}
                    onOpenGap={gapTarget ? () => openGapFor(group) : undefined}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

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
      />

      <RecommendedNatureEditor open={natureEditorOpen} onClose={() => setNatureEditorOpen(false)} />
    </div>
  );
}

/**
 * 母本清单卡片（四列）：已收集点卡片跳精灵背包筛选，未收集点卡片看「怎么补」。
 */
function MotherEggRow({
  eggName,
  eggGameId,
  number,
  recommendedNatures,
  mothers,
  eggGroupLabels,
  jumpBase,
  onOpenInventory,
  onOpenGap,
}: {
  eggName: string;
  eggGameId: number;
  number: string;
  recommendedNatures: string[];
  mothers: OwnedPet[];
  eggGroupLabels: string[];
  jumpBase: { tags: string[] };
  onOpenInventory?: (jump: MotherInventoryJump) => void;
  /** 未收集的卡点开「怎么补」悬浮窗 */
  onOpenGap?: () => void;
}) {
  const collected = mothers.length > 0;
  const collectedNatures = new Set(mothers.map((mother) => mother.nature));
  // 只带卡片上显示为绿色的推荐性格：点卡片就是看这几只已经达标母本的性格
  const natureTags = recommendedNatures
    .filter((nature) => collectedNatures.has(nature))
    .map((nature) => `nature:${nature}`);

  return (
    <li data-testid="mother-chain-row" className="min-w-0">
      <PetCardLayout
        name={eggName}
        number={number}
        eggGroups={eggGroupLabels}
        natures={recommendedNatures}
        natureCollected={(nature) => collectedNatures.has(nature)}
        size="mother"
        fitName
        avatar={<PetAvatar gameId={eggGameId} name={eggName} size={62} />}
        eggGroupsTestId="mother-card-egg-groups"
        naturesTestId="mother-card-natures"
        title={
          collected
            ? `${eggName} · 点卡片到精灵背包筛选`
            : onOpenGap
              ? `${eggName} · 点卡片看怎么补`
              : eggName
        }
        onClick={
          collected
            ? onOpenInventory
              ? () => onOpenInventory({ name: eggName, tags: [...jumpBase.tags, ...natureTags] })
              : undefined
            : onOpenGap
        }
      />
    </li>
  );
}
