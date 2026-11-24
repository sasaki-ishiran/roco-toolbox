# 家园横屏：账号、接单上窝、蛋仓移到右侧，刷新留在页面

> 分支：`friend/home-landscape-rail-20261124` → `test` · 工作区：S2 母本与配窝（家园页），连带 S3 换蛋页的纵栏接入

## 改了什么

横屏三栏骨架抽成公共组件后，家园、我的、换蛋、蛋仓四处接同一套：

- `src/ui/primitives/RailLayout.tsx`、`src/ui/primitives/rail.css`（新增）：横屏三栏骨架——主区在左、功能列（搜索 + 条件）在右可整列收起、纵向标题栏永远在最右；竖屏不套这一层。
- **家园横屏**（`src/ui/Home.tsx`、`src/index.css`）：顶栏不再渲染；**账号（可切换）、接单上窝、蛋仓**进右侧 2.6rem 纵向标题栏（一行两个字），账号下拉从栏内向左弹；**刷新家园**留在主区标题行右侧，刷新提示仍在标题下方一行；配窝卡单 / 双列只看横屏高度（`max-height: 600px`），高度够的平板横屏保持单列；未登录空态卡片居中、去掉说明，只留 1/3 宽的「去登录」，未入组 / 读失败保留说明。
- **我的 / 换蛋页**（`src/ui/Profile.tsx`、`src/ui/plan/EggMatchingHub.test.tsx`、`src/ui/CollectionGroups.tsx`）：页名由左侧页签表达，右侧栏不再重复；搜索与条件收进可折叠功能列，收起后主区加宽并按设备记住。
- **蛋详情**（`src/ui/plan/EggDetailModal.tsx`、`src/ui/plan/eggArt.tsx`、`src/ui/plan/eggDetail.css` 新增；`EggStockPanel.tsx` 相应变薄）：从蛋仓面板拆出来，高密度两栏排布，实际父母复用配窝精灵卡。
- 测试：`src/ui/Home.test.tsx`、`src/ui/Profile.test.tsx`、`src/ui/plan/EggStockView.test.tsx`、`src/ui/plan/EggMatchingHub.test.tsx` 补对应的横屏 / 收起 / 空态用例。

## 为什么

用户 2026-11-22 ~ 11-24 各轮原话：

- 「横屏的时候把账号，接单上窝，蛋仓移到右边」
- 「刷新家园留在家园页」
- 「未登录的卡片在屏幕正居中」「去登录按钮缩小 2/3」→ 后续改为「移除文案，按钮居中」
- 「只在屏幕高度不够才展示双列」（纠正第一版按宽度铺多列）
- 「我的」「换蛋」的页名由左侧页签表达，右侧栏不再重复

口径落点：`docs/设计系统/横屏布局规范-2026-11-22.md`；决策记录 `docs/项目记忆/决策.md` 2026-11-24 15:40。

## 涉及的产品口径

- 横屏家园顶栏位置变化（账号 / 蛋仓 / 接单上窝进右侧纵向标题栏）。
- 配窝卡并排只由高度触发，不再由宽度触发。
- 横屏未登录空态不再显示说明，只留「去登录」。
- 我的 / 换蛋横屏不再重复页面标题。
- 竖屏布局与文案均无变化。

## 验证

```text
$ npm run verify        # tsc -b && vitest run && vitest run --config vitest.functions.config.ts && node tools/lint-copy.mjs

 Test Files  204 passed | 1 skipped (205)
      Tests  1866 passed | 1 skipped (1867)
   Duration  44.97s

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  1.42s

文案 lint 通过：存量 13 条，新增 0 条。
exit=0
```

说明：这次全量跑了（分支刚合入最新 `test`、冲突刚解完，需要一次完整回归）。日常改动仍只跑相关文件，见 `AGENTS.md`「不要随便跑全量测试」。

## 界面变更

尺寸：844×390、1120×500、1024×768、390×844（本地 Chromium 导入真实备份后截图），文件在 `docs/preview/home-landscape-rail-20261124/`。

![844×390 横屏：账号 / 接单上窝 / 蛋仓在右侧纵向标题栏](https://raw.githubusercontent.com/EavonChan/roco-toolbox/friend/home-landscape-rail-20261124/docs/preview/home-landscape-rail-20261124/home-844-rail.png)

![844×390：账号下拉从标题栏向左弹](https://raw.githubusercontent.com/EavonChan/roco-toolbox/friend/home-landscape-rail-20261124/docs/preview/home-landscape-rail-20261124/home-844-account.png)

![1120×500 横屏：右栏不变，配窝卡保持单列](https://raw.githubusercontent.com/EavonChan/roco-toolbox/friend/home-landscape-rail-20261124/docs/preview/home-landscape-rail-20261124/home-1120-rail.png)

![1024×768 横屏：平板高度够，配窝卡单列](https://raw.githubusercontent.com/EavonChan/roco-toolbox/friend/home-landscape-rail-20261124/docs/preview/home-landscape-rail-20261124/home-1024-rail.png)

![390×844 竖屏：顶栏与配窝卡保持原样](https://raw.githubusercontent.com/EavonChan/roco-toolbox/friend/home-landscape-rail-20261124/docs/preview/home-landscape-rail-20261124/home-390-portrait.png)

![844×390 未登录空态：卡片居中、按钮 1/3 宽](https://raw.githubusercontent.com/EavonChan/roco-toolbox/friend/home-landscape-rail-20261124/docs/preview/home-landscape-rail-20261124/home-844-empty.png)

整页长图：[home-844-rail-full.png](https://raw.githubusercontent.com/EavonChan/roco-toolbox/friend/home-landscape-rail-20261124/docs/preview/home-landscape-rail-20261124/home-844-rail-full.png)

## 越界声明

- 改了 docs：`横屏布局规范-2026-11-22.md`（新增）、`决策.md`（新增 2026-11-24 15:40 一条）、`产品交互规范.md`（横屏口径）、`现状.md`（在制品），只追加本轮条目，未改历史结论。
- 碰了热点文件 `src/ui/plan/*`：蛋详情拆分、蛋仓面板变薄，原因同上（体量需要从面板里拆出去，见「改了什么」）。
- 分支里有一个 `merge: 合入 test（2ca1f28）` 的合并提交：按用户当轮指令合并主线，10 个冲突文件逐块解完（`individualBonuses` 统一为 `individualStats`、蛋仓保留共享骨架等）。规范建议用 rebase，这次是用户明确要求的例外；相对 `test` 的 diff 仍是本分支自身的改动，不含主线内容。

## 归属工作区

- 工作区：S2 母本与配窝（家园页）；连带 S3 换蛋页 / 我的页的纵栏接入
- 分支：`friend/home-landscape-rail-20261124` → `test`
- 规模：代码 **22 个文件，`+876 / −344`**；文档与截图 12 个文件，`+262 / −2`
  （**超协议上限 ≤8 文件 / ≤400 行**：这批提交是依次叠着做的——配窝卡 → 我的/换蛋接入 → 蛋详情拆分 → 家园右栏，单独抽一片出来编译不过；已与用户确认按「一次目的：横屏三栏改造」合并在一个 PR，不再拆）
