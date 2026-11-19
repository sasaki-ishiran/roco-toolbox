import { useMemo } from 'react';
import { GRADE_BODY, GRADE_VOICE, gradeLabel, type PetGrade } from '../domain/petFilters';
import { effectiveMotherVoices, type MotherCriteria } from '../domain/motherCriteria';
import { buildMotherNestSuggestions, type MotherNestAccount } from '../domain/motherNest';
import { createNaturesResolver } from '../domain/recommendedNatures';
import { species } from '../data/catalog';
import { useCoverageFilter } from './coverageFilterStore';
import { useMotherCriteria } from './motherCriteriaStore';
import { useNatureOverrides } from './natureOverrideStore';
import type { CollectionSummary } from './useCollectionSummary';

/**
 * 看板与收集页共用的「母本配窝建议 + 当前目标」口径（2026-11-19）。
 *
 * 悬浮窗复用到看板母本缺口和收集母本两处，这两处必须算出同一份线，
 * 否则同一个缺口在两边给的概率会不一样。所以把条件组装、建议计算和
 * 目标卡文案都收在这一个 hook 里。
 *
 * 档位取的是全局目标奖牌组合（看板「公母共用」那一组；母本页顶部四张组合卡
 * 写的是同一个 store，选「满分大粗」两边都会变），以前只差声音图标没跟着档位走。
 */
export interface MotherSuggestionsView {
  selectedGrade: PetGrade | null;
  effectiveCriteria: MotherCriteria;
  naturesOf: (gameId: number) => readonly string[];
  suggestions: ReadonlyMap<string, MotherNestAccount>;
  /** 目标卡卡底：目标 满分大婉 / 目标 满分大粗 / 目标 大婉（双牌） */
  targetLabel: string;
  bodyMedal: string | null;
  /** 声音目标标签（`+100` / `-100` / `婉转声` / `粗嗓门`），悬浮窗按它取奖牌图 */
  voiceTarget: string | null;
  voiceDb: number | null;
  weightPercent: number | null;
}

export function useMotherSuggestions(
  summary: Pick<CollectionSummary, 'owned' | 'mode' | 'coverageByAccount' | 'plans'>,
): MotherSuggestionsView {
  const { owned, mode, coverageByAccount, plans } = summary;
  const coverageFilter = useCoverageFilter();
  const motherCriteria = useMotherCriteria();
  const natureOverrides = useNatureOverrides();

  const selectedGrade = coverageFilter.grades[coverageFilter.grades.length - 1] ?? null;

  const effectiveCriteria: MotherCriteria = useMemo(
    () => ({
      bodies: motherCriteria.bodies,
      voices: effectiveMotherVoices(motherCriteria.voices, mode),
      grades: selectedGrade ? [selectedGrade] : motherCriteria.grades,
      targetMode: mode,
      recommendedNatures: motherCriteria.recommendedNatures === true,
    }),
    [motherCriteria, mode, selectedGrade],
  );

  const naturesOf = useMemo(
    () => createNaturesResolver({ species, overrides: natureOverrides }),
    [natureOverrides],
  );

  const suggestions = useMemo(() => {
    if (!selectedGrade) return new Map<string, MotherNestAccount>();
    return buildMotherNestSuggestions({
      species,
      owned,
      mode,
      grade: selectedGrade,
      criteria: effectiveCriteria,
      naturesOf,
      coverageByAccount,
      plans,
    });
  }, [owned, mode, selectedGrade, effectiveCriteria, naturesOf, coverageByAccount, plans]);

  const bodyMedal = selectedGrade ? GRADE_BODY[selectedGrade] : null;
  const targetLabel = selectedGrade
    ? // 用档位简称（满分大婉 / 满分大粗 / 双牌大婉…），不再写「大块头 · 婉转声」那串有歧义的拆解
      `目标 ${gradeLabel(selectedGrade, mode)}`
    : '目标未选';
  /**
   * 目标声音（与需求卡同一套标签）：追满分是 ±100，追双牌是 婉转声 / 粗嗓门。
   * 悬浮窗用它选奖牌图，不能只看 dB —— 大粗以前被算成 +100，图标一直是婉转声。
   */
  const voiceTarget = selectedGrade
    ? mode === 'perfect'
      ? GRADE_VOICE[selectedGrade] === '婉转声'
        ? '+100'
        : '-100'
      : GRADE_VOICE[selectedGrade]
    : null;
  const voiceDb = voiceTarget === '+100' ? 100 : voiceTarget === '-100' ? -100 : null;

  return {
    selectedGrade,
    effectiveCriteria,
    naturesOf,
    suggestions,
    targetLabel,
    bodyMedal,
    voiceTarget,
    voiceDb,
    weightPercent: bodyMedal === '大块头' ? 100 : bodyMedal === '小不点' ? 0 : null,
  };
}
