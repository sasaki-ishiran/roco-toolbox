import { useMemo } from 'react';
import { computeStudCoverage } from '../domain/studCoverage';
import { describeCoverageCells } from '../domain/coverageDetail';
import { TARGET_MODE_LABELS } from '../domain/petFilters';
import { eggGroupNames, species, targetNaturePool } from '../data/catalog';
import { useSnapshots } from './useSnapshots';
import { AccountFilterBar } from './AccountFilterBar';
import { useCoverageSlots } from './useCoverageSlots';
import { useOwnedPets } from './useOwnedPets';
import { useTargetMode } from './targetModeStore';
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
import { GenderRatioSpecies } from './GenderRatioSpecies';
import {
  COVERAGE_LEGEND_ORDER,
  COVERAGE_STATE_CHIP,
  COVERAGE_STATE_LABELS,
  CoverageMatrix,
} from './CoverageMatrix';
import { EmptyState } from './EmptyState';
import { SourceNotice } from './SourceNotice';

export interface CoverageProps {
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
  /** 空数据时「去导入数据」按钮的跳转 */
  onGoImport?: () => void;
}

export function Coverage({ expandedGroupId, onToggleGroup, onGoImport }: CoverageProps = {}) {
  const { loaded } = useSnapshots();
  const { owned, accounts } = useOwnedPets();

  const filter = useCoverageFilter();
  const slots = useCoverageSlots();
  const mode = useTargetMode();
  const stud = useMemo(
    () => computeStudCoverage(slots, species, owned, eggGroupNames, mode),
    [owned, slots, mode],
  );
  const details = useMemo(
    () => describeCoverageCells({ cells: stud.cells, species, owned, mode }),
    [stud, owned, mode],
  );

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

          <CoverageFilterBar
            filter={filter}
            onToggleGroup={toggleFilterGroup}
            onReset={resetCoverageFilter}
          />

          {/* 推荐性格 / 自选性格（2026-10-05 用户拍板：加回普通筛选模式） */}
          <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="nature-mode">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">性格</span>
              <div className="flex gap-1 rounded-full bg-slate-100 p-0.5" role="group" aria-label="性格模式">
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
                    className={`min-h-[28px] rounded-full px-2.5 text-xs ${
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
                <div className="flex flex-wrap gap-1.5">
                  {targetNaturePool.map((nature) => {
                    const on = filter.customNatures.includes(nature.name);
                    return (
                      <button
                        key={nature.name}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleCustomNature(nature.name)}
                        data-testid={`custom-nature-${nature.name}`}
                        className={`min-h-[28px] rounded-full border px-2 text-xs ${
                          on
                            ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-400'
                        }`}
                      >
                        {nature.name}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={toggleAllCustomNatures}
                  className="mt-1.5 min-h-[28px] rounded-full border border-slate-200 px-3 text-xs text-slate-600"
                  data-testid="custom-nature-select-all"
                >
                  {filter.customNatures.length === targetNaturePool.length ? '全部取消' : '全选'}
                </button>
              </div>
            ) : null}
          </section>

          {filter.natureMode === 'custom' && filter.customNatures.length === 0 ? (
            <p className="text-xs text-slate-400" data-testid="custom-natures-empty">
              先勾选要集齐的性格，蛋组矩阵会按所选性格显示。
            </p>
          ) : null}

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

          <GenderRatioSpecies owned={owned} />
        </>
      )}

      <SourceNotice />
    </main>
  );
}
