import type { NavigationIntent } from './navigation';
import { Coverage } from './Coverage';

export interface StudCollectionProps {
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
  onNavigate: (intent: NavigationIntent) => void;
}

/**
 * 种公工具只剩覆盖矩阵（2026-10-25 二期）。
 *
 * 「求什么 / 换蛋清单」已迁到「小组 · 个人求种公」，不再在收集页保留重复入口。
 */
export function StudCollection({
  expandedGroupId,
  onToggleGroup,
  onNavigate,
}: StudCollectionProps) {
  return (
    <Coverage
      expandedGroupId={expandedGroupId}
      onToggleGroup={onToggleGroup}
      onGoImport={() => onNavigate({ type: 'open-profile', section: 'data' })}
    />
  );
}
