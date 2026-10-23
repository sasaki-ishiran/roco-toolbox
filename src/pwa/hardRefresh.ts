/**
 * 手动刷新到最新版本。
 *
 * 正常情况下我们靠 Service Worker 的 skipWaiting + controllerchange 自动换版；
 * 但有人（尤其国产浏览器 / 应用内 WebView）会卡在旧缓存里，自动更新始终不生效。
 * 这个按钮做一次「硬刷新」：先让浏览器检查并注销 Service Worker、清空预缓存，
 * 再带一次性查询参数重新加载，绕过浏览器与内嵌 WebView 的 HTML 缓存。
 */
export interface HardRefreshDeps {
  /** 取当前 Service Worker 注册（没有则返回 null） */
  getRegistration: () => Promise<ServiceWorkerRegistration | null>;
  /** 当前所有 Cache Storage 的名字 */
  cacheNames: () => Promise<string[]>;
  /** 删除某个缓存 */
  deleteCache: (name: string) => Promise<boolean>;
  /** 当前页面地址 */
  href: string;
  /** 重新加载到指定地址 */
  reload: (url: string) => void;
  /** 时间戳来源（测试可注入） */
  now?: () => number;
}

/** 返回落点 URL，便于排查与测试。 */
export async function hardRefresh(deps: HardRefreshDeps): Promise<string> {
  // 1. 先触发一次更新检查：有新版就让它开始下载
  try {
    const registration = await deps.getRegistration();
    await registration?.update();
  } catch {
    // 检查失败不影响后面清缓存
  }

  // 2. 注销 Service Worker：下次加载会重新注册、重新拉一份
  try {
    const registration = await deps.getRegistration();
    await registration?.unregister();
  } catch {
    // 注销失败也继续
  }

  // 3. 清空预缓存（否则旧 SW 留下的资源还会被命中）
  try {
    for (const name of await deps.cacheNames()) {
      await deps.deleteCache(name).catch(() => false);
    }
  } catch {
    // Cache Storage 不可用时直接跳过
  }

  // 4. 带时间戳重新加载：URL 变了，浏览器与 WebView 的 HTML 缓存都用不上
  const url = new URL(deps.href);
  url.searchParams.set('v', String((deps.now ?? Date.now)()));
  deps.reload(url.toString());
  return url.toString();
}

/** 浏览器里的实际实现（App 的「刷新」按钮调用）。 */
export function refreshApp(): Promise<string> {
  const container = typeof caches === 'undefined' ? null : caches;
  return hardRefresh({
    getRegistration: async () =>
      'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistration()) ?? null : null,
    cacheNames: async () => (container ? await container.keys() : []),
    deleteCache: async (name) => (container ? await container.delete(name) : false),
    href: window.location.href,
    reload: (url) => window.location.replace(url),
  });
}
