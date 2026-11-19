import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listCollectionGroups, publishCollectionDemand } from '../api/collectionGroups';
import { readAccountId } from '../api/session';
import { ALL_EGG_GROUP_IDS } from '../domain/coverageTargets';
import { describeCoverageCells } from '../domain/coverageDetail';
import { TARGET_MODE_LABELS } from '../domain/petFilters';
import {
  eggGroupNames,
  allNatureNames,
  naturePlusStats,
  species,
  targetNatureNames,
  targetNaturePool,
} from '../data/catalog';
import { CollectionTargetEditor } from './CollectionTargetEditor';
import { useOwnedPets } from './useOwnedPets';
import { useAccountFilter } from './accountFilterStore';
import { useCollectionSummary } from './useCollectionSummary';
import {
  resetCoverageFilter,
  setNatureMode,
  toggleAllCustomNatures,
  toggleCustomNature,
  toggleFilterGroup,
  toggleGroupNature,
  useCoverageFilter,
} from './coverageFilterStore';
import { CoverageFilterBar } from './CoverageFilterBar';
import { CoverageIntroCard } from './CoverageIntroCard';
import {
  COVERAGE_LEGEND_ORDER,
  COVERAGE_STATE_CHIP,
  COVERAGE_STATE_LABELS,
  CoverageMatrix,
} from './CoverageMatrix';
import { EmptyState } from './EmptyState';
import { NATURE_STAT_ORDER } from './NatureSelectionContent';
import { SourceNotice } from './SourceNotice';
import { StudMatrix, type StudDemandPublishInput } from './StudMatrix';
import { useCoverageSlots } from './useCoverageSlots';

export interface CoverageProps {
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
  /** 空数据时「去导入数据」按钮的跳转 */
  onGoImport?: () => void;
}

/** 淡黄格弹层里的小组列表缓存有效期：同一账号 60 秒内只拉一次（与接单页同一口径，R2-4-L05）。 */
const DEMAND_GROUPS_TTL_MS = 60_000;

/**
 * 自选性格分组（2026-11-19 用户口径）：和精灵背包「全部性格」一致，
 * 按提升属性排成 6 行、每行 5 个；30 个性格常显，不再用「更多」折叠。
 */
const CUSTOM_NATURE_ROWS = NATURE_STAT_ORDER.map((stat) => ({
  stat,
  names: allNatureNames.filter((name) => naturePlusStats.get(name) === stat),
})).filter((row) => row.names.length > 0);

export function Coverage({ expandedGroupId, onToggleGroup, onGoImport }: CoverageProps = {}) {
  // 与看板同一份摘要（2026-10-24）：覆盖矩阵不再自己算一遍
  const { loaded, owned, mode, stud, recommendations, plans } = useCollectionSummary();
  const { accounts } = useOwnedPets();
  const { excluded } = useAccountFilter();
  const [editorOpen, setEditorOpen] = useState(false);
  /** 自选性格的下拉：默认收起，只留一行摘要；点开才铺 6 行 × 5 列（2026-11-19 用户口径）。 */
  const [customOpen, setCustomOpen] = useState(false);

  const filter = useCoverageFilter();
  const slots = useCoverageSlots();
  /**
   * 「筛选与默认值不同」标记（2026-11-01 R2-4-L03，2026-11-19 随默认模式改为八大）：
   * 蛋组少选、或性格模式不是「八大性格」，都算偏离默认。
   */
  const filterActive = useMemo(
    () =>
      filter.groupIds.length < ALL_EGG_GROUP_IDS.length || filter.natureMode !== 'eight',
    [filter],
  );

  /**
   * 点属性名整组勾选 / 取消（与精灵背包「全部性格」一致）：
   * 默认按 8 大预选时，点一下补全该组；整组都亮着时再点一下整组取消。
   */
  const toggleNatureStat = (names: readonly string[]) => {
    const allOn = names.every((name) => filter.customNatures.includes(name));
    for (const name of names) {
      const on = filter.customNatures.includes(name);
      if (allOn ? on : !on) toggleCustomNature(name);
    }
  };
  const speciesByGameId = useMemo(
    () => new Map(species.map((entry) => [entry.gameId, entry])),
    [],
  );
  const details = useMemo(
    () => describeCoverageCells({ cells: stud.cells, species, owned, mode }),
    [stud, owned, mode],
  );
  /** 种公阵列点淡黄推荐格 → 选小组发种公需求：小组列表按需读取，避免进页面就请求。 */
  const [demandGroups, setDemandGroups] = useState<Array<{ id: string; name: string }> | null>(null);
  const [demandGroupsLoading, setDemandGroupsLoading] = useState(false);
  const [demandGroupsError, setDemandGroupsError] = useState('');
  /** 读出的小组列表本机缓存 + 在途请求：连点多个淡黄格只拉一次（R2-4-L05）。 */
  const demandGroupsCache = useRef<{
    accountId: string | null;
    groups: Array<{ id: string; name: string }>;
    loadedAt: number;
  } | null>(null);
  const demandGroupsRequest = useRef<AbortController | null>(null);

  useEffect(() => () => demandGroupsRequest.current?.abort(), []);

  const loadDemandGroups = useCallback(() => {
    const accountId = readAccountId();
    const groupsOf = (list: Array<{ id: string; name: string; groupType: string }>) =>
      list.filter((group) => group.groupType === 'mother').map((group) => ({ id: group.id, name: group.name }));

    const cached = demandGroupsCache.current;
    if (cached && cached.accountId === accountId && Date.now() - cached.loadedAt < DEMAND_GROUPS_TTL_MS) {
      setDemandGroups(cached.groups);
      setDemandGroupsError('');
      setDemandGroupsLoading(false);
      return;
    }

    demandGroupsRequest.current?.abort();
    const controller = new AbortController();
    demandGroupsRequest.current = controller;
    setDemandGroupsLoading(true);
    setDemandGroupsError('');
    void listCollectionGroups(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        const groups = groupsOf(list);
        demandGroupsCache.current = { accountId, groups, loadedAt: Date.now() };
        setDemandGroups(groups);
      })
      .catch((failure: unknown) => {
        // 中止是离开页面 / 换身份的常态，不能当成「读取失败」写进界面
        if (controller.signal.aborted) return;
        setDemandGroupsError(
          failure instanceof Error ? failure.message : '读取小组失败，请稍后再试',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDemandGroupsLoading(false);
      });
  }, []);

  const publishStudDemand = useCallback(async (input: StudDemandPublishInput) => {
    await publishCollectionDemand(input.groupId, {
      eggGameId: -input.eggGroupId,
      natures: [input.natureName],
      gender: '公',
      body: input.body,
      voice: input.voice,
    });
  }, []);

  return (
    <main className="mx-auto max-w-md space-y-3 p-4" data-tour="collection-studs">
      {!loaded ? (
        <p className="text-sm text-slate-400">正在读取本地数据…</p>
      ) : accounts.length === 0 ? (
        <EmptyState onGoImport={onGoImport} />
      ) : (
        <>
          {/* 筛选提成一级卡片（2026-11-19 用户口径）：一进种公页就能改蛋组 / 档位 / 性格，
              不再收在阵列右上角；性格三种模式，默认「八大性格」 */}
          <section
            className="rounded-2xl bg-white p-3 shadow-sm"
            data-testid="coverage-filter-card"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-500">筛选</h2>
              {filterActive ? (
                <span
                  className="text-[10px] font-medium text-emerald-700"
                  data-testid="coverage-filter-active"
                >
                  已改
                </span>
              ) : null}
            </div>

            <div className="mt-2">
              <CoverageFilterBar
                filter={filter}
                onToggleGroup={toggleFilterGroup}
                onReset={resetCoverageFilter}
                onOpenTargetEditor={() => setEditorOpen(true)}
              />

              {/* 性格：推荐性格 / 八大性格 / 自选性格（2026-11-19 用户口径，默认八大） */}
              <div className="mt-2" data-testid="nature-mode">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">性格</span>
                  <div
                    className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5"
                    role="group"
                    aria-label="性格模式"
                  >
                    {(
                      [
                        { value: 'recommended', label: '推荐性格' },
                        { value: 'eight', label: '八大性格' },
                        { value: 'custom', label: '自选性格' },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={filter.natureMode === item.value}
                        onClick={() => setNatureMode(item.value)}
                        data-testid={`nature-mode-${item.value}`}
                        className={`min-h-[28px] rounded-md px-2 text-xs ${
                          filter.natureMode === item.value
                            ? 'bg-white font-medium text-emerald-700 shadow-sm'
                            : 'text-slate-500'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filter.natureMode === 'eight' ? (
                  <p
                    className="mt-1.5 text-[11px] leading-relaxed text-slate-400"
                    data-testid="nature-mode-eight-list"
                  >
                    八大性格：{targetNatureNames.join('、')}
                  </p>
                ) : null}

                {filter.natureMode === 'custom' ? (
                  <div className="mt-2 space-y-1" data-testid="custom-natures">
                    {/* 下拉框（2026-11-19 用户口径）：收起时只占一行摘要，点开才铺
                        六行 × 五列（每行一个属性组，30 个性格全部可选），收起按钮固定在网格上方 */}
                    <button
                      type="button"
                      aria-expanded={customOpen}
                      onClick={() => setCustomOpen((value) => !value)}
                      data-testid="custom-nature-toggle"
                      className="flex min-h-[32px] w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-left"
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-slate-600"
                        data-testid="custom-natures-summary"
                      >
                        {filter.customNatures.length === 0
                          ? '还没选性格'
                          : `已选 ${filter.customNatures.length} 个：${filter.customNatures.join('、')}`}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-emerald-700">
                        {customOpen ? '收起 ▴' : '全部性格 ▾'}
                      </span>
                    </button>

                    {customOpen ? (
                      <div className="space-y-1" data-testid="custom-nature-grid">
                        {CUSTOM_NATURE_ROWS.map(({ stat, names }) => {
                          const allOn = names.every((name) => filter.customNatures.includes(name));
                          return (
                            <div
                              key={stat}
                              className="grid grid-cols-[2.4rem_repeat(5,minmax(0,1fr))] items-stretch gap-1"
                              data-testid={`custom-nature-row-${stat}`}
                            >
                              <button
                                type="button"
                                aria-pressed={allOn}
                                onClick={() => toggleNatureStat(names)}
                                title={`${stat}：整组勾选 / 取消`}
                                data-testid={`custom-nature-stat-${stat}`}
                                className={`min-h-[30px] rounded-md border text-[11px] ${
                                  allOn
                                    ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-500'
                                }`}
                              >
                                {stat}
                              </button>
                              {names.map((name) => {
                                const on = filter.customNatures.includes(name);
                                return (
                                  <button
                                    key={name}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => toggleCustomNature(name)}
                                    data-testid={`custom-nature-${name}`}
                                    className={`min-h-[30px] rounded-md border px-1 text-xs ${
                                      on
                                        ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                                        : 'border-slate-200 bg-white text-slate-400'
                                    }`}
                                  >
                                    {name}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={toggleAllCustomNatures}
                          className="mt-1.5 min-h-[28px] rounded-md border border-slate-200 px-2 text-xs text-slate-600"
                          data-testid="custom-nature-select-all"
                        >
                          {targetNaturePool.every((entry) =>
                            filter.customNatures.includes(entry.name),
                          )
                            ? '全部取消'
                            : '全选八大'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {filter.natureMode === 'custom' && filter.customNatures.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-400" data-testid="custom-natures-empty">
                    先勾选要集齐的性格，蛋组矩阵会按所选性格显示。
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-slate-500">
              覆盖度
              <span className="ml-1 text-xs font-normal text-slate-400" data-testid="coverage-mode">
                · {TARGET_MODE_LABELS[mode]}
              </span>
            </h2>
            <p className="mt-1 text-2xl font-semibold text-slate-900" data-testid="coverage-total">
              已通 {stud.passedGroups} <span className="text-slate-400">/ {stud.groupCount}</span>{' '}
              <span className="text-base font-normal text-slate-400">组</span>
            </p>
            <ul
              className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"
              data-testid="coverage-legend"
            >
              {COVERAGE_LEGEND_ORDER.map((state) => (
                <li key={state} className="flex items-center gap-1">
                  <span
                    className={`inline-block h-3 w-3 rounded-full ${COVERAGE_STATE_CHIP[state]}`}
                    aria-hidden
                  />
                  {COVERAGE_STATE_LABELS[state]}
                </li>
              ))}
            </ul>
          </section>

          {/* 新用户第一次进来给一次极简说明（3 条），点「知道了」后不再出现 */}
          <CoverageIntroCard />

          {/* 种公阵列（2026-10-28，参考蛋神）：蛋组 × 目标性格，档位做 tab；
              卡片标题与副标题去掉（2026-11-19 用户口径：导航已经是「收集 · 种公」），
              下方保留按蛋组缺口明细 */}
          <StudMatrix
            slots={slots}
            owned={owned}
            species={species}
            speciesByGameId={speciesByGameId}
            eggGroupNames={eggGroupNames}
            mode={mode}
            recommendations={recommendations}
            demandGroups={demandGroups}
            demandGroupsLoading={demandGroupsLoading}
            demandGroupsError={demandGroupsError}
            onLoadDemandGroups={loadDemandGroups}
            onPublishStudDemand={publishStudDemand}
            plans={plans}
            accountNames={accounts.filter((name) => !excluded.has(name))}
          />

          <h2 className="px-1 text-sm font-medium text-slate-500">缺口明细（按蛋组）</h2>
          <CoverageMatrix
            stud={stud}
            eggGroupNames={eggGroupNames}
            expandedGroupId={expandedGroupId}
            onToggleGroup={onToggleGroup}
            details={details}
            naturePool={targetNaturePool}
            groupNatures={filter.naturesByGroup}
            onToggleGroupNature={toggleGroupNature}
            natureMode={filter.natureMode}
          />
        </>
      )}

      <CollectionTargetEditor
        open={editorOpen}
        section="studs"
        onClose={() => setEditorOpen(false)}
      />

      <SourceNotice />
    </main>
  );
}
