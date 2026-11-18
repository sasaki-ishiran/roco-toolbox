import { createModuleStore } from './createModuleStore';
import {
  DEFAULT_MOTHER_CRITERIA,
  MOTHER_BODY_OPTIONS,
  MOTHER_VOICE_OPTIONS,
  type MotherBody,
  type MotherCriteria,
  type MotherVoice,
} from '../domain/motherCriteria';
import type { PetGrade } from '../domain/petFilters';

export type { MotherBody, MotherCriteria, MotherVoice } from '../domain/motherCriteria';
export type { PetGrade } from '../domain/petFilters';
export {
  MOTHER_BODY_OPTIONS,
  MOTHER_VOICE_OPTIONS,
  matchesMotherVoice,
} from '../domain/motherCriteria';

const isVoice = (value: unknown): value is MotherVoice =>
  (MOTHER_VOICE_OPTIONS as readonly string[]).includes(value as string);
const isBody = (value: unknown): value is MotherBody =>
  (MOTHER_BODY_OPTIONS as readonly string[]).includes(value as string);
const MOTHER_GRADE_OPTIONS = ['大婉', '大粗', '小婉', '小粗'] satisfies readonly PetGrade[];
const isGrade = (value: unknown): value is PetGrade =>
  MOTHER_GRADE_OPTIONS.includes(value as PetGrade);

/**
 * 「待补齐母本」的达标标准（2026-10-05 用户拍板，取代旧开关）。
 *
 * 口径本身（什么是达标母本）在领域层 `src/domain/motherCriteria.ts`——
 * 看板「母本全收集」卡与母本页必须用同一份定义，否则两处数字会打架。
 * 这里只负责「存哪、持久化、给 hook」。
 */
const store = createModuleStore<MotherCriteria>(DEFAULT_MOTHER_CRITERIA, {
  persistKey: 'roco.motherCriteria',
  // 只在**字段缺失**（老数据）时补默认：体型 / 声音空数组表示该维度不限，
  // 组合奖牌空数组表示无组合；补默认会让用户主动清空的选择在重启后被偷偷还原。
  migrate: (loaded) => ({
    voices: Array.isArray(loaded.voices)
      ? loaded.voices.filter(isVoice)
      : [...DEFAULT_MOTHER_CRITERIA.voices],
    bodies: Array.isArray(loaded.bodies)
      ? loaded.bodies.filter(isBody)
      : [...DEFAULT_MOTHER_CRITERIA.bodies],
    ...(Array.isArray(loaded.grades) ? { grades: loaded.grades.filter(isGrade) } : {}),
    // 只在开启时落字段：老数据 / 关闭状态保持原样，避免把存量对象改胖
    ...(loaded.recommendedNatures === true ? { recommendedNatures: true } : {}),
  }),
});

export function getMotherCriteria(): MotherCriteria {
  return store.get();
}

export function setMotherCriteria(criteria: MotherCriteria): void {
  store.set(criteria);
}

export function useMotherCriteria(): MotherCriteria {
  return store.use();
}
