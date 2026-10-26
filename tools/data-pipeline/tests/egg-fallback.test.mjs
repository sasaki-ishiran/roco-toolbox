import { describe, expect, test } from 'vitest';
import { wikiEggBaseOf } from '../src/egg-fallback.mjs';

const pet = (patch) => ({
  game_id: 1,
  name: '示例',
  stage: 1,
  evolution_id: 'evo-1',
  egg_group: [13],
  image: { has_egg: true },
  ...patch,
});

describe('wiki 蛋归属兜底', () => {
  test('基础形态带蛋 → 归自己', () => {
    const base = pet({ game_id: 3784, name: '云梦豚' });
    expect(wikiEggBaseOf(base, [base])).toBe(3784);
  });

  test('进化形态 → 归同一进化链里 stage 最小的带蛋形态', () => {
    const base = pet({ game_id: 3784, stage: 1 });
    const grown = pet({ game_id: 3785, stage: 2 });
    expect(wikiEggBaseOf(grown, [base, grown])).toBe(3784);
  });

  test('没有蛋信息 → null', () => {
    const noEgg = pet({ image: { has_egg: false }, ecology: {} });
    expect(wikiEggBaseOf(noEgg, [noEgg])).toBeNull();
  });

  test('ecology.eggs 也算有蛋', () => {
    const withEcology = pet({ image: {}, ecology: { eggs: [{ name: '示例的蛋' }] } });
    expect(wikiEggBaseOf(withEcology, [withEcology])).toBe(1);
  });

  test('基础形态蛋组是「未发现」→ 不算蛋物种', () => {
    const base = pet({ egg_group: [1] });
    expect(wikiEggBaseOf(base, [base])).toBeNull();
  });
});
