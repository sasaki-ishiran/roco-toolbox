import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE = readFileSync('src/domain/__fixtures__/backup-sample.json', 'utf8');
const SAMPLE_PCAP = readFileSync('src/pcap/__fixtures__/synthetic-capture.pcap');

/** 等 Service Worker 真正接管页面：没接管的话 /share-target 的 POST 不会被它拦到。 */
async function waitForController(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20000,
  });
}

test('manifest 声明了分享目标（采集器「分享」→「洛克工具箱」的前提）', async ({ page }) => {
  await page.goto('/');

  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(href, '页面里应有 manifest 链接').toBeTruthy();
  const response = await page.request.get(new URL(href as string, page.url()).toString());
  const manifest = (await response.json()) as { share_target?: unknown };

  expect(manifest.share_target).toEqual({
    action: 'share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { files: [{ name: 'file', accept: ['application/json', '.json', '*/*'] }] },
  });
});

test('分享一份采集数据进来，页面自动导入并回到首页', async ({ page }) => {
  await page.goto('/');
  await waitForController(page);
  await expect(page.getByText('还没有数据')).toBeVisible();

  // 模拟系统分享面板：POST 一份 multipart 表单到分享目标
  const posted = await page.evaluate(async (text) => {
    const form = new FormData();
    form.append('file', new File([text], 'hatch-backup.json', { type: 'application/json' }));
    const response = await fetch('/share-target', { method: 'POST', body: form });
    return { status: response.status, pathname: new URL(response.url).pathname };
  }, SAMPLE);

  // Service Worker 接住后应该 303 跳回首页并拿到应用外壳（不是停在 /share-target）。
  // 首页由预缓存应答，所以 response.url 会显示成它对应的 /index.html。
  expect(posted.status).toBe(200);
  expect(posted.pathname).toMatch(/^\/(index\.html)?$/);

  // 分享会重新导航回首页，应用启动时把文件取走自动导入；
  // 导入后默认落看板（有数据），data-message 在「导入数据」页
  await page.reload();
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(page.getByTestId('data-message')).toContainText('已导入分享进来的采集数据');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await expect(page.getByText('0 / 255', { exact: true })).toHaveCount(0);

  // 再刷新一次不会重复导入（暂存取走就删了；有数据时默认回看板）
  await page.reload();
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(page.getByTestId('data-message')).toHaveCount(0);
  await expect(page.getByText('还没有数据')).toHaveCount(0);
});

test('原生壳 APK 注入分享数据后自动导入（应用已经开着的情况）', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('还没有数据')).toBeVisible();

  // 模拟原生壳：接住系统的分享后把内容挂到 window.__rocoPendingShare 并派发事件
  await page.evaluate((text) => {
    (window as unknown as { __rocoPendingShare?: unknown }).__rocoPendingShare = {
      name: 'hatch-backup.json',
      text,
    };
    window.dispatchEvent(new Event('roco-share'));
  }, SAMPLE);

  // 导入后默认落看板（有数据），data-message 在「导入数据」页
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(page.getByTestId('data-message')).toContainText('已导入分享进来的采集数据');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await expect(page.getByText('0 / 255', { exact: true })).toHaveCount(0);
});

test('分享导入后自动做一次云同步（跨设备用户不用再手动点）', async ({ page }) => {
  // 已登录才会触发自动同步（导入后顺手对齐云端）
  await page.addInitScript(() => {
    window.localStorage.setItem('roco.accountId', 'acc-e2e');
    window.localStorage.setItem('roco.deviceToken', 'token-e2e');
  });
  const calls: string[] = [];
  await page.route('**/api/sync**', async (route) => {
    const method = route.request().method();
    calls.push(method);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(method === 'PUT' ? { ok: true, version: 1 } : { ok: true, snapshot: null }),
    });
  });

  await page.goto('/');
  await expect(page.getByText('还没有数据')).toBeVisible();

  await page.evaluate((text) => {
    (window as unknown as { __rocoPendingShare?: unknown }).__rocoPendingShare = {
      name: 'hatch-backup.json',
      text,
    };
    window.dispatchEvent(new Event('roco-share'));
  }, SAMPLE);

  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  // 自动同步 = 先拉云端（GET，云端为空时本机当第一份）再推回（PUT），不用用户动手
  await expect.poll(() => calls).toContain('GET');
  await expect.poll(() => calls).toContain('PUT');
});

/**
 * 采集器的「分享文件」给的是抓包（二进制），不是 JSON。
 * 壳会拦下这个约定地址、把字节原样返回（并带上跨域头），网页自己去取再解码。
 * 这里用 Playwright 的路由拦截来扮演壳的那一端。
 */
test('采集器分享抓包进来：网页自动解码并导入', async ({ page }) => {
  await page.route('https://roco-share.invalid/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: SAMPLE_PCAP,
    }),
  );

  await page.goto('/');
  await expect(page.getByText('还没有数据')).toBeVisible();

  // 模拟壳：接住采集器分享的抓包后通知页面
  await page.evaluate(() => {
    (window as unknown as { __rocoPendingShare?: unknown }).__rocoPendingShare = {
      kind: 'capture',
      name: 'capture-1.pcap',
    };
    window.dispatchEvent(new Event('roco-share'));
  });

  // 导入后默认落看板（有数据）；data-message 与「N 个账号」在「导入数据」页
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(page.getByTestId('data-message')).toContainText('已解析并导入分享进来的抓包数据');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await expect(page.getByText('1 个账号')).toBeVisible();
  // 解出来的账号与精灵要真的落到看板上（合成抓包里只有一只精灵，且不在我们图鉴里）
  await page.getByRole('button', { name: '看板' }).click();
  await expect(page.getByText('1 只精灵的 game_id 暂不在图鉴中')).toBeVisible();
});