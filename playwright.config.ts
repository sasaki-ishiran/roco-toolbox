import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// 更新日志数据源（读 JSON 而不是 import src 的 TS：配置文件属于 node 的 ts 工程，跨工程 import 会报 TS6307）
const { entries: changelogEntries } = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'data', 'changelog.json'), 'utf8'),
) as { entries: Array<{ id: string }> };

/**
 * 首启教程的版本号：从 src/ui/guide.ts 里读出来，不再手抄一份。
 * 手抄的那份一旦忘了同步（改教程版本是常规操作），教程弹窗会盖住所有 e2e 用例，
 * 而且是「全套一起红」——所以这里解析失败就直接抛错，宁可启动就炸。
 */
const guideVersion: string = (() => {
  const source = readFileSync(join(process.cwd(), 'src', 'ui', 'guide.ts'), 'utf8');
  const matched = source.match(/GUIDE_VERSION\s*=\s*'([^']+)'/);
  if (!matched) throw new Error('没法从 src/ui/guide.ts 解析出 GUIDE_VERSION（写法变了？）');
  return matched[1];
})();

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 390, height: 844 },
    // 不写死 channel: 'chrome'：那样只有装了 Google Chrome 的机器才跑得起来。
    // 默认用 Playwright 自带的 Chromium（首次需要 `npx playwright install chromium`）。
    // 默认把「更新内容弹窗」标记为已读：它是首启盖一层的模态，不预置会挡住所有用例。
    // 弹窗本身由 e2e/changelog.spec.ts 单独用空 storageState 验证。
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [
            { name: 'roco.changelogSeen', value: changelogEntries[0]?.id ?? '' },
            // 首启「使用教程」引导也是盖一层的模态，同样预置为已读（值从 src/ui/guide.ts 读出来，
            // 不再手抄；教程本身由 e2e/guide.spec.ts 用空 storageState 单独验证）。
            { name: 'roco.guideSeen', value: guideVersion },
          ],
        },
      ],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    // 必须每次自己构建并启动：如果复用了外部正在跑的服务（例如“启动手机版.cmd”），
    // 测试会打到旧构建上，出现"改了代码但测试没反应"的假失败。
    reuseExistingServer: false,
  },
});
