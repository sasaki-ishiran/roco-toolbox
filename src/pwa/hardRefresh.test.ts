import { describe, expect, test, vi } from 'vitest';
import { hardRefresh, type HardRefreshDeps } from './hardRefresh';

interface Harness {
  deps: HardRefreshDeps;
  order: string[];
  update: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  deleteCache: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<HardRefreshDeps> = {}): Harness {
  const order: string[] = [];
  const update = vi.fn(async () => {
    order.push('update');
  });
  const unregister = vi.fn(async () => {
    order.push('unregister');
    return true;
  });
  const deleteCache = vi.fn(async (name: string) => {
    order.push(`delete:${name}`);
    return true;
  });
  const reload = vi.fn((url: string) => {
    order.push(`reload:${url}`);
  });
  const deps: HardRefreshDeps = {
    getRegistration: async () => ({ update, unregister }) as unknown as ServiceWorkerRegistration,
    cacheNames: async () => ['workbox-precache-v2', 'roco-share-target'],
    deleteCache,
    href: 'https://example.com/?a=1',
    reload,
    now: () => 1234,
    ...overrides,
  };
  return { deps, order, update, unregister, deleteCache, reload };
}

describe('hardRefresh', () => {
  test('先检查更新、再注销 SW、清空所有缓存，最后带时间戳重载', async () => {
    const { deps, order, update, unregister, deleteCache, reload } = harness();
    const url = await hardRefresh(deps);

    expect(update).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleteCache.mock.calls.map((call) => call[0])).toEqual([
      'workbox-precache-v2',
      'roco-share-target',
    ]);
    expect(url).toBe('https://example.com/?a=1&v=1234');
    expect(reload).toHaveBeenCalledWith(url);
    expect(order[0]).toBe('update');
    expect(order[1]).toBe('unregister');
    expect(order[order.length - 1]).toBe(`reload:${url}`);
  });

  test('没有 Service Worker 也照常清缓存并重载', async () => {
    const { deps, deleteCache, reload } = harness({ getRegistration: async () => null });
    const url = await hardRefresh(deps);
    expect(reload).toHaveBeenCalledWith(url);
    expect(deleteCache).toHaveBeenCalledTimes(2);
  });

  test('检查更新 / 注销 / 读缓存出错时仍然重载（不能把人卡在原地）', async () => {
    const { deps, reload } = harness({
      getRegistration: async () => {
        throw new Error('SW 不可用');
      },
      cacheNames: async () => {
        throw new Error('Cache Storage 不可用');
      },
    });
    const url = await hardRefresh(deps);
    expect(reload).toHaveBeenCalledWith(url);
  });

  test('删除某个缓存失败不影响后续缓存与重载', async () => {
    const order: string[] = [];
    const reload = vi.fn();
    const deleteCache = vi.fn(async (name: string) => {
      order.push(name);
      if (name === 'workbox-precache-v2') throw new Error('占用中');
      return true;
    });
    const url = await hardRefresh({
      getRegistration: async () => null,
      cacheNames: async () => ['workbox-precache-v2', 'roco-share-target'],
      deleteCache,
      href: 'https://example.com/',
      reload,
      now: () => 1,
    });
    expect(order).toEqual(['workbox-precache-v2', 'roco-share-target']);
    expect(reload).toHaveBeenCalledWith(url);
  });
});
