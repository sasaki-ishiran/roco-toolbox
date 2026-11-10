export interface CaptureAnalysis {
  fingerprint: string; hasGameTraffic: boolean; hasKey: boolean; hasProfile: boolean;
  accountCount: number; boxes: number; records: number; missingRecords: number;
  hasEggInventory: boolean; eggInventoryComplete: boolean; eggRecords: number;
  completionCandidate: boolean; truncated: boolean; flowErrors: number; stableWaitMs: number;
  /** 野外附近精灵（2026-11-05）：旧壳/旧分析可能没有，使用前按可选处理 */
  nearbyScene?: number | null;
  nearbyPets?: number;
  nearby?: LiveNearbyPet[];
  /** 自身世界坐标（上行 307）；解码器拿不到时为 null，雷达退回估算中心 */
  nearbySelf?: { x: number; y: number; heading?: number | null } | null;
  /** 最近一次赛季奇遇战（4886/4890）守卫的个体数据；没有奇遇战为 null */
  encounter?: SeasonEncounter | null;
  /**
   * 实时会话恢复点（2026-11-08）：解密 key + 账号 / 附近基线，存 localStorage 供
   * Worker 被回收后继续解裁剪过的文件。仅窗口化巡检会带。
   */
  liveState?: string;
}

/** 赛季奇遇战守卫（如「龙棋士」）→ 击败后捕获的精灵（随机，可能是蛋包蛋 / 恶魔狼等）。 */
export interface SeasonEncounter {
  /** 战斗中的显示名 */
  guardName: string;
  /** 捕获后的真实 petId；战斗早期只有临时 id 时为 null */
  rewardPetId: number | null;
  /** 捕获后的精灵名（按 petId 查图鉴）；还没拿到真实 petId 时为空字符串 */
  rewardName: string;
  level: number;
  natureId: number;
  /** 战斗帧里拿到的是否为真实性格（false = 30 占位，尚未生成） */
  natureConfirmed: boolean;
  /** 性格名；未确认或未收录为空字符串 */
  nature: string;
  /** 公 / 母 */
  gender: string;
  /** 原始协议单位：厘米 / 克 */
  height: number;
  weight: number;
  /** 身高百分位（0–100）；图鉴缺身高区间时为 null */
  heightPct: number | null;
  /** 体重百分位（0–100）；图鉴缺体重区间时为 null */
  weightPct: number | null;
  /** 声音（-100 ~ 100 dB）；战斗帧没有、捕获后才拿到时为 null */
  voiceDb: number | null;
}

/** 附近精灵的精简视图；只用于实时展示与提醒，不进入正式导入。 */
export interface LiveNearbyPet {
  key: string; cfgId: number; name: string; level: number; voiceDb: number;
  weightPct: number | null;
  /** 身高百分位（0–100）；图鉴缺身高区间 / 旧快照为 null（列表显示「高：xx.x%」） */
  heightPct?: number | null;
  kinds: string[]; rare: boolean;
  alertReason: string | null; distanceM: number | null;
  /** 性格（宠物记录回填）；未知为缺省 */
  nature?: string;
  natureId?: number | null;
  /** 性别（宠物记录回填）：公 / 母；未知为缺省 */
  gender?: string;
  /** 种族 petId（= 图鉴 gameId）；未收录时为 null */
  petId?: number | null;
  /** 世界坐标；旧数据/旧壳可能缺失，缺失时不上雷达 */
  pos?: { x: number; y: number; z: number };
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
