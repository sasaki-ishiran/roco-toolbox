/* ---------- 页签红点（模块级外部 store，TabNav 直接订阅） ---------- */

let badge = 0;
const listeners = new Set<() => void>();

export function publishPlanAlertBadge(next: number): void {
  const value = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
  if (value === badge) return;
  badge = value;
  for (const listener of listeners) listener();
}

export function subscribePlanAlertBadge(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlanAlertBadge(): number {
  return badge;
}
