import { useMemo, useState } from 'react';
import { TARGET_MODE_LABELS, type TargetMode } from '../domain/petFilters';
import { isChainCollected } from '../domain/motherCriteria';
import { findUncataloguedCount, studEmptyNote } from '../domain/suggestions';
import { eggGroupNames, species } from '../data/catalog';
import { ImportAdditionCard } from './ImportAdditionCard';
import { ProgressCard } from './ProgressCard';
import { SuggestionCard } from './SuggestionCard';
import { NestPlanCard } from './NestPlanCard';
import { findMotherGapFill, findStudGapFill, type GapFill } from '../domain/gapFill';
import { GapFillDialog, type GapTargetView } from './GapFillDialog';
import { toggleMotherPlan } from './motherPlanStore';
import { useMotherSuggestions } from './useMotherSuggestions';
import { PetAvatar } from './PetAvatar';
import { PetCardLayout } from './PetCardLayout';
import { SourceNotice } from './SourceNotice';
import { SegmentedControl } from './primitives/SegmentedControl';
import { useOwnedPets } from './useOwnedPets';
import { useCollectionSummary } from './useCollectionSummary';
import { setTargetGrade, useCoverageFilter } from './coverageFilterStore';
import { setTargetMode } from './targetModeStore';
import { toggleAccount, toggleAllAccounts, useAccountFilter } from './accountFilterStore';
import { useStudTransferTasks } from './studTransferTaskStore';
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
  /**
   * 「母本缺口怎么补」悬浮窗（2026-11-19 用户口径）：点缺口卡打开，
   * 内容是目标卡 + 小组求助卡 + 本号直配 / 跨号传蛋两段。
   */
  const [gapDialog, setGapDialog] = useState<{
    chainKey: string;
    eyebrow: string;
    target: GapTargetView;
    fill: GapFill;
    /** 只有母本缺口能把这条链加入「计划收集」；种公推荐没有对应的落库动作 */
    canAddToPlan: boolean;
  } | null>(null);

  const { owned, motherGroups, mode, stud, coverageByAccount, plans, recommendations } =
    useCollectionSummary();
  const { accounts } = useOwnedPets();
  const { excluded } = useAccountFilter();
  const selectedAccountNames = accounts.filter((name) => !excluded.has(name));
  const selectedAccountCount = selectedAccountNames.length;
  const noSelectedAccounts = accounts.length > 0 && selectedAccountCount === 0;
  const coverageFilter = useCoverageFilter();
  /**
   * 目标条件、母本建议与目标卡文案都和收集页共用一份（2026-11-19）：
   * 同一个缺口在看板与收集页给的概率必须一致。
   */
  const {
    selectedGrade,
    effectiveCriteria,
    naturesOf,
    suggestions: motherSuggestions,
    targetLabel: gapTargetLabel,
    bodyMedal: gapTargetBody,
    voiceTarget: gapTargetVoiceTarget,
    voiceDb: gapTargetVoiceDb,
    weightPercent: gapTargetWeight,
  } = useMotherSuggestions({ owned, mode, coverageByAccount, plans });
  /** 种公阵列里手动加入的跨号补种公任务（2026-11-03） */
  const transferTasks = useStudTransferTasks();
  /** 母本缺口只报**个人事实**；小组未加载时不在看板声称某成员拥有 */
  const missingMothers = useMemo(
    () => motherGroups.filter((group) => !isChainCollected(group, owned, effectiveCriteria, naturesOf)),
    [motherGroups, owned, effectiveCriteria, naturesOf],
  );
  const collectedMothers = motherGroups.length - missingMothers.length;

  /**
   * 缺口按号各算（2026-11-18 修正）：种公是成体、不能传，合并所有号算出来的「还差几个」
   * 会把别的号的种公误算成本号的进度，数字偏小。看板按每个号自己的覆盖度报缺口。
   */
  const gapsByAccount = useMemo(
    () =>
      selectedAccountNames.map((name) => {
        const coverage = coverageByAccount.get(name);
        const remaining = (coverage?.cells ?? []).filter((cell) => cell.state !== 'covered');
        return {
          account: name,
          gap: remaining.length,
          iterable: remaining.filter((cell) => cell.state === 'breedable').length,
          known: coverage != null,
        };
      }),
    [selectedAccountNames, coverageByAccount],
  );
  const gapTotal = gapsByAccount.reduce((sum, item) => sum + item.gap, 0);
  const allGapsKnown = gapsByAccount.every((item) => item.known);
  /** 单号直接报数；多号逐个写「甲 4 · 乙 7」，不把几个号加成一个总数 */
  const gapOfSingleAccount = gapsByAccount.length === 1 ? gapsByAccount[0] : null;
  const gapsByAccountMap = useMemo(
    () => new Map(gapsByAccount.map((item) => [item.account, item.gap])),
    [gapsByAccount],
  );
  /** 每个号已经收齐的蛋组：配窝卡里的蛋组标签标绿（2026-11-18 用户口径） */
  const collectedGroupsByAccount = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const [account, coverage] of coverageByAccount) {
      const collected = new Set<number>();
      for (const row of coverage.groupSummary) {
        if (row.total > 0 && row.covered === row.total) collected.add(row.groupId);
      }
      map.set(account, collected);
    }
    return map;
  }, [coverageByAccount]);
  /** 补全计划汇总（2026-11-18）：双组条数 + 母本建议 + 跨号传蛋待办（档位已在卡片上用概率表示） */
  const planPills = useMemo(() => {
    const pairings = plans.flatMap((plan) => plan.pairings);
    return {
      dual: pairings.filter((pairing) => pairing.groupIds.length >= 2).length,
      transfers: transferTasks.length,
      /** 母本建议条数（本号内 + 跨号 + 求助），与配窝卡里的母本段一致 */
      mother: [...motherSuggestions.values()].reduce(
        (sum, account) =>
          sum + account.pairings.length + account.tasks.length + account.helps.length,
        0,
      ),
    };
  }, [plans, transferTasks, motherSuggestions]);
  const nestEmptyNote =
    stud.groupCount === 0
      ? '未设置种公目标，请先调整体型、声音目标、蛋组和性格。'
      : gapTotal === 0 && allGapsKnown
        ? '种公目标已全部收集，没有要补的缺口。'
        : '没有能自己孵的方案：缺可配对的母本 / 公本，先去覆盖度看每个缺口的判定。';
  const suggestionEmptyNote = noSelectedAccounts
    ? '当前未选中任何账号，请先选择账号后查看建议。'
    : studEmptyNote({ hasData: accounts.length > 0, stud });

  const speciesGameIds = useMemo(() => new Set(species.map((entry) => entry.gameId)), []);
  const speciesByGameId = useMemo(() => new Map(species.map((entry) => [entry.gameId, entry])), []);
  const uncataloguedCount = useMemo(
    () => findUncataloguedCount(owned.map((pet) => pet.gameId), speciesGameIds),
    [owned, speciesGameIds],
  );

  return (
    <main className="mx-auto max-w-md space-y-2 p-3">
      {noSelectedAccounts ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800" data-testid="dashboard-empty-accounts">
          当前未选中任何账号，请在下方「账号」里选择。
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
            onSelect={(grade) => setTargetGrade(selectedGrade === grade ? null : grade)}
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
                      title={`${name} · ${natureLabel} · 点卡片看怎么补`}
                      size="gap"
                      fitName
                      avatar={<PetAvatar gameId={group.eggGameId} name={name} size={52} />}
                      onClick={() =>
                        setGapDialog({
                          chainKey: group.chainKey,
                          eyebrow: '母本缺口 · 怎么补',
                          canAddToPlan: true,
                          target: {
                            kind: 'mother',
                            name,
                            number: group.number,
                            gameId: group.eggGameId,
                            natures: natures.length > 0 ? natures : ['暂无推荐性格'],
                            eggGroupLabels:
                              eggGroups.length > 0 ? eggGroups : ['未分组'],
                            tag: '未收集',
                            targetLabel: gapTargetLabel,
                            bodyMedal: gapTargetBody,
                            voiceTarget: gapTargetVoiceTarget,
                            voiceDb: gapTargetVoiceDb,
                            weightPercent: gapTargetWeight,
                          },
                          fill: findMotherGapFill(
                            group.eggGameId,
                            motherSuggestions,
                            selectedAccountNames,
                          ),
                        })
                      }
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
          onOpenGap={(group) => {
            // 一张推荐卡 = 一只精灵（可能带多个性格 / 蛋组）：按第一条推荐定位到具体那一格
            const first = group.records[0];
            const groupId = first.groupIds[0];
            setGapDialog({
              chainKey: `stud:${group.gameId}`,
              eyebrow: '种公推荐 · 怎么补',
              canAddToPlan: false,
              target: {
                kind: 'stud',
                name: group.displayName,
                number: speciesByGameId.get(group.gameId)?.number,
                gameId: group.gameId,
                natures: group.natureNames,
                eggGroupLabels: group.groupLabels,
                tag: '推荐',
                targetLabel: gapTargetLabel,
                bodyMedal: gapTargetBody,
                voiceTarget: gapTargetVoiceTarget,
                voiceDb: gapTargetVoiceDb,
                weightPercent: gapTargetWeight,
              },
              fill:
                groupId == null
                  ? { self: null, transfer: null, helpChance: null }
                  : findStudGapFill(
                      { groupId, natureName: first.natureName, grade: first.grade },
                      plans,
                      selectedAccountNames,
                    ),
            });
          }}
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
          <h2 className="text-sm font-medium text-slate-500">补全计划</h2>
          <p className="mt-1 text-sm text-slate-600" data-testid="nest-summary-line">
            {stud.groupCount === 0 ? (
              '未设置种公目标，请先调整体型、声音目标、蛋组和性格。'
            ) : gapTotal === 0 && allGapsKnown ? (
              '种公目标已全部收集，没有要补的缺口。'
            ) : gapsByAccount.length > 1 ? (
              <>
                每个号各差种公目标：
                <br />
                {gapsByAccount.map((item, index) => (
                  <span key={item.account} data-testid="nest-gap-account">
                    {index > 0 ? <span className="text-slate-300"> · </span> : null}
                    <span className="text-slate-700">{item.account}</span>{' '}
                    <b className={item.gap > 0 ? 'text-rose-600' : 'text-emerald-700'}>
                      {item.known ? item.gap : '—'}
                    </b>
                  </span>
                ))}
              </>
            ) : (
              <>
                还差 {gapTotal} 个种公目标：
                <br />
                能自己迭代 {gapOfSingleAccount?.iterable ?? 0} · 未收集{' '}
                {gapTotal - (gapOfSingleAccount?.iterable ?? 0)}
              </>
            )}
          </p>
          {planPills.dual + planPills.mother + planPills.transfers > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="nest-plan-pills">
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
                双组 <b>{planPills.dual}</b>
              </span>
              {planPills.mother > 0 ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                  母本 <b>{planPills.mother}</b>
                </span>
              ) : null}
              {planPills.transfers > 0 ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                  需传蛋 <b>{planPills.transfers}</b>
                </span>
              ) : null}
            </div>
          ) : null}
          <NestPlanCard
            plans={plans}
            emptyNote={nestEmptyNote}
            gapsByAccount={gapsByAccountMap}
            collectedGroupIdsByAccount={collectedGroupsByAccount}
            motherSuggestions={motherSuggestions}
            onSeekHelp={() => onNavigate({ type: 'open-groups', groupType: 'mother' })}
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

      <GapFillDialog
        target={gapDialog?.target ?? null}
        fill={gapDialog?.fill ?? null}
        onClose={() => setGapDialog(null)}
        eyebrow={gapDialog?.eyebrow}
        targetReady={selectedGrade != null}
        onSeekHelp={() => {
          setGapDialog(null);
          onNavigate({ type: 'open-groups', groupType: 'mother' });
        }}
        onAddToPlan={
          gapDialog?.canAddToPlan
            ? () => {
                toggleMotherPlan(gapDialog.chainKey);
                setGapDialog(null);
              }
            : undefined
        }
      />
    </main>
  );
}
