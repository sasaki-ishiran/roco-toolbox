import { useMemo } from 'react';
import { buildCoverageSlots } from '../domain/coverageTargets';
import { targetNaturePool } from '../data/catalog';
import type { CoverageSlot } from '../domain/studCoverage';
import { useCoverageFilter } from './coverageFilterStore';

/**
 * 覆盖矩阵的目标槽位（蛋组 × 性格 × 满分档位），随筛选条件变化。
 * 筛选状态在 coverageFilterStore（三个页面共用，分母一致）。
 */
export function useCoverageSlots(): CoverageSlot[] {
  const filter = useCoverageFilter();
  return useMemo(() => buildCoverageSlots(filter, targetNaturePool), [filter]);
}
