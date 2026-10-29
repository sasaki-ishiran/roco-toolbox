import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getCollectionGroup } from './collectionGroups';

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const detailBody = (lines?: unknown[]) => ({
  ok: true,
  group: {
    id: 'g1',
    name: '组',
    ownerAccountId: 'A',
    createdAt: 1,
    groupType: 'mother',
    targetRevision: 0,
    resourceEpoch: 0,
    target: null,
  },
  members: [
    {
      accountId: 'A',
      displayName: '甲',
      joinedAt: 1,
      resourceRevision: 1,
      resource: {
        schemaVersion: 1,
        criteriaId: 'all-mothers-v2',
        catalogVersion: 'test-v1',
        accounts: [
          {
            accountKey: 'uid:1001',
            accountName: '甲',
            sourceExportedAt: '2026-10-27T00:00:00.000Z',
            eggGameIds: [101],
            ...(lines === undefined ? {} : { lines }),
          },
        ],
        revision: 1,
        publishedAt: 1,
      },
      studResource: null,
    },
  ],
});

const fetchMock = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('roco.deviceToken', 'token-1');
  window.localStorage.setItem('roco.accountId', 'A');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('收集组详情解析', () => {
  test('保留摘要里的产线，否则本地预览会一直判成「有变化」', async () => {
    const lines = [{ eggGameId: 101, grade: '大婉', natures: ['固执', '开朗'] }];
    fetchMock.mockResolvedValueOnce(response(detailBody(lines)));

    const detail = await getCollectionGroup('g1');
    expect(detail.members[0].resource?.accounts[0].lines).toEqual(lines);
  });

  test('旧摘要没有 lines 字段时保持 undefined（未知），不伪造成空产线', async () => {
    fetchMock.mockResolvedValueOnce(response(detailBody()));

    const detail = await getCollectionGroup('g1');
    expect(detail.members[0].resource?.accounts[0].lines).toBeUndefined();
  });
});
