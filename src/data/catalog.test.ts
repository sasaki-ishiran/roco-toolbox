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

  test('多分支进化的蛋按最终形态汇总推荐性格（2026-10-25）', () => {
    // 小灵面自己只有 30% 调皮，但两个分支最终形态都是胆小为主 → 只推胆小
    const soul = species.find((entry) => entry.name === '小灵面');
    expect(soul?.eggRecommendedNatures).toEqual(['胆小']);
    // 书魔虫两个分支各有主流（古卷执政官 聪明 / 古卷匣魔像 固执）→ 都保留
    const book = species.find((entry) => entry.name === '书魔虫');
    expect(book?.eggRecommendedNatures).toEqual(['聪明', '固执']);
  });
});
