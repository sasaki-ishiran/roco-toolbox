import { useCallback, useMemo, useState } from 'react';
import { listCollectionGroups, publishCollectionDemand } from '../api/collectionGroups';
import { ALL_EGG_GROUP_IDS } from '../domain/coverageTargets';
import { describeCoverageCells } from '../domain/coverageDetail';
import { TARGET_MODE_LABELS } from '../domain/petFilters';
import { eggGroupNames, allNatureNames, species, targetNatureNames, targetNaturePool } from '../data/catalog';
import { AccountFilterBar } from './AccountFilterBar';
import { CollectionTargetEditor } from './CollectionTargetEditor';
import { useOwnedPets } from './useOwnedPets';
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
import { SourceNotice } from './SourceNotice';
import { StudMatrix, type StudDemandPublishInput } from './StudMatrix';
import { useCoverageSlots } from './useCoverageSlots';

export interface CoverageProps {
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
  /** 空数据时「去导入数据」按钮的跳转 */
  onGoImport?: () => void;
}

export function Coverage({ expandedGroupId, onToggleGroup, onGoImport }: CoverageProps = {}) {
  // 与看板同一份摘要（2026-10-24）：覆盖矩阵不再自己算一遍
  const { loaded, owned, mode, stud, recommendations } = useCollectionSummary();
  const { accounts } = useOwnedPets();
  const [editorOpen, setEditorOpen] = useState(false);
  /** 筛选收在种公阵列右上角（2026-10-29 用户要求），默认收起省空间。 */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** 自选性格的「更多」：默认只出八大性格（两排），点开才显示全部（2026-10-30）。 */
  const [customMore, setCustomMore] = useState(false);

  const filter = useCoverageFilter();
  const slots = useCoverageSlots();
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

  const loadDemandGroups = useCallback(() => {
    setDemandGroupsLoading(true);
    setDemandGroupsError('');
    void listCollectionGroups()
      .then((list) => {
        setDemandGroups(
          list
            .filter((group) => group.groupType === 'mother')
            .map((group) => ({ id: group.id, name: group.name })),
        );
      })
      .catch((failure: unknown) => {
        setDemandGroupsError(
          failure instanceof Error ? failure.message : '读取小组失败，请稍后再试',
        );
      })
      .finally(() => setDemandGroupsLoading(false));
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
    <main className="mx-auto max-w-md space-y-3 p-4">
      <AccountFilterBar accounts={accounts} />
      {!loaded ? (
        <p className="text-sm text-slate-400">正在读取本地数据…</p>
      ) : accounts.length === 0 ? (
        <EmptyState onGoImport={onGoImport} />
      ) : (
        <>
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
              筛选收进卡片右上角（2026-10-29 用户要求），下方保留按蛋组缺口明细 */}
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
            filterOpen={filtersOpen}
            onToggleFilter={() => setFiltersOpen((open) => !open)}
            filterActive={
              filter.groupIds.length < ALL_EGG_GROUP_IDS.length || filter.natureMode === 'custom'
            }
            filterPanel={
              <>
                <CoverageFilterBar
                  filter={filter}
                  onToggleGroup={toggleFilterGroup}
                  onReset={resetCoverageFilter}
                  onOpenTargetEditor={() => setEditorOpen(true)}
                />

                {/* 推荐性格 / 自选性格（2026-10-05 用户拍板：加回普通筛选模式） */}
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

                  {filter.natureMode === 'custom' ? (
                    <div className="mt-2" data-testid="custom-natures">
                      {/* 八大性格固定两排（4 列 × 2 行），第 9 格「更多」可展开全部性格（2026-10-30） */}
                      <div className="grid grid-cols-4 gap-1.5">
                        {(customMore ? allNatureNames : targetNatureNames).map((name) => {
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
                        {allNatureNames.length > targetNatureNames.length ? (
                          <button
                            type="button"
                            onClick={() => setCustomMore((value) => !value)}
                            aria-expanded={customMore}
                            data-testid="custom-nature-more"
                            className="min-h-[30px] rounded-md border border-dashed border-slate-300 bg-white px-1 text-xs text-slate-500"
                          >
                            {customMore ? '收起' : `更多 +${allNatureNames.length - targetNatureNames.length}`}
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={toggleAllCustomNatures}
                        className="mt-1.5 min-h-[28px] rounded-md border border-slate-200 px-2 text-xs text-slate-600"
                        data-testid="custom-nature-select-all"
                      >
                        {filter.customNatures.length === targetNaturePool.length
                          ? '全部取消'
                          : '全选'}
                      </button>
                    </div>
                  ) : null}

                  {filter.natureMode === 'custom' && filter.customNatures.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400" data-testid="custom-natures-empty">
                      先勾选要集齐的性格，蛋组矩阵会按所选性格显示。
                    </p>
                  ) : null}
                </div>
              </>
            }
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
