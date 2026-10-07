import { describe, expect, test } from 'vitest';
import { computeMotherCoverage } from './motherCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

const species: SpeciesEntry[] = [
  // 单形态：三个阶段共享一颗蛋（蛋物种 = 伊雷龙）
  { key: 'pet_a1', gameId: 101, name: '伊雷龙', number: '203', stage: 1, evolutionId: 'evo_ilan', eggGroups: [14], eggGameId: 101 },
  { key: 'pet_a2', gameId: 102, name: '伊兰亚龙', number: '204', stage: 2, evolutionId: 'evo_ilan', eggGroups: [14], eggGameId: 101 },
  { key: 'pet_a3', gameId: 103, name: '伊兰龙', number: '204', stage: 4, evolutionId: 'evo_ilan', eggGroups: [14], eggGameId: 101 },
  // 多形态：两种样子各一颗蛋
  { key: 'pet_b1', gameId: 201, name: '岚鸟', form: '春天的样子', number: '020', stage: 3, evolutionId: 'evo_bird_spring', eggGroups: [5], eggGameId: 201 },
  { key: 'pet_b2', gameId: 202, name: '岚鸟', form: '夏天的样子', number: '020', stage: 3, evolutionId: 'evo_bird_summer', eggGroups: [5], eggGameId: 202 },
  // 不可孵蛋
  { key: 'pet_c1', gameId: 301, name: '迪莫', number: '001', stage: 1, evolutionId: 'evo_dimo', eggGroups: [1], eggGameId: null },
];

const mother = (gameId: number, account = '账号A'): OwnedPet => ({
  gameId,
  name: 'x',
  gender: '母',
  nature: '开朗',
  voiceDb: 99,
  medalBody: '',
  isShiny: false,
  account,
});
const male = (gameId: number): OwnedPet => ({ ...mother(gameId), gender: '公' });

describe('computeMotherCoverage', () => {
  test('母本计数单位是「蛋」，同一颗蛋的各个进化阶段算一个目标', () => {
    const result = computeMotherCoverage(species, [mother(102)], 'perfect');
    expect(result.total).toBe(3); // 伊兰蛋 + 岚鸟春 + 岚鸟夏；迪莫不可孵蛋不计
    const ilan = result.items.find((item) => item.chainKey === 'egg:101');
    expect(ilan?.collected).toBe(true);
    expect(ilan?.motherName).toBe('伊兰亚龙');
    expect(result.collected).toBe(1);
  });

  test('多形态精灵按形态分别统计', () => {
    const result = computeMotherCoverage(species, [mother(201)], 'perfect');
    const spring = result.items.find((item) => item.chainKey === 'egg:201');
    const summer = result.items.find((item) => item.chainKey === 'egg:202');
    expect(spring?.collected).toBe(true);
    expect(summer?.collected).toBe(false);
    expect(spring?.formLabel).toBe('岚鸟_春天的样子');
  });

  test('只有公的不算母本', () => {
    const result = computeMotherCoverage(species, [male(103)], 'perfect');
    expect(result.collected).toBe(0);
  });

  test('没有可孵蛋链时不除零', () => {
    const result = computeMotherCoverage([species[5]], [], 'perfect');
    expect(result.total).toBe(0);
    expect(result.collected).toBe(0);
  });

  test('统计优质母本链：只有「大块头 + 满分」的母本才算', () => {
    const weak = computeMotherCoverage(species, [mother(102)], 'perfect');
    expect(weak.collected).toBe(1);
    expect(weak.qualityCollected).toBe(0); // 普通母本配满分公也孵不出满分大块头

    const quality = computeMotherCoverage(
      species,
      [{ ...mother(102), medalBody: '大块头', voiceDb: 100 }],
      'perfect',
    );
    expect(quality.collected).toBe(1);
    expect(quality.qualityCollected).toBe(1);
  });

  test('母本全收集：追满分下只有满分 4 档才算收集，不够满分的母本不算', () => {
    const plain = computeMotherCoverage(species, [mother(102)], 'perfect');
    expect(plain.collected).toBe(1); // 任意母本 → 覆盖
    expect(plain.fullCollected).toBe(0); // 但没有牌子 → 不算收集

    const notFullScore = computeMotherCoverage(
      species,
      [{ ...mother(102), medalBody: '大块头', voiceDb: 98 }],
      'perfect',
    );
    expect(notFullScore.fullCollected).toBe(0); // 98dB 不是满分，不统计

    const sweetBig = computeMotherCoverage(
      species,
      [{ ...mother(102), medalBody: '大块头', voiceDb: 100 }],
      'perfect',
    );
    expect(sweetBig.fullCollected).toBe(1); // 大婉

    const roughSmall = computeMotherCoverage(
      species,
      [{ ...mother(102), medalBody: '小不点', voiceDb: -100 }],
      'perfect',
    );
    expect(roughSmall.fullCollected).toBe(1); // 小粗
  });

  test('追双牌下 96~99 的母本也算合格收集', () => {
    const nearFull = [{ ...mother(102), medalBody: '大块头', voiceDb: 97 }];
    expect(computeMotherCoverage(species, nearFull, 'medal').fullCollected).toBe(1);
    expect(computeMotherCoverage(species, nearFull, 'perfect').fullCollected).toBe(0);
  });

  test('同一物种有多只母本时，不能只看第一只（回归：曾漏掉合格的那只）', () => {
    const plainFirst = { ...mother(102) };
    const qualifiedSecond = { ...mother(102), medalBody: '大块头', voiceDb: 100 };
    const result = computeMotherCoverage(species, [plainFirst, qualifiedSecond], 'perfect');
    expect(result.collected).toBe(1);
    expect(result.fullCollected).toBe(1);
    // 展示的 Mother 应取等级更高的那只（大婉）
    expect(result.items.find((item) => item.collected)?.motherName).toBe('伊兰亚龙');
  });
});
