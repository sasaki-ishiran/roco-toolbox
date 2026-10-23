import { useMemo, useState } from 'react';
import { TARGET_MODE_LABELS, gradeLabel, type TargetMode } from '../domain/petFilters';
import { effectiveMotherVoices, isChainCollected, type MotherCriteria } from '../domain/motherCriteria';
import { findUncataloguedCount, studEmptyNote } from '../domain/suggestions';
import { species } from '../data/catalog';
import { AccountFilterBar } from './AccountFilterBar';
import { ImportAdditionCard } from './ImportAdditionCard';
import { ProgressCard } from './ProgressCard';
import { SuggestionCard } from './SuggestionCard';
import { SourceNotice } from './SourceNotice';
import { CollectionTargetEditor } from './CollectionTargetEditor';
import { ScopeSummary } from './primitives/ScopeSummary';
import { SegmentedControl } from './primitives/SegmentedControl';
import { useOwnedPets } from './useOwnedPets';
import { useCollectionSummary } from './useCollectionSummary';
import { useCoverageFilter } from './coverageFilterStore';
import { useMotherCriteria } from './motherCriteriaStore';
import { setTargetMode } from './targetModeStore';
import type { NavigationIntent } from './navigation';

export interface DashboardProps {
  /** 统一导航入口（2026-10-24）：看板只发意图，不直接改别页状态 */
  onNavigate: (intent: NavigationIntent) => void;
}

/**
 * 看板（2026-10-24 重构任务 8）：回答「我收集到哪了，接下来做什么」。
 *
 * 顺序：账号范围 → 目标短摘要 → 并列进度 → 近期新增 → 少量具体行动。
 * 完整配置（档位/蛋组/性格）与完整明细都在收集页，这里只保留入口。
 */
export function Dashboard({ onNavigate }: DashboardProps) {
  const [targetEditor, setTargetEditor] = useState<{
    open: boolean;
    section: 'studs' | 'mothers';
  }>({ open: false, section: 'studs' });

  const { owned, motherGroups, mode, mother, stud, recommendations } = useCollectionSummary();
  const { accounts } = useOwnedPets();
  const coverageFilter = useCoverageFilter();
  const motherCriteria = useMotherCriteria();

  const gradeText =
    coverageFilter.grades.length > 0
      ? coverageFilter.grades.map((grade) => gradeLabel(grade, mode)).join('、')
      : '未选档位';

  const effectiveCriteria: MotherCriteria = {
    bodies: motherCriteria.bodies,
    voices: effectiveMotherVoices(motherCriteria.voices, mode),
  };
  /** 母本缺口只报**个人事实**；小组未加载时不在看板声称某成员拥有 */
  const missingMothers = useMemo(
    () => motherGroups.filter((group) => !isChainCollected(group, owned, effectiveCriteria)),
    [motherGroups, owned, effectiveCriteria],
  );
  const motherMissingPreview = missingMothers.slice(0, 3);

  const remainingTargets = stud.cells.filter((cell) => cell.state !== 'covered').length;
  const iterableTargets = stud.cells.filter((cell) => cell.state === 'breedable').length;
  const missingTargets = remainingTargets - iterableTargets;
  const firstIterableGroupId =
    stud.cells.find((cell) => cell.state === 'breedable')?.groupId ?? undefined;
  const suggestionEmptyNote = studEmptyNote({ hasData: owned.length > 0, stud });

  const speciesGameIds = useMemo(() => new Set(species.map((entry) => entry.gameId)), []);
  const uncataloguedCount = useMemo(
    () => findUncataloguedCount(owned.map((pet) => pet.gameId), speciesGameIds),
    [owned, speciesGameIds],
  );

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      <AccountFilterBar accounts={accounts} />

      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="target-mode">
        <ScopeSummary
          scope="个人种公目标"
          criteria={`${TARGET_MODE_LABELS[mode]} · ${gradeText}`}
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
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">档位与蛋组在「调整目标」里改</span>
          <button
            type="button"
            onClick={() => setTargetEditor({ open: true, section: 'mothers' })}
            className="min-h-[44px] text-xs font-medium text-emerald-700"
            data-testid="mother-criteria-edit"
          >
            调整母本达标条件 ›
          </button>
        </div>
        {coverageFilter.grades.length === 0 ? (
          <p className="mt-1 text-[11px] text-amber-600" data-testid="target-grade-empty">
            未选目标档位：种公覆盖度与配窝没有槽位；母本按自己的达标条件单独计算，不受影响。
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <ProgressCard
          title="种公全收集"
          numerator={stud.passedGroups}
          denominator={stud.groupCount}
          hint={`${coverageFilter.groupIds.length} 个蛋组 · 组内目标全达标才算通`}
          onClick={() =>
            onNavigate({ type: 'open-collection', location: { kind: 'inventory', view: 'stud' } })
          }
          action="看我的种公"
          actionTestId="progress-card-action-stud"
        />
        <ProgressCard
          title="母本全收集"
          numerator={mother.collected}
          denominator={mother.total}
          hint="已收集 = 有达标母本的蛋；达标条件可自定义"
          onClick={() =>
            onNavigate({ type: 'open-collection', location: { kind: 'mothers', status: 'missing' } })
          }
          action="看我的待补齐母本"
          actionTestId="progress-card-action-mother"
        />
      </div>

      {/* 本次新增：最新一次导入的明细，可收起；历史在「我的 · 游戏数据」 */}
      <ImportAdditionCard />

      {/* 母本行动：只列个人缺口，最多 3 条 + 完整入口 */}
      <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mother-actions">
        <h2 className="text-sm font-medium text-slate-500">母本缺口</h2>
        {motherMissingPreview.length === 0 ? (
          <p className="mt-1 text-sm text-emerald-700">个人母本目标已全部收集。</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {motherMissingPreview.map((group) => (
              <li
                key={group.chainKey}
                className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"
                data-testid="mother-action-item"
              >
                {group.formLabel || '未知精灵'}
                <span className="ml-1 text-[11px] text-slate-400">还没有达标母本</span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() =>
            onNavigate({ type: 'open-collection', location: { kind: 'mothers', status: 'missing' } })
          }
          className="mt-2 min-h-[44px] text-xs font-medium text-emerald-700"
          data-testid="mother-actions-more"
        >
          去收集看母本缺口 ›
        </button>
      </section>

      <SuggestionCard
        title="优质种公推荐"
        items={recommendations}
        emptyNote={suggestionEmptyNote}
        onOpenSwap={() =>
          onNavigate({ type: 'open-collection', location: { kind: 'studs', view: 'eggs' } })
        }
      />

      {/* 配窝：只留汇总与三个入口，完整摆位与配对在「收集 · 种公 · 自己孵」 */}
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
          {remainingTargets > 0 && iterableTargets === 0 ? (
            <p className="mt-1 text-xs text-amber-700" data-testid="nest-no-plan">
              没有能自己孵的方案：缺可配对的母本 / 公本，先去覆盖度看每个缺口的判定。
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() =>
                onNavigate({
                  type: 'open-collection',
                  location:
                    firstIterableGroupId == null
                      ? { kind: 'studs', view: 'coverage' }
                      : { kind: 'studs', view: 'coverage', groupId: firstIterableGroupId },
                })
              }
              data-testid="nest-open-coverage"
              className="min-h-[44px] text-xs font-medium text-emerald-700"
            >
              去看怎么迭代 ›
            </button>
            <button
              type="button"
              onClick={() => onNavigate({ type: 'open-collection', location: { kind: 'studs', view: 'breed' } })}
              data-testid="nest-open-breed"
              className="min-h-[44px] text-xs font-medium text-emerald-700"
            >
              去配窝 ›
            </button>
            <button
              type="button"
              onClick={() => onNavigate({ type: 'open-collection', location: { kind: 'studs', view: 'eggs' } })}
              data-testid="nest-open-swap"
              className="min-h-[44px] text-xs font-medium text-emerald-700"
            >
              去看怎么快速收集 ›
            </button>
          </div>
        </section>
      ) : null}

      {uncataloguedCount > 0 ? (
        <section className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <h2 className="font-medium text-slate-500">图鉴未收录</h2>
          <p className="mt-1">
            {uncataloguedCount} 只精灵的 game_id 暂不在图鉴中，已单独列出、不计入进度分母。
          </p>
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
