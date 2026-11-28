import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.AV1_BASE ?? 'http://localhost:5239/';
const OUT = 'docs/preview';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const size of [{ width: 375, height: 812 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    for (const s of ['start', 'dashboard', 'collection', 'nearby', 'groups', 'home', 'profile']) {
      localStorage.setItem('roco.tourSeen.' + s, '6');
    }
    localStorage.setItem('roco.deviceToken', 'shot-token');
    localStorage.setItem('roco.accountId', 'mock-me');
    localStorage.setItem('roco.username', '阿岚');
    window.RocoCapture = {
      getState: async () => JSON.stringify({ version: 1, supported: true, phase: 'idle', message: '已停止', packets: 0, bytes: 0, files: [{ id: 'capture-1.pcap', name: 'capture-1.pcap', size: 1048576, createdAt: Date.now() - 60000, valid: true }] }),
      startCapture: async () => '', stopCapture: async () => '', getDevices: async () => JSON.stringify({ ok: true, devices: [], selected: null }), deleteFile: async () => '',
    };
  });
  const page = await context.newPage();
  await page.goto(BASE + '?mock=group&mockComplete=1', { waitUntil: 'load' });
  await page.waitForSelector('nav[data-tour="tab-nav"]', { timeout: 60000 });
  await page.waitForTimeout(900);
  const skip = page.getByRole('button', { name: '跳过' });
  await skip.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) { await skip.click({ force: true }).catch(() => {}); await page.waitForTimeout(300); }
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '我的')?.click());
  await page.waitForTimeout(600);
  for (const name of ['跳过', '知道了']) {
    const b = page.getByRole('button', { name });
    if (await b.isVisible().catch(() => false)) { await b.first().click({ force: true }).catch(() => {}); await page.waitForTimeout(300); break; }
  }
  await page.waitForSelector('[data-testid="native-collector-complete"]', { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/UX1-两卡-完成态-' + size.width + '.png', fullPage: true });
  console.log(size.width, '完成态', await page.getByTestId('native-collector-complete').isVisible(), await page.getByTestId('native-collector-state').textContent());
  await context.close();
}
await browser.close();
