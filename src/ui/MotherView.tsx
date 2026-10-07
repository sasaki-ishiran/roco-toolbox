import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { boxLabel } from '../domain/coverageDetail';
import type { MotherGroup, TargetMode } from '../domain/petFilters';
import type { OwnedPet } from '../domain/types';
import { chainTopNaturesByGameId } from '../data/catalog';
import {
  effectiveMotherVoices,
  isChainCollected as chainCollectedBy,
  isQualifiedMother as isQualifiedMotherBy,
  motherVoicesForMode,
  type MotherCriteria,
} from '../domain/motherCriteria';
import { AccountSection } from './AccountSection';
import { FilterAccordion } from './FilterAccordion';
import { GenderMark } from './GenderMark';
import {
  getMotherCriteria,
  setMotherCriteria,
  useMotherCriteria,
  type MotherBody,
  type MotherVoice,
} from './motherCriteriaStore';
import { removeManyFromMotherPlan, toggleMotherPlan, useMotherPlan } from './motherPlanStore';

/** 每节的分页大小：母本视角的每一节动辄上百条，必须分页 */
const PAGE_SIZE = 20;

export interface MotherViewProps {
  owned: OwnedPet[];
  /** 蛋搜索索引（`egg:<蛋物种 gameId>` → 归属这颗蛋的全部形态名 + 图鉴号） */
  searchIndex: Map<string, string>;
  eggGroupNames: Record<number, string>;
  motherGroups: MotherGroup[];
  mode: TargetMode;
}

interface SectionProps {
  title: string;
  titleClass: string;
  groups: MotherGroup[];
  defaultOpen?: boolean;
  testId: string;
  renderRow: (group: MotherGroup) => ReactNode;
  /** 标题下方的工具区（候选区的搜索框、计划区的「清除已达成」） */
  toolbar?: ReactNode;
  /** 列表容器样式（已收集用两列网格，候选/计划用单列） */
  listClassName?: string;
  /** 提供该分组键时，列表按它聚拢、每组用 AccountSection 标题（2026-10-05 已收集按账号分组） */
  groupKey?: (group: MotherGroup) => string;
}

/** 可折叠 + 分页的一节。默认收起，避免一进页面就被几百条铺满。 */
function CollapsibleSection({
  title,
  titleClass,
  groups,
  defaultOpen = false,
  testId,
  renderRow,
  toolbar,
  listClassName = 'space-y-1',
  groupKey,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(1);
  // 搜索命中时把这一节自动展开（用户拍板：搜索到的页签就打开展示对应精灵）
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = groups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  // 提供 groupKey 时把当前页的条目按它分组（2026-10-05 已收集按账号聚拢）
  const grouped = groupKey
    ? (() => {
        const map = new Map<string, MotherGroup[]>();
        for (const group of visible) {
          const key = groupKey(group);
          const list = map.get(key) ?? [];
          list.push(group);
          map.set(key, list);
        }
        return [...map.entries()].map(([account, items]) => ({ account, items }));
      })()
    : null;

  return (
    <section className="rounded-2xl bg-white shadow-sm" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[44px] w-full items-center justify-between px-3 text-left"
        data-testid={`${testId}-toggle`}
      >
        <span className={`text-sm font-medium ${titleClass}`}>
          {title}（{groups.length}）
        </span>
        <span className="text-xs text-slate-300" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-slate-100 p-3">
          {toolbar}
          {groups.length === 0 ? (
            <p className="text-xs text-slate-400" data-testid={`${testId}-empty`}>
              这一节暂时没有。
            </p>
          ) : grouped ? (
            <>
              <div className="space-y-2" data-testid={`${testId}-list`}>
                {grouped.map(({ account, items }) => (
                  <AccountSection key={account} account={account}>
                    <ul className={listClassName}>{items.map(renderRow)}</ul>
                  </AccountSection>
                ))}
              </div>
              {totalPages > 1 ? (
                <nav className="flex items-center justify-between gap-2" aria-label="分页">
                  <button
                    type="button"
                    disabled={safePage === 1}
                    onClick={() => setPage(safePage - 1)}
                    className="min-h-[36px] flex-1 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 disabled:text-slate-300"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-slate-400">
                    第 {safePage} / {totalPages} 页
                  </span>
                  <button
                    type="button"
                    disabled={safePage === totalPages}
                    onClick={() => setPage(safePage + 1)}
                    className="min-h-[36px] flex-1 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 disabled:text-slate-300"
                  >
                    下一页
                  </button>
                </nav>
              ) : null}
            </>
          ) : (
            <>
              <ul className={listClassName} data-testid={`${testId}-list`}>
                {visible.map(renderRow)}
              </ul>
              {totalPages > 1 ? (
                <nav className="flex items-center justify-between gap-2" aria-label="分页">
                  <button
                    type="button"
                    disabled={safePage === 1}
                    onClick={() => setPage(safePage - 1)}
                    className="min-h-[36px] flex-1 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 disabled:text-slate-300"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-slate-400">
                    第 {safePage} / {totalPages} 页
                  </span>
                  <button
                    type="button"
                    disabled={safePage === totalPages}
                    onClick={() => setPage(safePage + 1)}
                    className="min-h-[36px] flex-1 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 disabled:text-slate-300"
                  >
                    下一页
                  </button>
                </nav>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
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
 * - **计划收集**：用户从「待补齐母本」里挑出来的待办（存 localStorage / 随备份走），
 *   自动判定达成（该链已有合格母本）并支持「清除已达成」；
 * - **待补齐母本**：所有还没有合格母本的链（无母本 ∪ 有母本但不够档），
 *   默认收起、可搜索、勾选即加入计划。
 */
export function MotherView({
  owned,
  searchIndex,
  eggGroupNames,
  motherGroups,
  mode,
}: MotherViewProps) {
  const plan = useMotherPlan();
  const criteria = useMotherCriteria();
  const [query, setQuery] = useState('');
  // 默认看「未收集」（待补齐才是主场景；看板「母本全收集」卡跳过来也是它）
  const [chainFilter, setChainFilter] = useState<ChainFilter>('uncollected');

  /**
   * 声音选项随目标模式联动（2026-10-05 用户拍板）：
   * 追满分 → +100 / -100；追双牌 → 婉转声 / 粗嗓门。
   * 模式切换后若旧选择与此模式无交集，重置为该模式的默认全选（避免隐藏选项仍在暗中过滤）。
   */
  const modeVoices: MotherVoice[] = motherVoicesForMode(mode);
  const activeVoices = effectiveMotherVoices(criteria.voices, mode);
  useEffect(() => {
    if (activeVoices.length === 0 && criteria.voices.length > 0) {
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
  const effectiveCriteria: MotherCriteria = { bodies: criteria.bodies, voices: activeVoices };
  const isQualifiedMother = (pet: OwnedPet): boolean =>
    isQualifiedMotherBy(pet, effectiveCriteria);
  const isChainCollected = (group: MotherGroup): boolean =>
    chainCollectedBy(group, owned, effectiveCriteria);

  const toggleCriteria = <T extends string>(current: T[], value: T): T[] =>
    current.includes(value) ? current.filter((item) => item !== value) : [...current, value];

  /** 搜索（进化链全员命中）+ 蛋组筛选：同时作用于已收集 / 计划 / 待补齐 */
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
   * 链清单（2026-10-05 用户拍板：合并成一条链一行，密集排版，一眼看整体、搜索即答）：
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
  }, [matchedGroups, chainFilter, owned, criteria, activeVoices.join(',')]);

  const plannedSet = useMemo(() => new Set(plan), [plan]);
  const planGroups = useMemo(
    () => matchedGroups.filter((group) => plannedSet.has(group.chainKey)),
    [matchedGroups, plannedSet],
  );
  const achievedGroups = planGroups.filter((group) => isChainCollected(group));

  const renderPlanRow = (group: MotherGroup): ReactNode => {
    const achieved = isChainCollected(group);
    return (
      <li
        key={group.chainKey}
        className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
        data-testid="mother-plan-row"
      >
        <span className="min-w-0 flex-1 truncate">
          <span className={`text-sm ${achieved ? 'text-emerald-700' : 'text-slate-800'}`}>
            {group.formLabel || '未知精灵'}
          </span>
          {group.number ? (
            <span className="ml-1 text-[11px] text-slate-400">#{group.number}</span>
          ) : null}
          {achieved ? (
            <span className="ml-1.5 text-[11px] text-emerald-700" data-testid="mother-plan-done">
              已达成
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => toggleMotherPlan(group.chainKey)}
          className="min-h-[28px] shrink-0 rounded-full border border-slate-200 bg-white px-2 text-[11px] text-slate-500"
          data-testid="mother-plan-remove"
        >
          移除
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-2">
      {/* 搜索在最上（用户拍板：对所有母本搜索，支持进化链全员命中） */}
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索母本名称或图鉴号（支持进化链）"
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none"
        data-testid="mother-search"
      />

      {/* 达标条件（决定「已收集 / 未收集」）+ 蛋组 */}
      <section className="rounded-xl bg-white p-3 shadow-sm" data-testid="mother-filters">
        <FilterAccordion
          dimensions={[
            {
              id: 'voice',
              label: '声音',
              options: modeVoices.map((voice) => ({ value: voice, label: voice })),
              selected: activeVoices,
              onToggle: (voice) =>
                setMotherCriteria({
                  ...criteria,
                  voices: toggleCriteria(criteria.voices, voice as MotherVoice),
                }),
              onClear: () => setMotherCriteria({ ...criteria, voices: [] }),
            },
            {
              id: 'body',
              label: '体型',
              options: (['大块头', '小不点'] as MotherBody[]).map((body) => ({
                value: body,
                label: body,
              })),
              selected: criteria.bodies,
              onToggle: (body) =>
                setMotherCriteria({
                  ...criteria,
                  bodies: toggleCriteria(criteria.bodies, body as MotherBody),
                }),
              onClear: () => setMotherCriteria({ ...criteria, bodies: [] }),
            },
            {
              id: 'motherGroup',
              label: '蛋组',
              options: eggGroupOptions,
              selected: eggGroupFilter,
              onToggle: (groupId) =>
                setEggGroupFilter((prev) =>
                  prev.includes(groupId) ? prev.filter((item) => item !== groupId) : [...prev, groupId],
                ),
              onClear: () => setEggGroupFilter([]),
            },
          ]}
        />
      </section>

      {planGroups.length > 0 ? (
        <CollapsibleSection
          title="计划收集"
          titleClass="text-emerald-700"
          groups={planGroups}
          defaultOpen
          testId="mother-plan"
          renderRow={renderPlanRow}
          toolbar={
            achievedGroups.length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  removeManyFromMotherPlan(achievedGroups.map((group) => group.chainKey))
                }
                className="min-h-[32px] rounded-full border border-emerald-500 px-3 text-xs font-medium text-emerald-700"
                data-testid="mother-plan-clear-done"
              >
                清除已达成（{achievedGroups.length}）
              </button>
            ) : undefined
          }
        />
      ) : null}

      {/* 链清单：一条链一行（按蛋组分区），密集排版便于一眼看整体；搜索即刻看到已收集/未收集 */}
      <section className="space-y-2" data-testid="mother-chain-list">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-slate-400" data-testid="mother-chain-summary">
            共 {matchedGroups.length} 条链 · 已收集 {collectedChainCount}
          </span>
          <div
            className="flex gap-1 rounded-full bg-slate-100 p-0.5"
            role="group"
            aria-label="母本收集状态"
          >
            {CHAIN_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={chainFilter === item.value}
                onClick={() => setChainFilter(item.value)}
                data-testid={`mother-chain-filter-${item.value}`}
                className={`min-h-[28px] rounded-full px-2.5 text-[11px] ${
                  chainFilter === item.value
                    ? 'bg-white font-medium text-emerald-700 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {item.label}
              </button>
            ))}
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
              <ul className="divide-y divide-slate-50">
                {section.groups.map((group) => (
                  <MotherEggRow
                    key={group.chainKey}
                    eggName={group.formLabel || '未知精灵'}
                    recommendedNatures={chainTopNaturesByGameId.get(group.eggGameId) ?? []}
                    mothers={mothersOf(group)}
                    eggGroupLabels={group.eggGroups.map(
                      (groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`,
                    )}
                    planned={plannedSet.has(group.chainKey)}
                    onTogglePlan={() => toggleMotherPlan(group.chainKey)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/**
 * 一颗蛋一行（2026-10-05 用户拍板两行式）：
 * - **第一行**：状态灯（灰=未收集／绿=已收集）· 精灵名 ·…· 右侧动作
 *   （未收集=「计划」按钮；已收集=「已收集 N 只」可展开）；
 * - **第二行**：这条血脉的**推荐性格**标签 + **蛋组**标签；
 * - **展开**（已收集）后逐只列出实际母本：`名字 ♀ 性格` / `声音 · 体型 · 账号 · 位置`；
 *   性格按是否命中推荐上色（推荐=翠绿、非推荐=浅灰）。
 */
function MotherEggRow({
  eggName,
  recommendedNatures,
  mothers,
  eggGroupLabels,
  planned,
  onTogglePlan,
}: {
  eggName: string;
  recommendedNatures: string[];
  mothers: OwnedPet[];
  eggGroupLabels: string[];
  planned: boolean;
  onTogglePlan: () => void;
}) {
  const [open, setOpen] = useState(false);
  const collected = mothers.length > 0;
  const recommended = new Set(recommendedNatures);

  return (
    <li data-testid="mother-chain-row">
      {/* 一行显示：状态灯 · 名字 · 推荐性格 · 蛋组 · 右侧动作（2026-10-05 用户要求合一行） */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-xs">
        {/* 状态灯：绿=已收集 / 灰=未收集（data-status 供测试定位状态） */}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${collected ? 'bg-emerald-500' : 'bg-slate-300'}`}
          data-testid="mother-chain-status"
          data-status={collected ? 'collected' : 'uncollected'}
          aria-hidden
        />
        <span className="min-w-0 truncate text-sm font-medium text-slate-800">{eggName}</span>
        {recommendedNatures.map((nature) => (
          <span
            key={nature}
            className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] leading-none text-emerald-700"
            data-testid="mother-rec-nature"
          >
            {nature}
          </span>
        ))}
        {eggGroupLabels.map((label) => (
          <span
            key={label}
            className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] leading-none text-slate-500"
            data-testid="mother-egg-group"
          >
            {label}
          </span>
        ))}
        <span className="min-w-0 flex-1" />
        {collected ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            data-testid="mother-chain-expand"
            className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
          >
            <span data-testid="mother-chain-detail">已收集 {mothers.length} 只</span>
            <span className="text-[10px]" aria-hidden>
              {open ? '▲' : '▼'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onTogglePlan}
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
              planned
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 text-slate-500'
            }`}
            data-testid="mother-plan-toggle"
            aria-pressed={planned}
          >
            {planned ? '已计划' : '计划'}
          </button>
        )}
      </div>

      {collected && open ? (
        <ul className="space-y-1 border-t border-slate-100 bg-slate-50/60 px-3 py-1.5" data-testid="mother-chain-mothers">
          {mothers.map((mother, index) => (
            <li
              key={`${mother.account}-${mother.captureId ?? mother.gameId}-${index}`}
              className="text-[11px]"
              data-testid="mother-chain-mother"
            >
              <div className="flex items-center gap-1">
                <span className="font-medium text-slate-700">{mother.name}</span>
                <GenderMark gender={mother.gender} />
                <span
                  className={
                    recommended.has(mother.nature)
                      ? 'font-medium text-emerald-600'
                      : 'text-slate-400'
                  }
                >
                  {mother.nature}
                </span>
              </div>
              <div className="text-slate-400">
                {mother.voiceDb}dB · {mother.medalBody || '无体型牌'} · {mother.account} ·{' '}
                {boxLabel(mother)}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}