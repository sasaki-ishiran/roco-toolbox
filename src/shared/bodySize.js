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
 * 身高必须**正好到顶 / 到底**才算极端体型（2026-10-28 用户确认）：
 * 100% 身高与 95% 体重是一起满足的条件，不能再有 99.5% 的容差。
 */
export const HEIGHT_EXTREME_TOLERANCE = 0;

/**
 * 合格判定的体重容差（百分位，2026-10-28 用户确认）：
 * 没有奖牌时，身高 100% 且体重 ≥95% 才算大块头；身高 0% 且体重 ≤5% 才算小不点。
 * **奖牌显示仍按 98% / 2%**，这里只放宽「够不够格当亲本」。
 */
export const BODY_WEIGHT_TOLERANCE = 5;

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

/**
 * 合格体型（2026-10-28 用户确认的完整口径）：
 * 1. 有奖牌：以奖牌为准（奖牌本身已隐含身高到顶 / 到底）；
 * 2. 没有奖牌：身高必须正好 100% / 0%，**并且**体重 ≥95% / ≤5%，两者一起满足；
 * 3. 缺身高或体重（老抓包）→ 判不了，不猜。
 */
export function bodyGradeOf(pet) {
  if (!pet) return '';
  if (pet.medalBody === '大块头' || pet.medalBody === '小不点') return pet.medalBody;
  const heightBody = heightBodyOf(pet.heightPercent);
  if (!heightBody) return '';
  const percent = pet.weightPercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return '';
  if (heightBody === '大块头' && percent >= 100 - BODY_WEIGHT_TOLERANCE) return '大块头';
  if (heightBody === '小不点' && percent <= BODY_WEIGHT_TOLERANCE) return '小不点';
  return '';
}
