import { expect, test } from '@playwright/test';

/** PWA 可安装的前提：manifest 可访问、图标齐全、Service Worker 注册成功 */
test('PWA：manifest 可访问且 Service Worker 注册成功', async ({ page }) => {
  await page.goto('/');

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(manifestHref, '页面里应有 manifest 链接').toBeTruthy();

  const manifestUrl = new URL(manifestHref as string, page.url()).toString();
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBeTruthy();
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: Array<{ src: string; purpose?: string; sizes?: string; type?: string }>;
  };
  expect(manifest.name).toBe('洛克工具箱');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

  // 安卓 Chrome 要 192/512 的位图（PNG）才会做成「真安装」（WebAPK）。
  // 只有 SVG 时会退化成快捷方式，而快捷方式拿不到分享目标 ——「洛克工具箱」就不会出现在系统分享面板里。
  const iconTypes = manifest.icons.map((icon) => `${icon.sizes}|${icon.type}`);
  expect(iconTypes, '要有 192x192 的 PNG 位图图标').toContain('192x192|image/png');
  expect(iconTypes, '要有 512x512 的 PNG 位图图标').toContain('512x512|image/png');
  expect(
    manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.type === 'image/png'),
    '要有 PNG 的 maskable 图标（安卓会把图标裁成圆形）',
  ).toBe(true);

  // 图标文件真的能取到
  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, manifestUrl).toString();
    const iconResponse = await page.request.get(iconUrl);
    expect(iconResponse.ok(), `${icon.src} 应该能访问`).toBeTruthy();
  }

  // Service Worker 注册（插件在页面加载时自动注册）
  let registered = false;
  for (let attempt = 0; attempt < 20 && !registered; attempt += 1) {
    registered = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
    if (!registered) await page.waitForTimeout(250);
  }
  expect(registered, 'Service Worker 应注册成功（否则安卓无法真正安装到主屏幕）').toBe(true);
});

/**
 * 部署新版本后，手机上打开的可能是被 Service Worker 缓存下来的旧页面。
 * 顶部显示构建时间，就能一眼确认"我拿到的到底是不是最新一版"。
 */
test('页面顶部显示版本标记', async ({ page }) => {
  await page.goto('/');

  const version = page.getByTestId('app-version');
  await expect(version).toBeVisible();
  await expect(version).toContainText(/\d{4}-\d{2}-\d{2}/);
});
