import { useMemo, useState, type ReactNode } from 'react';
import type { OwnedPet } from '../domain/types';
import { buildNestPlans } from '../domain/nestPlan';
import {
  MOTHER_CLASS_ORDER,
  TARGET_MODE_LABELS,
  classifyMother,
  gradeLabel,
  groupMothersByEgg,
  type MotherGroup,
  type MotherClass,
  type PetGrade,
  type TargetMode,
} from '../domain/petFilters';
import { ALL_GRADES } from '../domain/coverageTargets';
import { boxLabel } from '../domain/coverageDetail';
import {
  countQualifiedMotherChains,
  effectiveMotherVoices,
} from '../domain/motherCriteria';
import { computeStudCoverage } from '../domain/studCoverage';
import { computeStudRecommendations, findUncataloguedCount } from '../domain/suggestions';
import { speciesDisplayName } from '../domain/speciesName';
import { eggGroupNames, species } from '../data/catalog';
import { AccountFilterBar } from './AccountFilterBar';
import { AccountSection } from './AccountSection';
import { GenderMark } from './GenderMark';
import { ImportAdditionCard } from './ImportAdditionCard';
import { NestPlanCard } from './NestPlanCard';
import { ProgressCard } from './ProgressCard';
import { SuggestionCard } from './SuggestionCard';
import { SourceNotice } from './SourceNotice';
import { useOwnedPets } from './useOwnedPets';
import { useSwapWishes } from './useSwapWishes';
import { useCoverageSlots } from './useCoverageSlots';
import { toggleFilterGrade, useCoverageFilter } from './coverageFilterStore';
import { useMotherCriteria } from './motherCriteriaStore';
import { setTargetMode, useTargetMode } from './targetModeStore';

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
  // 母本全收集按档位分开看，默认主流目标「大婉」（追满分时显示为「满分大婉」）
  const [motherGrade, setMotherGrade] = useState<PetGrade>('大婉');
  // 全局目标模式：追满分 / 追双牌，看板上的开关写它，所有页面读它
  const mode = useTargetMode();
  // 母本列表默认收起（2026-10-04 优化：方便同时看上面的收集进度和下面的建议）
  const [motherListOpen, setMotherListOpen] = useState(false);
  // 档位下拉栏展开态（不用原生 <select>：手机上会弹系统选择器窗口，用户要的是页内展开的下拉栏）
  const [gradeMenuOpen, setGradeMenuOpen] = useState(false);

  const { owned, accounts } = useOwnedPets();
  const speciesByGameId = useMemo(() => new Map(species.map((entry) => [entry.gameId, entry])), []);
  // 母本清单的「蛋」全集。卡片的**分子与分母都从这里出**（2026-10-07 收敛）：
  // 以前分母来自另一套实现（computeMotherCoverage），两套口径各算一遍、
  // 只改一边就会让卡片分数与点进去的清单对不上。
  const motherGroups = useMemo(
    () => groupMothersByEgg(owned, speciesByGameId, species, mode),
    [owned, speciesByGameId, mode],
  );
  const motherClassCounts = useMemo(() => {
    const counts = new Map<MotherClass, number>();
    for (const group of motherGroups) {
      if (!group.motherClass) continue;
      counts.set(group.motherClass, (counts.get(group.motherClass) ?? 0) + 1);
    }
    return counts;
  }, [motherGroups]);
  const filteredMotherChains = useMemo(
    () => motherGroups.filter((group) => group.motherClass === motherGrade),
    [motherGroups, motherGrade],
  );
  const motherCriteria = useMotherCriteria();
  /**
   * 「已收集的蛋数」——与「我的精灵 · 母本」页**同一口径**（2026-10-06 修）：
   * 以前这张卡按单一档位算（满分大婉 12/142），点进去母本页按达标条件算（已收集 60/142），
   * 数字对不上，用户会以为工具算错。现在两处共用 `domain/motherCriteria`。
   */
  const collectedMotherChains = useMemo(
    () =>
      countQualifiedMotherChains(motherGroups, owned, {
        bodies: motherCriteria.bodies,
        voices: effectiveMotherVoices(motherCriteria.voices, mode),
      }),
    [motherGroups, owned, motherCriteria, mode],
  );
  /** 每条链的代表母本：优先取与该链档位一致的那只，否则取母的（2026-10-05 母本按账号聚拢） */
  const representativeMotherOf = (group: MotherGroup): OwnedPet | undefined => {
    const motherIndex =
      group.memberIndexes.find((index) => classifyMother(owned[index], mode) === group.motherClass) ??
      group.memberIndexes.find((index) => owned[index].gender === '母');
    return motherIndex === undefined ? undefined : owned[motherIndex];
  };
  /** 母本列表按「代表母本所在账号」聚拢，账号名做分组标题（2026-10-05 拍板） */
  const groupedMotherByAccount = useMemo(() => {
    const map = new Map<string, { group: MotherGroup; mother: OwnedPet | undefined }[]>();
    for (const group of filteredMotherChains) {
      const account = representativeMotherOf(group)?.account ?? '未知账号';
      const list = map.get(account) ?? [];
      list.push({ group, mother: representativeMotherOf(group) });
      map.set(account, list);
    }
    return [...map.entries()].map(([account, chains]) => ({ account, chains }));
  }, [filteredMotherChains, owned, mode]);
  const renderMotherRow = ({
    group,
    mother,
  }: {
    group: MotherGroup;
    mother: OwnedPet | undefined;
  }): ReactNode => (
    <li
      key={group.chainKey}
      className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
      data-testid="mother-filter-row"
    >
      {mother ? (
        <>
          {speciesDisplayName(speciesByGameId.get(mother.gameId), mother.name)}{' '}
          <GenderMark gender={mother.gender} />（{boxLabel(mother)}）
        </>
      ) : (
        group.formLabel || '未知精灵'
      )}
    </li>
  );
  const slots = useCoverageSlots();
  const coverageFilter = useCoverageFilter();
  const stud = useMemo(
    () => computeStudCoverage(slots, species, owned, eggGroupNames, mode),
    [owned, slots, mode],
  );

  const wishes = useSwapWishes(stud, owned);
  const suggestions = useMemo(() => computeStudRecommendations(wishes), [wishes]);
  // 配窝汇总（明细在卡片里）：还差多少目标，以及分别属于哪种状态
  const remainingTargets = stud.cells.filter((cell) => cell.state !== 'covered').length;
  // 「可迭代」= 手里就有能孵出它的那对（学院小窝放带目标性格的那只），自己孵就行
  const iterableTargets = stud.cells.filter((cell) => cell.state === 'breedable').length;
  // 「有母本·缺公」不再单列，和"完全没人"一起算未收集（都是得去弄一只）
  const missingTargets = remainingTargets - iterableTargets;
  // 第一个「可迭代」的蛋组：点「去看怎么迭代」时把它带过去自动展开（不然用户得在 14 行里找）
  const firstIterableGroupId =
    stud.cells.find((cell) => cell.state === 'breedable')?.groupId ?? undefined;
  const breedPlan = useMemo(
    () => buildNestPlans({ species, owned, coverage: stud, mode }),
    [owned, stud, mode],
  );

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
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">当前模式</span>
          <div className="flex gap-1 rounded-full bg-slate-100 p-0.5" role="group" aria-label="目标模式">
            {(['perfect', 'medal'] as TargetMode[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setTargetMode(value)}
                data-testid={`target-mode-${value}`}
                className={`min-h-[28px] rounded-full px-2.5 text-xs ${
                  mode === value
                    ? 'bg-white font-medium text-emerald-700 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {TARGET_MODE_LABELS[value]}
              </button>
            ))}
          </div>
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
            至少勾一个档位，否则没有目标槽位（覆盖度、母本、配窝都会是空的）。
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
          numerator={collectedMotherChains}
          denominator={motherGroups.length}
          hint="已收集 = 有达标母本的蛋；达标条件可自定义，下方清单可切档位"
          onClick={onOpenMothers}
          action="看我的待补齐母本"
          actionTestId="progress-card-action-mother"
        />
      </div>

      <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mother-filter">
        <div className="flex items-center justify-between gap-2">
          {/* 「按档位筛选」几个字的位置就是下拉栏本体的触发按钮（2026-10-05 用户拍板：
              页内展开的下拉栏，不是原生 select——手机原生弹出的是系统弹窗） */}
          <h2 className="flex min-w-0 items-center gap-1 text-sm font-medium text-slate-500" data-testid="mother-filter-title">
            <span className="shrink-0">母本全收集 </span>
            <span className="relative">
              <button
                type="button"
                aria-expanded={gradeMenuOpen}
                onClick={() => setGradeMenuOpen((prev) => !prev)}
                data-testid="mother-grade-select"
                className="min-h-[30px] min-w-[96px] rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-normal text-slate-600"
              >
                {gradeLabel(motherGrade, mode)} ({motherClassCounts.get(motherGrade) ?? 0}){' '}
                {gradeMenuOpen ? '▲' : '▼'}
              </button>
              {gradeMenuOpen ? (
                <div
                  className="absolute left-0 top-full z-20 mt-1 w-max min-w-[128px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                  data-testid="mother-grade-options"
                >
                  {MOTHER_CLASS_ORDER.filter((motherClass) => motherClass !== '其他').map((motherClass) => (
                    <button
                      key={motherClass}
                      type="button"
                      onClick={() => {
                        setMotherGrade(motherClass as PetGrade);
                        setMotherListOpen(true);
                        setGradeMenuOpen(false);
                      }}
                      data-testid={`mother-grade-option-${motherClass}`}
                      className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${
                        motherClass === motherGrade
                          ? 'bg-emerald-50 font-medium text-emerald-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {gradeLabel(motherClass as PetGrade, mode)} ({motherClassCounts.get(motherClass) ?? 0})
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
          </h2>
          <button
            type="button"
            aria-expanded={motherListOpen}
            onClick={() => setMotherListOpen((prev) => !prev)}
            className="min-h-[24px] shrink-0 text-xs text-slate-400"
            data-testid="mother-list-toggle"
          >
            {motherListOpen ? '收起' : '展开'}
          </button>
        </div>

        {motherListOpen ? (
          <div className="mt-2 space-y-2" data-testid="mother-filter-result">
            {groupedMotherByAccount.length === 0 ? (
              <p className="text-xs text-slate-400">这个档位暂时没有合格的母本。</p>
            ) : (
              groupedMotherByAccount.map(({ account, chains }) => (
                <AccountSection key={account} account={account}>
                  <ul className="space-y-1">{chains.map(renderMotherRow)}</ul>
                </AccountSection>
              ))
            )}
          </div>
        ) : null}
      </section>

      {uncataloguedCount > 0 ? (
        <section className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <h2 className="font-medium text-slate-500">图鉴未收录</h2>
          <p className="mt-1">
            {uncataloguedCount} 只精灵的 game_id 暂不在图鉴中，已单独列出、不计入进度分母。
          </p>
        </section>
      ) : null}

      <SuggestionCard title="优质种公推荐" items={suggestions} onOpenSwap={onOpenSwap} />

      {/* 配窝：给「谁和谁配」的建议（不再列候选配对）。
          缺什么/怎么迭代在「覆盖度」页看，要去弄什么在「换什么」页看。 */}
      {owned.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="nest-summary">
          <h2 className="text-sm font-medium text-slate-500">配窝建议</h2>
          <p className="mt-1 text-sm text-slate-600" data-testid="nest-summary-line">
            还差 {remainingTargets} 个目标：
            <br />
            能自己迭代 {iterableTargets} · 未收集 {missingTargets}
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
          <NestPlanCard plans={breedPlan} />
        </section>
      ) : null}

      <SourceNotice />
    </main>
  );
}