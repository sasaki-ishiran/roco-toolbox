import { describe, expect, test } from 'vitest';
import { createNaturesResolver, defaultEggNatures, eggNatures } from './recommendedNatures';
import type { SpeciesEntry } from './types';

const entry = (patch: Partial<SpeciesEntry> & { gameId: number; name: string }): SpeciesEntry =>
  ({
    key: `pet_${patch.gameId}`,
    number: String(patch.gameId),
    eggGameId: patch.gameId,
    eggGroups: [2],
    stage: 1,
    ...patch,
  }) as SpeciesEntry;

const species: SpeciesEntry[] = [
  entry({ gameId: 101, name: '火花', recommendedNatures: ['固执'] }),
  entry({ gameId: 102, name: '火神', eggGameId: 101, stage: 3, recommendedNatures: ['开朗'] }),
  entry({
    gameId: 201,
    name: '水蓝蓝',
    stats: { hp: 50, atk: 40, spa: 80, def: 40, spd: 40, spe: 40 },
  }),
];

describe('推荐性格：图鉴优先，缺数据按种族值兜底', () => {
  test('有 PVP 推荐就用 PVP 推荐（一级形态按基础形态取）', () => {
    expect(defaultEggNatures(species, 101)).toEqual(['固执']);
  });

  test('同一进化链按最高形态的推荐（打 PVP 不用低阶）', () => {
    const chain: SpeciesEntry[] = [
      entry({ gameId: 301, name: '火花', evolutionId: 'evo-a', recommendedNatures: ['固执'] }),
      entry({
        gameId: 302,
        name: '火神',
        eggGameId: 301,
        stage: 3,
        evolutionId: 'evo-a',
        recommendedNatures: ['固执', '开朗'],
      }),
      entry({
        gameId: 303,
        name: '烈火战神_首领形态',
        eggGameId: 301,
        stage: 4,
        evolutionId: 'evo-a',
        form: '首领形态',
        recommendedNatures: ['认真'],
      }),
    ];
    // 首领形态不参与链顶选择
    expect(defaultEggNatures(chain, 301)).toEqual(['固执', '开朗']);
  });

  test('图鉴烘焙的「按蛋推荐」优先（多分支进化按最终形态汇总）', () => {
    const withEgg: SpeciesEntry[] = [
      entry({
        gameId: 501,
        name: '小灵面',
        recommendedNatures: ['调皮'],
        eggRecommendedNatures: ['胆小'],
      }),
    ];
    expect(defaultEggNatures(withEgg, 501)).toEqual(['胆小']);
  });

  test('图鉴没收录推荐性格的物种按种族值兜底（魔攻高 → 聪明）', () => {
    expect(defaultEggNatures(species, 201)).toEqual(['聪明']);
  });

  test('用户/组长的覆盖优先于默认；空覆盖等于没改', () => {
    expect(eggNatures(species, 101, { '101': ['开朗', '固执'] })).toEqual(['开朗', '固执']);
    expect(eggNatures(species, 101, { '101': [] })).toEqual(['固执']);
  });

  test('解析器按蛋缓存：同一颗蛋的进化形态共用一份性格', () => {
    const naturesOf = createNaturesResolver({ species, overrides: { '101': ['开朗'] } });
    expect(naturesOf(101)).toEqual(['开朗']);
    expect(naturesOf(102)).toEqual(['开朗']);
    expect(naturesOf(201)).toEqual(['聪明']);
  });

  test('查不到物种时返回空，不瞎猜', () => {
    const naturesOf = createNaturesResolver({ species });
    expect(naturesOf(999)).toEqual([]);
  });
});
