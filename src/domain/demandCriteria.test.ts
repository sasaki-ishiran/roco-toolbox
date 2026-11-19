import { describe, expect, test } from 'vitest';
import {
  eggMapOf,
  findBreedableSupply,
  findMatchingPet,
  groupFreshness,
  hasStockForDemand,
  hasStockForStudDemand,
  findStudBreedableSupply,
  matchesParentGrade,
  memberFreshness,
  pairOptionsForEgg,
  petMatchesDemand,
  studHatchOptions,
} from './demandCriteria';
import type { SpeciesEntry } from './types';
import type { DemandCriteria } from '../shared/collectionGroups';
import {
  FIXTURE_TIME,
  catalog,
  member,
  mother,
  resourceWith,
  sharedAccount,
  snapshot,
} from '../test/fixtures/motherSharing';

const DAY = 86_400_000;

/** 三号蛋组的一只种公，用来验证「同账号可孵」。 */
const male3: SpeciesEntry = {
  key: 'male-3',
  gameId: 701,
  name: '三组公',
  number: '701',
  eggGameId: 701,
  eggGroups: [3],
  stage: 1,
  maleCapable: true,
};

const species: SpeciesEntry[] = [...catalog, male3];

/** 水蓝蓝能出公的版本：验证「需求为公」时也能同账号配出来。 */
const speciesWithMale201: SpeciesEntry[] = [
  ...catalog,
  { ...catalog.find((entry) => entry.gameId === 201)!, maleCapable: true },
  male3,
];

/** 全部字段都不挑：只要血脉对就算匹配。 */
const anyCriteria: DemandCriteria = {
  eggGameId: 101,
  nature: '',
  gender: '',
  body: '',
  voice: '',
};

describe('petMatchesDemand', () => {
  test('空字段（不挑 / 不限）直接跳过，不参与匹配', () => {
    const anyFire = mother(101, { gender: '公', nature: '抓狂', voiceDb: 0, medalBody: '' });
    expect(petMatchesDemand(anyFire, anyCriteria, eggMapOf(species))).toBe(true);
  });

  test('选了哪个字段就只校验哪个字段', () => {
    const male = mother(101, { gender: '公' });
    const eggOf = eggMapOf(species);
    expect(petMatchesDemand(male, { ...anyCriteria, gender: '母' }, eggOf)).toBe(false);
    expect(petMatchesDemand(male, { ...anyCriteria, gender: '公' }, eggOf)).toBe(true);

    const small = mother(101, { medalBody: '小不点' });
    expect(petMatchesDemand(small, { ...anyCriteria, body: '大块头' }, eggOf)).toBe(false);
    expect(petMatchesDemand(small, { ...anyCriteria, body: '' }, eggOf)).toBe(true);

    const quiet = mother(101, { voiceDb: 0 });
    expect(petMatchesDemand(quiet, { ...anyCriteria, voice: '+100' }, eggOf)).toBe(false);
    expect(petMatchesDemand(quiet, { ...anyCriteria, voice: '' }, eggOf)).toBe(true);

    const calm = mother(101, { nature: '开朗' });
    expect(petMatchesDemand(calm, { ...anyCriteria, nature: '固执' }, eggOf)).toBe(false);
    expect(petMatchesDemand(calm, { ...anyCriteria, nature: '开朗' }, eggOf)).toBe(true);
  });

  test('声音匹配与 petFilters 同口径：婉转声 ≥96、粗嗓门 ≤-96，满分只认 ±100', () => {
    const eggOf = eggMapOf(species);
    const at = (voiceDb: number) => mother(101, { medalBody: '大块头', voiceDb });
    expect(petMatchesDemand(at(96), { ...anyCriteria, voice: '婉转声' }, eggOf)).toBe(true);
    expect(petMatchesDemand(at(95), { ...anyCriteria, voice: '婉转声' }, eggOf)).toBe(false);
    expect(petMatchesDemand(at(-96), { ...anyCriteria, voice: '粗嗓门' }, eggOf)).toBe(true);
    expect(petMatchesDemand(at(-95), { ...anyCriteria, voice: '粗嗓门' }, eggOf)).toBe(false);
    expect(petMatchesDemand(at(99), { ...anyCriteria, voice: '+100' }, eggOf)).toBe(false);
  });

  test('满分体型（满体重 / 零体重）按体重百分位 100% / 0% 判定（2026-11-01）', () => {
    const eggOf = eggMapOf(species);
    // 有奖牌 + 体重正好 100% 才算满体重；98% 的大块头不算
    const full = mother(101, { medalBody: '大块头', weightPercent: 100 });
    const near = mother(101, { medalBody: '大块头', weightPercent: 98 });
    expect(petMatchesDemand(full, { ...anyCriteria, body: '满体重' }, eggOf)).toBe(true);
    expect(petMatchesDemand(near, { ...anyCriteria, body: '满体重' }, eggOf)).toBe(false);
    // 满体重也满足普通「大块头」口径（极端档是奖牌档的子集）
    expect(petMatchesDemand(full, { ...anyCriteria, body: '大块头' }, eggOf)).toBe(true);

    const zero = mother(101, { medalBody: '小不点', weightPercent: 0 });
    expect(petMatchesDemand(zero, { ...anyCriteria, body: '零体重' }, eggOf)).toBe(true);
    expect(petMatchesDemand(zero, { ...anyCriteria, body: '小不点' }, eggOf)).toBe(true);
    // 缺体重字段 → 判不了，不猜
    const noWeight = mother(101, { medalBody: '大块头' });
    expect(petMatchesDemand(noWeight, { ...anyCriteria, body: '满体重' }, eggOf)).toBe(false);
  });

  test('进化形态也算同一颗蛋', () => {
    const evolved = mother(102, { nature: '开朗' });
    const criteria = { ...anyCriteria, nature: '开朗' };
    expect(petMatchesDemand(evolved, criteria, eggMapOf(species))).toBe(true);
  });
});

describe('findMatchingPet / hasStockForDemand', () => {
  test('背包里有完全匹配的个体就是现货，进化形态也认', () => {
    const snapshots = [snapshot(1001, '甲', [mother(102, { nature: '胆小' })])];
    const criteria = { ...anyCriteria, nature: '胆小' };
    expect(hasStockForDemand(snapshots, criteria, species)).toBe(true);
    const match = findMatchingPet(snapshots, criteria, species);
    expect(match?.pet.gameId).toBe(102);
    expect(match?.snapshot.accountKey).toBe('uid:1001');
  });

  test('性格不对、或只有别的蛋血脉，都不算现货', () => {
    const snapshots = [snapshot(1001, '甲', [mother(201)])];
    expect(hasStockForDemand(snapshots, anyCriteria, species)).toBe(false);
    expect(hasStockForDemand([], anyCriteria, species)).toBe(false);
  });
});

describe('findBreedableSupply', () => {
  test('只有一只现货、配不出另一半时不算能接（只认配对孵蛋）', () => {
    const snapshots = [snapshot(1001, '甲', [mother(201)])];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '', gender: '', body: '', voice: '' },
      species,
    );
    expect(supply.kind).toBe('none');
  });

  test('同账号有目标母本 + 同蛋组公、且性格落在父母任一方时，算可孵', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201),
        mother(701, { gender: '公', nature: '固执' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '固执', gender: '母', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.motherGameId).toBe(201);
    expect(supply.maleGameId).toBe(701);
  });

  test('公本可以是同蛋组的进化形态，不要求是蛋物种本体', () => {
    // 102 火神是 101 火花的进化形态（eggGameId=101，同蛋组 2），当公本一样能配
    const snapshots = [
      snapshot(1001, '甲', [
        mother(101, { nature: '开朗' }),
        mother(102, { gender: '公', nature: '固执' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 101, nature: '固执', gender: '母', body: '大块头', voice: '+100' },
      catalog,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.motherGameId).toBe(101);
    expect(supply.maleGameId).toBe(102);
  });

  test('公也必须同档位：非大块头 / 非 +100 的公不算可孵', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201),
        mother(701, { gender: '公', nature: '固执', medalBody: '', voiceDb: 0 }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '固执', gender: '母', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('none');
  });

  test('身高到顶直接等效大块头：父母双方都要同时满足', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { medalBody: '', heightPercent: 100, weightPercent: 1 }),
        mother(701, { gender: '公', nature: '固执', medalBody: '', heightPercent: 100, weightPercent: 1 }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '固执', gender: '母', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.motherGameId).toBe(201);
    expect(supply.maleGameId).toBe(701);
  });

  test('身高不足 100% 时不等效大块头', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { medalBody: '', heightPercent: 99.9, weightPercent: 100 }),
        mother(701, { gender: '公', nature: '固执' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '固执', gender: '母', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('none');
  });

  test('母本自带目标性格时，公可以不带目标性格', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { nature: '固执' }),
        mother(701, { gender: '公', nature: '开朗' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '固执', gender: '公', body: '大块头', voice: '+100' },
      speciesWithMale201,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.motherGameId).toBe(201);
    expect(supply.maleGameId).toBe(701);
  });

  test('性格在父母两边都没有时不硬凑', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201),
        mother(701, { gender: '公', nature: '开朗' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '固执', gender: '母', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('none');
  });

  test('不挑性格时，只要同账号能配出这颗蛋就算可孵（需求为公）', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { nature: '开朗' }),
        mother(701, { gender: '公', nature: '抓狂' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '', gender: '公', body: '', voice: '' },
      speciesWithMale201,
    );
    expect(supply.kind).toBe('breedable');
  });

  test('纯母物种要不到公：直接判不可孵', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(301),
        mother(701, { gender: '公', nature: '固执' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 301, nature: '', gender: '公', body: '', voice: '' },
      species,
    );
    expect(supply.kind).toBe('none');
  });

  test('两个账号各缺一半时，不会跨账号拼配对', () => {
    const snapshots = [
      snapshot(1001, '甲', [mother(201)]),
      snapshot(1002, '乙', [mother(701, { gender: '公' })]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '固执', gender: '母', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('none');
  });

  test('同图鉴号多只母本时，返回达标的那只，不是背包里第一只', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        // 同图鉴号第一只：不达标（-4dB、普通体型）；只有第二只是大块头 + 100dB
        mother(201, { nature: '专注', medalBody: '', heightPercent: 33.3, weightPercent: 30.7, voiceDb: -4 }),
        mother(201, { nature: '开朗' }),
        mother(701, { gender: '公', nature: '胆小' }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '胆小', gender: '', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.motherPet?.pet.voiceDb).toBe(100);
    expect(supply.motherPet?.pet.medalBody).toBe('大块头');
  });

  test('同图鉴号多只公本时，返回达标的那只，不按性格挑到 96dB', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { nature: '急躁' }),
        // 同图鉴号第一只公：带目标性格但只有 96dB，孵不出 +100
        mother(701, { gender: '公', nature: '急躁', voiceDb: 96 }),
        mother(701, { gender: '公', nature: '开朗', voiceDb: 100 }),
      ]),
    ];
    const supply = findBreedableSupply(
      snapshots,
      { eggGameId: 201, nature: '急躁', gender: '母', body: '大块头', voice: '+100' },
      species,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.malePet?.pet.voiceDb).toBe(100);
    expect(supply.malePet?.pet.nature).toBe('开朗');
  });
});

describe('种公需求（负数蛋组 id）', () => {
  test('组内任意蛋能凑出同账号一对时，返回具体母本 × 公', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { nature: '固执' }),
        mother(701, { gender: '公', nature: '开朗' }),
      ]),
    ];
    const supply = findStudBreedableSupply(
      snapshots,
      { eggGameId: -3, nature: '固执', body: '大块头', voice: '+100' },
      speciesWithMale201,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.eggGameId).toBe(201);
    expect(supply.motherPet?.pet.gameId).toBe(201);
    expect(supply.malePet?.pet.gameId).toBe(701);
  });

  test('同一个图鉴号有多只时，优先展示带目标性格的那只', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { nature: '开朗' }),
        mother(201, { nature: '固执' }),
        mother(701, { gender: '公', nature: '固执' }),
      ]),
    ];
    const supply = findStudBreedableSupply(
      snapshots,
      { eggGameId: -3, nature: '固执', body: '大块头', voice: '+100' },
      speciesWithMale201,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.motherPet?.pet.nature).toBe('固执');
  });

  test('同图鉴号多只时返回达标的那只，不按性格挑到不达标个体', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        // 同图鉴号第一只：带目标性格但不达标（声音 0dB、非大块头）
        mother(201, { nature: '固执', medalBody: '', heightPercent: 40, weightPercent: 40, voiceDb: 0 }),
        mother(201, { nature: '固执' }),
        mother(701, { gender: '公', nature: '固执' }),
      ]),
    ];
    const supply = findStudBreedableSupply(
      snapshots,
      { eggGameId: -3, nature: '固执', body: '大块头', voice: '+100' },
      speciesWithMale201,
    );
    expect(supply.kind).toBe('breedable');
    expect(supply.motherPet?.pet.voiceDb).toBe(100);
    expect(supply.motherPet?.pet.medalBody).toBe('大块头');
  });

  test('完成校验：背包里有任意同组物种的符合条件的公就算满足', () => {
    const stock = [snapshot(1001, '甲', [mother(201, { gender: '公', nature: '固执' })])];
    expect(
      hasStockForStudDemand(
        stock,
        { eggGameId: -3, nature: '固执', body: '大块头', voice: '+100' },
        speciesWithMale201,
      ),
    ).toBe(true);
    expect(
      hasStockForStudDemand(
        [snapshot(1001, '甲', [mother(201, { nature: '固执' })])],
        { eggGameId: -3, nature: '固执', body: '大块头', voice: '+100' },
        speciesWithMale201,
      ),
    ).toBe(false);
  });
});

describe('配对按概率排序（2026-10-30 石岚号漏选 60% 的回归）', () => {
  /** 同一个蛋组的三组蛋：图鉴顺序 801 → 802，但 802 才带目标性格。 */
  const eggLow: SpeciesEntry = {
    key: 'egg-low',
    gameId: 801,
    name: '低概率蛋',
    number: '801',
    eggGameId: 801,
    eggGroups: [3],
    stage: 1,
    maleCapable: true,
  };
  const eggHigh: SpeciesEntry = {
    key: 'egg-high',
    gameId: 802,
    name: '高概率蛋',
    number: '802',
    eggGameId: 802,
    eggGroups: [3],
    stage: 1,
    maleCapable: true,
  };
  const twoEggSpecies: SpeciesEntry[] = [...catalog, male3, eggLow, eggHigh];

  test('种公需求按概率挑蛋：双亲同性格的 60% 优先于图鉴靠前的 30%', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        // 图鉴靠前的 801：母本不带目标性格，只能靠种公 → 30%
        mother(801, { nature: '开朗' }),
        // 图鉴靠后的 802：双亲都带「固执」→ 60%
        mother(802, { nature: '固执' }),
        mother(701, { gender: '公', nature: '固执' }),
      ]),
    ];
    const demand = { eggGameId: -3, nature: '固执', gender: '公', body: '大块头', voice: '+100' };
    const options = studHatchOptions(snapshots, demand, twoEggSpecies);
    expect(options.map((item) => item.eggGameId)).toEqual([802, 801]);
    // 主数字按家园口径：性格 60% × 性别 50% = 30%；801 只有 30% × 50% = 15%
    expect(options[0].chance).toBeCloseTo(0.3);
    expect(options[1].chance).toBeCloseTo(0.15);
    // 布尔判断（能不能接）只找第一颗能孵的蛋就停，不参与概率排序
    expect(findStudBreedableSupply(snapshots, demand, twoEggSpecies).kind).toBe('breedable');
  });

  test('不挑性格：同一账号的多个母本都要能出现，不被第一只吃满名额（2026-11-02）', () => {
    const snapshots = [
      snapshot(1001, '石岚', [
        mother(101, { captureId: 'silent', nature: '沉默' }),
        mother(102, { gender: '公', captureId: 'male-1' }),
        mother(102, { gender: '公', captureId: 'male-2' }),
        mother(102, { gender: '公', captureId: 'male-3' }),
        mother(102, { captureId: 'blue', nature: '忧郁' }),
      ]),
    ];
    const criteria: DemandCriteria = {
      eggGameId: 101,
      nature: '',
      gender: '母',
      body: '',
      voice: '',
    };
    const options = pairOptionsForEgg(snapshots, criteria, species, 3);
    // 三组名额里必须给第二只母本留一个，否则「仓库里有满足的精灵却选不到」
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.motherPet.pet.captureId)).toContain('blue');
    // limit=1 仍只取全局第一组，findBreedableSupply 的口径不变
    expect(pairOptionsForEgg(snapshots, criteria, species, 1)).toHaveLength(1);
  });

  test('只有一只母本时也要用满名额，不把同样合法的公截掉（2026-11-19）', () => {
    const snapshots = [
      snapshot(1001, '石岚', [
        mother(101, { captureId: 'only-mother' }),
        mother(102, { gender: '公', captureId: 'male-1' }),
        mother(102, { gender: '公', captureId: 'male-2' }),
        mother(102, { gender: '公', captureId: 'male-3' }),
      ]),
    ];
    const criteria: DemandCriteria = { eggGameId: 101, nature: '', gender: '母', body: '大块头', voice: '+100' };
    expect(pairOptionsForEgg(snapshots, criteria, species, 3)).toHaveLength(3);
  });

  test('不挑性格：接单人优先推荐带推荐性格的配对（2026-11-03）', () => {
    /** 火花蛋的推荐性格是「固执」（真实数据来自图鉴的 PVP 推荐表）。 */
    const withRecommended: SpeciesEntry[] = catalog.map((entry) =>
      entry.gameId === 101 ? { ...entry, recommendedNatures: ['固执'] } : entry,
    );
    const snapshots = [
      snapshot(1001, '石岚', [
        mother(101, { captureId: 'adamant-mother', nature: '固执' }),
        mother(101, { captureId: 'rash-mother', nature: '急躁' }),
        mother(102, { captureId: 'rash-male', gender: '公', nature: '急躁' }),
        mother(102, { captureId: 'adamant-male', gender: '公', nature: '固执' }),
      ]),
    ];
    const criteria: DemandCriteria = {
      eggGameId: 101,
      nature: '',
      gender: '母',
      body: '大块头',
      voice: '+100',
    };
    // 先出现的「固执母 × 急躁公」不能当推荐；双亲都带推荐性格的那对排第一
    const options = pairOptionsForEgg(snapshots, criteria, withRecommended);
    expect(options[0].motherPet.pet.captureId).toBe('adamant-mother');
    expect(options[0].malePet.pet.captureId).toBe('adamant-male');
    // 覆盖表指定另一组推荐性格时按覆盖的来
    const overridden = pairOptionsForEgg(snapshots, criteria, withRecommended, 3, false, ['急躁']);
    expect(overridden[0].motherPet.pet.captureId).toBe('rash-mother');
    expect(overridden[0].malePet.pet.captureId).toBe('rash-male');
  });

  test('多账号时取概率最高的那一对（原来按账号顺序会拿到 30%）', () => {
    const snapshots = [
      // 先导入的号：种公不带目标性格 → 30%
      snapshot(1001, '甲', [
        mother(201, { nature: '固执' }),
        mother(701, { gender: '公', nature: '开朗' }),
      ]),
      // 后导入的号：双亲都带 → 60%
      snapshot(1002, '乙', [
        mother(201, { nature: '固执' }),
        mother(701, { gender: '公', nature: '固执' }),
      ]),
    ];
    const criteria: DemandCriteria = {
      eggGameId: 201,
      nature: '固执',
      gender: '母',
      body: '大块头',
      voice: '+100',
    };
    const options = pairOptionsForEgg(snapshots, criteria, speciesWithMale201);
    expect(options[0].natureChance).toBe(0.6);
    expect(options[0].malePet.snapshot.accountName).toBe('乙');
    expect(findBreedableSupply(snapshots, criteria, speciesWithMale201).kind).toBe('breedable');
  });

  test('绿窝需求：性格按学院小窝 100% 算，不再按单方 30% / 双亲 60%', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        // 只有母本带目标性格 → 普通窝是 30%
        mother(201, { nature: '固执' }),
        // 三号蛋组的母 / 公，用来验证种公需求的绿窝概率
        mother(701, { nature: '固执' }),
        mother(701, { gender: '公', nature: '开朗' }),
      ]),
    ];
    const criteria: DemandCriteria = {
      eggGameId: 201,
      nature: '固执',
      gender: '母',
      body: '大块头',
      voice: '+100',
    };
    const normal = pairOptionsForEgg(snapshots, criteria, speciesWithMale201);
    expect(normal[0].natureChance).toBe(0.3);
    expect(normal[0].greenNest).toBe(false);

    const green = pairOptionsForEgg(snapshots, criteria, speciesWithMale201, 3, true);
    expect(green[0].natureChance).toBe(1);
    expect(green[0].greenNest).toBe(true);

    // 种公需求同样认绿窝：性格 100% × 性别 50% = 50%
    const studDemand = {
      eggGameId: -3,
      nature: '固执',
      gender: '公',
      body: '大块头',
      voice: '+100',
      requireGreenNest: true,
    };
    const [studBest] = studHatchOptions(snapshots, studDemand, speciesWithMale201);
    expect(studBest.greenNest).toBe(true);
    expect(studBest.chance).toBeCloseTo(0.5);
  });
});

describe('满体重 / 零体重：父母按普通档位匹配，交付才要求满分（2026-11-01）', () => {
  const nearFull = mother(101, { medalBody: '大块头', weightPercent: 98 });
  const nearFullMale = mother(101, { gender: '公', medalBody: '大块头', weightPercent: 98 });
  const full = mother(101, { medalBody: '大块头', weightPercent: 100 });
  const criteria: DemandCriteria = {
    eggGameId: 101,
    nature: '',
    gender: '母',
    body: '满体重',
    voice: '',
  };

  test('父母只要是大块头就能配，不要求本身就 100% 体重', () => {
    expect(matchesParentGrade(nearFull, criteria)).toBe(true);
    const options = pairOptionsForEgg([snapshot(1001, '甲', [nearFull, nearFullMale])], criteria, species);
    expect(options).toHaveLength(1);
  });

  test('结单 / 现货仍然严格要求满体重', () => {
    const eggOf = eggMapOf(species);
    expect(petMatchesDemand(nearFull, criteria, eggOf)).toBe(false);
    expect(petMatchesDemand(full, criteria, eggOf)).toBe(true);
  });
});

describe('数据新鲜度', () => {
  test('没发布的成员算不新鲜', () => {
    expect(memberFreshness(member('A', null))).toEqual({
      published: false,
      days: null,
      stale: true,
    });
  });

  test('按导出时间算天数；超过 7 天算旧', () => {
    const fresh = member('A', resourceWith([101]));
    const freshResult = memberFreshness(fresh, Date.parse(FIXTURE_TIME) + 2 * DAY);
    expect(freshResult.published).toBe(true);
    expect(freshResult.days).toBe(2);
    expect(freshResult.stale).toBe(false);

    const old = member(
      'B',
      resourceWith([], {
        accounts: [sharedAccount(1002, [], { sourceExportedAt: new Date(Date.now() - 10 * DAY).toISOString() })],
      }),
    );
    const oldResult = memberFreshness(old);
    expect(oldResult.days).toBe(10);
    expect(oldResult.stale).toBe(true);
  });

  test('组新鲜度按最旧账号判：一人旧就整组数据不全', () => {
    const old = member(
      'B',
      resourceWith([], {
        accounts: [sharedAccount(1002, [], { sourceExportedAt: new Date(Date.now() - 10 * DAY).toISOString() })],
      }),
    );
    const result = groupFreshness([member('A', resourceWith([101])), old, member('C', null)]);
    expect(result.total).toBe(3);
    expect(result.fresh).toBe(1);
    expect(result.stale).toBe(2);
    expect(result.staleMemberIds).toEqual(['B', 'C']);
  });
});
