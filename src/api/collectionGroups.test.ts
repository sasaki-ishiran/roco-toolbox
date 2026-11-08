import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  claimCollectionDemand,
  completeCollectionDemand,
  getCollectionDemandFeed,
  getCollectionDemands,
  getCollectionGroup,
  joinCollectionGroup,
  publishCollectionDemand,
  releaseCollectionDemand,
  withdrawCollectionDemand,
} from './collectionGroups';
import { flushEvents, setAnalyticsEnabled, trackDemandFail } from './analytics';

// 失败埋点单独抓：成功路径的埋点仍走真实实现
const trackFail = vi.hoisted(() => vi.fn());
vi.mock('./analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./analytics')>();
  return { ...actual, trackDemandFail: trackFail };
});

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
  trackFail.mockClear();
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

describe('成功状态却不是 JSON 对象', () => {
  test('文案带上方法 / 路径 / 状态 / Content-Type 与响应开头', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!doctype html><html><body>proxy</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );

    const error = await getCollectionGroup('g1').catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect((error as Error).message).toContain('GET /api/collection-groups/g1');
    expect((error as Error).message).toContain('text/html');
    expect((error as Error).message).toContain('<!doctype html>');
  });
});

describe('需求契约（归档行 / 旧口径 / 错误码）', () => {
  const openDemand = {
    groupId: 'g1',
    demanderAccountId: 'A',
    eggGameId: 101,
    nature: '',
    gender: '母',
    body: '大块头',
    voice: '+100',
    status: 'open',
    claimerAccountId: null,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
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

  test('需求中心三份数据一起解析：未完成列表 + 已结单聚合 + 我的完成回执', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        ok: true,
        demands: [openDemand],
        completedCounts: { B: 3, C: 1 },
        myRecentCompleted: [doneDemand],
      }),
    );

    const feed = await getCollectionDemandFeed('g1');
    expect(feed.demands.map((demand) => demand.status)).toEqual(['open']);
    expect(feed.completedCounts).toEqual({ B: 3, C: 1 });
    expect(feed.myRecentCompleted[0]).toMatchObject({ status: 'done', claimerAccountId: 'B' });
  });

  test('旧服务端没有聚合字段时按空处理，不抛错', async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: true, demands: [openDemand] }));

    const feed = await getCollectionDemandFeed('g1');
    expect(feed.demands).toHaveLength(1);
    expect(feed.completedCounts).toEqual({});
    expect(feed.myRecentCompleted).toEqual([]);
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
    // 失败路径也要留痕：只报步骤与错误码
    expect(trackFail).toHaveBeenCalledWith('claim', 'DEMAND_TAKEN');
    expect(trackDemandFail).toBe(trackFail);
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

describe('换蛋核心链路埋点（2026-11-08）', () => {
  type WireEvent = { name: string; props?: Record<string, unknown> };
  const batches: Array<{ events: WireEvent[] }> = [];

  const demand = {
    groupId: 'g1',
    demanderAccountId: 'A',
    eggGameId: 101,
    nature: '固执',
    gender: '母',
    body: '大块头',
    voice: '+100',
    status: 'open',
    claimerAccountId: null,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const criteria = {
    demanderAccountId: 'A',
    eggGameId: 101,
    nature: '固执',
    gender: '母' as const,
    body: '大块头' as const,
    voice: '+100' as const,
    version: 1,
  };

  /** 业务接口返回 apiBody，埋点上报单独收进 batches（两条请求都走同一个 fetch）。 */
  const routeFetch = (apiBody: unknown, status = 200) => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/event')) {
        batches.push(JSON.parse(String(init?.body ?? '{}')) as { events: WireEvent[] });
        return Promise.resolve(response({ ok: true }));
      }
      return Promise.resolve(response(apiBody, status));
    });
  };

  const emitted = async (): Promise<WireEvent[]> => {
    await flushEvents();
    return batches.flatMap((batch) => batch.events);
  };

  beforeEach(() => {
    batches.length = 0;
    window.localStorage.setItem('roco.analyticsForce', '1');
    setAnalyticsEnabled(false); // 清掉上一个用例可能残留的队列
    setAnalyticsEnabled(true);
  });

  afterEach(() => {
    setAnalyticsEnabled(false);
  });

  test('发布需求成功：demand_publish 带本次落库条数', async () => {
    routeFetch({
      ok: true,
      demands: [demand, { ...demand, nature: '开朗' }],
    });

    await publishCollectionDemand('g1', {
      eggGameId: 101,
      natures: ['固执', '开朗'],
      gender: '母',
      body: '大块头',
      voice: '+100',
    });

    expect(await emitted()).toEqual([
      expect.objectContaining({ name: 'demand_publish', props: { count: 2 } }),
    ]);
  });

  test('认领 / 结单 / 撤回各自上报一次；释放（release）不算认领', async () => {
    routeFetch({ ok: true, demand: { ...demand, status: 'claimed', claimerAccountId: 'B' } });
    await claimCollectionDemand('g1', criteria);

    routeFetch({ ok: true, demand: { ...demand, status: 'open' } });
    await releaseCollectionDemand('g1', criteria);

    routeFetch({ ok: true, demand: { ...demand, status: 'done', claimerAccountId: 'B' } });
    await completeCollectionDemand('g1', criteria);

    routeFetch({ ok: true });
    await withdrawCollectionDemand('g1', 101, {
      nature: '固执',
      gender: '母',
      body: '大块头',
      voice: '+100',
    });

    expect((await emitted()).map((event) => event.name)).toEqual([
      'demand_claim',
      'demand_complete',
      'demand_withdraw',
    ]);
  });

  test('加入小组成功才上报 group_join，且不带任何参数', async () => {
    routeFetch({ ok: true, groupId: 'g1', groupType: 'mother' });

    await joinCollectionGroup({ inviteCode: 'ABC123', displayName: '甲' });

    expect(await emitted()).toEqual([expect.objectContaining({ name: 'group_join' })]);
  });

  test('接口失败不上报：被抢单的认领不算 demand_claim', async () => {
    routeFetch({ ok: false, code: 'DEMAND_TAKEN', error: '这条需求已经被别人接了' }, 409);

    await expect(claimCollectionDemand('g1', criteria)).rejects.toMatchObject({
      code: 'DEMAND_TAKEN',
    });
    expect(await emitted()).toEqual([]);
  });
});
