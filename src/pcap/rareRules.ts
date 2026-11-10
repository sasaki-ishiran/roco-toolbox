/**
 * 稀有精灵判定（2026-11-05，逆向自多多工具箱 4.2）。
 *
 * 两套口径：
 * - 列表/牌子：`kindsOf`，声音 ±96dB 就记「婉转声/粗嗓门」，
 *   体重与身高百分位同时 ≥98 / ≤2 才记「大块头/小不点」（2026-11-10 按游戏奖牌口径修正）。
 * - 主动提醒：`rareAlertReason`，只有「±100dB」或「体重牌 + 声音牌」才响。
 *
 * 纯函数，不依赖协议解析；阈值来自多多工具箱的 `ka / _kinds / un`。
 */

export type RareKind =
  | 'colorful' // 炫彩
  | 'shiny' // 异色
  | 'pollution' // 污染
  | 'big' // 大块头
  | 'small' // 小不点
  | 'high' // 婉转声
  | 'low'; // 粗嗓门

export const KIND_LABELS: Record<RareKind, string> = {
  colorful: '炫彩',
  shiny: '异色',
  pollution: '污染',
  big: '大块头',
  small: '小不点',
  high: '婉转声',
  low: '粗嗓门',
};

export interface WeightPercentileInput {
  weightKg: number;
  lowKg: number;
  highKg: number;
}

/** 体重在种族区间内的百分位；区间无效时返回 null（不伪造）。 */
export function weightPercentile({ weightKg, lowKg, highKg }: WeightPercentileInput): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(lowKg) || !Number.isFinite(highKg) || highKg <= lowKg) return null;
  return Math.max(0, Math.min(100, ((weightKg - lowKg) / (highKg - lowKg)) * 100));
}

export interface KindInput {
  mutation: number;
  glassType: number;
  weightPct: number | null;
  /** 身高百分位（0–100）；图鉴缺身高区间时为 null，此时不判体型牌 */
  heightPct: number | null;
  voiceDb: number;
}

/** 列表里显示的牌子；只要有一个牌子，`rare` 就为真。 */
export function kindsOf({ mutation, glassType, weightPct, heightPct, voiceDb }: KindInput): RareKind[] {
  const kinds: RareKind[] = [];
  if ((glassType || 0) !== 0 || (mutation & 8) !== 0) kinds.push('colorful');
  if ((mutation & 1) !== 0) kinds.push('shiny');
  if ((mutation & 166) !== 0) kinds.push('pollution');
  // 体型牌按游戏真实奖牌口径：体重与身高同时到顶 / 到底才挂牌（2026-11-10）。
  // 只看体重会误报——如格兰花 7.76/7.80kg 体重 98.9%、身高普通，游戏里没有奖牌。
  if (weightPct != null && heightPct != null) {
    if (weightPct >= 98 && heightPct >= 98) kinds.push('big');
    else if (weightPct <= 2 && heightPct <= 2) kinds.push('small');
  }
  if (voiceDb >= 96) kinds.push('high');
  else if (voiceDb <= -96) kinds.push('low');
  return kinds;
}

export function isRare(kinds: readonly RareKind[]): boolean {
  return kinds.length > 0;
}

export interface AlertInput {
  voiceDb: number;
  kinds: readonly RareKind[];
}

/**
 * 主动提醒的原因；不满足返回 null。
 * 注意：±100dB 单独成立；±96~99dB 必须再叠加体重牌才成立。
 */
export function rareAlertReason({ voiceDb, kinds }: AlertInput): string | null {
  const reasons: string[] = [];
  // 提醒文案里也只写分贝数，不再用「婉转声 / 粗嗓门」这种分类词（2026-11-10）
  const db = `${voiceDb > 0 ? '+' : ''}${Math.round(voiceDb)}dB`;
  if (voiceDb >= 100) reasons.push(db);
  else if (voiceDb <= -100) reasons.push(db);
  const body = kinds.includes('big') ? 'big' : kinds.includes('small') ? 'small' : null;
  const voice = kinds.includes('high') ? 'high' : kinds.includes('low') ? 'low' : null;
  if (body && voice && voiceDb > -100 && voiceDb < 100) reasons.push(`${KIND_LABELS[body]} · ${db}`);
  return reasons.length > 0 ? reasons.join(' · ') : null;
}

export function rareAlertTitle(count: number): string {
  return count === 1 ? '稀有精灵出现！' : `稀有精灵 ×${count}`;
}
