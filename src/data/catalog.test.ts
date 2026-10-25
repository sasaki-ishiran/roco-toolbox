import { describe, expect, test } from 'vitest';
import { species } from './catalog';

describe('图鉴数据', () => {
  test('新赛季精灵（云梦豚 / 长江豚）已按蛋物种接入', () => {
    const base = species.find((entry) => entry.name === '云梦豚');
    const grown = species.find((entry) => entry.name === '长江豚');
    expect(base?.eggGameId).toBe(base?.gameId);
    // 长江豚是进化形态，归到云梦豚那颗蛋
    expect(grown?.eggGameId).toBe(base?.gameId);
  });

  test('可孵蛋物种都有蛋归属；图鉴缺性别比例时不能当成纯母', () => {
    const missing = species.filter(
      (entry) => entry.eggGroups.some((group) => group >= 2 && group <= 15) && entry.eggGameId == null,
    );
    expect(missing.map((entry) => entry.name)).toEqual([]);
    const base = species.find((entry) => entry.name === '云梦豚');
    expect(base?.maleCapable).toBe(true);
  });
});
