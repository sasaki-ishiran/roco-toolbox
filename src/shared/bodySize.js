// 成体体重（kg），不是蛋重。供采集解析器和 JSON 导入共用。
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function resolveBodySize(entry) {
  if (!entry) return null;
  const match = String(entry.weight ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\s*KG\s*$/i);
  const min = match ? Number(match[1]) : NaN;
  const max = match ? Number(match[2]) : NaN;
  const hasRange = positive(min) && max > min;
  // 专用阈值优先（少数特殊形态与常规体重区间不同），只补缺失值。
  const small = positive(entry.adultSmallWeight)
    ? entry.adultSmallWeight
    : hasRange ? min + (max - min) * 0.02 : null;
  const big = positive(entry.adultBigWeight)
    ? entry.adultBigWeight
    : hasRange ? min + (max - min) * 0.98 : null;
  if (small == null || big == null || small >= big) return null;
  return { small, big };
}

export function bodyMedalOf(size, weightKg) {
  if (!size || !positive(weightKg)) return '';
  // 消除浮点运算在精确克数边界的误差；不使用已四舍五入的百分位。
  if (weightKg <= size.small + 1e-9) return '小不点';
  if (weightKg >= size.big - 1e-9) return '大块头';
  return '';
}

/**
 * 身高百分位（0~100）：身高区间 [min, max] 米，100% = 区间上限、0% = 区间下限。
 * `heightCm` 是抓包里的身高（厘米）。缺失或区间非法时返回 null（判不了就不猜）。
 */
export function heightPercentOf(size, heightCm) {
  if (!size || !positive(heightCm) || !(size.max > size.min)) return null;
  const percent = ((heightCm / 100 - size.min) / (size.max - size.min)) * 100;
  return Number(Math.min(100, Math.max(0, percent)).toFixed(1));
}

/**
 * 「两个 100% 身高能生大块头蛋、两个 0% 生小不点蛋」的容差（2026-10-26 用户拍板）。
 * 百分位保留 1 位小数，99.5 以上 / 0.5 以下都按到顶 / 到底算。
 */
export const HEIGHT_EXTREME_TOLERANCE = 0.5;

/**
 * 身高百分位换算成「能产出的体型蛋」：到顶 = 大块头、到底 = 小不点。
 *
 * **只用于合格判定**（合格种公 / 母本、档位），不改大块头 / 小不点奖牌——
 * 奖牌仍由 `bodyMedalOf` 按体重 98% / 2% 判定并展示。
 */
export function heightBodyOf(heightPercent) {
  if (typeof heightPercent !== 'number' || !Number.isFinite(heightPercent)) return '';
  if (heightPercent >= 100 - HEIGHT_EXTREME_TOLERANCE) return '大块头';
  if (heightPercent <= HEIGHT_EXTREME_TOLERANCE) return '小不点';
  return '';
}
