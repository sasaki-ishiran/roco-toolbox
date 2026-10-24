export interface CaptureAnalysis {
  fingerprint: string; hasGameTraffic: boolean; hasKey: boolean; hasProfile: boolean;
  accountCount: number; boxes: number; records: number; missingRecords: number;
  hasEggInventory: boolean; eggInventoryComplete: boolean; eggRecords: number;
  completionCandidate: boolean; truncated: boolean; flowErrors: number; stableWaitMs: number;
}
export interface CaptureProgress {
  session: string; analysis: CaptureAnalysis; checkedAt: number; stableSince: number | null;
  remainingMs: number; stage: 'waiting' | 'login' | 'collecting' | 'multiple' | 'stabilizing' | 'ready';
}
export function nextCaptureProgress(previous: CaptureProgress | null, analysis: CaptureAnalysis, now: number, session: string): CaptureProgress {
  const current: CaptureProgress = { session, analysis, checkedAt: now, stableSince: null, remainingMs: 0, stage: 'collecting' };
  if (!analysis.hasGameTraffic) return { ...current, stage: 'waiting' };
  if (analysis.accountCount > 1) return { ...current, stage: 'multiple' };
  if (!analysis.hasKey || !analysis.hasProfile) return { ...current, stage: 'login' };
  if (!analysis.completionCandidate || !analysis.hasEggInventory || !analysis.eggInventoryComplete
    || analysis.missingRecords > 0 || analysis.truncated || analysis.flowErrors > 0) return current;
  const continuous = previous?.session === session && previous.stableSince != null
    && previous.analysis.fingerprint === analysis.fingerprint
    && now >= previous.checkedAt && now - previous.checkedAt <= 15000;
  const stableSince = continuous ? previous.stableSince! : now;
  const remainingMs = Math.max(0, analysis.stableWaitMs - (now - stableSince));
  return { ...current, stableSince, remainingMs, stage: remainingMs === 0 ? 'ready' : 'stabilizing' };
}
