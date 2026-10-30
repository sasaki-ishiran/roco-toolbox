/**
 * 种公需求「用哪颗蛋接单」的本机记忆（2026-10-30）。
 *
 * 需求本身只记蛋组，具体用组内哪一枚蛋 / 哪只精灵去接由本机选，
 * 不上传服务端：换手机或清缓存会回到「双蛋组优先」的第一颗。
 */
const KEY = 'roco.demandPick';

export type DemandPicks = Record<string, number>;

export function readDemandPicks(): DemandPicks {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const picks: DemandPicks = {};
    for (const [demandKey, eggGameId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof eggGameId === 'number' && Number.isFinite(eggGameId)) {
        picks[demandKey] = eggGameId;
      }
    }
    return picks;
  } catch {
    // 隐私模式 / 存了坏数据：当作没选过，不影响接单
    return {};
  }
}

export function writeDemandPicks(picks: DemandPicks): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(picks));
  } catch {
    // 存不下不影响本次选择
  }
}

export function clearDemandPicks(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 忽略
  }
}
