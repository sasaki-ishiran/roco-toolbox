import { useMemo, useState } from 'react';
import {
  TARGET_MODE_LABELS,
  gradeLabel,
  type TargetMode,
} from '../domain/petFilters';
import { ALL_GRADES } from '../domain/coverageTargets';
import { findUncataloguedCount, studEmptyNote } from '../domain/suggestions';
import { species } from '../data/catalog';
import { AccountFilterBar } from './AccountFilterBar';
import { ImportAdditionCard } from './ImportAdditionCard';
import { MotherGradeInventory } from './MotherGradeInventory';
import { NestPlanCard } from './NestPlanCard';
import { ProgressCard } from './ProgressCard';
import { SuggestionCard } from './SuggestionCard';
import { SourceNotice } from './SourceNotice';
import { CollectionTargetEditor } from './CollectionTargetEditor';
import { ScopeSummary } from './primitives/ScopeSummary';
import { SegmentedControl } from './primitives/SegmentedControl';
import { useOwnedPets } from './useOwnedPets';
import { useCollectionSummary } from './useCollectionSummary';
import { toggleFilterGrade, useCoverageFilter } from './coverageFilterStore';
import { setTargetMode } from './targetModeStore';

export interface DashboardProps {
  /** 「种公全收集」卡上的快速入口：跳到「我的精灵 · 种公视角」 */
  onOpenStuds?: () => void;
  /** 「母本全收集」卡上的快速入口：跳到「我的精灵 · 母本视角（待补齐母本）」 */
  onOpenMothers?: () => void;
  /** 优质种公推荐「全部」：跳到「换什么」页看完整求蛋清单 */
  onOpenSwap?: () => void;
  /** 配窝汇总的入口：跳到「覆盖度」页看每个目标怎么迭代（带上第一个可迭代的蛋组，跳过去自动展开） */
  onOpenCoverage?: (groupId?: number) => void;
}

export function Dashboard({ onOpenStuds, onOpenMothers, onOpenSwap, onOpenCoverage }: DashboardProps = {}) {
  // 唯一目标编辑器：种公 / 母本两个分区
  const [targetEditor, setTargetEditor] = useState<{
    open: boolean;
    section: 'studs' | 'mothers';
  }>({ open: false, section: 'studs' });

  // 摘要全部来自 useCollectionSummary（与收集详情同一份领域计算）
  const {
    owned,
    motherGroups,
    mode,
    mother,
    stud,
    plans: breedPlan,
    recommendations: suggestions,
  } = useCollectionSummary();
  const { accounts } = useOwnedPets();
  const coverageFilter = useCoverageFilter();
  // 配窝汇总（明细在卡片里）：还差多少目标，以及分别属于哪种状态
  const remainingTargets = stud.cells.filter((cell) => cell.state !== 'covered').length;
  // 「可迭代」= 手里就有能孵出它的那对（学院小窝放带目标性格的那只），自己孵就行
  const iterableTargets = stud.cells.filter((cell) => cell.state === 'breedable').length;
  // 「有母本·缺公」不再单列，和"完全没人"一起算未收集（都是得去弄一只）
  const missingTargets = remainingTargets - iterableTargets;
  // 第一个「可迭代」的蛋组：点「去看怎么迭代」时把它带过去自动展开（不然用户得在 14 行里找）
  const firstIterableGroupId =
    stud.cells.find((cell) => cell.state === 'breedable')?.groupId ?? undefined;
  /**
   * 空清单提示语（2026-10-24 修）：以前卡片写死「导入抓包数据后给出建议」，
   * 种公已收齐的人看到会以为数据没导进来；配窝也同样不能让他去「补缺口」。
   */
  const suggestionEmptyNote = studEmptyNote({ hasData: owned.length > 0, stud });
  const nestEmptyNote =
    stud.groupCount === 0
      ? suggestionEmptyNote
      : remainingTargets === 0
        ? '种公目标已全部收集，不用再配窝'
        : undefined;

  const speciesGameIds = useMemo(() => new Set(species.map((s) => s.gameId)), []);
  const uncataloguedCount = useMemo(
    () => findUncataloguedCount(owned.map((p) => p.gameId), speciesGameIds),
    [owned, speciesGameIds],
  );

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      <AccountFilterBar accounts={accounts} />

      {/* 本次新增：最新一次导入的明细，可收起；历史在「导入数据」页（2026-10-05 拍板） */}
      <ImportAdditionCard />

      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="target-mode">
        <ScopeSummary
          scope="个人种公目标"
          criteria="看板 / 覆盖度 / 母本 / 配窝共用这一份"
          onEdit={() => setTargetEditor({ open: true, section: 'studs' })}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">当前模式</span>
          <SegmentedControl
            label="目标模式"
            value={mode}
            options={(['perfect', 'medal'] as TargetMode[]).map((value) => ({
              value,
              label: TARGET_MODE_LABELS[value],
            }))}
            onValueChange={(next) => setTargetMode(next as TargetMode)}
            optionTestId={(value) => `target-mode-${value}`}
            className="w-[176px] shrink-0"
          />
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          追满分 = ±100dB 才算；追双牌 = 有体重+声音双牌就算。
        </p>
        {/* 目标档位是**全局口径**（2026-10-06 用户拍板）：看板 / 覆盖度 / 母本 / 配窝都按它算，
            所以入口只在看板，覆盖度页只显示当前值 */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2">
          <span className="text-xs text-slate-400">目标档位</span>
          {ALL_GRADES.map((grade) => (
            <button
              key={grade}
              type="button"
              aria-pressed={coverageFilter.grades.includes(grade)}
              onClick={() => toggleFilterGrade(grade)}
              data-testid={`target-grade-${grade}`}
              className={`min-h-[30px] rounded-full border px-2.5 text-xs ${
                coverageFilter.grades.includes(grade)
                  ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              {gradeLabel(grade, mode)}
            </button>
          ))}
        </div>
        {coverageFilter.grades.length === 0 ? (
          <p className="mt-1 text-[11px] text-amber-600" data-testid="target-grade-empty">
            至少勾一个档位，否则种公覆盖度与配窝没有目标槽位；母本按自己的达标条件单独计算，不受影响。
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <ProgressCard
          title="种公全收集"
          numerator={stud.passedGroups}
          denominator={stud.groupCount}
          hint={`${coverageFilter.groupIds.length} 个蛋组 · 组内目标全达标才算通`}
          onClick={onOpenStuds}
          action="看我的种公"
          actionTestId="progress-card-action-stud"
        />
        <ProgressCard
          title="母本全收集"
          numerator={mother.collected}
          denominator={mother.total}
          hint="已收集 = 有达标母本的蛋；达标条件可自定义，下方清单可切档位"
          onClick={onOpenMothers}
          action="看我的待补齐母本"
          actionTestId="progress-card-action-mother"
        />
      </div>

      {/* 按代表母本档位查看：完整库存迁到收集页，看板保留入口（任务 8 再精简） */}
      <MotherGradeInventory motherGroups={motherGroups} owned={owned} mode={mode} />
      <button
        type="button"
        onClick={() => setTargetEditor({ open: true, section: 'mothers' })}
        className="min-h-[44px] text-xs font-medium text-emerald-700"
        data-testid="mother-criteria-edit"
      >
        调整个人母本达标条件 ›
      </button>

      {uncataloguedCount > 0 ? (
        <section className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <h2 className="font-medium text-slate-500">图鉴未收录</h2>
          <p className="mt-1">
            {uncataloguedCount} 只精灵的 game_id 暂不在图鉴中，已单独列出、不计入进度分母。
          </p>
        </section>
      ) : null}

      <SuggestionCard
        title="优质种公推荐"
        items={suggestions}
        emptyNote={suggestionEmptyNote}
        onOpenSwap={onOpenSwap}
      />

      {/* 配窝：给「谁和谁配」的建议（不再列候选配对）。
          缺什么/怎么迭代在「覆盖度」页看，要去弄什么在「换什么」页看。 */}
      {owned.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="nest-summary">
          <h2 className="text-sm font-medium text-slate-500">配窝建议</h2>
          <p className="mt-1 text-sm text-slate-600" data-testid="nest-summary-line">
            {remainingTargets === 0 ? (
              '种公目标已全部收集，没有要补的缺口。'
            ) : (
              <>
                还差 {remainingTargets} 个目标：
                <br />
                能自己迭代 {iterableTargets} · 未收集 {missingTargets}
              </>
            )}
          </p>
          {/* 两个入口跟在汇总行下面，不加大间距，按正常行距排（2026-10-06 用户拍板） */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onOpenCoverage?.(firstIterableGroupId)}
              data-testid="nest-open-coverage"
              className="text-xs font-medium text-emerald-700"
            >
              去看怎么迭代 ›
            </button>
            <button
              type="button"
              onClick={onOpenSwap}
              data-testid="nest-open-swap"
              className="text-xs font-medium text-emerald-700"
            >
              去看怎么快速收集 ›
            </button>
          </div>
          <NestPlanCard plans={breedPlan} emptyNote={nestEmptyNote} />
        </section>
      ) : null}

      <CollectionTargetEditor
        open={targetEditor.open}
        section={targetEditor.section}
        onClose={() => setTargetEditor((state) => ({ ...state, open: false }))}
      />

      <SourceNotice />
    </main>
  );
}