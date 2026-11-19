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

  test('没有奖牌时：身高 100% / 0% 直接等效大块头 / 小不点', () => {
    const bigOnly: MotherCriteria = { voices: ['+100'], bodies: ['大块头'] };
    const smallOnly: MotherCriteria = { voices: ['+100'], bodies: ['小不点'] };
    // 身高到顶 / 到底即等效对应体型，不受体重百分位影响。
    expect(isQualifiedMother(pet({ medalBody: '', heightPercent: 100, weightPercent: 1 }), bigOnly)).toBe(true);
    expect(isQualifiedMother(pet({ medalBody: '', heightPercent: 0, weightPercent: 99 }), smallOnly)).toBe(true);
    // 身高必须正好 100% / 0%，不对接近值放宽。
    expect(isQualifiedMother(pet({ medalBody: '', heightPercent: 99.9, weightPercent: 99 }), bigOnly)).toBe(false);
    // 真·小不点不会因为身高 100% 被算成大块头
    expect(isQualifiedMother(pet({ medalBody: '小不点', weightPercent: 0 }), bigOnly)).toBe(false);
    // 没有身高百分位（老数据）时保持原样，不靠猜
    expect(isQualifiedMother(pet({ medalBody: '' }), bigOnly)).toBe(false);
  });

  test('有奖牌时以奖牌为准，不再看身高 / 体重', () => {
    const bigOnly: MotherCriteria = { voices: ['+100'], bodies: ['大块头'] };
    expect(isQualifiedMother(pet({ medalBody: '大块头', heightPercent: 50, weightPercent: 90 }), bigOnly)).toBe(true);
    expect(isQualifiedMother(pet({ medalBody: '小不点', heightPercent: 100 }), bigOnly)).toBe(false);
  });

  test('母本孵蛋口径：无奖牌时身高 100% / 0% 即可，不再要求体重', () => {
    const big: MotherCriteria = { voices: ['+100'], bodies: ['大块头'] };
    expect(
      isQualifiedMother(pet({ medalBody: '', heightPercent: 100, weightPercent: 55 }), big),
    ).toBe(true);
    expect(
      isQualifiedMother(pet({ medalBody: '', heightPercent: 99, weightPercent: 100 }), big),
    ).toBe(false);
    const small: MotherCriteria = { voices: ['+100'], bodies: ['小不点'] };
    expect(
      isQualifiedMother(pet({ medalBody: '', heightPercent: 0, weightPercent: 45 }), small),
    ).toBe(true);
  });

  test('要求推荐性格时，性格不在推荐列表里的母本不算达标', () => {
    const criteria: MotherCriteria = {
      voices: ['+100'],
      bodies: ['大块头'],
      recommendedNatures: true,
    };
    const naturesOf = (gameId: number): string[] => (gameId === 1 ? ['固执'] : []);
    expect(isQualifiedMother(pet({ nature: '固执' }), criteria, naturesOf)).toBe(true);
    expect(isQualifiedMother(pet({ nature: '开朗' }), criteria, naturesOf)).toBe(false);
    // 没有解析器 / 解析不出推荐性格 = 无法判定，按不达标处理（与小组口径一致，不靠猜）
    expect(isQualifiedMother(pet({ nature: '固执' }), criteria)).toBe(false);
    // 不开开关时性格不参与判定
    expect(
      isQualifiedMother(pet({ nature: '开朗' }), { ...criteria, recommendedNatures: false }, naturesOf),
    ).toBe(true);
  });

  test('组合奖牌条件可精确筛选四种组合中的任意多项', () => {
    const criteria: MotherCriteria = {
      bodies: ['大块头', '小不点'],
      voices: ['+100'],
      grades: ['大婉', '小婉'],
      targetMode: 'perfect',
    };
    expect(isQualifiedMother(pet({ medalBody: '大块头', voiceDb: 100 }), criteria)).toBe(true);
    expect(isQualifiedMother(pet({ medalBody: '小不点', voiceDb: 100 }), criteria)).toBe(true);
    expect(isQualifiedMother(pet({ medalBody: '大块头', voiceDb: -100 }), criteria)).toBe(false);
    expect(isQualifiedMother(pet({ medalBody: '大块头', voiceDb: 98 }), criteria)).toBe(false);

    expect(
      isQualifiedMother(
        pet({ medalBody: '大块头', voiceDb: 97 }),
        { ...criteria, grades: ['大婉'], targetMode: 'medal' },
      ),
    ).toBe(true);
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
