import { describe, expect, test } from 'vitest';
import type { LiveNearbyPet } from '../collector/captureProgress';
import type { CollectionDemand } from '../shared/collectionGroups';
import type { SpeciesEntry } from '../domain/types';
import { demandHitsForPet, demandSpeciesIndex } from './demandMatch';

const species: SpeciesEntry[] = [
  { key: 'pet_000001', gameId: 3001, name: '喵喵', number: '002', eggGroups: [6, 9], eggGameId: 3001, maleCapable: true },
  { key: 'pet_000002', gameId: 3002, name: '火花', number: '003', eggGroups: [3], eggGameId: 3002, maleCapable: true },
];
const index = demandSpeciesIndex(species);

const pet = (overrides: Partial<LiveNearbyPet> = {}): LiveNearbyPet => ({
  key: 'a', cfgId: 10000, petId: 3001, name: '喵喵', level: 10, voiceDb: 0,
  weightPct: 50, heightPct: 50, kinds: [], rare: false, alertReason: null, distanceM: null,
  ...overrides,
});

const demand = (overrides: Partial<CollectionDemand> = {}): CollectionDemand => ({
  groupId: 'g1', demanderAccountId: 'a1', eggGameId: 3001, nature: '', gender: '',
  body: '', voice: '', status: 'open', claimerAccountId: null, version: 1,
  createdAt: 0, updatedAt: 0, ...overrides,
});

describe('demandHitsForPet', () => {
  test('同种蛋、没有额外条件时命中', () => {
    expect(demandHitsForPet(pet(), [demand()], index)).toHaveLength(1);
  });

  test('不同物种不命中', () => {
    expect(demandHitsForPet(pet({ petId: 3002, name: '火花' }), [demand()], index)).toHaveLength(0);
  });

  test('未收录物种不命中', () => {
    expect(demandHitsForPet(pet({ petId: null }), [demand()], index)).toHaveLength(0);
    expect(demandHitsForPet(pet({ petId: 99999 }), [demand()], index)).toHaveLength(0);
  });

  test('体型条件：大块头要体重与身高同时 98% 以上', () => {
    expect(demandHitsForPet(pet({ weightPct: 99, heightPct: 100 }), [demand({ body: '大块头' })], index)).toHaveLength(1);
    expect(demandHitsForPet(pet({ weightPct: 50, heightPct: 100 }), [demand({ body: '大块头' })], index)).toHaveLength(0);
    expect(demandHitsForPet(pet({ weightPct: 100 }), [demand({ body: '满体重' })], index)).toHaveLength(1);
  });

  test('回归：格兰花 7.76/7.80kg（体重 98.9%、身高 60%）不算大块头', () => {
    expect(demandHitsForPet(pet({ weightPct: 98.88, heightPct: 60 }), [demand({ body: '大块头' })], index))
      .toHaveLength(0);
    expect(demandHitsForPet(pet({ weightPct: 100, heightPct: 100 }), [demand({ body: '大块头' })], index))
      .toHaveLength(1);
  });

  test('体型条件：小不点要体重与身高同时 2% 以下', () => {
    expect(demandHitsForPet(pet({ weightPct: 2, heightPct: 0 }), [demand({ body: '小不点' })], index)).toHaveLength(1);
    expect(demandHitsForPet(pet({ weightPct: 2, heightPct: 60 }), [demand({ body: '小不点' })], index)).toHaveLength(0);
    expect(demandHitsForPet(pet({ weightPct: 2, heightPct: null }), [demand({ body: '小不点' })], index)).toHaveLength(0);
  });

  test('声音条件：+100 必须正好 100', () => {
    expect(demandHitsForPet(pet({ voiceDb: 100 }), [demand({ voice: '+100' })], index)).toHaveLength(1);
    expect(demandHitsForPet(pet({ voiceDb: 99 }), [demand({ voice: '+100' })], index)).toHaveLength(0);
    expect(demandHitsForPet(pet({ voiceDb: 99 }), [demand({ voice: '婉转声' })], index)).toHaveLength(1);
  });

  test('性格/性别无法从野生实体读取，命中但标记待确认', () => {
    const [hit] = demandHitsForPet(pet(), [demand({ nature: '固执', gender: '母' })], index);
    expect(hit.unverified).toEqual(['性格', '性别']);
  });

  test('宠物记录回填后：性格/性别相符才命中，不符直接排除', () => {
    const known = pet({ nature: '天真', gender: '公' });
    const [hit] = demandHitsForPet(known, [demand({ nature: '天真', gender: '公' })], index);
    expect(hit.known).toEqual(['性格', '性别']);
    expect(demandHitsForPet(known, [demand({ nature: '踏实' })], index)).toHaveLength(0);
    expect(demandHitsForPet(known, [demand({ gender: '母' })], index)).toHaveLength(0);
  });

  test('种公需求（eggGameId 为负）：按蛋组命中', () => {
    expect(demandHitsForPet(pet(), [demand({ eggGameId: -6 })], index)).toHaveLength(1);
    expect(demandHitsForPet(pet(), [demand({ eggGameId: -3 })], index)).toHaveLength(0);
  });

  test('多条需求全部返回，已满足的条件记入 known', () => {
    const hits = demandHitsForPet(pet({ weightPct: 99, heightPct: 100, voiceDb: 100 }), [
      demand({ body: '大块头', voice: '+100' }),
      demand({ body: '小不点' }),
    ], index);
    expect(hits).toHaveLength(1);
    expect(hits[0].known).toEqual(['体型', '声音']);
  });
});
