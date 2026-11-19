import { useCallback, useMemo, useState } from 'react';
import { buildEggSearchIndex } from '../domain/petFilters';
import { eggGroupNames, species } from '../data/catalog';
import type { CollectionLocation, NavigationIntent } from './navigation';
import { MyPets } from './MyPets';
import { MotherView } from './MotherView';
import { StudCollection } from './StudCollection';
import { useCollectionSummary } from './useCollectionSummary';
import { useMotherSuggestions } from './useMotherSuggestions';
import { useAccountFilter } from './accountFilterStore';
import { AccountFilterBar } from './AccountFilterBar';
import { useOwnedPets } from './useOwnedPets';
import {
  clearInventoryFilters,
  setMyPetsSelected,
} from './myPetsFilterStore';
import { setPersonalQuery } from './listViewStore';

export interface CollectionProps {
  location: CollectionLocation;
  onNavigate: (intent: NavigationIntent) => void;
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
}

type Kind = CollectionLocation['kind'];

function CollectionAccountSlot() {
  const { accounts } = useOwnedPets();
  return <AccountFilterBar accounts={accounts} compact />;
}

/** 收集页的三类视图入口，仅显示居中的名称。 */
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'inventory', label: '精灵背包' },
  { value: 'mothers', label: '母本' },
  { value: 'studs', label: '种公' },
];

/**
 * 母本分支：只有这里需要整份摘要（母本分组 + 覆盖度）。放在子组件里，
 * 精灵背包分支就不会一进页先白算一遍覆盖度（R2-4-L07）。
 */
function MothersBranch({
  searchIndex,
  status,
  onNavigate,
}: {
  searchIndex: ReturnType<typeof buildEggSearchIndex>;
  status: Extract<CollectionLocation, { kind: 'mothers' }>['status'];
  onNavigate: (intent: NavigationIntent) => void;
}) {
  const summary = useCollectionSummary();
  const { owned, motherGroups, mode } = summary;
  const { accounts } = useOwnedPets();
  const { excluded } = useAccountFilter();
  const accountNames = accounts.filter((name) => !excluded.has(name));
  /** 悬浮窗与看板共用同一份母本建议（2026-11-19） */
  const { suggestions, targetLabel, bodyMedal, voiceTarget, voiceDb, weightPercent } =
    useMotherSuggestions(summary);

  return (
    <main className="mx-auto max-w-md space-y-2 p-3">
      <MotherView
        owned={owned}
        searchIndex={searchIndex}
        eggGroupNames={eggGroupNames}
        motherGroups={motherGroups}
        mode={mode}
        status={status}
        motherSuggestions={suggestions}
        accountNames={accountNames}
        gapTarget={{ label: targetLabel, bodyMedal, voiceTarget, voiceDb, weightPercent }}
        onSeekHelp={() => onNavigate({ type: 'open-groups', groupType: 'mother' })}
        onOpenInventory={(jump) => {
          // 点已收集卡 = 去精灵背包按这条进化链搜，带上奖牌 / 身高 / 性格条件
          clearInventoryFilters();
          setMyPetsSelected(new Set(jump.tags));
          setPersonalQuery('inventory-all', jump.name);
          onNavigate({ type: 'open-collection', location: { kind: 'inventory' } });
        }}
      />
    </main>
  );
}

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
  const searchIndex = useMemo(() => buildEggSearchIndex(species), []);
  const [inventoryCount, setInventoryCount] = useState(0);
  const reportInventoryCount = useCallback((count: number) => setInventoryCount(count), []);

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
        <div
          className="grid grid-cols-[minmax(76px,0.8fr)_repeat(3,minmax(0,1fr))] gap-1.5"
          data-testid="collection-kinds"
          data-tour="collection-kinds"
        >
          <CollectionAccountSlot />
          {KINDS.map((item) => {
            const active = item.value === kind;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => switchKind(item.value)}
                data-testid={`collection-kind-${item.value}`}
                className={`min-h-[48px] rounded-xl border px-1.5 py-1 text-center shadow-sm ${
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
                {active && item.value === 'inventory' ? (
                  <span className="block text-[10px] font-normal leading-tight text-slate-500">
                    共 {inventoryCount} 只
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {location.kind === 'mothers' ? (
        <MothersBranch searchIndex={searchIndex} status={location.status} onNavigate={onNavigate} />
      ) : location.kind === 'studs' ? (
        <StudCollection
          expandedGroupId={expandedGroupId}
          onToggleGroup={onToggleGroup}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          <MyPets
            onGoImport={() => onNavigate({ type: 'open-profile', section: 'data' })}
            onTotalCountChange={reportInventoryCount}
          />
        </>
      )}
    </>
  );
}
