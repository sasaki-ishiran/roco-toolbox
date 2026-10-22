import { defineConfig } from '@playwright/test';

/**
 * 真实本地 Functions + D1 的多人母本联调配置。
 *
 * 由 `tools/test/run-mother-groups-local.mjs --live` 启动服务后调用；
 * 这里**不**启动静态 preview（那没有 /api），baseURL 指向本地 wrangler。
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'mother-sharing-live.spec.ts',
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: process.env.ROCO_MOTHER_API_BASE ?? 'http://127.0.0.1:8789',
    viewport: { width: 390, height: 844 },
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
});
