export interface BodySize { small: number; big: number }
export function resolveBodySize(entry: {
  weight?: string;
  adultSmallWeight?: number | null;
  adultBigWeight?: number | null;
} | null | undefined): BodySize | null;
export function bodyMedalOf(size: BodySize | null | undefined, weightKg: number | null | undefined): '' | '小不点' | '大块头';
export interface HeightSize { min: number; max: number }
/** 身高百分位（0~100）：`heightCm` 为厘米，区间单位是米；判不了返回 null。 */
export function heightPercentOf(size: HeightSize | null | undefined, heightCm: number | null | undefined): number | null;
export const HEIGHT_EXTREME_TOLERANCE: number;
/** 身高百分位到顶 / 到底 → 「大块头」/「小不点」；只用于合格判定，与奖牌无关。 */
export function heightBodyOf(heightPercent: number | null | undefined): '' | '小不点' | '大块头';
