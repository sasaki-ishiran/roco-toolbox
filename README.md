# 洛克工具箱

《洛克王国：世界》孵蛋规划工具箱 —— 把你自己的精灵数据导进来，算出「还缺哪些母本 / 该换什么蛋 / 家园小窝怎么摆」，让每颗孵出来的蛋都是你要的。

纯前端的 PWA，数据默认只存在本机（IndexedDB / localStorage）；可选的云同步能把账号数据与偏好同步到自建的 Cloudflare Pages Functions + D1 后端。另有一个 Android 壳（WebView）方便手机上导入抓包文件。

## 功能

- **我的精灵** —— 按账号 / 性别 / 性格 / 体型 / 声音筛选，卡片显示盒位与账号。
- **覆盖度** —— 以「蛋组 × 性格 × 档位」为缺口矩阵，看还差哪些（目标档位是全局口径，在看板顶部选）。
- **配窝建议** —— 按账号生成家园摆位：普通窝 60%/30%、学院小窝 100% 遗传，尽量多连线、公母均衡，并给出可直接照着摆的坐标图。
- **换什么** —— 换蛋候选清单，与「优质种公推荐」共用同一套口径。
- **母本全收集 / 待补齐母本** —— 达标标准（体型、声音）可自定义。
- **导入数据** —— 支持采集器导出的备份、抓包文件（PCAP）、分享导入；导入是可合并的，不会覆盖本机已有数据。
- **云同步（可选）** —— 免密开号 + 恢复码，跨设备合并（不是覆盖）。

## 环境要求

- **Node.js ≥ 22**（构建与部署用 `wrangler@4`）
- 想重新抓数据/重建图鉴：能访问上游 Wiki 的网络
- 想打包 Android 壳：JDK 21、Android SDK 35、NDK 28.2.13676358、CMake 3.22.1

## 快速开始

```bash
npm install
npm run dev            # 本地开发（http://localhost:5173）
```

仓库根还有三个 Windows 一键脚本：`启动手机版.cmd`（构建后用局域网 IP 起服务，手机同 Wi-Fi 打开）、`刷新数据.cmd`（从 Wiki 刷新数据并重建图鉴）、`构建线上版.cmd`（只构建 `dist/`）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查 + 构建到 `dist/` |
| `npm run preview` | 本地预览生产构建（注意：会真的上报匿名埋点） |
| `npm test` | Vitest 单元/领域测试 |
| `npm run e2e` | Playwright 端到端测试（建议加 `--workers=4`） |
| `npm run trim:catalog` | 由 `data/` 重建 `src/data/catalog.gen.json` |
| `npx tsc -p functions/tsconfig.json` | 后端类型检查（根 `tsc -b` 不含后端工程） |

## 目录结构

```
src/domain/      孵蛋领域模型（配窝、几何、覆盖度、换蛋、种公推荐）——纯函数，最好读的一层
src/ui/          React 界面与模块级 store
src/data/        图鉴（catalog.gen.json，由数据管线生成）
src/api/         云同步 / 埋点 / 会话
src/storage/     IndexedDB 与 localStorage
src/pcap/        抓包文件解析入口（解析器本体在 src/pcap-decoder/，见「第三方」）
functions/       Cloudflare Pages Functions + D1 后端（schema.sql 是表结构）
android-shell/   Android WebView 壳
tools/data-pipeline/  数据管线：抓 Wiki、烘焙图鉴、生成蛋归属映射
e2e/             Playwright 用例
docs/            领域说明、部署与历史记录
```

## 数据来源与管线

图鉴口径来自 [洛克王国：世界 Wiki](https://wiki.biligame.com/nrc)（CC BY-SA 4.0），原始快照在 `data/raw/`，抓取逻辑在 `tools/data-pipeline/refresh.mjs`：

```bash
node tools/data-pipeline/refresh.mjs          # 抓最新 → 写 data/
node tools/data-pipeline/trim-catalog.mjs     # data/ → src/data/catalog.gen.json
```

「每个形态对应哪颗蛋」的映射表是 `tools/data-pipeline/vendor/egg-map.json`。重建它需要第三方工具「蛋神助手」的解包目录（**不随本仓库分发，需自备**）：

```bash
node tools/data-pipeline/build-egg-map.mjs <蛋神助手解包目录>
```

## 后端（可选，自建云同步）

后端是 Cloudflare Pages Functions + D1，与前端同域，配置在根 `wrangler.toml`。

```bash
# 1) 建表（在仓库根执行；库名见 wrangler.toml 的 d1_databases）
npx wrangler d1 execute <你的库名> --remote --file functions/schema.sql

# 2) 看统计用的只读令牌（不写进仓库）
npx wrangler pages secret put STATS_TOKEN

# 3) 部署
npm run build
npx wrangler pages deploy dist --project-name <你的项目名> --branch=main --commit-dirty=true
```

`wrangler.toml` 里的 `database_id` 需要改成你自己的 D1；`ALLOWED_ORIGINS` 改成你的域名。

## 测试

```bash
npm test                                   # Vitest
npx playwright test --workers=4            # e2e（8 并发会出现偶发 Target crashed）
```

e2e 依赖两个首启弹窗（更新公告、使用教程）被预置为「已读」，见 `playwright.config.ts`；**改了 `src/ui/guide.ts` 的 `GUIDE_VERSION` 必须同步改那里**，否则教程会挡住所有用例。

## 许可与第三方

- 本项目代码以 **GPL-3.0** 授权，见 [LICENSE](LICENSE)。
- 图鉴数据来自 [洛克王国：世界 Wiki](https://wiki.biligame.com/nrc)，以 **CC BY-SA 4.0** 授权。
- `src/pcap-decoder/` 是上游「数据采集器」的抓包解析器源码，以 **GPL-3.0** 原样内嵌（含其 [LICENSE](src/pcap-decoder/LICENSE)），未作修改。
