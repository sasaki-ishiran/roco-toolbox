import {
  ALL_EGG_GROUP_IDS,
  ALL_GRADES,
  buildDefaultFilter,
  type CoverageFilter,
} from '../domain/coverageTargets';
import type { PetGrade } from '../domain/petFilters';
import { allNatureNames, targetNatureNames, targetNatures, targetNaturePool } from '../data/catalog';
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

/**
 * 按八大池的顺序排一下，保证矩阵里性格的排列不随点击顺序变化；池外性格排后面。
 *
 * 池内性格先占位、`allNatureNames` 只补池外的，不能反过来展开成同一个 Map：
 * 两者键都是性格名，后展开的会覆盖先展开的，池序就被图鉴序顶掉了。
 */
const POOL_ORDER = new Map<string, number>();
targetNaturePool.forEach((entry, index) => POOL_ORDER.set(entry.name, index));
allNatureNames.forEach((name, index) => {
  if (!POOL_ORDER.has(name)) POOL_ORDER.set(name, 100 + index);
});
const sortNatures = (names: string[]): string[] =>
  [...names].sort((a, b) => (POOL_ORDER.get(a) ?? 999) - (POOL_ORDER.get(b) ?? 999));

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
        // 奖牌目标改成单选（2026-11-18）：旧数据 / 云同步里残留的多个档位只保留最后一个
        ? loaded.grades.filter(isGrade).slice(-1)
        : defaults.grades,
      // 2026-11-19：新增「八大性格」并改为默认。旧的「推荐性格」是上一版默认值、
      // 分不清是没改过还是特意选的，统一迁到新默认；只有「自选性格」是用户显式选择，保留。
      natureMode: loaded.natureMode === 'custom' ? 'custom' : 'eight',
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

/** 奖牌目标是单选（2026-11-18）：点别的档替换，点已选中的档取消目标。 */
export function toggleFilterGrade(grade: PetGrade): void {
  setTargetGrade(store.get().grades[0] === grade ? null : grade);
}

/** 目标编辑器选择单一体型 × 声音组合时使用；null 表示清空目标档位。 */
export function setTargetGrade(grade: PetGrade | null): void {
  store.set({ ...store.get(), grades: grade ? [grade] : [] });
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

/**
 * 切换「推荐性格 / 八大性格 / 自选性格」。
 *
 * 切到自选时，若还没勾过任何性格，就先预选八大性格（2026-11-19 用户口径：
 * 「自选」是从八大全集里挑，不是从空白开始）。
 */
export function setNatureMode(mode: 'eight' | 'recommended' | 'custom'): void {
  const filter = store.get();
  const customNatures =
    mode === 'custom' && filter.customNatures.length === 0
      ? sortNatures([...targetNatureNames])
      : filter.customNatures;
  store.set({ ...filter, natureMode: mode, customNatures });
}

/** 自选模式下勾选 / 取消一个全局性格。 */
export function toggleCustomNature(natureName: string): void {
  const filter = store.get();
  const next = filter.customNatures.includes(natureName)
    ? filter.customNatures.filter((name) => name !== natureName)
    : sortNatures([...filter.customNatures, natureName]);
  store.set({ ...filter, customNatures: next });
}

/**
 * 自选模式下「全选 / 全部取消」：**只作用八大性格池**，不动已经勾上的池外性格
 * （2026-11-01 用户拍板 R2-4-M01：以前会把池外已勾项静默清掉）。
 */
export function toggleAllCustomNatures(): void {
  const filter = store.get();
  const all = targetNaturePool.map((entry) => entry.name);
  const hasAll = all.every((name) => filter.customNatures.includes(name));
  const next = hasAll
    ? filter.customNatures.filter((name) => !all.includes(name))
    : sortNatures([...new Set([...filter.customNatures, ...all])]);
  store.set({ ...filter, customNatures: next });
}

export function useCoverageFilter(): CoverageFilter {
  return store.use();
}
