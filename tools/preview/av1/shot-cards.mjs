/**
 * 「我的」页卡片化（UX1 方案 A）实现截图：375 / 390。
 *
 * 输出：docs/preview/UX1-实现-{375,390}-{1-我的页,2-采集问号,3-附近详情}.png
 * 运行：AV1_BASE=http://localhost:5238/ node tools/preview/av1/shot-cards.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.AV1_BASE ?? 'http://localhost:5238/';
const OUT = 'docs/preview';
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
];

async function openProfile(page) {
  await page.goto(`${BASE}?mock=group`, { waitUntil: 'load' });
  await page.waitForSelector('nav[data-tour="tab-nav"]', { timeout: 60_000 });
  await page.evaluate(() => {
    for (const segment of ['start', 'dashboard', 'collection', 'nearby', 'groups', 'home', 'profile']) {
      localStorage.setItem('roco.tourSeen.' + segment, '6');
    }
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('nav[data-tour="tab-nav"]', { timeout: 60_000 });
  await page.waitForTimeout(900);
  const skip = page.getByRole('button', { name: '跳过' });
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) {
    await skip.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '我的');
    tab?.click();
  });
  await page.waitForSelector('[data-testid="profile-collect-card"]', { timeout: 30_000 });
  await page.waitForTimeout(600);
  const skipProfile = page.getByRole('button', { name: '跳过' });
  await skipProfile.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await skipProfile.isVisible().catch(() => false)) {
    await skipProfile.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    for (const size of SIZES) {
      const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
      await context.addInitScript(() => {
        const accountId = 'mock-me';
        for (const segment of ['start', 'dashboard', 'collection', 'nearby', 'groups', 'home', 'profile']) {
          localStorage.setItem('roco.tourSeen.' + segment, '6');
        }
        localStorage.setItem('roco.deviceToken', 'shot-token');
        localStorage.setItem('roco.accountId', accountId);
        localStorage.setItem('roco.username', '阿岚');
        localStorage.setItem('roco.nearbyTargets', JSON.stringify([3001, 3002]));
        // 模拟安卓壳的采集桥：只读状态（截图用，不会真的开始采集）
        let capturing = false;
        window.RocoCapture = {
          getState: async () =>
            JSON.stringify({
              version: 1,
              supported: true,
              phase: capturing ? 'capturing' : 'idle',
              message: capturing ? '采集中' : '已停止',
              packets: capturing ? 1234 : 0,
              bytes: capturing ? 1024 * 1024 : 0,
              fileId: capturing ? 'capture-1.pcap' : '',
              files: capturing
                ? []
                : [{ id: 'capture-1.pcap', name: 'capture-1.pcap', size: 1024 * 1024, createdAt: Date.now() - 60_000, valid: true }],
            }),
          startCapture: async () => { capturing = true; return ''; },
          stopCapture: async () => { capturing = false; return ''; },
          getDevices: async () => JSON.stringify({ ok: true, devices: [], selected: null }),
          deleteFile: async () => '',
        };
        localStorage.setItem(
          'roco.collectionGroupCache',
          JSON.stringify({
            [accountId]: {
              groups: [{ id: 'mock-weekend', name: '周末互换', memberCount: 3, updatedAt: Date.now() }],
            },
          }),
        );
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => console.log(`PAGEERROR ${size.width}: ${error.message}`));

      await openProfile(page);
      await page.screenshot({ path: `${OUT}/UX1-实现-${size.width}-1-我的页.png`, fullPage: true });
      console.log(size.width, '1-我的页', await page.getByTestId('profile-home').getAttribute('data-sections'));

      // 战斗焦点：只换看哪一类，不重开采集
      await page.getByTestId('profile-capture-focus-battle').click({ force: true });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/UX1-实现-${size.width}-1b-我的页-战斗.png` });
      console.log(size.width, '1b-战斗焦点', await page.getByTestId('profile-collect-result').getAttribute('data-focus'));
      await page.getByTestId('profile-capture-focus-nearby').click({ force: true });
      await page.waitForTimeout(150);

      await page.getByTestId('native-collector-help').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/UX1-实现-${size.width}-2-采集问号.png` });
      console.log(size.width, '2-采集问号', await page.getByTestId('native-collector-help-body').isVisible());

      // 收起 ? 再拍采集中
      await page.getByTestId('native-collector-help').click({ force: true });
      await page.waitForTimeout(150);
      // 采集中：第 4 段收成一个停止按钮
      await page.evaluate(() => (document.querySelector('[data-testid="profile-collect-peek"]')).click());
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/UX1-实现-${size.width}-3-采集中.png` });
      console.log(size.width, '3-采集中', await page.getByTestId('profile-collect-stop').isVisible());

      await page.evaluate(() => (document.querySelector('[data-testid="profile-collect-detail"]')).click());
      await page.waitForSelector('[data-testid="nearby-alert-card"]', { timeout: 15_000 });
      await page.waitForTimeout(500);
      const skipNearby = page.getByRole('button', { name: '跳过' });
      await skipNearby.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
      if (await skipNearby.isVisible().catch(() => false)) {
        await skipNearby.click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: `${OUT}/UX1-实现-${size.width}-4-附近详情.png` });
      console.log(size.width, '4-附近详情', await page.getByTestId('nearby-alert-card').isVisible());

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
