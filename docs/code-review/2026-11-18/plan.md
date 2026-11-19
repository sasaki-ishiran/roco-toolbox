# 2026-11-18 代码审查执行清单

> 依据：`docs/code-review/REVIEW-PLAYBOOK.md`（基线固化 → 分批发包 → 只读审查 → 分批修复 → 收尾验收）
> 本轮性质：先只读审查，报告出来后再进修复阶段。
> 上次审查：2026-11-08（`docs/code-review/2026-11-08/review-report.md`），基线 `087434f` + 增量 `e1f2f3c`、`779b08c`。

## 0. 本轮事实

| 项 | 值 |
| --- | --- |
| 上次审查结束 HEAD | `779b08c`（2026-11-08 23:38） |
| 本轮 head | `test` = `2c1ac40`（2026-11-18 03:00）+ 工作区改动 |
| 未审提交 | `779b08c..test` 共 **35 个**（2026-11-09 01:17 起） |
| 分支状态 | `test..release`、`test..bot` 为空；`codex/friend-ui-assets-20261117` 有 1 个未合入提交 `8b97e48`（设计资产） |
| 历史注意 | 2026-11-08 审查所在分支已被 `test` 重建取代，`087434f` 不在任何分支上；不能用 `087434f..test` 比范围 |

## 1. 开工前必须拍板的 6 件事（不许猜）

- [ ] **① 是否固化基线快照**：工作区有 5 个已改文件 + 1 个新迁移 + 多个未跟踪目录。建议提交一个「审查前基线快照」commit，作为总回滚点；不固化则修复阶段的 HEAD 会被工作区污染。
- [ ] **② 基线快照纳入哪些未跟踪内容**：建议只 add 代码与文档；`2026-11-12/15/16/17`、`output/`、`public/ui/eggs/`、`.preview/`、`.playwright-cli/`、`tmp-inspect-pcap.mjs` 先确认是产物还是源码，产物不纳入（或补 `.gitignore`），不要直接 `git add -A`。
- [ ] **③ 今天工作区里的巡查改动是否算本轮范围**：`functions/_lib/eggPatrol.ts`、`src/shared/eggPatrol.ts`、`src/shared/eggPatrol.test.ts`、`tools/test/egg-patrol-api.test.mjs`、`functions/schema.sql`、`functions/migrations/2026-11-18-egg-patrol-repeat-reminders.sql`。建议算入（并入 B3 / B4 / B5）。
- [ ] **④ 是否审 `android-shell/**`**：本轮 +6415/−2111，建议审，拆成 3 批 + 测试跟批。
- [ ] **⑤ 并行度**：默认 ≤3 个会话（本机终端上限 5）。
- [ ] **⑥ `8b97e48`（设计资产）**：建议只登记不审，待合入时按 §11 增量处理。

## 2. 阶段一：基线固化与验证

- [ ] 记录事实：`git log --oneline -5`、`git status --short`、`git diff --stat 779b08c..test`
- [ ] 按 ① ② 的决定提交基线快照，记下 `git rev-parse HEAD` 作为**总回滚点**
- [ ] 跑基线（只跑这一遍，收尾再跑一遍）：

```powershell
npx tsc -b
npx tsc -p functions/tsconfig.json
npx vitest run
npm run test:data-pipeline
```

- [ ] 把「文件数 / 用例数 / 通过 / 既有失败」写进本文件下方表格；既有失败逐条列出，后续对比时排除

| 检查项 | 结果 | 备注 |
| --- | --- | --- |
| `npx tsc -b` | 待跑 | |
| `npx tsc -p functions/tsconfig.json` | 待跑 | |
| `npx vitest run` | 待跑 | |
| `npm run test:data-pipeline` | 待跑 | |

## 3. 规范依据（仓库无 eslint / editorconfig，实测）

- `tsconfig*.json`（strict / noUnusedLocals / noUnusedParameters / noFallthroughCasesInSwitch / isolatedModules）
- `AGENTS.md`（工作约定、四类动作硬门槛、UI 先审后做）
- `docs/产品交互规范.md`、`docs/design/`（交互与文案）
- `docs/domain/**`（蛋组、体型、性格、覆盖度、配种排序）
- `src/data/changelog.json` 对应条目（需求口径）
- 同模块既有写法（必须写成「依据：参照 xxx 第 N 行」）
- 指不出依据的一律记为「建议」，不计中风险；禁止把个人偏好当规范

## 4. 阶段二：批次表（按目录切，测试跟被测代码同批）

> 规模来自 35 个提交的 numstat 汇总，用于切批；逐步开工时以实际 diff 为准。单批目标 ≤1,300 行，超了按文件再拆。

| 批次 | 范围 | 规模（+ / −） | 审查重点 | 验证命令 |
| --- | --- | --- | --- | --- |
| B1 | `src/domain/**`、`src/data/**`（图鉴/changelog） | +797 / −10 | 领域口径、体型/性格/覆盖度、changelog 与实现一致 | `npx vitest run src/domain` |
| B2 | `src/shared/eggWorkflow.ts`、`eggTaskActions.ts`、`eggMigration.ts` + tests | ≈ +900 / −17 | 交易状态机、认领/取消/确认、迁移口径 | `npx vitest run src/shared/eggWorkflow.test.ts src/shared/eggMigration.test.ts` |
| B3 | `src/shared/eggMatching.ts`、`eggPatrol.ts` + tests、`collectionGroups.ts` | ≈ +550 / −1 | 唯一父本判定、巡查窗口、提醒节流、任务键稳定性 | `node --test tools/test/egg-patrol-api.test.mjs` |
| B4 | `functions/_lib/**`（18 文件） | +692 / −34 | 巡查租约/配额/幂等、机器人桥接鉴权、催办、并发写 | `npx tsc -p functions/tsconfig.json` |
| B5 | `functions/schema.sql`、`functions/migrations/**` | +660 / 0 | 表结构/索引/唯一约束、迁移幂等、与代码字段一致（修复阶段禁改） | `node tools/test/verify-mother-groups-schema.mjs` |
| B6 | `src/pcap/**`、`src/pcap-decoder/**` | +917 / −127 | 实时解包增量、尾窗、坐标来源、异常帧 | `npx vitest run src/pcap src/pcap-decoder` |
| B7 | `src/collector/**`、`src/api/**` | +1080 / −100 | 采集所有权、解码源唯一、失败回退、上传链路 | `npx vitest run src/collector src/api` |
| B8a | `src/nearby/overlayPayload.ts` + tests | ≈ +980 / −55 | payload 契约、分贝口径、字段兼容 | `npx vitest run src/nearby/overlayPayload.test.ts` |
| B8b | `overlayBridge.ts`、`overlayPanels.ts`、`overlayMapAsset.ts`、`nearbyTargetStore.ts`、`nearbyFilterStore.ts`、`useNearbyOverlayPush.ts` + tests | ≈ +900 / −20 | 推送频率、面板配置、筛选与命中 | `npx vitest run src/nearby` |
| B9 | `src/ui/Nearby*.tsx`、`src/ui/NearbyMap.ts` + tests | ≈ +900 / −120 | 地图裁剪、雷达兜底、错误边界、性能 | `npx vitest run src/ui/Nearby.test.tsx src/ui/NearbyMap.test.ts` |
| B10 | `src/ui/plan/`：EggTasksPanel、EggMatchingHub、useEggMatching、EggLineSummary、EggDemandCard/Editor + tests | ≈ +1200 | 任务卡状态、匹配刷新、写冲突、来源展示 | `npx vitest run src/ui/plan` |
| B11 | `src/ui/plan/`：EggStockPanel、eggStockModel、EggBotConnection、eggTime、homeEggAdapter、usePlanBadge、planAlertsStore + tests | ≈ +600 | 蛋仓推算、连接状态、时间口径、角标 | `npx vitest run src/ui/plan` |
| B12 | `src/ui/` 其他（Profile、ServerAddressPanel、serverEnv、TabNav、tour、useTabViewTracking、HomeDemandPlacements、useClaimedDemands 等） | ≈ +700 / −80 | 切服口径、教程进度、埋点、文案闸门 | `npx vitest run src/ui/Profile.test.tsx src/ui/ServerAddressPanel.test.tsx src/ui/tour.test.ts` |
| B13 | `android-shell` capture 包（Capture* 7 文件）+ 对应测试 | ≈ +2500 / −900 | VPN 采集生命周期、上传队列、状态机、异常恢复 | `npm run test`（安卓侧按仓库现有命令） |
| B14 | `android-shell` 悬浮窗/面板（BattleOverlayController、NearbyOverlayModel、NearbyPanelController、OverlayGeometry）+ 对应测试 | ≈ +1800 / −700 | 悬浮窗生命周期、坐标换算、触摸/拖拽、权限 | 同上 |
| B15 | `android-shell` 壳本体与更新（MainActivity、ServerConfig、IdentityRescue、update/*、其余测试） | ≈ +1100 / −600 | 切服探活、身份救援、更新清单兼容、保活 | 同上 |
| B16 | `scripts/**`、`tools/**`、`package.json`、`public/_headers`、`public/android/**` | ≈ +1000 / −50 | 发版断言、通道校验、lint-copy 基线、清单门禁 | `node tools/test/verify-mother-groups-schema.mjs`、`node tools/lint-copy.mjs` |
| B17 | `e2e/**`（最后一批） | ≈ +110 / −35 | 只在所有修复提交完成后跑 | `npx playwright test --list` + 相关 2~3 个 spec |

**排除范围**：`docs/screenshots/**`、`docs/prototypes/**`、`docs/设计资产/**`、`*.png`、`dist/`、`node_modules/`、`*.apk`、`*.tsbuildinfo`、lockfile、生成物。

## 5. 阶段三：分发

- [ ] 每批一份自包含简报：`docs/code-review/2026-11-18/briefs.md`（按 §12 骨架，四反引号整段可复制）
- [ ] 简报自带：文件清单、审查重点、已知线索、规范白名单、分级、输出路径与编号、验证命令、纪律、必须停下问的情形
- [ ] 并行 ≤3；同一文件不允许两个会话同时改；只读阶段禁止任何 git 写操作
- [ ] 每批报告路径：`docs/code-review/2026-11-18/B{n}.md`，编号 `B{n}-H01 / M01 / L01 / U01`
- [ ] 每条严格按 §5 三段式：①问题描述（现状/用户影响/触发条件，技术证据压成一行括号附录）②优化方案（把 X 改成 Y，不贴代码）③优化后表现（解决什么 + 可点路径或可执行命令）

## 6. 阶段四：修复规则

- [ ] 顺序 高 → 中 → 低；每批 ≤3 问题 / 3 文件，批间汇报（结论 + 速览表 + 最多 2 条待拍板）
- [ ] 每个问题：记 HEAD → 独立提交 `fix(cr-B{n}-01): …` → 跑相关测试 + `npx tsc -b` → 与基线对比，新增失败立即回滚该提交
- [ ] 硬性禁止：删文件/目录、重命名公共接口、改 `migrations/**` 与 `schema.sql`、改 CI/CD 与部署配置、改 lockfile、`reset --hard`/`rebase`/force push、顺带重构/格式化、升级依赖、为让测试通过改断言
- [ ] 必须停下问：业务口径二选一、涉及线上数据、影响面无法静态确认、需要改表结构、需要放宽 e2e 超时
- [ ] 本轮特别提醒：`functions/migrations/**` 与 `schema.sql` 已在 B5 审查；发现问题只记录，修复动作单独确认

## 7. 阶段五：收尾验收（只跑一次，对着最终 HEAD）

```powershell
npx vitest run
npx tsc -b
npx tsc -p functions/tsconfig.json
npm run test:data-pipeline
npm run test:mother-groups:api
npx playwright test --list
npx playwright test <与本次改动最相关的 2~3 个 spec>
```

- [ ] 核对数据库迁移执行顺序（迁移先于 Functions 部署）
- [ ] 核对 changelog 是否需要补用户可见说明
- [ ] 核对报告覆盖所有批次编号

## 8. 合并报告

- [ ] `docs/code-review/2026-11-18/report.md`：结论 → 问题统计（批 × 等级）→ 修复记录（编号 → commit → 验证）→ 未修/降级/待议 → 剩余风险 → 一页速览（只列高中风险，不出现文件名行号）
- [ ] 归档本清单与各批报告，保持编号不变，修复提交直接引用

## 9. 增量规则（审查中途来了新提交）

- [ ] 先让工作区落地（提交或冻结）
- [ ] 只审差异面：文件被改过 → 旧结论作废/降级复核；没改 → 原样承接；被删 → 关闭
- [ ] 计划文档留「旧项作废判定表」：有效 / 作废 / 已顺手修掉
- [ ] 收尾验收仍只做一次，对着最终 HEAD
