import { matchesVoiceOption, type MotherGroup, type TargetMode } from './petFilters';
import { bodyGradeOf } from '../shared/bodySize.js';
import type { OwnedPet } from './types';

/**
 * 「母本达标」的统一口径（2026-10-06 抽出）。
 *
 * 达标 = 该蛋（进化血脉）**有母本**同时命中「选中的体型」和「选中的声音」；
 * 某一维度一个都不选 = 该维度不限。
 *
 * 之所以要抽到领域层：「看板 · 母本全收集」卡的分子与「我的精灵 · 母本」页的
 * 「已收集」必须是**同一口径**——此前看板卡按单一档位算、母本页按达标条件算，
 * 卡上显示「满分大婉 12/142」、点进去却是「已收集 60/142」，用户会以为工具算错。
 */
export type MotherVoice = '婉转声' | '+100' | '-100' | '粗嗓门';
export type MotherBody = '大块头' | '小不点';

export interface MotherCriteria {
  voices: MotherVoice[];
  bodies: MotherBody[];
  /**
   * 是否要求母本性格为「推荐性格」（2026-10-25）。个人页与小组同一开关：
   * 小组由组长在目标里开启，组员按组长那份推荐性格表判定。
   */
  recommendedNatures?: boolean;
}

export const MOTHER_VOICE_OPTIONS: MotherVoice[] = ['婉转声', '+100', '-100', '粗嗓门'];
export const MOTHER_BODY_OPTIONS: MotherBody[] = ['大块头', '小不点'];

/** 默认 = 大块头+小不点 × +100/-100（即原「任意满分 4 档」口径）。 */
export const DEFAULT_MOTHER_CRITERIA: MotherCriteria = {
  voices: ['+100', '-100'],
  bodies: ['大块头', '小不点'],
};

/** 每个目标模式可用的声音档（与母本页筛选选项一致）。 */
export const motherVoicesForMode = (mode: TargetMode): MotherVoice[] =>
  mode === 'perfect' ? ['+100', '-100'] : ['婉转声', '粗嗓门'];

/**
 * 该模式下的**有效**声音选择：把与当前模式无交集的选择换成该模式的全集
 * （与母本页「模式切换后重置为该模式默认全选」的行为对齐，避免两处口径不一致）。
 * 原始选择为空（用户主动清空）= 不限，仍然返回空。
 */
export const effectiveMotherVoices = (
  voices: MotherVoice[],
  mode: TargetMode,
): MotherVoice[] => {
  const allowed = motherVoicesForMode(mode);
  const active = voices.filter((voice) => allowed.includes(voice));
  if (active.length > 0) return active;
  return voices.length > 0 ? allowed : [];
};

/** 声音数字是否命中某个声音选项（统一走 petFilters.matchesVoiceOption）。 */
export const matchesMotherVoice = (voiceDb: number, voices: readonly string[]): boolean =>
  voices.some((voice) => matchesVoiceOption(voiceDb, voice));

/**
 * 该精灵是否命中选中的体型。
 *
 * 口径与档位 / 种公完全一致（2026-10-28 用户确认）：奖牌优先；没有奖牌时
 * **身高 100% / 0% 且体重 ≥95% / ≤5% 同时满足**才算大块头 / 小不点。
 * 奖牌显示仍按体重 98% / 2%，这里只影响「够不够格当合格母本」。
 */
export function matchesMotherBody(pet: OwnedPet, bodies: readonly MotherBody[]): boolean {
  if (bodies.length === 0) return true;
  const body = bodyGradeOf(pet);
  return body !== '' && (bodies as readonly string[]).includes(body);
}

/** 单只精灵是否是「达标母本」。`naturesOf` 只在要求推荐性格时才会被用到。 */
export function isQualifiedMother(
  pet: OwnedPet,
  criteria: MotherCriteria,
  naturesOf?: (gameId: number) => readonly string[],
): boolean {
  if (pet.gender !== '母') return false;
  if (!matchesMotherBody(pet, criteria.bodies)) return false;
  if (criteria.voices.length > 0 && !matchesMotherVoice(pet.voiceDb, criteria.voices)) return false;
  if (criteria.recommendedNatures) {
    const allowed = naturesOf ? naturesOf(pet.gameId) : [];
    if (allowed.length === 0 || !allowed.includes(pet.nature)) return false;
  }
  return true;
}

/** 这条蛋（血脉）是否已收集 = 归属它的任意一只精灵是达标母本。 */
export function isChainCollected(
  group: MotherGroup,
  owned: OwnedPet[],
  criteria: MotherCriteria,
  naturesOf?: (gameId: number) => readonly string[],
): boolean {
  return group.memberIndexes.some((index) => isQualifiedMother(owned[index], criteria, naturesOf));
}

/** 已收集的蛋数（看板卡与母本页共用这一个计数）。 */
export function countQualifiedMotherChains(
  groups: MotherGroup[],
  owned: OwnedPet[],
  criteria: MotherCriteria,
  naturesOf?: (gameId: number) => readonly string[],
): number {
  return groups.filter((group) => isChainCollected(group, owned, criteria, naturesOf)).length;
}
