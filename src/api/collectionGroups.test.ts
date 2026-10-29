import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  claimCollectionDemand,
  getCollectionDemands,
  getCollectionGroup,
  publishCollectionDemand,
} from './collectionGroups';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
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
        criteriaId: 'all-mothers-v3-perfect',
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

describe('需求契约（归档行 / 旧口径 / 错误码）', () => {
  const doneDemand = {
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
    updatedAt: 2,
  };

  test('旧 criteriaId 发布返回 400，错误码与文案原样透出', async () => {
    fetchMock.mockResolvedValueOnce(
      response(
        {
          ok: false,
          code: 'INVALID_INPUT',
          error: 'criteriaId 不受支持：客户端版本过旧，请更新后重新发布',
        },
        400,
      ),
    );

    await expect(
      publishCollectionDemand('g1', {
        eggGameId: 101,
        natures: [],
        gender: '母',
        body: '大块头',
        voice: '+100',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_INPUT',
      message: expect.stringContaining('版本过旧'),
    });
  });

  test('归档的已完成行按 done 解析：version 0、updatedAt 是完成时间', async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: true, demands: [doneDemand] }));

    const demands = await getCollectionDemands('g1');
    expect(demands[0]).toMatchObject({
      status: 'done',
      claimerAccountId: 'B',
      version: 0,
      createdAt: 1,
      updatedAt: 2,
    });
  });

  test('需求的业务错误码不会被归成 HTTP_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ ok: false, code: 'DEMAND_TAKEN', error: '这条需求已经被别人接了' }, 409),
    );

    await expect(
      claimCollectionDemand('g1', {
        demanderAccountId: 'A',
        eggGameId: 101,
        nature: '',
        gender: '母',
        body: '大块头',
        voice: '+100',
        version: 1,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'DEMAND_TAKEN' });
  });

  test('未知错误码退回 HTTP_ERROR，不硬塞进窄联合', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ ok: false, code: 'SOMETHING_NEW', error: '新错误' }, 500),
    );

    await expect(getCollectionDemands('g1')).rejects.toMatchObject({
      status: 500,
      code: 'HTTP_ERROR',
    });
  });
});
