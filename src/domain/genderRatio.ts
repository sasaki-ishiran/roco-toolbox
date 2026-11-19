import type { SpeciesEntry } from './types';

/**
 * 性别比例门（2026-11-18 用户口径，配窝补全计划）。
 *
 * 图鉴 `genderRatio` 是 10 分制（male + female = 10），5:5 是标准比。
 * 用户确认的三条：
 * 1. 种公路线：**0 公（0:10）和少公（2:8）不参与**；8:2 公多，保留。
 * 2. 母本路线：只排除 **0 母（10:0）**；8:2 母少仍参与，只是概率被稀释。
 * 3. 图鉴缺性别比例的物种按 **5:5** 处理。
 *
 * 「稀释」用相对 1:1 的系数表达：`genderFactorOf` 返回 share / 0.5，
 * 5:5（和缺数据）正好是 1，8:2 出公 1.6、出母 0.4。
 * 排列时用它乘进期望，展示时保留原始的 100% / 60% / 30% 档位概率。
 */
export type TargetGender = '公' | '母';

/** 标准比例：5:5 */
const BASELINE_SHARE = 0.5;
/** 出目标性别 ≤ 2/10 视为「少」，不进对应路线 */
const SCARCE_MAX_SHARE = 0.2;

/** 出某个性别的比例（0~1）。缺 `genderRatio` 的按 5:5。 */
export function genderShareOf(species: SpeciesEntry | undefined, gender: TargetGender): number {
  const ratio = species?.genderRatio;
  if (!ratio || ratio.male + ratio.female <= 0) return BASELINE_SHARE;
  const share = gender === '公' ? ratio.male : ratio.female;
  return share / (ratio.male + ratio.female);
}

/**
 * 这条路线是否可能产出目标性别。
 * - 种公：出公 > 2/10（0 公与 2:8 少公被排除）
 * - 母本：出母 > 0（10:0 全公被排除）
 */
export function canProduceGender(
  species: SpeciesEntry | undefined,
  gender: TargetGender,
): boolean {
  // 图鉴的 maleCapable 是更硬的「这物种根本没有公」标志（老数据没有 genderRatio 时只能靠它）
  if (gender === '公' && species?.maleCapable === false) return false;
  const share = genderShareOf(species, gender);
  return gender === '公' ? share > SCARCE_MAX_SHARE : share > 0;
}

/**
 * 性别折算系数（相对 1:1）：5:5 / 缺数据 = 1，8:2 出公 1.6、出母 0.4。
 * 只用于排序与期望值，不改变 100% / 60% / 30% 的档位口径。
 */
export function genderFactorOf(species: SpeciesEntry | undefined, gender: TargetGender): number {
  return genderShareOf(species, gender) / BASELINE_SHARE;
}

/** 是否「非标准比例」，界面据此决定要不要显示折算提示。 */
export function isSkewedGender(species: SpeciesEntry | undefined): boolean {
  const ratio = species?.genderRatio;
  if (!ratio) return false;
  return ratio.male !== ratio.female;
}
