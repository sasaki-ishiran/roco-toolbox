import { describe, expect, test } from 'vitest';
import type { CollectionDemand } from '../shared/collectionGroups';
import {
  newDemandCompletionNotice,
  resolveDemandCompletionNotice,
} from './demandCompletionNotice';

const demand = (over: Partial<CollectionDemand>): CollectionDemand => ({
  groupId: 'g1',
  demanderAccountId: 'A',
  eggGameId: 101,
  nature: '',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'done',
  claimerAccountId: 'B',
  version: 0,
  createdAt: 1,
  updatedAt: 100,
  ...over,
});

const names: Record<string, string> = { A: '小明', C: '小红' };
const nameOf = (accountId: string): string | null => names[accountId] ?? null;

describe('newDemandCompletionNotice', () => {
  test('本机第一次见到这个组：只返回水位，不把历史当成新消息', () => {
    const notice = newDemandCompletionNotice(
      [demand({ updatedAt: 300 }), demand({ eggGameId: 102, updatedAt: 200 })],
      'B',
      null,
      nameOf,
    );
    expect(notice).toEqual({ count: 0, demanderNames: [], watermark: 300 });
  });

  test('只提示水位之后完成的单，需求方昵称去重', () => {
    const notice = newDemandCompletionNotice(
      [
        demand({ updatedAt: 500 }),
        demand({ eggGameId: 102, updatedAt: 400 }),
        demand({ demanderAccountId: 'C', eggGameId: 103, updatedAt: 300 }),
        demand({ eggGameId: 104, updatedAt: 100 }),
      ],
      'B',
      200,
      nameOf,
    );
    expect(notice).toEqual({ count: 3, demanderNames: ['小明', '小红'], watermark: 500 });
  });

  test('全部看过之后不再提示', () => {
    const notice = newDemandCompletionNotice(
      [demand({ updatedAt: 100 })],
      'B',
      100,
      nameOf,
    );
    expect(notice).toEqual({ count: 0, demanderNames: [], watermark: 100 });
  });

  test('没有自己承接的已完成单时返回 null', () => {
    expect(
      newDemandCompletionNotice(
        [
          demand({ claimerAccountId: 'C' }),
          demand({ claimerAccountId: 'B', status: 'claimed' }),
          demand({ claimerAccountId: 'B', status: 'open' }),
        ],
        'B',
        null,
        nameOf,
      ),
    ).toBeNull();
  });

  test('需求方已不在成员列表时退回通用文案的空昵称', () => {
    const notice = newDemandCompletionNotice(
      [demand({ demanderAccountId: 'gone', updatedAt: 300 })],
      'B',
      100,
      nameOf,
    );
    expect(notice).toEqual({ count: 1, demanderNames: [], watermark: 300 });
  });
});

describe('resolveDemandCompletionNotice', () => {
  test('第一次见到组、还没有任何已完成单：也要写下初始化水位', () => {
    expect(resolveDemandCompletionNotice([], 'B', null, nameOf, 1000)).toEqual({
      notice: null,
      markSeenAt: 1000,
    });
  });

  test('第一次见到组、已有历史完成单：不提示，水位取「现在」而不是最晚完成时间', () => {
    expect(
      resolveDemandCompletionNotice([demand({ updatedAt: 300 })], 'B', null, nameOf, 1000),
    ).toEqual({ notice: null, markSeenAt: 1000 });
  });

  test('初始化之后完成的单会提示，并且不再改写水位', () => {
    expect(
      resolveDemandCompletionNotice([demand({ updatedAt: 1200 })], 'B', 1000, nameOf, 2000),
    ).toEqual({
      notice: { count: 1, demanderNames: ['小明'], watermark: 1200 },
      markSeenAt: null,
    });
  });

  test('已读水位之后没有新的完成单：不提示也不写', () => {
    expect(
      resolveDemandCompletionNotice([demand({ updatedAt: 900 })], 'B', 1000, nameOf, 2000),
    ).toEqual({ notice: null, markSeenAt: null });
  });
});
