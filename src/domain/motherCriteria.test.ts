import { describe, expect, test } from 'vitest';
import {
  countQualifiedMotherChains,
  effectiveMotherVoices,
  isQualifiedMother,
  type MotherCriteria,
} from './motherCriteria';
import type { MotherGroup } from './petFilters';
import type { OwnedPet } from './types';

const pet = (over: Partial<OwnedPet>): OwnedPet => ({
  gameId: 1,
  name: 'x',
  gender: '母',
  nature: '开朗',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '甲',
  ...over,
});

const group = (chainKey: string, memberIndexes: number[]): MotherGroup => ({
  chainKey,
  eggGameId: Number(chainKey.replace('egg:', '')),
  collected: false,
  quality: false,
  motherClass: null,
  formLabel: '某蛋',
  number: '001',
  eggGroups: [14],
  memberIndexes,
});

const DEFAULT: MotherCriteria = { voices: ['+100', '-100'], bodies: ['大块头', '小不点'] };

describe('母本达标口径（看板卡与母本页共用）', () => {
  test('只有母本、且命中体型与声音才算达标', () => {
    expect(isQualifiedMother(pet({}), DEFAULT)).toBe(true);
    expect(isQualifiedMother(pet({ gender: '公' }), DEFAULT)).toBe(false);
    expect(isQualifiedMother(pet({ medalBody: '' }), DEFAULT)).toBe(false);
    expect(isQualifiedMother(pet({ voiceDb: 98 }), DEFAULT)).toBe(false);
    expect(isQualifiedMother(pet({ voiceDb: -100, medalBody: '小不点' }), DEFAULT)).toBe(true);
  });

  test('某一维度一个都不选 = 该维度不限', () => {
    const bodyAny: MotherCriteria = { voices: ['+100', '-100'], bodies: [] };
    expect(isQualifiedMother(pet({ medalBody: '' }), bodyAny)).toBe(true);
    const voiceAny: MotherCriteria = { voices: [], bodies: ['大块头'] };
    expect(isQualifiedMother(pet({ voiceDb: 10 }), voiceAny)).toBe(true);
  });

  test('有效声音选择随目标模式联动（与母本页的「切换模式重置」行为一致）', () => {
    // 追满分：满分档就是当前模式的可选项，原样保留
    expect(effectiveMotherVoices(['+100', '-100'], 'perfect')).toEqual(['+100', '-100']);
    // 追双牌：满分档与该模式无交集 → 换成该模式的全集（婉转声 / 粗嗓门）
    expect(effectiveMotherVoices(['+100', '-100'], 'medal')).toEqual(['婉转声', '粗嗓门']);
    // 用户主动清空 = 不限，保持空
    expect(effectiveMotherVoices([], 'medal')).toEqual([]);
  });

  test('已收集计数 = 有达标母本的蛋数（与母本页同一函数）', () => {
    const owned = [pet({ voiceDb: 100, medalBody: '大块头' }), pet({ voiceDb: 10, medalBody: '' })];
    const groups = [group('egg:1', [0]), group('egg:2', [1]), group('egg:3', [])];
    expect(countQualifiedMotherChains(groups, owned, DEFAULT)).toBe(1);

    // 条件收窄到只认「小不点 + -100」→ 原本达标的那只不算了
    const narrowed: MotherCriteria = { voices: ['-100'], bodies: ['小不点'] };
    expect(countQualifiedMotherChains(groups, owned, narrowed)).toBe(0);
  });
});
