import { useMemo, useState } from 'react';
import { buildEggSearchIndex, TARGET_MODE_LABELS } from '../domain/petFilters';
import { eggGroupNames, species } from '../data/catalog';
import type { CollectionLocation, NavigationIntent } from './navigation';
import { MotherGradeInventory } from './MotherGradeInventory';
import { MyPets } from './MyPets';
import { MotherView } from './MotherView';
import { StudCollection } from './StudCollection';
import { useCollectionSummary } from './useCollectionSummary';

export interface CollectionProps {
  location: CollectionLocation;
  focusRevision: number;
  onNavigate: (intent: NavigationIntent) => void;
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
}

type Kind = CollectionLocation['kind'];

/**
 * 三个入口卡（2026-10-29 用户拍板）：每张卡写清「这一页干什么」，
 * 不再用一排分段按钮让人猜「精灵库」和「种公」有什么区别。
 */
const KINDS: Array<{ value: Kind; label: string; hint: string }> = [
  { value: 'inventory', label: '精灵背包', hint: '看全部精灵' },
  { value: 'mothers', label: '母本', hint: '看我的所有母本' },
  { value: 'studs', label: '种公', hint: '挑种公去孵蛋' },
];

/**
 * 收集（2026-10-24 重构任务 7）：精灵背包 / 母本 / 种公三类目标工具。
 *
 * 2026-10-29 简化：精灵背包只放全部精灵（「合格种公」页取消，种公只留种公阵列）；
 * 母本看自己的所有母本；种公挑种公去孵蛋。
 */
export function Collection({
  location,
  onNavigate,
  expandedGroupId,
  onToggleGroup,
}: CollectionProps) {
  const { owned, motherGroups, mode } = useCollectionSummary();
  const [showGradeInventory, setShowGradeInventory] = useState(false);
  const searchIndex = useMemo(() => buildEggSearchIndex(species), []);

  const kind: Kind = location.kind;

  const switchKind = (next: Kind) => {
    const target: CollectionLocation =
      next === 'mothers'
        ? { kind: 'mothers', status: 'missing' }
        : next === 'studs'
          ? { kind: 'studs', view: 'coverage' }
          : { kind: 'inventory' };
    onNavigate({ type: 'open-collection', location: target });
  };

  return (
    <>
      <nav className="mx-auto max-w-md px-3 pt-2" aria-label="收集视图">
        <div className="grid grid-cols-3 gap-1.5" data-testid="collection-kinds">
          {KINDS.map((item) => {
            const active = item.value === kind;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => switchKind(item.value)}
                data-testid={`collection-kind-${item.value}`}
                className={`min-h-[44px] rounded-xl border px-2 py-1.5 text-left shadow-sm ${
                  active
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <span
                  className={`block text-sm font-semibold leading-tight ${
                    active ? 'text-emerald-700' : 'text-slate-700'
                  }`}
                >
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-tight text-slate-400">
                  {item.hint}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {location.kind === 'mothers' ? (
        <main className="mx-auto max-w-md space-y-2 p-3">
          <MotherView
            owned={owned}
            searchIndex={searchIndex}
            eggGroupNames={eggGroupNames}
            motherGroups={motherGroups}
            mode={mode}
            status={location.status}
          />
        </main>
      ) : location.kind === 'studs' ? (
        <StudCollection
          expandedGroupId={expandedGroupId}
          onToggleGroup={onToggleGroup}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          {/* 当前模式与「按代表档位查看母本」并成一行：精灵背包上半部分不再堆四行（2026-10-30） */}
          <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 pt-1">
            <button
              type="button"
              aria-expanded={showGradeInventory}
              onClick={() => setShowGradeInventory((open) => !open)}
              className="min-h-[28px] text-xs font-medium text-emerald-700"
              data-testid="inventory-grade-toggle"
            >
              按代表档位查看母本{showGradeInventory ? ' ▲' : ' ▼'}
            </button>
            <span className="shrink-0 text-[10px] text-slate-400" data-testid="mypets-mode">
              当前模式 · {TARGET_MODE_LABELS[mode]}
            </span>
          </div>
          {showGradeInventory ? (
            <div className="mx-auto max-w-md px-4 pt-2">
              <MotherGradeInventory motherGroups={motherGroups} owned={owned} mode={mode} />
            </div>
          ) : null}
          <MyPets onGoImport={() => onNavigate({ type: 'open-profile', section: 'data' })} />
        </>
      )}
    </>
  );
}
