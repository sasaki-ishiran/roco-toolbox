import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

/** 与客户端当前图鉴版本一致，否则摘要会被判成「需更新」。 */
const CATALOG_VERSION = (
  JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'catalog.gen.json'), 'utf8')) as {
    dataVersion: string;
  }
).dataVersion;

/**
 * 静态 preview（没有 Functions）下的小组收集 mock。
 *
 * 用真实图鉴里的蛋 ID，保证覆盖行能真正渲染：
 * 3003 = 火花（同蛋还有火神 3006 / 焰火 3032）、3002 = 水蓝蓝、3001 = 喵喵。
 */
export const GROUP_ID = 'g1';

const resource = (
  revision: number,
  accounts: Array<{ accountKey: string; accountName: string; eggGameIds: number[] }>,
) => ({
  schemaVersion: 1,
  criteriaId: 'female-huge-voice100-v1',
  catalogVersion: CATALOG_VERSION,
  accounts: accounts.map((account) => ({
    ...account,
    sourceExportedAt: '2026-10-23T00:00:00.000Z',
  })),
  revision,
  publishedAt: 1_760_000_000_000,
});

export const groupDetail = {
  group: {
    id: GROUP_ID,
    name: '周末互换',
    ownerAccountId: 'A',
    createdAt: 1_760_000_000_000,
    groupType: 'mother',
    targetRevision: 0,
    resourceEpoch: 1,
    target: {
      kind: 'mother',
      criteriaId: 'female-huge-voice100-v1',
      mode: 'perfect',
      bodies: ['大块头'],
      voices: ['+100'],
      catalogVersion: CATALOG_VERSION,
    },
  },
  members: [
    {
      accountId: 'A',
      displayName: '阿甲',
      joinedAt: 1,
      resourceRevision: 1,
      resource: resource(1, [{ accountKey: 'uid:1001', accountName: '甲的大号', eggGameIds: [3003] }]),
      studResource: null,
    },
    {
      accountId: 'B',
      displayName: '阿乙',
      joinedAt: 2,
      resourceRevision: 1,
      resource: resource(1, [{ accountKey: 'uid:2001', accountName: '乙的号', eggGameIds: [3002] }]),
      studResource: null,
    },
    {
      accountId: 'C',
      displayName: '阿丙',
      joinedAt: 3,
      resourceRevision: 0,
      resource: null,
      studResource: null,
    },
  ],
};

export const groupSummary = {
  id: GROUP_ID,
  name: '周末互换',
  ownerAccountId: 'A',
  memberCount: 3,
  groupType: 'mother',
  targetRevision: 0,
  targetReady: true,
};

const fulfill = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  });

export interface MockOptions {
  /** 发布接口返回 409（模拟另一台设备刚改过） */
  publishConflict?: boolean;
}

export async function mockMotherGroups(page: Page, options: MockOptions = {}): Promise<void> {
  let revision = 2;
  const tasks: Array<Record<string, unknown>> = [];
  await page.route('**/api/collection-groups**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (method === 'GET' && path === '/api/collection-groups') {
      return fulfill(route, { ok: true, groups: [groupSummary] });
    }
    if (method === 'GET' && path === `/api/collection-groups/${GROUP_ID}`) {
      return fulfill(route, { ok: true, ...groupDetail });
    }
    if (method === 'GET' && path === `/api/collection-groups/${GROUP_ID}/tasks`) {
      return fulfill(route, {
        ok: true,
        targetRevision: 0,
        confirmed: true,
        pendingMemberIds: [],
        tasks,
      });
    }
    if (method === 'POST' && path === `/api/collection-groups/${GROUP_ID}/tasks/claim`) {
      const body = request.postDataJSON() as { targetKey: string };
      const existing = tasks.find((task) => task.targetKey === body.targetKey);
      const task = {
        groupId: GROUP_ID,
        targetRevision: 0,
        targetKey: body.targetKey,
        round: existing?.round ?? 0,
        status: 'claimed',
        ownerAccountId: 'A',
        version: Number(existing?.version ?? 0) + 1,
        updatedAt: Date.now(),
        closedAt: null,
      };
      if (existing) Object.assign(existing, task);
      else tasks.push(task);
      return fulfill(route, { ok: true, task });
    }
    if (method === 'POST' && path === `/api/collection-groups/${GROUP_ID}/tasks/release`) {
      const body = request.postDataJSON() as { targetKey: string };
      const existing = tasks.find((task) => task.targetKey === body.targetKey);
      if (!existing) {
        return fulfill(route, { ok: false, code: 'TASK_NOT_FOUND', error: '没有进行中的认领' }, 404);
      }
      existing.status = 'open';
      existing.ownerAccountId = null;
      existing.version = Number(existing.version) + 1;
      return fulfill(route, { ok: true, task: existing });
    }
    if (method === 'PUT' && path === `/api/collection-groups/${GROUP_ID}/resources/me`) {
      if (options.publishConflict) {
        return fulfill(
          route,
          { ok: false, code: 'REVISION_CONFLICT', error: '小组资源已被其他设备更新，请重新预览再发布' },
          409,
        );
      }
      revision += 1;
      return fulfill(route, { ok: true, resourceRevision: revision, publishedAt: Date.now() });
    }
    if (method === 'PUT' && path.endsWith('/target')) {
      return fulfill(route, { ok: true, targetRevision: 1 });
    }
    if (method === 'PUT' && path.endsWith('/profile/me')) return fulfill(route, { ok: true });
    if (method === 'POST' && path.endsWith('/invite/reset')) {
      return fulfill(route, { ok: true, inviteCode: 'NEWC2345' });
    }
    if (method === 'DELETE') return fulfill(route, { ok: true });
    return fulfill(route, { ok: false, code: 'GROUP_NOT_FOUND', error: '没有这个接口' }, 404);
  });
}

/** 让页面以指定工具箱身份打开（不真正登录；API 已 mock）。 */
export async function loginAs(page: Page, accountId = 'A', token = 'mock-token'): Promise<void> {
  await page.addInitScript(
    ([id, value]) => {
      window.localStorage.setItem('roco.accountId', id);
      window.localStorage.setItem('roco.deviceToken', value);
    },
    [accountId, token],
  );
}

/** 直接进入某个组（否则二期默认落在个人求蛋）。 */
export async function enterGroup(page: Page, accountId = 'A'): Promise<void> {
  await page.addInitScript(
    ([id, groupId]) => {
      window.localStorage.setItem(
        `roco.collectionGroups:${id}`,
        JSON.stringify({
          mode: 'group',
          personalType: 'mother',
          lastGroupIds: { mother: groupId },
          inviteCodes: {},
        }),
      );
    },
    [accountId, GROUP_ID],
  );
}
