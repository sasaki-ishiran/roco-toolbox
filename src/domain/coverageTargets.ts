import type { PetGrade } from './petFilters';
import type { CoverageSlot, TargetNature } from './studCoverage';

/**
 * 覆盖矩阵的筛选条件（用户 2026-10-03 确认要做成可筛选）。
 *
 * 三个维度互相独立，槽位 = 蛋组 × 性格 × 档位：
 * - 蛋组：14 个可孵蛋组
 * - 性格：三种模式（2026-11-19 用户口径）——
 *   `eight` 八大性格：固定用池里 8 个性格，默认模式；
 *   `recommended` 推荐性格：每个蛋组各取推荐前 3（保留组间差异）；
 *   `custom` 自选性格：全局勾选的 `customNatures` 应用到全部蛋组（可含池外性格）。
 * - 档位：目标 4 档，默认只追「大婉」（追满分时显示为「满分大婉」）
 */
export interface CoverageFilter {
  groupIds: number[];
  /** 每个蛋组选中的性格名（推荐模式用；custom 模式忽略） */
  naturesByGroup: Record<number, string[]>;
  grades: PetGrade[];
  /** 八大性格（默认，池里 8 个）/ 推荐模式（每蛋组前 3）/ 自选模式（全局性格应用到所有蛋组） */
  natureMode: 'eight' | 'recommended' | 'custom';
  /** 自选模式下要集齐的全局性格 */
  customNatures: string[];
}

/** 4 个档位，顺序与展示一致（展示时按模式加「满分」前缀）。 */
export const ALL_GRADES: PetGrade[] = ['大婉', '小婉', '大粗', '小粗'];

/**
 * 默认只追「大婉」（大块头 + 婉转声）。粗嗓门玩家少很多，小不点也不是主流目标（用户口径），
 * 所以默认矩阵规模与过去（每蛋组前 3 性格 ≈ 42 格）基本一致，不会一上来糊满一屏。
 */
export const DEFAULT_GRADES: PetGrade[] = ['大婉'];

/** 14 个可孵蛋组（id 2~15；1 是「未发现」，不可孵蛋）。 */
export const ALL_EGG_GROUP_IDS: number[] = Array.from({ length: 14 }, (_, i) => i + 2);

/**
 * 每个蛋组的**推荐性格**（数据推导，来自 PVP 统计的每蛋组前 3）。
 *
 * 它的作用只剩两个：给组内筛选当默认勾选项，以及在界面上标注「推荐」。
 * 不再是矩阵规模的决定者——用户可以在任何一组里自由增减。
 */
export function groupRecommendedNatures(
  targetNatures: TargetNature[],
): Record<number, string[]> {
  const byGroup: Record<number, string[]> = {};
  for (const groupId of ALL_EGG_GROUP_IDS) byGroup[groupId] = [];
  for (const target of targetNatures) (byGroup[target.groupId] ??= []).push(target.name);
  return byGroup;
}

/** 默认筛选：蛋组全选、每蛋组取推荐前 3 打底、档位只勾「大婉」。 */
export function buildDefaultFilter(targetNatures: TargetNature[]): CoverageFilter {
  return {
    groupIds: [...ALL_EGG_GROUP_IDS],
    naturesByGroup: groupRecommendedNatures(targetNatures),
    grades: [...DEFAULT_GRADES],
    natureMode: 'eight',
    customNatures: [],
  };
}

/** 把筛选条件展开成覆盖矩阵的槽位。 */
export function buildCoverageSlots(
  filter: CoverageFilter,
  naturePool: Array<{ id: number; name: string }>,
): CoverageSlot[] {
  const natureIdByName = new Map(naturePool.map((entry) => [entry.name, entry.id]));
  const slots: CoverageSlot[] = [];
  // 八大性格（默认）：池里 8 个性格应用到所有蛋组；
  // 自选模式：全局勾选的性格应用到所有蛋组（用户拍板 2026-10-05）；
  // 推荐模式：每蛋组用自己的推荐前 3
  const poolNames = naturePool.map((entry) => entry.name);
  const naturesOf = (groupId: number): string[] =>
    filter.natureMode === 'custom'
      ? filter.customNatures
      : filter.natureMode === 'eight'
        ? poolNames
        : filter.naturesByGroup[groupId] ?? [];
  for (const groupId of filter.groupIds) {
    for (const natureName of naturesOf(groupId)) {
      for (const grade of filter.grades) {
        slots.push({ groupId, natureId: natureIdByName.get(natureName) ?? 0, natureName, grade });
      }
    }
  }
  return slots;
}
