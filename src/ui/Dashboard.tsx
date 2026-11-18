import { useEffect, useMemo, useState } from 'react';
import {
  TARGET_MODE_LABELS,
  type TargetMode,
} from '../domain/petFilters';
import { effectiveMotherVoices, isChainCollected, type MotherCriteria } from '../domain/motherCriteria';
import { findUncataloguedCount, studEmptyNote } from '../domain/suggestions';
import { createNaturesResolver } from '../domain/recommendedNatures';
import { eggGroupNames, species } from '../data/catalog';
import { ImportAdditionCard } from './ImportAdditionCard';
import { ProgressCard } from './ProgressCard';
import { SuggestionCard } from './SuggestionCard';
import { NestPlanCard } from './NestPlanCard';
import { PetAvatar } from './PetAvatar';
import { PetCardLayout } from './PetCardLayout';
import { SourceNotice } from './SourceNotice';
import { SegmentedControl } from './primitives/SegmentedControl';
import { useOwnedPets } from './useOwnedPets';
import { useCollectionSummary } from './useCollectionSummary';
import { setTargetGrade, useCoverageFilter } from './coverageFilterStore';
import { useMotherCriteria } from './motherCriteriaStore';
import { useNatureOverrides } from './natureOverrideStore';
import { setTargetMode } from './targetModeStore';
import { clearAccountFilter, toggleAccount, toggleAllAccounts, useAccountFilter } from './accountFilterStore';
import { removeStudTransferTask, useStudTransferTasks } from './studTransferTaskStore';
import type { NavigationIntent } from './navigation';
import { TargetGradeSelector } from './TargetGradeSelector';

export interface DashboardProps {
  /** 统一导航入口（2026-10-24）：看板只发意图，不直接改别页状态 */
  onNavigate: (intent: NavigationIntent) => void;
}

/**
 * 看板（2026-10-24 重构任务 8）：回答「我收集到哪了，接下来做什么」。
 *
 * 顺序：账号范围 → 目标与进度 → 近期新增 → 推荐与缺口清单。
 * 奖牌目标直接在看板调整；蛋组 / 性格设置保留在目标弹层。
 */
export function Dashboard({ onNavigate }: DashboardProps) {
  const [actionPanel, setActionPanel] = useState<'mothers' | 'studs'>('studs');
  const [accountSelectorOpen, setAccountSelectorOpen] = useState(false);

  const { owned, motherGroups, mode, stud, plans, recommendations } = useCollectionSummary();
  const { accounts } = useOwnedPets();
  const { excluded } = useAccountFilter();
  const selectedAccountNames = accounts.filter((name) => !excluded.has(name));
  const selectedAccountCount = selectedAccountNames.length;
  const noSelectedAccounts = accounts.length > 0 && selectedAccountCount === 0;
  useEffect(() => {
    if (noSelectedAccounts) clearAccountFilter();
  }, [noSelectedAccounts]);
  const coverageFilter = useCoverageFilter();
  const motherCriteria = useMotherCriteria();

  const selectedGrade = coverageFilter.grades[coverageFilter.grades.length - 1] ?? null;

  const effectiveCriteria: MotherCriteria = {
    bodies: motherCriteria.bodies,
    voices: effectiveMotherVoices(motherCriteria.voices, mode),
    grades: selectedGrade ? [selectedGrade] : motherCriteria.grades,
    targetMode: mode,
    recommendedNatures: motherCriteria.recommendedNatures === true,
  };
  const natureOverrides = useNatureOverrides();
  /** 种公阵列里手动加入的跨号补种公任务（2026-11-03） */
  const transferTasks = useStudTransferTasks();
  const naturesOf = useMemo(
    () => createNaturesResolver({ species, overrides: natureOverrides }),
    [natureOverrides],
  );
  /** 母本缺口只报**个人事实**；小组未加载时不在看板声称某成员拥有 */
  const missingMothers = useMemo(
    () => motherGroups.filter((group) => !isChainCollected(group, owned, effectiveCriteria, naturesOf)),
    [motherGroups, owned, effectiveCriteria, naturesOf],
  );
  const collectedMothers = motherGroups.length - missingMothers.length;

  const remainingTargets = stud.cells.filter((cell) => cell.state !== 'covered').length;
  const iterableTargets = stud.cells.filter((cell) => cell.state === 'breedable').length;
  const missingTargets = remainingTargets - iterableTargets;
  const firstIterableGroupId =
    stud.cells.find((cell) => cell.state === 'breedable')?.groupId ?? undefined;
  const nestEmptyNote =
    stud.groupCount === 0
      ? '未设置种公目标，请先调整体型、声音目标、蛋组和性格。'
      : remainingTargets === 0
        ? '种公目标已全部收集，没有要补的缺口。'
        : '没有能自己孵的方案：缺可配对的母本 / 公本，先去覆盖度看每个缺口的判定。';
  const suggestionEmptyNote = noSelectedAccounts
    ? '当前未选中任何账号，请在上方选择账号后查看建议。'
    : studEmptyNote({ hasData: accounts.length > 0, stud });

  const speciesGameIds = useMemo(() => new Set(species.map((entry) => entry.gameId)), []);
  const uncataloguedCount = useMemo(
    () => findUncataloguedCount(owned.map((pet) => pet.gameId), speciesGameIds),
    [owned, speciesGameIds],
  );

  return (
    <main className="mx-auto max-w-md space-y-2 p-3">
      {noSelectedAccounts ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800" data-testid="dashboard-empty-accounts">
          当前未选中任何账号，已恢复为全选。
        </p>
      ) : null}

      <section
        className="rounded-2xl bg-white p-3 shadow-sm"
        data-testid="target-mode"
        data-tour="dashboard-target"
      >
        <div
          className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
          data-testid="dashboard-target-header"
        >
          <span className="text-xs font-medium text-slate-500">账号</span>
          {accounts.length > 0 ? (
            <button
              type="button"
              onClick={() => setAccountSelectorOpen((open) => !open)}
              aria-expanded={accountSelectorOpen}
              aria-controls={accountSelectorOpen ? 'dashboard-account-options' : undefined}
              className={`flex min-h-[32px] min-w-0 w-full items-center gap-1 rounded-lg border px-2 text-xs text-slate-700 shadow-sm hover:border-emerald-300 ${
                accountSelectorOpen ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'
              }`}
              data-testid="dashboard-account-summary"
              title={`${selectedAccountNames.join('、')} (${selectedAccountCount}/${accounts.length})`}
            >
              <span className="flex min-w-0 flex-1 items-center">
                <span
                  className={`truncate ${
                    selectedAccountNames.length > 1 ? 'max-w-[45%] shrink-0' : 'min-w-0 flex-1'
                  }`}
                >
                  {selectedAccountNames[0] ?? '选择账号'}
                </span>
                {selectedAccountNames.length > 1 ? (
                  <span className="min-w-0 flex-1 truncate" title={selectedAccountNames.slice(1).join('、')}>
                    、{selectedAccountNames.slice(1).join('、')}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0">({selectedAccountCount}/{accounts.length})</span>
              <span aria-hidden className="shrink-0 text-[10px] text-slate-400">
                {accountSelectorOpen ? '⌃' : '⌄'}
              </span>
            </button>
          ) : null}
          <SegmentedControl
            label="目标模式"
            value={mode}
            options={(['perfect', 'medal'] as TargetMode[]).map((value) => ({
              value,
              label: TARGET_MODE_LABELS[value],
            }))}
            onValueChange={(next) => setTargetMode(next as TargetMode)}
            optionTestId={(value) => `target-mode-${value}`}
            className="w-[144px] shrink-0"
          />
        </div>
        {accountSelectorOpen && accounts.length > 0 ? (
          <div
            className="mt-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2"
            data-testid="dashboard-account-selector"
            id="dashboard-account-options"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">至少选择一个账号</span>
              {selectedAccountCount < accounts.length ? (
                <button
                  type="button"
                  onClick={() => toggleAllAccounts(accounts)}
                  className="text-[11px] font-medium text-emerald-700"
                  data-testid="dashboard-account-select-all"
                >
                  全选
                </button>
              ) : null}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1" role="group" aria-label="看板账号选择">
              {accounts.map((account) => {
                const selected = !excluded.has(account);
                const isLastSelected = selected && selectedAccountCount === 1;
                return (
                  <button
                    key={account}
                    type="button"
                    aria-pressed={selected}
                    disabled={isLastSelected}
                    title={isLastSelected ? '至少保留一个已选账号' : account}
                    onClick={() => toggleAccount(account)}
                    className={`min-h-[32px] min-w-0 truncate rounded-lg border px-2 text-left text-xs ${
                      selected
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-500'
                    } disabled:cursor-not-allowed`}
                    data-testid={`dashboard-account-${account}`}
                  >
                    {account}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="mt-3 space-y-2" data-testid="dashboard-target-combinations">
          <TargetGradeSelector
            mode={mode}
            selectedGrades={selectedGrade ? [selectedGrade] : []}
            onSelect={setTargetGrade}
            label="目标奖牌组合（公母共用）"
            testIdPrefix="dashboard-target"
          />
          <p className="text-xs text-slate-400" data-testid="dashboard-target-voice-note">
            {mode === 'perfect'
              ? '追满分即满声：婉转声 +100、粗嗓门 -100。'
              : '追双牌按声音奖牌判定：婉转声 ≥96、粗嗓门 ≤-96。'}
          </p>
          <p className="text-xs text-slate-400" data-testid="dashboard-target-body-note">
            大块头对应身高 100%，小不点对应身高 0%。
          </p>
          {coverageFilter.grades.length > 1 ? (
            <p className="text-xs text-amber-700" data-testid="dashboard-target-multiple-note">
              当前有多个组合目标；选择后会收敛为一组。
            </p>
          ) : null}
        </div>
        {coverageFilter.grades.length === 0 ? (
          <p className="mt-1 text-[11px] text-amber-600" data-testid="target-grade-empty">
            未选体型或声音目标：种公覆盖度与配窝没有槽位；母本按自己的达标条件单独计算，不受影响。
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
            onNavigate({ type: 'open-collection', location: { kind: 'studs', view: 'coverage' } })
          }
          actionTestId="progress-card-action-stud"
        />
        <ProgressCard
          title="母本全收集"
          numerator={collectedMothers}
          denominator={motherGroups.length}
          hint="已收集 = 有达标母本的蛋；达标条件可自定义"
          onClick={() =>
            onNavigate({ type: 'open-collection', location: { kind: 'mothers', status: 'missing' } })
          }
          actionTestId="progress-card-action-mother"
        />
      </div>

      {/* 本次新增：最新一次导入的明细，可收起；历史在「我的 · 游戏数据」 */}
      <ImportAdditionCard />

      <div data-testid="dashboard-action-switch">
        <SegmentedControl
          label="看板行动"
          value={actionPanel}
          options={[
            { value: 'studs', label: '种公推荐' },
            { value: 'mothers', label: '母本缺口' },
          ]}
          onValueChange={(value) => setActionPanel(value as 'mothers' | 'studs')}
          optionTestId={(value) => `dashboard-action-${value}`}
          className="w-full"
        />
      </div>

      {actionPanel === 'mothers' ? (
        /* 母本行动：完整列出个人缺口 */
        <section
          className="rounded-2xl bg-white shadow-sm"
          data-testid="mother-actions"
          data-tour="dashboard-actions"
        >
          {missingMothers.length === 0 ? (
            <p className="mt-1 text-sm text-emerald-700">个人母本目标已全部收集。</p>
          ) : (
            <ul className="grid grid-cols-4 gap-1" data-testid="mother-action-items">
              {missingMothers.map((group) => {
                const name = group.formLabel || '未知精灵';
                const natures = naturesOf(group.eggGameId);
                const natureLabel = natures.length > 0 ? natures.join('、') : '暂无推荐性格';
                const eggGroups = group.eggGroups
                  .slice(0, 2)
                  .map((groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`);
                return (
                  <li
                    key={group.chainKey}
                    aria-label={`${name}，推荐性格：${natureLabel}，还没有达标母本`}
                    data-testid="mother-action-item"
                  >
                    <PetCardLayout
                      name={name}
                      number={group.number}
                      eggGroups={eggGroups.length > 0 ? eggGroups : ['未分组']}
                      natures={natures.length > 0 ? natures : ['暂无推荐性格']}
                      naturesTestId="mother-action-nature"
                      title={`${name} · ${natureLabel} · 还没有达标母本`}
                      avatar={<PetAvatar gameId={group.eggGameId} name={name} size={44} />}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() =>
              onNavigate({ type: 'open-collection', location: { kind: 'mothers', status: 'missing' } })
            }
            className="mx-1 mt-2 min-h-[28px] text-xs font-medium text-emerald-700"
            data-testid="mother-actions-more"
          >
            去收集看母本缺口 ›
          </button>
        </section>
      ) : (
        <SuggestionCard
          items={recommendations}
          emptyNote={suggestionEmptyNote}
        />
      )}

      {/* 配窝建议是产品亮点（2026-10-25 用户要求放回看板）：直接展示完整摆位与配对，
          不再只给一个「去配窝」入口；收集页的完整视图仍然保留。 */}
      {owned.length > 0 ? (
        <section
          className="rounded-2xl bg-white p-4 shadow-sm"
          data-testid="nest-summary"
          data-tour="dashboard-nest"
        >
          <h2 className="text-sm font-medium text-slate-500">配窝建议</h2>
          <p className="mt-1 text-sm text-slate-600" data-testid="nest-summary-line">
            {stud.groupCount === 0 ? (
              '未设置种公目标，请先调整体型、声音目标、蛋组和性格。'
            ) : remainingTargets === 0 ? (
              '种公目标已全部收集，没有要补的缺口。'
            ) : (
              <>
                还差 {remainingTargets} 个目标：
                <br />
                能自己迭代 {iterableTargets} · 未收集 {missingTargets}
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
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
              className="min-h-[28px] text-xs font-medium text-emerald-700"
            >
              看缺口 ›
            </button>
            <button
              type="button"
              onClick={() =>
                onNavigate({ type: 'open-collection', location: { kind: 'studs', view: 'eggs' } })
              }
              data-testid="nest-open-swap"
              className="min-h-[28px] text-xs font-medium text-emerald-700"
            >
              看推荐种公 ›
            </button>
          </div>
          <NestPlanCard
            plans={plans}
            emptyNote={nestEmptyNote}
            transferTasks={transferTasks}
            onRemoveTransferTask={removeStudTransferTask}
          />
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

      <SourceNotice />
    </main>
  );
}
