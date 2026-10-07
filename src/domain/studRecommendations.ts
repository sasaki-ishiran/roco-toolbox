import { chainTopNaturesByGameId } from '../data/catalog';
import type { SpeciesEntry } from './types';

/**
 * 推荐性格（推荐算法专项，2026-10-04 用户拍板）。
 *
 * 优质种公推荐里「能换到的性格蛋」：
 * 1. 优先用 B站 wiki 图鉴的 PVP 推荐性格 top2（`recommendedNatures`，管线烘焙）；
 * 2. 没有推荐性格（如 S4 新精灵未完虫）时走**种族值兜底算法**，从八大性格里选。
 *
 * 兜底映射规则（确定性，无学习参数；依据 data/natures.json 的 plus/minus 与八大性格池）：
 * - 速度型（速度显著高于双攻）→ 胆小（+速度-物攻）〔先判速度：速度是先手权，
 *   高速精灵不该被主攻向抢走；2026-10-06 修复（m2）：速度判断提到最前，
 *   否则 100 攻 / 120 速这类双高精灵会漏判成聪明/固执〕
 * - 特攻主向（spa > atk）→ 聪明（+特攻-物攻）〔未完虫魔攻 111 > 物攻 102 → 聪明〕
 * - 物攻主向（atk > spa）→ 固执（+物攻-特攻）
 * - 肉盾/辅助型（血高且攻低）→ 沉默（+生命-物攻）
 * - 兜底 → 踏实（+生命-速度）
 */
export type PetStats = NonNullable<SpeciesEntry['stats']>;

/** 种族值 → 八大性格之一的兜底推荐。 */
export function fallbackNature(stats: PetStats): string {
  if (stats.spe > Math.max(stats.atk, stats.spa) + 10) return '胆小';
  if (stats.spa > stats.atk) return '聪明';
  if (stats.atk > stats.spa) return '固执';
  if (
    stats.hp >= Math.max(stats.def, stats.spd) &&
    (stats.atk + stats.spa) * 2 < stats.hp + stats.def + stats.spd
  ) {
    return '沉默';
  }
  return '踏实';
}

/**
 * 该物种的推荐性格（用于换蛋时挑「能换到的性格蛋」）：
 * 有 PVP 推荐取前两个（换蛋推荐用第一个），没有走种族值兜底。
 */
export function recommendedNaturesForSpecies(entry: SpeciesEntry | undefined): string[] {
  const fromPvp = entry?.recommendedNatures ?? [];
  if (fromPvp.length > 0) return fromPvp;
  if (entry?.stats) return [fallbackNature(entry.stats)];
  return [];
}

/**
 * 一只精灵**自己能换到的性格**（优质种公推荐 / 换什么清单共用的单一口径）：
 * 1. 优先用进化链**最高形态**的 PVP 推荐（打 PVP 没人用最低阶精灵，低阶形态的推荐对实战无意义）；
 * 2. 整条链都无推荐（如 S4 新精灵）→ 退回单物种的种族值兜底。
 * 物种完全无推荐信息时返回空数组（换不到任何性格蛋，不该被推荐）。
 *
 * 2026-10-05 修复：换什么页此前直接拿「清单目标性格」配任意物种，
 * 出现「固执白发懒人」这种没人孵的性格蛋——换蛋只能换到该精灵自己
 * 能换到的性格（别人愿意孵的那些蛋）。
 */
export function swappableNaturesForSpecies(entry: SpeciesEntry | undefined): string[] {
  if (!entry) return [];
  const chainNatures = chainTopNaturesByGameId.get(entry.gameId);
  if (chainNatures && chainNatures.length > 0) return chainNatures;
  return recommendedNaturesForSpecies(entry);
}
