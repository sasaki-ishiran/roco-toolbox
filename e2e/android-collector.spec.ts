import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const url = 'https://roco-share.invalid/collector/12345678-1234-1234-1234-123456789abc';
const fixture = readFileSync('src/pcap/__fixtures__/synthetic-capture.pcap');
const bootstrap = readFileSync('android-shell/app/src/main/assets/capture-bridge.js', 'utf8');
async function mockCollector(page: Page) {
  await page.addInitScript((captureUrl) => {
    const file = { id: 'capture-123.pcap', name: 'capture-123.pcap', size: 1234, createdAt: 1792800000000, valid: true };
    const state = { version: 1, supported: true, phase: 'idle', message: '准备采集', packets: 0, bytes: 0, files: [file] };
    const actions: Record<string, (id?: string) => string> = {
      getState: () => JSON.stringify(state),
      startCapture: () => { state.phase = 'capturing'; state.message = '采集中'; return ''; },
      stopCapture: () => { state.phase = 'idle'; state.message = '已停止并保存'; return ''; },
      openGame: () => '', shareCapture: () => '',
      importCapture: () => {
        (window as unknown as { __rocoPendingShare: unknown }).__rocoPendingShare = { kind: 'capture', name: file.name, url: captureUrl };
        window.dispatchEvent(new Event('roco-share'));
        return '';
      },
      deleteCapture: () => { state.files = []; return ''; },
    };
    const port = { onmessage: null as null | ((event: { data: string }) => void), postMessage(text: string) {
      const request = JSON.parse(text) as { requestId: string; action: string; id?: string };
      const result = actions[request.action](request.id);
      queueMicrotask(() => port.onmessage?.({ data: JSON.stringify({ requestId: request.requestId, result }) }));
    } };
    (window as unknown as { RocoCaptureBridge: unknown }).RocoCaptureBridge = port;
  }, url);
  await page.addInitScript({ content: bootstrap });
}

test('新版安卓入口从采集保存到真实 Worker 解析、账号持久化', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await mockCollector(page);
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: fixture }));
  await page.goto('/');
  const card = page.getByTestId('native-collector');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '开始采集', exact: true }).click();
  await expect(card.getByRole('button', { name: '解析并导入', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: '停止并保存', exact: true }).click();
  await card.getByRole('button', { name: '解析并导入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.getByTestId('data-message')).toContainText('已解析并导入本机采集数据');
  await expect(page.getByText('1 个账号')).toBeVisible();
  // The raw file is still present; reloading does not need another import.
  await expect(card.getByText('capture-123.pcap')).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 个账号')).toBeVisible();
  await expect(page.getByText(/测试玩家/).first()).toBeVisible();
  const stored = await page.evaluate(() => new Promise<{ gameId: number; pets: unknown[] }[]>((resolve, reject) => {
    const request = indexedDB.open('locke-toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('snapshots').objectStore('snapshots').getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }));
  expect(stored).toHaveLength(1);
  expect(stored[0].gameId).toBe(151910);
  expect(stored[0].pets).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('解析失败保留原包，手机宽度无横向溢出，删除需明确确认', async ({ page }) => {
  await mockCollector(page);
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from('invalid capture') }));
  await page.goto('/');
  const card = page.getByTestId('native-collector');
  await card.getByRole('button', { name: '解析并导入', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /抓包|pcap|PCAP/ }).first()).toBeVisible();
  await expect(card.getByText('capture-123.pcap')).toBeVisible();
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
  await page.screenshot({ path: '.superpowers/collector-mobile.png', fullPage: true });
  await card.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '保留文件', exact: true }).click();
  await expect(card.getByText('capture-123.pcap')).toBeVisible();
  await card.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(card.getByText('还没有本机采集文件')).toBeVisible();
});
