import {
  ALL_EGG_GROUP_IDS,
  ALL_GRADES,
  buildDefaultFilter,
  type CoverageFilter,
} from '../domain/coverageTargets';
import type { PetGrade } from '../domain/petFilters';
import { targetNatures, targetNaturePool } from '../data/catalog';
import { createModuleStore } from './createModuleStore';

/**
 * 覆盖矩阵的筛选状态（进程内共享）。
 *
 * 为什么是模块级 store 而不是页面 state：看板 / 覆盖度 / 换什么三个页面都用
 * `useCoverageSlots()` 算同一份覆盖度，分母必须一致；筛选条件放这里，三处同步变化。
 *
 * 性格这一维**按蛋组存**（`naturesByGroup`），默认值是「每个蛋组各取自己推荐的前 3」——
 * 这个预设只在组内有意义（部分性格在部分组几乎没用），所以只在展开某个蛋组时增减，
 * 界面上不再有「对所有组一起加减」的全局开关。
 *
 * 2026-10-04 重构：样板（listeners/commit/useXxx）提取到 createModuleStore。
 */

const POOL_ORDER = new Map(targetNaturePool.map((entry, index) => [entry.name, index]));

/** 按八大池的顺序排一下，保证矩阵里性格的排列不随点击顺序变化。 */
const sortNatures = (names: string[]): string[] =>
  [...names].sort((a, b) => (POOL_ORDER.get(a) ?? 99) - (POOL_ORDER.get(b) ?? 99));

const isGrade = (value: unknown): value is PetGrade =>
  (ALL_GRADES as readonly string[]).includes(value as string);

/** 只保留合法的可孵蛋组 id；`undefined`/非数组返回 null 表示「字段缺失」 */
const toGroupIds = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (item): item is number => typeof item === 'number' && ALL_EGG_GROUP_IDS.includes(item),
  );
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** 逐组校验：键必须是数字，值必须是字符串数组 */
const toNaturesByGroup = (
  value: unknown,
  defaults: Record<number, string[]>,
): Record<number, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const result: Record<number, string[]> = { ...defaults };
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    const groupId = Number(key);
    if (!Number.isInteger(groupId)) continue;
    result[groupId] = toStringArray(list);
  }
  return result;
};

const store = createModuleStore<CoverageFilter>(buildDefaultFilter(targetNatures), {
  persistKey: 'roco.coverageFilter',
  // 2026-10-05 筛选持久化专项 + 自选性格：老数据缺字段时补默认。
  // **逐字段校验类型**：这个键会被云同步的云端值直接覆盖（CLOUD_WINS_PREF_KEYS），
  // 脏值（如 `{"grades": 5}`）会让覆盖度/看板在渲染期 `includes`/`map` 抛错白屏。
  migrate: (loaded) => {
    const defaults = buildDefaultFilter(targetNatures);
    return {
      groupIds: toGroupIds(loaded.groupIds) ?? defaults.groupIds,
      naturesByGroup: toNaturesByGroup(loaded.naturesByGroup, defaults.naturesByGroup),
      grades: Array.isArray(loaded.grades)
        ? loaded.grades.filter(isGrade)
        : defaults.grades,
      natureMode: loaded.natureMode === 'custom' ? 'custom' : 'recommended',
      customNatures: toStringArray(loaded.customNatures),
    };
  },
});

export function getCoverageFilter(): CoverageFilter {
  return store.get();
}

/**
 * 恢复默认：蛋组全选、每蛋组取推荐前 3。
 * **档位不动**（2026-10-06）：它是全局口径、入口在看板，覆盖度页的「恢复默认」不该偷偷改看板。
 */
export function resetCoverageFilter(): void {
  store.set({ ...buildDefaultFilter(targetNatures), grades: store.get().grades });
}

export function toggleFilterGroup(groupId: number): void {
  const filter = store.get();
  const groupIds = filter.groupIds.includes(groupId)
    ? filter.groupIds.filter((id) => id !== groupId)
    : [...filter.groupIds, groupId].sort((a, b) => a - b);
  store.set({ ...filter, groupIds });
}

export function toggleFilterGrade(grade: PetGrade): void {
  const filter = store.get();
  const grades = filter.grades.includes(grade)
    ? filter.grades.filter((item) => item !== grade)
    : [...filter.grades, grade];
  store.set({ ...filter, grades });
}

/** 某个蛋组自己的性格加减（展开蛋组行时用，仅推荐模式有意义）。 */
export function toggleGroupNature(groupId: number, natureName: string): void {
  const filter = store.get();
  const current = filter.naturesByGroup[groupId] ?? [];
  const next = current.includes(natureName)
    ? current.filter((name) => name !== natureName)
    : sortNatures([...current, natureName]);
  store.set({ ...filter, naturesByGroup: { ...filter.naturesByGroup, [groupId]: next } });
}

/** 切换「推荐性格 / 自选性格」。 */
export function setNatureMode(mode: 'recommended' | 'custom'): void {
  store.set({ ...store.get(), natureMode: mode });
}

/** 自选模式下勾选 / 取消一个全局性格。 */
export function toggleCustomNature(natureName: string): void {
  const filter = store.get();
  const next = filter.customNatures.includes(natureName)
    ? filter.customNatures.filter((name) => name !== natureName)
    : sortNatures([...filter.customNatures, natureName]);
  store.set({ ...filter, customNatures: next });
}

/** 自选模式下全部勾选 / 清空（八大性格池）。 */
export function toggleAllCustomNatures(): void {
  const filter = store.get();
  const all = targetNaturePool.map((entry) => entry.name);
  const next = filter.customNatures.length === all.length ? [] : all;
  store.set({ ...filter, customNatures: next });
}

export function useCoverageFilter(): CoverageFilter {
  return store.use();
}
