import { describe, expect, test } from 'vitest';
import { fallbackNature, recommendedNaturesForSpecies } from './studRecommendations';
import type { SpeciesEntry } from './types';

const species = (over: Partial<SpeciesEntry> = {}): SpeciesEntry => ({
  key: 'k',
  gameId: 1,
  name: 'x',
  number: '001',
  eggGroups: [2],
  ...over,
});

describe('fallbackNature（种族值兜底）', () => {
  test('未完虫型：特攻 > 物攻 → 聪明', () => {
    // 未完虫（3542）实景：魔攻 111 > 物攻 102 → 推荐聪明
    expect(
      fallbackNature({ hp: 86, atk: 102, def: 68, spa: 111, spd: 100, spe: 100 }),
    ).toBe('聪明');
  });

  test('物攻更高 → 固执', () => {
    expect(
      fallbackNature({ hp: 80, atk: 120, def: 70, spa: 60, spd: 70, spe: 80 }),
    ).toBe('固执');
  });

  test('速度型（速度远超攻击）→ 胆小', () => {
    expect(
      fallbackNature({ hp: 70, atk: 65, def: 60, spa: 65, spd: 60, spe: 110 }),
    ).toBe('胆小');
  });

  test('特攻向但速度突出：速度优先于攻向 → 胆小（m2：速度判断提到攻向之前）', () => {
    expect(
      fallbackNature({ hp: 70, atk: 80, def: 60, spa: 100, spd: 60, spe: 120 }),
    ).toBe('胆小');
  });

  test('物攻向但速度突出：同理 → 胆小（m2）', () => {
    expect(
      fallbackNature({ hp: 70, atk: 100, def: 60, spa: 80, spd: 60, spe: 120 }),
    ).toBe('胆小');
  });

  test('肉盾/辅助型（血高攻低）→ 沉默', () => {
    expect(
      fallbackNature({ hp: 130, atk: 40, def: 90, spa: 40, spd: 90, spe: 40 }),
    ).toBe('沉默');
  });

  test('没有明显倾向（六围接近）→ 踏实', () => {
    expect(
      fallbackNature({ hp: 70, atk: 72, def: 70, spa: 72, spd: 70, spe: 70 }),
    ).toBe('踏实');
  });
});

describe('recommendedNaturesForSpecies', () => {
  test('有 PVP 推荐：直接用 top2', () => {
    expect(
      recommendedNaturesForSpecies(species({ recommendedNatures: ['固执', '胆小'] })),
    ).toEqual(['固执', '胆小']);
  });

  test('无 PVP 推荐但有种族值：走兜底', () => {
    const entry = species({
      gameId: 3542,
      stats: { hp: 86, atk: 102, def: 68, spa: 111, spd: 100, spe: 100 },
    });
    expect(recommendedNaturesForSpecies(entry)).toEqual(['聪明']);
  });

  test('都没有：空数组', () => {
    expect(recommendedNaturesForSpecies(species())).toEqual([]);
    expect(recommendedNaturesForSpecies(undefined)).toEqual([]);
  });
});
