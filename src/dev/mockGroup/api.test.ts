import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getCollectionDemands,
  getCollectionGroup,
  getCollectionTasks,
  listCollectionGroups,
  publishCollectionResources,
} from '../../api/collectionGroups';
import { getEggMatching, mutateEggMatching } from '../../api/eggMatching';
import { createMockState, ensureSelf, handleMockApi, type MockGroupState } from './api';
import { MOCK_GROUP_ID } from './data';

/**
 * 假后端最重要的约束：**客户端解析器必须能接受它的响应**。
 *
 * 界面代码一行不改就能预览，靠的就是这里返回的结构和真实服务端一致；
 * 如果哪天接口加了必填字段，这个用例会先红，提醒补种子数据。
 */
let state: MockGroupState;

beforeEach(() => {
  state = createMockState();
  ensureSelf(state);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://127.0.0.1:5199');
      const reply = handleMockApi(
        url.pathname,
        (init?.method ?? 'GET').toUpperCase(),
        typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        state,
      );
      if (!reply) return new Response(JSON.stringify({ error: '未实现的接口' }), { status: 404 });
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('小组假后端', () => {
  test('组列表 / 组详情 / 需求 / 任务都能通过客户端解析器', async () => {
    const groups = await listCollectionGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: MOCK_GROUP_ID, name: '周末互换', groupType: 'mother' });

    const detail = await getCollectionGroup(MOCK_GROUP_ID);
    expect(detail.members.map((member) => member.displayName)).toEqual(['林', '阿岚', '小鱼', '默默']);
    // 「默默」没发布过资源：用来验证「待发布」文案，必须真的没有 resource。
    expect(detail.members[3].resource).toBeNull();
    expect(detail.group.target?.kind).toBe('mother');

    const feed = await getCollectionDemands(MOCK_GROUP_ID);
    expect(feed.map((demand) => demand.status).sort()).toEqual(['claimed', 'open']);

    const tasks = await getCollectionTasks(MOCK_GROUP_ID);
    expect(tasks.confirmed).toBe(true);
    expect(tasks.tasks).toEqual([]);
  });

  test('换蛋状态能通过校验器，且 POST 会真的改状态并升版本', async () => {
    const first = await getEggMatching(MOCK_GROUP_ID);
    expect(first.version).toBe(1);
    expect(first.state.demands.length).toBeGreaterThan(0);

    const next = await mutateEggMatching(MOCK_GROUP_ID, first.version, {
      type: 'list',
      id: 'egg-me-1',
      listed: false,
    });
    expect(next.version).toBe(first.version + 1);
    expect(next.state.eggs.find((egg) => egg.id === 'egg-me-1')?.listed).toBe(false);

    // 版本对不上时必须 409：界面靠它触发「正在刷新」而不是静默覆盖。
    await expect(
      mutateEggMatching(MOCK_GROUP_ID, first.version, { type: 'list', id: 'egg-me-1', listed: true }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('发布摘要后我的资源版本 +1，发布页不再是「需更新」', async () => {
    const before = await getCollectionGroup(MOCK_GROUP_ID);
    const mine = before.members.find((member) => member.accountId === state.me);
    expect(mine?.resource?.revision).toBe(3);

    const result = await publishCollectionResources(MOCK_GROUP_ID, {
      baseRevision: 3,
      baseTargetRevision: before.group.targetRevision,
      resource: {
        schemaVersion: 1,
        criteriaId: mine!.resource!.criteriaId,
        catalogVersion: mine!.resource!.catalogVersion,
        accounts: mine!.resource!.accounts,
      },
    });
    expect(result.resourceRevision).toBe(4);
    expect(result.publishedAt).toEqual(expect.any(Number));

    const after = await getCollectionGroup(MOCK_GROUP_ID);
    expect(after.members.find((member) => member.accountId === state.me)?.resourceRevision).toBe(4);
  });
});
