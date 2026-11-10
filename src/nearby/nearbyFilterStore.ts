import { useEffect, useState } from 'react';

/**
 * 「附近」页列表的总范围筛选（2026-11-09 从 Nearby 组件内 useState 下沉）。
 *
 * 悬浮窗列表要和 App 内附近页看同一档筛选，所以提成模块级状态并持久化；
 * 判定函数 {@link nearbyFilterAllows} 两边共用，不各写一套近似逻辑。
 *
 * 注意：这里只管**总范围**（全部 / 稀有 / 需求）。声音 / 体型 / 性格 / 公母
 * 那组维度筛选属于战斗目标（`battleTargetStore`），在悬浮窗里与总范围叠加。
 */
export type NearbyFilter = 'all' | 'rare' | 'demand';

const STORAGE_KEY = 'roco.nearbyFilter';
const listeners = new Set<() => void>();

const normalize = (value: unknown): NearbyFilter =>
  value === 'rare' || value === 'demand' ? value : 'all';

function read(): NearbyFilter {
  if (typeof window === 'undefined') return 'all';
  try {
    return normalize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'all';
  }
}

let current: NearbyFilter = read();

export function getNearbyFilter(): NearbyFilter {
  return current;
}

export function setNearbyFilter(next: NearbyFilter): void {
  const value = normalize(next);
  if (value === current) return;
  current = value;
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 隐私模式写不进去：本次会话内仍然生效
  }
  for (const listener of [...listeners]) listener();
}

/** 订阅同一份筛选状态：页面切档位后悬浮窗下一轮推送立刻跟上。 */
export function subscribeNearbyFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 侧订阅（附近页分段控件用）。 */
export function useNearbyFilter(): NearbyFilter {
  const [value, setValue] = useState(current);
  useEffect(() => {
    setValue(current);
    return subscribeNearbyFilter(() => setValue(current));
  }, []);
  return value;
}

/** 测试用：恢复默认档位。 */
export function resetNearbyFilterForTest(): void {
  current = 'all';
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
  for (const listener of [...listeners]) listener();
}

/**
 * 附近列表的唯一总范围口径（App 内附近页列表与悬浮窗共用）。
 *
 * - 命中需求中心 → 恒放行，不受档位影响；
 * - 「全部」→ 全部通过；
 * - 「稀有」→ `rare` 才通过；
 * - 「需求」→ 除命中需求外一律不通过。
 *
 * `alertReason`（可提醒）是解析阶段按声音 / 体重阈值算出的标记，
 * 与这份筛选无关，也不能绕过它单独放行。
 */
export function nearbyFilterAllows(
  filter: NearbyFilter,
  pet: { rare: boolean },
  demandHits: number,
): boolean {
  if (demandHits > 0) return true;
  if (filter === 'all') return true;
  if (filter === 'rare') return pet.rare;
  return false;
}
