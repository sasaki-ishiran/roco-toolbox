import { useMemo } from 'react';
import { eggGroupNames, species, species as catalogSpecies } from '../data/catalog';
import { buildNestPlans } from '../domain/nestPlan';
import {
  groupMothersByEgg,
  type MotherGroup,
  type TargetMode,
} from '../domain/petFilters';
import {
  countQualifiedMotherChains,
  effectiveMotherVoices,
} from '../domain/motherCriteria';
import { createNaturesResolver } from '../domain/recommendedNatures';
import { computeStudCoverage, computeStudCoverageByAccount } from '../domain/studCoverage';
import { computeStudRecommendations } from '../domain/suggestions';
import type { OwnedPet } from '../domain/types';
import { useCoverageSlots } from './useCoverageSlots';
import { useMotherCriteria } from './motherCriteriaStore';
import { useNatureOverrides } from './natureOverrideStore';
import { useOwnedPets } from './useOwnedPets';
import { useSnapshots } from './useSnapshots';
import { useSwapWishes } from './useSwapWishes';
import { useTargetMode } from './targetModeStore';

/**
 * 个人收集摘要（2026-10-24 重构任务 5）：看板 / 收集详情共用这一份计算结果。
 *
 * 数字全部来自既有领域函数与用户既有条件（账号范围、种公目标、个人母本达标条件），
 * 不在这里另定口径，也**不在 App 全站后台运行**——只由真正展示摘要的页面调用。
 */
export interface CollectionSummary {
  loaded: boolean;
  owned: OwnedPet[];
  motherGroups: MotherGroup[];
  mode: TargetMode;
  mother: { collected: number; total: number };
  stud: ReturnType<typeof computeStudCoverage>;
  /** 每个号自己那份种公覆盖度（2026-11-18 修正：缺口按号各算） */
  coverageByAccount: ReadonlyMap<string, ReturnType<typeof computeStudCoverage>>;
  plans: ReturnType<typeof buildNestPlans>;
  recommendations: ReturnType<typeof computeStudRecommendations>;
}

export function useCollectionSummary(): CollectionSummary {
  const { loaded } = useSnapshots();
  const { owned } = useOwnedPets();
  const mode = useTargetMode();
  const motherCriteria = useMotherCriteria();
  const natureOverrides = useNatureOverrides();
  const slots = useCoverageSlots();

  const speciesByGameId = useMemo(
    () => new Map(catalogSpecies.map((entry) => [entry.gameId, entry])),
    [],
  );

  /** 推荐性格解析器（与母本页、小组同一口径） */
  const naturesOf = useMemo(
    () => createNaturesResolver({ species: catalogSpecies, overrides: natureOverrides }),
    [natureOverrides],
  );

  const motherGroups = useMemo(
    () => groupMothersByEgg(owned, speciesByGameId, species, mode),
    [owned, speciesByGameId, mode],
  );

  const mother = useMemo(
    () => ({
      collected: countQualifiedMotherChains(
        motherGroups,
        owned,
        {
          bodies: motherCriteria.bodies,
          voices: effectiveMotherVoices(motherCriteria.voices, mode),
          grades: motherCriteria.grades,
          targetMode: mode,
          recommendedNatures: motherCriteria.recommendedNatures === true,
        },
        naturesOf,
      ),
      total: motherGroups.length,
    }),
    [motherGroups, owned, motherCriteria, mode, naturesOf],
  );

  const stud = useMemo(
    () => computeStudCoverage(slots, species, owned, eggGroupNames, mode),
    [owned, slots, mode],
  );

  const coverageByAccount = useMemo(
    () => computeStudCoverageByAccount(slots, species, owned, eggGroupNames, mode),
    [owned, slots, mode],
  );

  const wishes = useSwapWishes(stud, owned);
  const recommendations = useMemo(() => computeStudRecommendations(wishes), [wishes]);

  const plans = useMemo(
    () => buildNestPlans({ species, owned, coverage: stud, coverageByAccount, mode }),
    [owned, stud, coverageByAccount, mode],
  );

  return {
    loaded,
    owned,
    motherGroups,
    mode,
    mother,
    stud,
    coverageByAccount,
    plans,
    recommendations,
  };
}
