import { createModuleStore } from './createModuleStore';

/**
 * 「计划收集」清单（母本待办）：用户从「待补齐母本」里挑的目标，按**进化链 key** 存。
 *
 * - 存 localStorage：与「重置导入数据」无关（规划设置会保留）；
 * - 随备份一起走，多设备合并取**并集**；
 * - 达成与否不存——导入新数据后由母本分组实时判定（该链有合格母本 = 已达成）。
 *
 * 2026-10-04 重构：样板（listeners/commit/useXxx）提取到 createModuleStore。
 */
const PLAN_KEY = 'roco.motherPlan';

const read = (): string[] => {
  try {
    const raw = window.localStorage.getItem(PLAN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

const store = createModuleStore<string[]>(read());

const commit = (next: string[]): void => {
  try {
    window.localStorage.setItem(PLAN_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式下写不了 localStorage：只在内存里生效
  }
  store.set(next);
};

export function getMotherPlan(): readonly string[] {
  return store.get();
}

/** 勾选 / 取消勾选一条链。 */
export function toggleMotherPlan(chainKey: string): void {
  const plan = store.get();
  commit(plan.includes(chainKey) ? plan.filter((key) => key !== chainKey) : [...plan, chainKey]);
}

/** 批量移除（「清除已达成」用）。 */
export function removeManyFromMotherPlan(chainKeys: readonly string[]): void {
  const drop = new Set(chainKeys);
  const plan = store.get();
  const next = plan.filter((key) => !drop.has(key));
  if (next.length !== plan.length) commit(next);
}

/** 备份合并：取并集，返回新增的条数（用于导入反馈文案）。 */
export function mergeMotherPlan(chainKeys: readonly string[]): number {
  const plan = store.get();
  const next = new Set(plan);
  const before = next.size;
  for (const key of chainKeys) next.add(key);
  if (next.size !== before) commit([...next]);
  return next.size - before;
}

export function useMotherPlan(): readonly string[] {
  return store.use();
}

/** 供单元测试复位。 */
export function resetMotherPlanForTest(): void {
  store.set(read());
}
