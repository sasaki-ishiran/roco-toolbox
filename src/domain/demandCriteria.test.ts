import { describe, expect, test } from 'vitest';
import {
  eggMapOf,
  findBreedableSupply,
  findMatchingPet,
  groupFreshness,
  hasStockForDemand,
  hasStockForStudDemand,
  findStudBreedableSupply,
  memberFreshness,
  petMatchesDemand,
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

  test('身高到顶且体重 ≥95% 才能当大块头：父母双方都要同时满足', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { medalBody: '', heightPercent: 100, weightPercent: 95 }),
        mother(701, { gender: '公', nature: '固执', medalBody: '', heightPercent: 100, weightPercent: 95 }),
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

  test('身高 100% 但体重不足 95% 时不算大块头', () => {
    const snapshots = [
      snapshot(1001, '甲', [
        mother(201, { medalBody: '', heightPercent: 100, weightPercent: 94.9 }),
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
