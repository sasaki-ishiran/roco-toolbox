import { describe, expect, test } from 'vitest';
import type { CollectionDemand } from '../shared/collectionGroups';
import { completedDemandCounts } from './demandStats';

const demand = (over: Partial<CollectionDemand>): CollectionDemand => ({
  groupId: 'g1',
  demanderAccountId: 'A',
  eggGameId: 101,
  nature: '固执',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'open',
  claimerAccountId: null,
  version: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('completedDemandCounts', () => {
  test('只统计已完成的单，并按承接人累计', () => {
    const counts = completedDemandCounts([
      demand({ status: 'done', claimerAccountId: 'B' }),
      demand({ status: 'done', claimerAccountId: 'B', eggGameId: 102 }),
      demand({ status: 'done', claimerAccountId: 'C', eggGameId: 103 }),
      demand({ status: 'claimed', claimerAccountId: 'C' }),
      demand({ status: 'open' }),
    ]);
    expect(counts.get('B')).toBe(2);
    expect(counts.get('C')).toBe(1);
    expect(counts.get('A')).toBeUndefined();
  });

  test('没有承接人的已完成单不计入任何人', () => {
    const counts = completedDemandCounts([demand({ status: 'done' })]);
    expect(counts.size).toBe(0);
  });
});
