import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  MotherGroupsApiError,
  getMotherGroup,
  listMotherGroups,
  publishMotherResources,
} from './motherGroups';

const detailBody = {
  ok: true,
  group: { id: 'g1', name: '组', ownerAccountId: 'A', createdAt: 1 },
  members: [
    {
      accountId: 'A',
      displayName: '甲',
      joinedAt: 1,
      resourceRevision: 2,
      resource: {
        schemaVersion: 1,
        criteriaId: 'female-huge-voice100-v2',
        catalogVersion: 'test-v1',
        accounts: [
          {
            accountKey: 'uid:1001',
            accountName: '甲',
            sourceExportedAt: '2026-10-23T00:00:00.000Z',
            eggGameIds: [101],
          },
        ],
        revision: 2,
        publishedAt: 123,
      },
    },
  ],
};

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
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

describe('多人母本共享 API 客户端', () => {
  test('读取详情：带 Bearer、严格解析 DTO', async () => {
    fetchMock.mockResolvedValueOnce(response(detailBody));
    const detail = await getMotherGroup('g1');
    expect(detail.group.name).toBe('组');
    expect(detail.members[0].resource?.accounts[0].eggGameIds).toEqual([101]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/mother-groups/g1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  test('非法响应不转成空组，抛 INVALID_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: true, groups: [{ id: 1 }] }));
    await expect(listMotherGroups()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetchMock.mockResolvedValueOnce(response({ ok: true, group: detailBody.group, members: 'x' }));
    await expect(getMotherGroup('g1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  test('409 保留业务错误码；429 读取 Retry-After（秒与日期）', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ ok: false, code: 'REVISION_CONFLICT', error: '版本冲突' }, 409),
    );
    await expect(
      publishMotherResources('g1', {
        baseRevision: 1,
        resource: {
          schemaVersion: 1,
          criteriaId: 'female-huge-voice100-v2',
          catalogVersion: 'test-v1',
          accounts: [],
        },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });

    fetchMock.mockResolvedValueOnce(
      response({ ok: false, code: 'RATE_LIMITED', error: '太频繁' }, 429, { 'Retry-After': '90' }),
    );
    const error = await listMotherGroups().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MotherGroupsApiError);
    expect((error as MotherGroupsApiError).retryAfterSeconds).toBe(90);

    fetchMock.mockResolvedValueOnce(
      response({ ok: false, code: 'RATE_LIMITED', error: '太频繁' }, 429, {
        'Retry-After': new Date(Date.now() + 30_000).toUTCString(),
      }),
    );
    const dated = await listMotherGroups().catch((failure: unknown) => failure);
    expect((dated as MotherGroupsApiError).retryAfterSeconds).toBeGreaterThan(20);
  });

  test('401 按现有机制清掉会话', async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: false, error: '未登录' }, 401));
    await expect(listMotherGroups()).rejects.toThrow(/登录已失效/);
    expect(window.localStorage.getItem('roco.deviceToken')).toBeNull();
  });

  test('signal 透传给 fetch；DELETE 用 DELETE', async () => {
    fetchMock.mockResolvedValueOnce(response(detailBody));
    const controller = new AbortController();
    await getMotherGroup('g1', controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);

    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    const { leaveMotherGroup } = await import('./motherGroups');
    await leaveMotherGroup('g1');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });
});
