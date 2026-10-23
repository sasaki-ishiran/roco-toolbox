import type { NestPlan } from '../domain/nestPlan';
import type { NavigationIntent } from './navigation';
import { Breeding } from './Breeding';
import { Coverage } from './Coverage';
import { SegmentedControl } from './primitives/SegmentedControl';
import { Swap } from './Swap';

export type StudToolView = 'coverage' | 'breed' | 'eggs';

export interface StudCollectionProps {
  view: StudToolView;
  plans: NestPlan[];
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
  onNavigate: (intent: NavigationIntent) => void;
}

const TOOLS = [
  { value: 'coverage', label: '覆盖矩阵' },
  { value: 'breed', label: '自己孵' },
  { value: 'eggs', label: '求蛋' },
];

/**
 * 种公的三个完整工具（2026-10-24）：覆盖矩阵 / 自己孵 / 求蛋必须同级可达，
 * 不藏进多层高级菜单。三种工具都保留原有完整能力。
 */
export function StudCollection({
  view,
  plans,
  expandedGroupId,
  onToggleGroup,
  onNavigate,
}: StudCollectionProps) {
  return (
    <>
      <div className="mx-auto max-w-md px-4 pt-2">
        <SegmentedControl
          label="种公工具"
          value={view}
          options={TOOLS}
          onValueChange={(next) =>
            onNavigate({
              type: 'open-collection',
              location: { kind: 'studs', view: next as StudToolView },
            })
          }
          optionTestId={(value) => `stud-tool-${value}`}
        />
      </div>
      {view === 'coverage' ? (
        <Coverage
          expandedGroupId={expandedGroupId}
          onToggleGroup={onToggleGroup}
          onGoImport={() => onNavigate({ type: 'open-profile', section: 'data' })}
        />
      ) : view === 'breed' ? (
        <main className="mx-auto max-w-md space-y-3 p-4">
          <Breeding plans={plans} />
        </main>
      ) : (
        <Swap
          view="eggs"
          onViewChange={(next) =>
            onNavigate(
              next === 'sharing'
                ? { type: 'tab', page: 'groups' }
                : { type: 'open-collection', location: { kind: 'studs', view: 'eggs' } },
            )
          }
          onGoImport={() => onNavigate({ type: 'open-profile', section: 'data' })}
          onGoAccount={() => onNavigate({ type: 'open-profile', section: 'identity' })}
        />
      )}
    </>
  );
}
