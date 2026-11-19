import { describe, expect, test } from 'vitest';
import { buildStudCandidates } from './studCandidates';
import type { NestPlan, NestPet } from './nestPlan';
import type { OwnedPet, SpeciesEntry } from './types';

const pet = (key: string, gameId: number, name: string, account = '昭昭'): NestPet => ({
  key,
  gameId,
  name,
  account,
  gender: '公',
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  heightPercent: 100,
  weightPercent: 100,
  box: `${account} · 盒子 01 第 1 位`,
});

const plan = (account: string, fathers: NestPet[]): NestPlan => ({
  account,
  pairings: fathers.map((father) => ({
    tier: 'normal60',
    groupIds: [2],
    natureName: '固执',
    grade: '大婉',
    account,
    father,
    mother: { ...father, key: `${account}#0`, gender: '母' },
    academyParent: null,
    partner: father,
    natureChance: 0.6,
    expectedValue: 0.6,
    distance: 8,
    fatherPosition: { x: 8, y: 0 },
    motherPosition: { x: 0, y: 0 },
    expected: { species: father.name, nature: '固执', body: '大块头', voice: '婉转声' },
  })),
  blockedLinks: [],
  slots: [],
  nestsUsed: 1,
  nestsTotal: 6,
  clusters: [],
  unfilled: [],
  delegated: [],
  alternatives: [],
});

const species: SpeciesEntry[] = [
  { gameId: 3006, name: '火神', eggGroups: [2, 12] } as SpeciesEntry,
  { gameId: 3003, name: '火花', eggGroups: [12, 2] } as SpeciesEntry,
];

const owned = [
  { gameId: 3006, account: '昭昭', gender: '公' },
  { gameId: 3006, account: '昭昭', gender: '公' },
  { gameId: 3003, account: '云舟', gender: '公' },
] as OwnedPet[];

const cell = { groupId: 2, natureName: '固执', grade: '大婉' as const };

describe('buildStudCandidates', () => {
  test('本号能配的排前面，跨号带上源号，权重按能否配 + 组数 + 公数', () => {
    const list = buildStudCandidates({
      cell,
      plans: [plan('昭昭', [pet('昭昭#1', 3006, '火神')]), plan('云舟', [pet('云舟#1', 3003, '火花', '云舟')])],
      accounts: ['昭昭'],
      owned,
      species,
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ gameId: 3006, route: 'self', males: 2 });
    expect(list[1]).toMatchObject({ gameId: 3003, route: 'transfer', sourceAccount: '云舟' });
    expect(list[0].weight).toBeGreaterThan(list[1].weight);
  });

  test('同一只公被两个号排上时本号优先，不重复出现', () => {
    const list = buildStudCandidates({
      cell,
      plans: [plan('云舟', [pet('云舟#1', 3006, '火神', '云舟')]), plan('昭昭', [pet('昭昭#1', 3006, '火神')])],
      accounts: ['昭昭'],
      owned,
      species,
    });
    expect(list).toHaveLength(1);
    expect(list[0].route).toBe('self');
  });

  test('没有方案排过这一格时返回空（界面写无法配对）', () => {
    const list = buildStudCandidates({
      cell: { ...cell, natureName: '开朗' },
      plans: [plan('昭昭', [pet('昭昭#1', 3006, '火神')])],
      accounts: ['昭昭'],
      owned,
      species,
    });
    expect(list).toEqual([]);
  });
});
