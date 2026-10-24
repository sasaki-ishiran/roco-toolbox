import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const BASE = (process.env.ROCO_MOTHER_API_BASE ?? 'http://127.0.0.1:8789').replace(/\/$/, '');

const { entries: changelogEntries } = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'data', 'changelog.json'), 'utf8'),
) as { entries: Array<{ id: string }> };
const GUIDE_VERSION = /GUIDE_VERSION\s*=\s*'([^']+)'/.exec(
  readFileSync(join(process.cwd(), 'src/ui/guide.ts'), 'utf8'),
)?.[1];
if (!GUIDE_VERSION) throw new Error('读不到 GUIDE_VERSION');

const CATALOG_VERSION = (
  JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'catalog.gen.json'), 'utf8')) as {
    dataVersion: string;
  }
).dataVersion;

interface Identity {
  accountId: string;
  token: string;
  recoveryCode: string;
}

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function register(label: string): Promise<Identity> {
  return api(null, 'POST', '/api/auth/register', { label });
}

const resourceOf = (uid: number, eggGameId: number) => ({
  schemaVersion: 1,
  criteriaId: 'female-huge-voice100-v1',
  catalogVersion: CATALOG_VERSION,
  accounts: [
    {
      accountKey: `uid:${uid}`,
      accountName: `账号${uid}`,
      sourceExportedAt: '2026-10-23T00:00:00.000Z',
      eggGameIds: [eggGameId],
    },
  ],
});

async function contextFor(browser: Browser, identity: Identity, groupId: string) {
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE,
          localStorage: [
            { name: 'roco.accountId', value: identity.accountId },
            { name: 'roco.deviceToken', value: identity.token },
            { name: 'roco.changelogSeen', value: changelogEntries[0]?.id ?? '' },
            { name: 'roco.guideSeen', value: GUIDE_VERSION as string },
            {
              name: `roco.collectionGroups:${identity.accountId}`,
              value: JSON.stringify({
                mode: 'group',
                personalType: 'mother',
                lastGroupIds: { mother: groupId },
                inviteCodes: {},
              }),
            },
          ],
        },
      ],
    },
  });
}

const openSharing = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: '小组', exact: true }).click();
  await expect(page.getByTestId('collection-groups')).toBeVisible();
};

test('真实 Functions + D1：三个身份、A 两设备共享同一成员与资源目录', async ({ browser }) => {
  const a = await register('live-A');
  const b = await register('live-B');
  const c = await register('live-C');
  const recovered = await api(null, 'POST', '/api/auth/recover', { recoveryCode: a.recoveryCode });
  const aSecond = { ...a, token: recovered.token };

  const created = await api(a.token, 'POST', '/api/collection-groups', {
    name: '真实联调组',
    displayName: '阿甲',
    groupType: 'mother',
  });
  const groupId = created.group.id;
  for (const [identity, displayName] of [
    [b, '阿乙'],
    [c, '阿丙'],
  ] as const) {
    await api(identity.token, 'POST', '/api/collection-groups/join', {
      inviteCode: created.inviteCode,
      displayName,
    });
  }

  // A 已发布火花、B 已发布水蓝蓝、C 未发布（未知）
  const publishedA = await api(a.token, 'PUT', `/api/collection-groups/${groupId}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 0,
    resource: resourceOf(1001, 3003),
  });
  await api(b.token, 'PUT', `/api/collection-groups/${groupId}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 0,
    resource: resourceOf(2001, 3002),
  });
  expect(publishedA.resourceRevision).toBe(1);

  const contextA = await contextFor(browser, a, groupId);
  const contextA2 = await contextFor(browser, aSecond, groupId);
  const contextB = await contextFor(browser, b, groupId);
  const pageA = await contextA.newPage();
  const pageA2 = await contextA2.newPage();
  const pageB = await contextB.newPage();

  await openSharing(pageA);
  await expect(pageA.getByTestId('group-card')).toContainText('真实联调组');
  await expect(pageA.getByTestId('group-card')).toContainText('3 人');
  await expect(pageA.getByTestId('group-type-label')).toContainText('母本收集');

  await pageA.getByTestId('mother-view-all').click();
  await expect(
    pageA.getByTestId('mother-resource-row').filter({ hasText: '火花' }),
  ).toContainText('有：阿甲（账号1001）');
  await expect(
    pageA.getByTestId('mother-resource-row').filter({ hasText: '水蓝蓝' }),
  ).toContainText('有：阿乙（账号2001）');
  await expect(
    pageA.getByTestId('mother-resource-row').filter({ hasText: '喵喵' }),
  ).toContainText('已发布成员均无，另 1 人待发布/更新');

  // A 的第二台设备：没有本地导入数据，也能发现同一组并看到云端摘要
  await openSharing(pageA2);
  await expect(pageA2.getByTestId('group-card')).toContainText('3 人');
  await pageA2.getByTestId('mother-view-all').click();
  await expect(
    pageA2.getByTestId('mother-resource-row').filter({ hasText: '火花' }),
  ).toContainText('有：阿甲');

  // B 的缺口：A 有火花、C 未知；B 自己没有水蓝蓝的缺口
  await openSharing(pageB);
  const bMissing = pageB.getByTestId('mother-resource-row');
  await expect(bMissing.filter({ hasText: '火花' })).toBeVisible();
  await expect(bMissing.filter({ hasText: '水蓝蓝' })).toHaveCount(0);
  await expect(bMissing.filter({ hasText: '喵喵' })).toContainText('另 1 人待发布/更新');

  await Promise.all([contextA.close(), contextA2.close(), contextB.close()]);
});
