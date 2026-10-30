import { beforeEach, describe, expect, test } from 'vitest';
import type { CollectionDemand } from '../shared/collectionGroups';
import { completionReadKey, markCompletionRead, readCompletionRead } from './demandCompletionReadStore';

const demand = (over: Partial<CollectionDemand> = {}): CollectionDemand => ({
  groupId: 'g1',
  demanderAccountId: 'm1',
  eggGameId: 100,
  nature: '固执',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'done',
  claimerAccountId: 'me',
  version: 0,
  createdAt: 1,
  updatedAt: 10,
  ...over,
});

beforeEach(() => window.localStorage.clear());

describe('需求完成回执的本机已读', () => {
  test('点过「知道了」后同一单不再算未读', () => {
    const row = demand();
    const key = completionReadKey('g1', row);
    expect(readCompletionRead('me')[key]).toBeUndefined();

    markCompletionRead('me', [key]);
    expect(readCompletionRead('me')[key]).toBe(true);
  });

  test('同款需求重新完成（completedAt 变了）会重新提醒', () => {
    const first = completionReadKey('g1', demand({ updatedAt: 10 }));
    markCompletionRead('me', [first]);

    const second = completionReadKey('g1', demand({ updatedAt: 20 }));
    expect(readCompletionRead('me')[second]).toBeUndefined();
  });

  test('不同账号的已读互不影响', () => {
    const key = completionReadKey('g1', demand());
    markCompletionRead('me', [key]);
    expect(readCompletionRead('other')[key]).toBeUndefined();
  });
});
