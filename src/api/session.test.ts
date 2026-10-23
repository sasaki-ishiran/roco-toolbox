import { afterEach, expect, test, vi } from 'vitest';
import { authFetch, deleteAccount, logoutAccount, readAccountId } from './session';

afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

test('旧令牌请求晚到的 401 不得清除后来登录的新会话', async () => {
  window.localStorage.setItem('roco.accountId', 'A');
  window.localStorage.setItem('roco.deviceToken', 'tokenA');
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const request = authFetch('/api/mother-groups').catch((e: unknown) => e);
  window.localStorage.setItem('roco.accountId', 'B');
  window.localStorage.setItem('roco.deviceToken', 'tokenB');
  finish(new Response('{}', { status: 401 }));
  await request;
  expect(readAccountId()).toBe('B');
});

test('当前令牌的 401 仍然清除失效会话', async () => {
  window.localStorage.setItem('roco.accountId', 'A');
  window.localStorage.setItem('roco.deviceToken', 'tokenA');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
  await expect(authFetch('/api/mother-groups')).rejects.toThrow('登录已失效');
  expect(readAccountId()).toBeNull();
});

test.each([['退出', logoutAccount], ['注销', deleteAccount]] as const)('%s的旧请求晚到不能清除新身份', async (_name, action) => {
  window.localStorage.setItem('roco.accountId', 'A');
  window.localStorage.setItem('roco.deviceToken', 'tokenA');
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const request = action();
  window.localStorage.setItem('roco.accountId', 'B');
  window.localStorage.setItem('roco.deviceToken', 'tokenB');
  finish(new Response('{}', { status: 200 }));
  await request;
  expect(readAccountId()).toBe('B');
});
