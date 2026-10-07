import type { SwapWish } from './swapPlan';
import type { PetGrade } from './petFilters';

/** 优质种公推荐里的一条：一只「性格精灵（组别）」的待办 */
export interface StudRecommendation {
  id: string;
  natureName: string;
  /** 建议去要的精灵显示名（有形态时带形态） */
  displayName: string;
  groupLabels: string[];
  /** 想换的这个性格蛋产出的档位 */
  grade: PetGrade;
  gameId: number;
}

/**
 * 优质种公推荐（2026-10-04 改版）：看板「下一步建议」改成「优质种公推荐」，
 * 每一条是结构化待办（性格 + 精灵 + 组别），可勾选标记「已换到」。
 *
 * 性格 = **缺口（槽位）需要的那个性格**，与「换什么」清单完全同源：
 * swapPlan 产的 wish 里 `natureName` 就是槽位性格，且建议物种已保证「能孵出该性格的蛋」
 * （用进化链最高形态的 PVP 推荐 top2 过滤）。所以这里直接透传，不再自己挑性格。
 *
 * 2026-10-05 修正：此前这里用「建议物种自己的推荐性格」覆盖了缺口性格，导致
 * **显示的性格不是缺口要的那个**（用户报的：有平和种公，却被推荐「平和 XXX」，
 * 实际缺口要的是沉默/固执）。现在显示的性格与缺口一一对应。
 *
 * 去重：多个缺口（不同蛋组）可能收敛到同一只精灵的同一性格同一档位，
 * 按 (gameId, natureName, grade) 聚合成一条，组别合并展示（组A × 组B）。
 */
export function computeStudRecommendations(wishes: SwapWish[]): StudRecommendation[] {
  const byPair = new Map<string, StudRecommendation>();
  for (const wish of wishes) {
    const gameId = wish.suggested.gameId;
    const natureName = wish.natureName;
    const key = `${gameId}|${natureName}|${wish.grade}`;
    const existing = byPair.get(key);
    if (existing) {
      // 同一个缺口反复出现时，组别取并集
      for (const label of wish.groupLabels) {
        if (!existing.groupLabels.includes(label)) existing.groupLabels.push(label);
      }
      continue;
    }
    byPair.set(key, {
      id: `${gameId}|${natureName}|${wish.grade}|${wish.fillGroups.join('+')}`,
      natureName,
      displayName: wish.suggested.displayName,
      groupLabels: [...wish.groupLabels],
      grade: wish.grade,
      gameId,
    });
  }
  return [...byPair.values()];
}

/** 当推荐清单为空时给一句收尾说明。 */
export function emptyRecommendationsNote(
  stud: { groupCount: number; passedGroups: number },
): string {
  return stud.groupCount > 0 && stud.passedGroups === stud.groupCount
    ? '种公网络已全通，没有要补的缺口'
    : '当前没有要换的缺口';
}

export function findUncataloguedCount(
  ownedGameIds: number[],
  speciesGameIds: Set<number>,
): number {
  return ownedGameIds.filter((id) => !speciesGameIds.has(id)).length;
}
