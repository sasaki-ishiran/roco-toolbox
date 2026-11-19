# 2026-11-19 发版前代码审查执行清单

> 依据 `docs/code-review/REVIEW-PLAYBOOK.md`。本轮目标：正式发布前把 `test` 上未审的改动全部过一遍。
> 上一轮实际执行过的审查是 2026-11-08（基线 `779b08c`）；2026-11-18 的清单只做了计划，未执行。

## 0. 基线（已冻结）

| 项 | 值 |
| --- | --- |
| 审查基线 | `6aaf5e7`（`test`，含今日 UI 与壳修复） |
| 审查范围 | `779b08c..6aaf5e7`（2026-11-09 起全部未审提交，约 60 个） |
| 协作分支 | `friend/20261119` 已同步到 `6aaf5e7` |
| 分支状态 | `test..release`、`test..bot` 为空；`codex/friend-ui-assets-20261117` 仅作历史 |

基线验证（已跑，收尾再跑一次）：

- `npx tsc -b` ✅
- `npx tsc -p functions/tsconfig.json` ✅
- `npx vitest run` ✅ 181 文件 / 1563 通过、1 跳过
- `node --test tools/test/egg-patrol-api.test.mjs` ✅ 19 通过
- `npm run test:data-pipeline` ✅ 59 通过

## 1. 数据库状态（已执行，不要重复跑）

| 迁移 | 状态 |
| --- | --- |
| `2026-11-18-egg-patrol-repeat-reminders.sql` | 已执行 |
| `2026-11-18-egg-patrol-placement.sql` | **已执行**：observations CHECK 含 `placed`，`egg_patrol_one_egg` 已恢复 |
| `2026-11-18-accounts-username-password.sql` | 已执行：accounts 三列 + 唯一索引 |

备份表：`accounts_backup_20261118`、`egg_patrol_observations_backup_20261118`。

## 2. 批次（今日 delta 优先）

| 批次 | 范围 | 重点 | 验证 |
| --- | --- | --- | --- |
| R1 | `src/shared/eggPatrol.ts`、`eggWorkflow.ts`、`eggMatching.ts` + tests | 目标匹配、breeding_pairs、placed、对称 give/return | `npx vitest run src/shared/eggPatrol.test.ts` |
| R2 | `functions/_lib/eggPatrol.ts`、`eggPatrolStore.ts`、`tools/test/egg-patrol-api.test.mjs` | 上窝/产出先后、限频、唯一索引让位、任务重建 | `node --test tools/test/egg-patrol-api.test.mjs` |
| R3 | `src/ui/plan/**`（EggMatchingHub、EggTasksPanel、EggDemandCard、useEggMatching、eggStock） + tests | 广场状态条、只看我能接、需求两块、统一入口、双行确认、memo | `npx vitest run src/ui/plan` |
| R4 | `functions/_lib/auth.ts`、`util.ts`、`router.ts`、`src/api/session.ts`、`AccountPanel` | 用户名密码、PBKDF2、老账号 setup、旧接口保留 | `npx tsc -p functions/tsconfig.json` |
| R5 | `src/shared/bodySize.*`、`src/domain/petFilters/motherCriteria/demandCriteria/catalog` | 奖牌与孵蛋口径分离、身高边界、v4 判定 | `npx vitest run src/domain` |
| R6 | `src/ui/Dashboard/MyPets/Collection/myPetsFilterStore/coverageFilterStore/CoverageFilterBar` | 档位单选、看板空账号、共 N 只、筛选迁移 | `npx vitest run src/ui` |
| R7 | 朋友 PR（`8b97e48..081b604`） | 背包/图鉴筛选、收集看板、家园页、卡片布局 | 按文件分批只读 |
| R8 | `android-shell` 壳：`MainActivity`、`appUpdate`、`build.gradle` | 桥强引用、通道/版本号、保活重建 | `compileReleaseJavaWithJavac` |
| R9 | 其余 2026-11-09 起未审的采集/附近/壳/脚本 | 沿用 `docs/code-review/2026-11-18/plan.md` 的 B1-B17 分批 | 对应 vitest / tsc |

> 单批目标 ≤1300 行；R7/R9 按目录再拆。每批报告写 `docs/code-review/2026-11-19/R{n}.md`，编号 `R{n}-H01 / M01 / L01`。

## 3. 分发与格式

- 简报自包含：文件清单、重点、已知线索、规范白名单（tsconfig / AGENTS / 产品交互规范 / domain 文档 / changelog）、分级、输出路径、验证命令
- 只读阶段禁止任何 git 写操作；并行 ≤3；同一文件不允许两个会话同时改
- 每条问题按三段式：现状与影响 → 优化方案 → 优化后表现；技术证据压成一行括号附录

## 4. 修复与验收

- 顺序 H → M → L；每批 ≤3 问题 / 3 文件，批间汇报
- 禁止：删文件、改迁移/schema、改发版脚本与清单、改 lockfile、`reset --hard`/force push、顺手重构
- 收尾一次跑：两套 tsc、全量 vitest、patrol API、data-pipeline、`npx playwright test --list` + 相关 2~3 个 spec
- 合并报告：`docs/code-review/2026-11-19/report.md`（结论、统计、修复记录、剩余风险、一页速览）

## 5. 上线前置条件（审查后确认）

- [ ] 审查报告完成，高中风险全部关闭或有明确豁免
- [ ] v4 `all-mothers-v4-*` 与客户端同窗口发布（旧客户端发布会 400）
- [ ] 正式包用正式参数重新构建、版本号与两份主站清单一致
- [ ] 发布窗顺序：版本化包 → `latest.apk` → 两份清单 → 网页
- [ ] 回滚三件套（网页 + `latest.apk` + 两份清单）与交接卡准备好
