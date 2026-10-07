import { useMemo } from 'react';
import { eggGroupNames, maleCapableGameIds, species } from '../data/catalog';
import type { StudCoverageResult } from '../domain/studCoverage';
import { rankSwapWishes, type SwapWish } from '../domain/swapPlan';
import type { OwnedPet } from '../domain/types';
import { useTargetMode } from './targetModeStore';

/**
 * 换蛋目标清单。看板的「下一步建议」、覆盖度页与「换什么」页共用同一份口径。
 *
 * 「未拥有」按**蛋物种**判（不是按形态 gameId）：手里有这条血脉的任意一个形态
 * （石肤蜥_本来的样子 / 石肤蜥_球球尾巴的样子）就算这颗蛋已拥有——它们本质是一回事，
 * 不该互相推荐（用户 2026-10-05 报的：有石冠王蜥却被推荐同物种另一个形态的蛋）。
 * 只影响排序：候选池不因为「已经有了」而隐藏，因为手里有的个体未必是能当种公的那只。
 */
export function useSwapWishes(coverage: StudCoverageResult, owned: OwnedPet[]): SwapWish[] {
  const mode = useTargetMode();
  return useMemo(() => {
    const byGameId = new Map(species.map((entry) => [entry.gameId, entry]));
    const ownedEggGameIds = new Set<number>();
    for (const pet of owned) {
      const eggGameId = byGameId.get(pet.gameId)?.eggGameId;
      if (eggGameId != null) ownedEggGameIds.add(eggGameId);
    }
    return rankSwapWishes({
      species,
      coverage,
      owned,
      mode,
      ownedEggGameIds,
      maleCapableGameIds,
      eggGroupNames,
    });
  }, [coverage, owned, mode]);
}
