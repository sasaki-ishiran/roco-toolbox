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
