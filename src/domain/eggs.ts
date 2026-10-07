/**
 * 可孵蛋蛋组范围的**单源**定义（2026-10-04 收敛：此前 breedPlan / coverageDetail /
 * importDiff / petFilters / studTargets / swapPlan 各自重复一份 `2 <= group <= 15`）。
 *
 * 洛克王国可孵蛋的蛋组是 2~15（1 是「未发现」，不可孵蛋）。
 */
export const EGG_GROUP_MIN = 2;
export const EGG_GROUP_MAX = 15;

/** 该蛋组是否可孵蛋（蛋组 2~15）。 */
export const isBreedableGroup = (groupId: number): boolean =>
  groupId >= EGG_GROUP_MIN && groupId <= EGG_GROUP_MAX;
