import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  it('基础形态带蛋 → 归自己', () => {
    const base = pet({ game_id: 3784, name: '云梦豚' });
    assert.equal(wikiEggBaseOf(base, [base]), 3784);
  });

  it('进化形态 → 归同一进化链里 stage 最小的带蛋形态', () => {
    const base = pet({ game_id: 3784, stage: 1 });
    const grown = pet({ game_id: 3785, stage: 2 });
    assert.equal(wikiEggBaseOf(grown, [base, grown]), 3784);
  });

  it('没有蛋信息 → null', () => {
    const noEgg = pet({ image: { has_egg: false }, ecology: {} });
    assert.equal(wikiEggBaseOf(noEgg, [noEgg]), null);
  });

  it('ecology.eggs 也算有蛋', () => {
    const withEcology = pet({ image: {}, ecology: { eggs: [{ name: '示例的蛋' }] } });
    assert.equal(wikiEggBaseOf(withEcology, [withEcology]), 1);
  });

  it('基础形态蛋组是「未发现」→ 不算蛋物种', () => {
    const base = pet({ egg_group: [1] });
    assert.equal(wikiEggBaseOf(base, [base]), null);
  });
});
