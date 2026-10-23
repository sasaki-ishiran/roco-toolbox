import { useEffect, useMemo, useState } from 'react';
import { computeStudCoverage } from '../domain/studCoverage';
import { TARGET_MODE_LABELS } from '../domain/petFilters';
import { computeStudRecommendations, studEmptyNote } from '../domain/suggestions';
import { eggGroupNames, species } from '../data/catalog';
import { useSnapshots } from './useSnapshots';
import { AccountFilterBar } from './AccountFilterBar';
import { EmptyState } from './EmptyState';
import { FilterAccordion } from './FilterAccordion';
import { SearchField } from './primitives/SearchField';
import { SourceNotice } from './SourceNotice';
import { SwapWishCard } from './SwapWishCard';
import { MotherSharing } from './MotherSharing';
import { useCoverageSlots } from './useCoverageSlots';
import { useOwnedPets } from './useOwnedPets';
import { useSwapWishes } from './useSwapWishes';
import { setSwapFilters, readSwapMainView, saveSwapMainView, useSwapView } from './swapViewStore';
import { useTargetMode } from './targetModeStore';

/** 多选筛选的开关：点一下加进去，再点一下移出来（空 = 不限） */
const toggleIn = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/**
 * 「换什么」：按「换上这只、孵出合格个体后能补上的缺口」排序的换蛋目标清单。
 * 满分只能由双满分父母产出，自己抓 + 迭代远不如直接换蛋，所以这里不再有抓取路线。
 *
 * 2026-10-05 复用优质种公推荐算法：清单直接用 computeStudRecommendations 的输出
 * （性格 = 该精灵自己能换到的性格，进化链最高形态推荐 / 种族值兜底），
 * 与看板同一口径，不再出现「性格与精灵不匹配」。
 */
export function Swap({
  onGoImport,
  onGoAccount,
  view: controlledView,
  onViewChange,
}: {
  onGoImport?: () => void;
  onGoAccount?: () => void;
  /** 兼容桥（任务 1）：主视图由 App 的导航状态驱动；不传时沿用页内状态 */
  view?: 'eggs' | 'sharing';
  onViewChange?: (view: 'eggs' | 'sharing') => void;
} = {}) {
  const { loaded } = useSnapshots();
  const { owned, accounts } = useOwnedPets();

  const slots = useCoverageSlots();
  const mode = useTargetMode();
  const stud = useMemo(
    () => computeStudCoverage(slots, species, owned, eggGroupNames, mode),
    [owned, slots, mode],
  );
  const wishes = useSwapWishes(stud, owned);
  // 换什么页 = 优质种公推荐算法的完整清单（不加数量限制）
  const recommendations = useMemo(() => computeStudRecommendations(wishes), [wishes]);
  const dualCount = recommendations.filter((rec) => rec.groupLabels.length >= 2).length;

  // 筛选（可多选，空 = 不限）+ 搜索：只过滤展示，不动算法。
  // 放模块级 store：切页签回来筛选与勾选不丢（见 swapViewStore）
  const { natureFilter, groupFilter, query } = useSwapView();

  /** 选项只列清单里实际出现的，并带条数（没出现的不给空选项） */
  const natureOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rec of recommendations) {
      counts.set(rec.natureName, (counts.get(rec.natureName) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ value: name, label: `${name} (${count})` }));
  }, [recommendations]);

  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rec of recommendations) {
      for (const label of new Set(rec.groupLabels)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([label, count]) => ({ value: label, label: `${label} (${count})` }));
  }, [recommendations]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return recommendations.filter((rec) => {
      if (natureFilter.length > 0 && !natureFilter.includes(rec.natureName)) return false;
      if (groupFilter.length > 0 && !rec.groupLabels.some((label) => groupFilter.includes(label))) {
        return false;
      }
      if (!keyword) return true;
      const haystack = `${rec.natureName}${rec.displayName}${rec.groupLabels.join('')}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [recommendations, natureFilter, groupFilter, query]);

  // 顶部主分段：换蛋清单（原有算法）/ 母本共享（多人小组）。
  // 主视图跨重启保留（关后台回来还停在母本共享，不会以为小组没了）。
  const [internalView, setInternalView] = useState<'eggs' | 'sharing'>(() => readSwapMainView());
  const view = controlledView ?? internalView;
  const setView = (next: 'eggs' | 'sharing') => {
    setInternalView(next);
    saveSwapMainView(next);
    onViewChange?.(next);
  };

  useEffect(() => {
    saveSwapMainView(view);
  }, [view]);

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
        {(
          [
            ['eggs', '换蛋清单'],
            ['sharing', '母本共享'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            data-testid={`swap-view-${id}`}
            className={`min-h-[34px] flex-1 rounded-lg text-xs ${
              view === id ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'sharing' ? (
        <MotherSharing onGoAccount={onGoAccount} />
      ) : (
        <>
          {/* 账号筛选只影响换蛋清单；母本共享按明确选号，不能被顶部筛选偷偷改变 */}
          <AccountFilterBar accounts={accounts} />
          {!loaded ? (
            <p className="text-sm text-slate-400">正在读取本地数据…</p>
          ) : accounts.length === 0 ? (
            <EmptyState onGoImport={onGoImport} />
          ) : (
            <>
              <section className="rounded-2xl bg-white p-4 shadow-sm">
                <h2 className="text-sm font-medium text-slate-500">
                  换什么
                  <span className="ml-1 text-xs font-normal text-slate-400" data-testid="swap-mode">
                    · {TARGET_MODE_LABELS[mode]}
                  </span>
                </h2>
                <p className="mt-1 text-sm text-slate-600" data-testid="swap-total">
                  共 {recommendations.length} 条 · 其中 {dualCount} 条一只顶两组
                </p>
              </section>

              {/* 搜索在最上，下面是筛选手风琴（性格 / 蛋组）——筛选放在清单卡外面，
                  清空筛选后也不会跟着空状态一起消失 */}
              <SearchField
                label="搜索换蛋目标"
                value={query}
                onValueChange={(value) => setSwapFilters({ query: value })}
                placeholder="搜性格 / 精灵名 / 蛋组"
                testId="swap-search"
              />
              <section className="rounded-xl bg-white p-3 shadow-sm" data-testid="swap-filters">
                <FilterAccordion
                  dimensions={[
                    {
                      id: 'swapNature',
                      label: '性格',
                      options: natureOptions,
                      selected: natureFilter,
                      onToggle: (name) => setSwapFilters({ natureFilter: toggleIn(natureFilter, name) }),
                      onClear: () => setSwapFilters({ natureFilter: [] }),
                    },
                    {
                      id: 'swapGroup',
                      label: '蛋组',
                      options: groupOptions,
                      selected: groupFilter,
                      onToggle: (label) => setSwapFilters({ groupFilter: toggleIn(groupFilter, label) }),
                      onClear: () => setSwapFilters({ groupFilter: [] }),
                    },
                  ]}
                />
              </section>

              <SwapWishCard
                recommendations={filtered}
                emptyNote={
                  recommendations.length === 0
                    ? studEmptyNote({ hasData: accounts.length > 0, stud })
                    : undefined
                }
              />
            </>
          )}
        </>
      )}

      <SourceNotice />
    </main>
  );
}
