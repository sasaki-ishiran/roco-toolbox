import { createModuleStore } from './createModuleStore';
import {
  DEFAULT_MOTHER_CRITERIA,
  MOTHER_BODY_OPTIONS,
  MOTHER_VOICE_OPTIONS,
  type MotherBody,
  type MotherCriteria,
  type MotherVoice,
} from '../domain/motherCriteria';

export type { MotherBody, MotherCriteria, MotherVoice } from '../domain/motherCriteria';
export {
  MOTHER_BODY_OPTIONS,
  MOTHER_VOICE_OPTIONS,
  matchesMotherVoice,
} from '../domain/motherCriteria';

const isVoice = (value: unknown): value is MotherVoice =>
  (MOTHER_VOICE_OPTIONS as readonly string[]).includes(value as string);
const isBody = (value: unknown): value is MotherBody =>
  (MOTHER_BODY_OPTIONS as readonly string[]).includes(value as string);

/**
 * 「待补齐母本」的达标标准（2026-10-05 用户拍板，取代旧开关）。
 *
 * 口径本身（什么是达标母本）在领域层 `src/domain/motherCriteria.ts`——
 * 看板「母本全收集」卡与母本页必须用同一份定义，否则两处数字会打架。
 * 这里只负责「存哪、持久化、给 hook」。
 */
const store = createModuleStore<MotherCriteria>(DEFAULT_MOTHER_CRITERIA, {
  persistKey: 'roco.motherCriteria',
  // 只在**字段缺失**（老数据）时补默认：空数组是合法状态（该维度「不限」），
  // 母本页的「清除本组」就会产生空数组，补默认会让用户的清空在重启后被偷偷还原。
  migrate: (loaded) => ({
    voices: Array.isArray(loaded.voices)
      ? loaded.voices.filter(isVoice)
      : [...DEFAULT_MOTHER_CRITERIA.voices],
    bodies: Array.isArray(loaded.bodies)
      ? loaded.bodies.filter(isBody)
      : [...DEFAULT_MOTHER_CRITERIA.bodies],
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
