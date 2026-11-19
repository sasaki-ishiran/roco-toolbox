/**
 * 小组页 + 家园「接单上窝」的「纯本地预览」入口（2026-11-19）。
 *
 * 用法：`npm run dev`，地址后面加 `?mock=group`（例如 http://localhost:5173/?mock=group）。
 * 打开后：
 * - 自动登录成一个假账号（阿岚），并进入「周末互换」小组；
 * - 小组资源、需求中心、换蛋广场、蛋仓、我的换蛋都有假数据；
 * - 家园里有两只假号（主号 / 小号）、窝、住户和实际配对，家园 → 接单上窝能排出
 *   「母本 × 种公」，也能勾「已上窝」；
 * - 新建 / 加入 / 发布 / 撤回 / 发起换蛋 / 上窝这些操作在内存里真的会变（刷新页面还原）。
 *
 * 只在开发环境生效：`src/main.tsx` 用 `import.meta.env.DEV` 守住，生产构建不会打包这里。
 */
import { API_BASE } from '../../api/analytics';
import { accountKeyOf } from '../../domain/parseBackup';
import { saveSnapshot, listSnapshots } from '../../storage/snapshots';
import { refreshSnapshots } from '../../storage/snapshotStore';
import { CHANGELOG } from '../../data/changelog';
import { createMockState, ensureSelf, handleMockApi, type MockGroupState } from './api';
import { MOCK_GROUP_ID, MOCK_INVITE, MOCK_ME } from './data';
import { mockSnapshots } from './home';

const TOKEN_KEY = 'roco.deviceToken';
const ACCOUNT_KEY = 'roco.accountId';
const PREFS_KEY = `roco.collectionGroups:${MOCK_ME}`;

function jsonResponse(reply: { status: number; body: unknown }): Response {
  if (reply.status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 让页面以为「已经登录、并且在这个组里」，省掉手动登录 / 输邀请码。 */
function seedSession(): void {
  const localStorage = window.localStorage;
  if (!localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, 'mock-dev-token');
  localStorage.setItem(ACCOUNT_KEY, MOCK_ME);
  // 预览时别让更新弹窗 / 新手引导挡住界面（只在 mock 模式里做）。
  localStorage.setItem('roco.changelogSeen', CHANGELOG[0]?.id ?? 'mock');
  // 直接从「小组」页开屏：旧键 swap 会被 initialNavigation() 映射到 groups。
  if (!localStorage.getItem('roco.lastTab')) localStorage.setItem('roco.lastTab', 'swap');
  for (const segment of ['start', 'dashboard', 'collection', 'groups', 'home', 'profile', 'nearby']) {
    localStorage.setItem(`roco.tourSeen.${segment}`, '3');
  }
  if (!localStorage.getItem(PREFS_KEY)) {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        mode: 'group',
        lastGroupIds: { mother: MOCK_GROUP_ID },
        inviteCodes: { [MOCK_GROUP_ID]: MOCK_INVITE },
        sharingOff: {},
        completionsSeenAt: {},
      }),
    );
  }
}

/**
 * 写入假的本机数据（背包精灵 + 家园）。
 *
 * - 本机一条数据都没有：两张假号全写进去；
 * - 已经有预览数据、但那是旧版（没有家园快照）：补一份，免得升级后家园还是空的；
 * - 已经有真实数据：一律不动用户的本机数据。
 */
async function seedSnapshots(): Promise<void> {
  const seeds = mockSnapshots();
  const existing = await listSnapshots();
  const isMockSnapshot = (snapshot: { pets: { captureId?: string }[] }): boolean =>
    snapshot.pets.some((pet) => pet.captureId?.startsWith('mock_'));
  const pending =
    existing.length === 0
      ? seeds
      : seeds.filter((seed) => {
          const current = existing.find((item) => accountKeyOf(item) === accountKeyOf(seed));
          return current ? isMockSnapshot(current) && !current.home : false;
        });
  if (pending.length === 0) return;
  await Promise.all(pending.map((snapshot) => saveSnapshot(snapshot)));
  await refreshSnapshots();
}

export async function installGroupMock(): Promise<MockGroupState> {
  const state = createMockState();
  ensureSelf(state);
  seedSession();

  // 必须等写完再渲染：首屏拿不到本机数据时 App 会跳去「我的·游戏数据」，
  // 那样「打开就是小组页」的预览体验就没了。
  try {
    await seedSnapshots();
  } catch {
    // 写不了 IndexedDB（隐私模式）也能看，只是「我的资源」里没有本机账号。
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.href);
      if (url.pathname.startsWith('/api/')) {
        const sameOrigin = url.origin === window.location.origin;
        const devApi = API_BASE.length > 0 && raw.startsWith(API_BASE);
        if (sameOrigin || devApi) {
          const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
          let body: unknown = null;
          if (typeof init?.body === 'string') {
            try {
              body = JSON.parse(init.body);
            } catch {
              body = null;
            }
          }
          const reply = handleMockApi(url.pathname, method, body, state);
          // 没实现的接口也**不放行到网络**：开发环境的 API_BASE 指向正式站，
          // 假令牌打过去至少会 401 把你踢下线，不该让预览污染线上。
          if (reply) return Promise.resolve(jsonResponse(reply));
          return Promise.resolve(
            new Response(JSON.stringify({ error: '预览模式没有实现这个接口' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
      }
    } catch {
      // 解析 URL 失败就照常走真实网络，不影响其它请求。
    }
    return originalFetch(input as RequestInfo, init);
  };

  // 方便在控制台看当前假数据：`__mockGroup.group`
  (window as unknown as { __mockGroup?: MockGroupState }).__mockGroup = state;
  return state;
}
