import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// 更新日志数据源（读 JSON 而不是 import src 的 TS：配置文件属于 node 的 ts 工程，跨工程 import 会报 TS6307）
const { entries: changelogEntries } = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'data', 'changelog.json'), 'utf8'),
) as { entries: Array<{ id: string }> };

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 390, height: 844 },
    channel: 'chrome',
    // 默认把「更新内容弹窗」标记为已读：它是首启盖一层的模态，不预置会挡住所有用例。
    // 弹窗本身由 e2e/changelog.spec.ts 单独用空 storageState 验证。
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [
            { name: 'roco.changelogSeen', value: changelogEntries[0]?.id ?? '' },
            // 首启「使用教程」引导也是盖一层的模态，同样预置为已读（版本号见 src/ui/guide.ts 的 GUIDE_VERSION）；
            // 教程本身由 e2e/guide.spec.ts 用空 storageState 单独验证。
            // 改了 GUIDE_VERSION 必须同步改这里的值，否则教程会挡住所有用例。
            { name: 'roco.guideSeen', value: '3' },
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
