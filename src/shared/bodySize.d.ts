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
export const BODY_WEIGHT_TOLERANCE: number;
/** 身高百分位到顶 / 到底 → 「大块头」/「小不点」；只用于合格判定，与奖牌无关。 */
export function heightBodyOf(heightPercent: number | null | undefined): '' | '小不点' | '大块头';
/** 奖牌 / 展示 / 需求口径：奖牌优先；没有奖牌时身高 100% / 0% 且体重 ≥95% / ≤5%。 */
export function bodyGradeOf(pet: {
  medalBody?: string | null;
  heightPercent?: number | null;
  weightPercent?: number | null;
} | null | undefined): '' | '小不点' | '大块头';
/** 孵蛋合格口径（母本 / 种公 / 档位）：奖牌优先；没有奖牌时只看身高 100% / 0%。 */
export function breedingBodyGradeOf(pet: {
  medalBody?: string | null;
  heightPercent?: number | null;
  weightPercent?: number | null;
} | null | undefined): '' | '小不点' | '大块头';
