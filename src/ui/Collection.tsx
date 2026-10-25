import { useMemo, useState } from 'react';
import { buildEggSearchIndex } from '../domain/petFilters';
import { eggGroupNames, species } from '../data/catalog';
import type { CollectionLocation, NavigationIntent } from './navigation';
import { MotherGradeInventory } from './MotherGradeInventory';
import { MyPets } from './MyPets';
import { MotherView } from './MotherView';
import { SegmentedControl } from './primitives/SegmentedControl';
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

const KINDS = [
  { value: 'mothers', label: '母本' },
  { value: 'studs', label: '种公' },
  { value: 'inventory', label: '精灵库' },
];

/**
 * 收集（2026-10-24 重构任务 7）：母本 / 种公 / 精灵库三类目标工具。
 *
 * 目标与缺口来自 useCollectionSummary（与看板同源）；子视图只发导航意图。
 * 精灵库只放真实个体；「按代表档位查看」是明确标注的次视角。
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
          : { kind: 'inventory', view: 'all' };
    onNavigate({ type: 'open-collection', location: target });
  };

  return (
    <>
      <div className="mx-auto max-w-md px-3 pt-2">
        <SegmentedControl
          label="收集视图"
          value={kind}
          options={KINDS}
          onValueChange={(next) => switchKind(next as Kind)}
          optionTestId={(value) => `collection-kind-${value}`}
        />
      </div>

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
          <div className="mx-auto max-w-md space-y-2 px-4 pt-2">
            <SegmentedControl
              label="精灵库视图"
              value={location.view}
              options={[
                { value: 'all', label: '全部' },
                { value: 'stud', label: '合格种公' },
              ]}
              onValueChange={(next) =>
                onNavigate({
                  type: 'open-collection',
                  location: { kind: 'inventory', view: next as 'all' | 'stud' },
                })
              }
              optionTestId={(value) => `inventory-view-${value}`}
            />
            <button
              type="button"
              aria-expanded={showGradeInventory}
              onClick={() => setShowGradeInventory((open) => !open)}
              className="min-h-[28px] text-xs font-medium text-emerald-700"
              data-testid="inventory-grade-toggle"
            >
              按代表档位查看母本{showGradeInventory ? ' ▲' : ' ▼'}
            </button>
          </div>
          {showGradeInventory ? (
            <div className="mx-auto max-w-md px-4 pt-3">
              <MotherGradeInventory motherGroups={motherGroups} owned={owned} mode={mode} />
            </div>
          ) : null}
          <MyPets
            view={location.view}
            hideViewTabs
            onViewChange={(view) => {
              if (view === 'mother') {
                onNavigate({
                  type: 'open-collection',
                  location: { kind: 'mothers', status: 'missing' },
                });
                return;
              }
              onNavigate({ type: 'open-collection', location: { kind: 'inventory', view } });
            }}
            onGoImport={() => onNavigate({ type: 'open-profile', section: 'data' })}
          />
        </>
      )}
    </>
  );
}
