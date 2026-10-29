# 2026-10-29 代码审查：各批任务简报（可直接粘贴分发）

> 用法：从下面挑一个批次，把**整段代码块内容**作为新会话的第一条消息发出去即可。
> 每个简报都自带范围、规范依据、分级标准、输出路径与纪律，新会话无需额外上下文。
>
> 配套：[审查计划与批次](2026-10-29-审查计划与批次.md)（范围、基线、统计口径）。

## 分发顺序建议

| 阶段 | 批次 | 并行度 |
| --- | --- | --- |
| 1 | B1 → B2 | 串行（口径先定死） |
| 2 | B3 → B4 | 串行即可，也可与 B9 并行 |
| 3 | B9、B6、B7、B8 | 最多同时 3 个会话 |
| 4 | B5（单会话，分两轮读） | 单独一个会话 |
| 5 | B10 | 最后，基于全部修复后的 HEAD |

---

## B1 域模型 A：需求口径与产线

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端（手机优先）+ Cloudflare Pages Functions + D1 后端。孵蛋领域规则见 docs/domain/breeding-planner/、docs/domain/蛋组推荐性格.md、docs/domain/数据字段说明.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中下列文件的变更，及其直接调用方。
- src/domain/demandCriteria.ts（新增 +334 行，共 307 行）/ demandCriteria.test.ts（+370）
- src/domain/demandStats.ts（新增 +18）/ demandStats.test.ts（+39）
- src/domain/productionLines.ts（新增 +210，共 194 行）/ productionLines.test.ts（+163）
- src/domain/motherCriteria.ts（+7/−15）/ motherCriteria.test.ts
- src/domain/petFilters.ts（+7/−2）/ petFilters.test.ts（+36）
- src/shared/bodySize.js（+54）/ bodySize.d.ts（+13）；测试在 src/pcap/bodySize.test.ts（文件本身未改，但必须一起跑）

【审查重点】
1. 需求口径：目标 = 蛋 + 性格 + 性别 + 体型 + 声音；空字段不参与校验，是否有字段漏判/误判。
2. 严格结单：血脉（含进化形态）、性格、性别、体型、声音全部匹配才算；与 changelog 2026-10-27a 描述是否一致。
3. 体型合格口径：无奖牌时身高 100%/0% 且体重 ≥95%/≤5%；有奖牌仍按 98%/2%；两组口径是否混用、边界（正好 95%、浮点 0.9499）是否正确。
4. 身高/体重两位小数：取整时机、舍入方式、浮点比较是否有误差累积。
5. 产线档位等价：+100 ≡ 婉转声、-100 ≡ 粗嗓门；档位表合并逻辑是否会把不该等价的档位也纳入；all-mothers-v2 口径标识是否与后端（functions/_lib）一致。
6. demandStats 已结单计数口径（含被移除成员），与 docs/产品交互规范.md 229-239 是否一致。
7. motherCriteria 删掉的 15 行口径是否还有调用方在用。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig.app.json（strict/noUnusedLocals/noUnusedParameters/noFallthroughCasesInSwitch）；AGENTS.md；docs/产品交互规范.md；docs/domain/**；src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目；同模块既有写法（须写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性（精度、编码、时区、事务、幂等）/安全。中：违反上述明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释格式。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B1.md。编号 B1-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/调用链）、影响面、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B1-01): …，提交前记录 git rev-parse HEAD 写入 B1.md 的「处理记录」。
【验证】修复后跑 npx vitest run src/domain/demandCriteria.test.ts src/domain/demandStats.test.ts src/domain/productionLines.test.ts src/domain/motherCriteria.test.ts src/domain/petFilters.test.ts src/pcap/bodySize.test.ts 与 npx tsc -b。基线：104 文件/810 用例全绿、tsc 通过；出现新增失败立即回滚该提交并标「修复失败待议」。
【硬性禁止】删文件/目录、重命名公共接口、改 functions/migrations 与 schema.sql、改 CI/CD 与部署配置、改 lockfile、git reset --hard/rebase/force push/改历史、顺带重构或格式化无关代码、升级依赖、为让测试通过改断言（认为断言错就先报告）。
【遇以下立即停下问我】需要业务口径二选一、涉及线上数据、影响面无法静态确认。
````

---

## B2 域模型 B：资源、阵列与备份

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端（手机优先）+ Cloudflare Pages Functions + D1 后端。孵蛋领域规则见 docs/domain/breeding-planner/、docs/domain/蛋组推荐性格.md、docs/domain/数据字段说明.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中下列文件的变更，及其直接调用方。
- src/domain/studMatrix.ts（新增 +167，共 152 行）/ studMatrix.test.ts（+107）
- src/domain/studResource.ts（+57/−25，共 278 行）/ studResource.test.ts（+25）
- src/domain/studSharing.ts（+38/−16）
- src/domain/motherResource.ts（+74/−14）/ motherResource.test.ts（+72/−55）
- src/domain/motherSharing.ts（±4）/ motherSharing.test.ts
- src/domain/coverageDetail.ts、suggestions.ts、nestPlan.ts、collectionPublication.ts、backup.ts
- src/domain/parseBackup.ts（+123/−2，共 243 行）/ parseBackup.test.ts（+68）
- src/domain/types.ts（新增 +81）
- src/test/fixtures/motherSharing.ts（±6）

【审查重点】
1. 种公阵列（studMatrix）：蛋组 × 目标性格 × 档位 的分格逻辑；同格多只时选代表与记忆；推荐兜底（无精确推荐时按蛋组兜底一只可出公的蛋物种）是否会给出错误物种。
2. 推荐取个体：同一图鉴号有多只时优先挑带目标性格的那只（changelog 2026-10-28c），多只都符合时的确定性。
3. 母本摘要（motherResource）：新增 lines（蛋 × 档位 × 性格）的构建、去重与体积；all-mothers-v2 升级后旧摘要显示「需更新」的判定。
4. 进化形态算同蛋组（火神 vs 本体）；多分支进化按分支最终形态算推荐性格。
5. 备份解析（parseBackup）：编码、超大文件、字段缺失/类型异常、异常数据是否被静默丢弃。
6. types.ts 新增 81 行字段的可选性——是否会让旧数据/旧备份解析后出现 undefined 崩溃。
7. motherSharing 的覆盖度聚合与 unknown 成员处理是否与 docs/产品交互规范.md 245 一致。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig.app.json（strict/noUnusedLocals/noUnusedParameters/noFallthroughCasesInSwitch）；AGENTS.md；docs/产品交互规范.md；docs/domain/**；src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目；同模块既有写法（须写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性/安全。中：违反上述明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释格式。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B2.md。编号 B2-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/调用链）、影响面、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B2-01): …，提交前记录 git rev-parse HEAD 写入 B2.md 的「处理记录」。
【验证】修复后跑 npx vitest run src/domain/studMatrix.test.ts src/domain/studResource.test.ts src/domain/motherResource.test.ts src/domain/motherSharing.test.ts src/domain/parseBackup.test.ts src/domain/collectionPublication.test.ts src/domain/backup.test.ts 与 npx tsc -b。基线：104 文件/810 用例全绿；出现新增失败立即回滚该提交并标「修复失败待议」。
【硬性禁止】删文件/目录、重命名公共接口、改 functions/migrations 与 schema.sql、改 CI/CD 与部署配置、改 lockfile、git reset --hard/rebase/force push/改历史、顺带重构或格式化无关代码、升级依赖、为让测试通过改断言（认为断言错就先报告）。
【遇以下立即停下问我】需要业务口径二选一、涉及线上数据、影响面无法静态确认。
````

---

## B3 后端 A：D1 存储层

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端 + Cloudflare Pages Functions + D1 后端（functions/_lib/）。需求口径以 src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目为准，交互约定见 docs/产品交互规范.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- functions/_lib/collectionGroupsStore.ts（+603/−76，现 1,800 行）★核心
- functions/_lib/collectionGroupsValidation.ts（+17/−12）
以及它们在 functions/ 内的调用方。表结构（functions/schema.sql、functions/migrations/2026-10-2*.sql）只读，用于核对列名/约束/级联。

【审查重点】
1. 需求状态机 open→claimed→done 的 claim/release/complete/withdraw：是否每条 UPDATE 都判 meta.changes（0 行更新不能当成功），是否有「先查后写」的时间窗。
2. 外键级联：collection_group_demands 的 (group_id,demander_account_id) → mother_group_members ON DELETE CASCADE；移除成员/退出/解散小组会不会删掉 status='done' 的记录，导致其他成员「已结单」数倒退（规范 229-239 明确要求已完成保留）。
3. 成员移除/退出清理的语句顺序（有没有排在级联之后的无效 DELETE）。
4. 额度与限流：发布额度统计口径、done 行是否永不清理、列表是否有分页。
5. 断言/校验：natures 是否 trim 后入库、路径/请求体数值是否严格校验。
6. resource_epoch / targetRevision 的一致性语义，客户端是否真的消费。

【已知线索（未复核，必须重读当前代码确认行号与结论后再定级）】
- 疑似高：collectionGroupsStore.ts 约 962-976，移除成员靠级联删除其已完成需求。
- 疑似中：completeCollectionDemand 约 1866-1887 不判 changes；撤回需求 DELETE 约 1701-1723 无 status<>'done' 守卫；需求列表约 1532-1544 无分页。
- 疑似低：种公组整条链路已成不可达死代码（约 601-758、1063、1153）；parseCollectionTarget 的 allowEmptyStud 死参；resource_epoch 无人消费。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig；AGENTS.md；docs/产品交互规范.md；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能（N+1、循环内 IO）/数据正确性（事务、幂等、精度、编码）/安全（越权、注入）。中：违反明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B3.md。编号 B3-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/SQL/调用链）、影响面、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B3-01): …，提交前记录 git rev-parse HEAD 写入 B3.md 的「处理记录」。
【验证】修复后跑 npx tsc -p functions/tsconfig.json 与 npm run test:mother-groups:api（起本地 wrangler + 临时 D1，只监听 127.0.0.1）。基线：tsc 通过；该集成测试尚未跑过，首次结果即基线，请把结果记进报告。出现新增失败立即回滚该提交并标「修复失败待议」。
【硬性禁止】删文件/目录、重命名公共接口、改 functions/migrations 与 schema.sql（发现表结构问题只报告）、改 CI/CD 与部署配置、改 lockfile、git reset --hard/rebase/force push/改历史、顺带重构、升级依赖、为让测试通过改断言。
【遇以下立即停下问我】修 H1 这类需要「加历史表/改外键」的方案取舍、D1 是否开启外键、涉及线上数据。
````

---

## B4 后端 B：handler 与表结构

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端 + Cloudflare Pages Functions + D1 后端。需求口径以 src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目为准，交互约定见 docs/产品交互规范.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- functions/_lib/collectionGroups.ts（+261/−2，现 710 行）
- functions/_lib/motherGroupsStore.ts（+71/−9）
- functions/_lib/motherGroups.ts（+8）
- functions/_lib/motherGroupsValidation.ts（+43/−1）
- 只读核对：functions/schema.sql（+28）、functions/migrations/2026-10-26-collection-demands.sql、2026-10-27-collection-demand-criteria.sql、2026-10-27-drop-stud-groups.sql、2026-10-27-mother-production-lines.sql

【审查重点】
1. 请求体上限：母本发布从 256KiB 改到 128KiB（MOTHER_RESOURCE_MAX_BODY_BYTES）是否与本次新增的 lines 字段 + 账号/蛋/产线/性格上限匹配，是否会造成多账号用户 413 回归。
2. 鉴权与越权：组长专属操作（改目标、移除成员、解散）、成员操作、邀请码；身份是否可伪造。
3. 错误码与 HTTP 状态一致性（同一 code 在不同 handler 映射不同状态）。
4. 路径/query 参数解析宽松度（Number() vs 严格整数校验），缺参时是否静默补默认导致误删。
5. criteriaId 不再校验后，「发布成功但永远未确认」的静默状态是否存在。
6. 迁移可重入性：2026-10-27-collection-demand-criteria.sql 若是「建 v2→复制→删旧表→改名」，重复执行会不会静默把所有需求的性别/体型/声音重置为默认值。
7. 迁移与 schema.sql 的列名/默认值/唯一约束/索引是否一致；两份 handler 是否重复了同一批辅助函数与限流常量。

【已知线索（未复核，必须重读当前代码确认行号与结论后再定级）】
- 疑似中：collectionGroups.ts 约 334-340 母本 128KiB 上限；约 1019-1078（store 侧）criteriaId 不校验；两份 handler 约 64-128 / 40-109 重复辅助件；撤回需求缺省默认值（约 586-591）；parseDemandEggGameId 用 Number()（约 481-494）。
- 疑似低：handleRemoveMember 用 404 + NOT_MEMBER，与 STORE_STATUS 的 403 冲突（约 737-739）。
- 疑似不确定：全员图鉴版本一致才算 confirmed 是否必要；生产 D1 是否开启外键。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig；AGENTS.md；docs/产品交互规范.md；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性/安全（越权、注入、敏感信息）。中：违反明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B4.md。编号 B4-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/SQL/调用链）、影响面、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B4-01): …，提交前记录 git rev-parse HEAD 写入 B4.md 的「处理记录」。
【验证】修复后跑 npx tsc -p functions/tsconfig.json 与 npm run test:mother-groups:api。基线：tsc 通过；该集成测试尚未跑过，首次结果即基线。
【硬性禁止】删文件/目录、重命名公共接口、改 functions/migrations 与 schema.sql（只报告）、改 CI/CD 与部署配置、改 lockfile、git reset --hard/rebase/force push/改历史、顺带重构、升级依赖、为让测试通过改断言。
【遇以下立即停下问我】需要改表结构/迁移的修法取舍、线上实际最坏请求体大小、D1 外键开关状态。
````

---

## B5 UI A：MotherGroupResources 巨型组件

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端（手机优先，安卓 WebView 内运行）+ Cloudflare Functions + D1。需求口径以 src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目为准，交互约定见 docs/产品交互规范.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- src/ui/MotherGroupResources.tsx（+2,339/−126，现 2,576 行）★全仓最大组件
- src/ui/MotherGroupResources.test.tsx（+1,328/−88）

【读法】这个文件是**单个组件**（MasterGroupResources 组件本体约 141–2607 行，辅助函数在 2608 行之后）。请分两轮读、在报告里分两节写：
- 第 1 轮：状态与派生（1–765 行）、「我缺的」筛选与瀑布流（560–660）、成员复选（约 169–560）
- 第 2 轮：需求聚合与卡片（766–1140）、发布动作（1143–1336）、结单控件与选择态（1337–1470）、渲染主体（1469–2607）、辅助函数（2608 之后）

【审查重点】
1. 三视图（missing/mine/seeking）的状态隔离：切身份/切组时临时查看状态、筛选条件、选择态是否串到另一个组或另一个视图（2026-10-24 曾有同类缺陷）。
2. 「我缺的」瀑布流：默认 24 项 + IntersectionObserver 追加的边界（重复项、漏项、筛选变化后滚动位置、observer 未清理）；筛选区的分区是否会被筛空的整页跳走。
3. 严格结单判定：血脉（含进化形态）/性格/性别/体型/声音是否全部匹配；「本机只有一只、配不出另一只时不算能接单」是否正确；一键结单的触发条件（对方已接单且本机确有该蛋）。
4. 发布动作：publishResourceDemand / publishStudDemand 的并发（DEMAND_PUBLISH_CONCURRENCY=4）与失败回滚、重复点击、部分成功的提示是否准确。
5. 性能：渲染期重建的大数组/Set/排序、每行新增闭包、2600 行组件的重复计算；明显可 memo 的点只算建议，但循环内 IO/每帧 O(n²) 算高。
6. 可测试性：单文件 2576 行、单函数过长、重复逻辑（归中/建议）。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig（strict/noUnusedLocals/noUnusedParameters）；AGENTS.md；docs/产品交互规范.md；docs/domain/**；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性/安全。中：违反明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B5.md。编号 B5-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/调用链）、影响面（什么操作触发、用户看到什么）、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B5-01): …，提交前记录 git rev-parse HEAD 写入 B5.md 的「处理记录」。**不要在这个文件里做拆分重构**（拆组件属于独立任务，需另开）。
【验证】修复后跑 npx vitest run src/ui/MotherGroupResources.test.tsx 与 npx tsc -b。基线：104 文件/810 用例全绿。
【硬性禁止】删文件/目录、重命名公共接口、改 migrations/schema、改 CI/CD、改 lockfile、git reset --hard/rebase/force push、顺带重构或格式化、升级依赖、为让测试通过改断言。
【遇以下立即停下问我】需要改交互口径、涉及线上数据、影响面无法静态确认。
````

---

## B6 UI B：小组与需求流

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端（手机优先）+ Cloudflare Functions + D1。需求口径以 src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目为准，交互约定见 docs/产品交互规范.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- src/ui/useCollectionGroups.ts（+271/−146，现 1,145 行）
- src/ui/groupAutoPublish.ts（+117/−9）/ groupAutoPublish.test.ts（+162/−3）
- src/ui/MotherGroupMembers.tsx（+204/−46）/ MotherGroupMembers.test.tsx（+151，新增）
- src/ui/GroupTargetEditor.tsx（+113/−28）
- src/ui/CollectionGroups.tsx（+159/−168）
- src/ui/CollectionGroupSetup.tsx（+32/−81）/ CollectionGroupSetup.test.tsx（−19）
- src/ui/collectionGroupStore.ts（+12/−7）/ collectionGroupStore.test.ts

【审查重点】
1. hook 竞态：切换小组/切换成员/刷新后旧请求回写（abort 或 epoch 校验）；连续 setState 的合并；isLoading/错误态残留。
2. 自动发布（groupAutoPublish）：触发条件是否严格为「导入后 + 对方已接单 + 本机确有该蛋」；幂等（会不会重复发同一需求）；失败后的重试与用户提示。
3. 目标编辑（GroupTargetEditor）：修订号并发（两人同时改），冲突时是否覆盖别人；criteriaId 生成口径（motherCriteriaIdOf）与后端「只认 all-mothers-v2」是否一致。
4. CollectionGroups：+159/−168 的删改是否漏掉旧入口（种公组已下线）；空态/错误态。
5. CollectionGroupSetup：−81 行后创建流程是否还能走通（旧种公组分支删除后的残留判断）。
6. 错误处理一致性：同层里有 catch 的不 catch、错误被吞、提示文案与实际失败不符。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig；AGENTS.md；docs/产品交互规范.md；docs/domain/**；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性/安全（越权）。中：违反明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B6.md。编号 B6-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/调用链）、影响面、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B6-01): …，提交前记录 git rev-parse HEAD 写入 B6.md 的「处理记录」。
【验证】修复后跑 npx vitest run src/ui/groupAutoPublish.test.ts src/ui/MotherGroupMembers.test.tsx src/ui/CollectionGroupSetup.test.tsx src/ui/collectionGroupStore.test.ts 与 npx tsc -b。基线：104 文件/810 用例全绿。
【硬性禁止】删文件/目录、重命名公共接口、改 migrations/schema、改 CI/CD、改 lockfile、git reset --hard/rebase/force push、顺带重构或格式化、升级依赖、为让测试通过改断言。
【遇以下立即停下问我】需要改交互口径、涉及线上数据、影响面无法静态确认。
````

---

## B7 UI C：家园与精灵卡

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端（手机优先，安卓 WebView）+ Cloudflare Functions + D1。需求口径以 src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目为准，UI 规范见 docs/产品交互规范.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- src/ui/Home.tsx（新增 +285，共 265 行）/ Home.test.tsx（+160，新增）
- src/ui/PetCompactCard.tsx（新增 +205，共 189 行）
- src/ui/PetCard.tsx（+58/−40）/ PetCard.test.tsx（+56）
- src/ui/PetAvatar.tsx（新增 +63）/ PetAvatar.test.tsx（+31）
- src/domain/petAvatar.ts（新增 +23）/ petAvatar.test.ts（+23）；src/domain/petIcons.ts（新增 +54）/ petIcons.test.ts（+37）
- src/ui/ImportOutcomeNotice.tsx（+132/−1）/ ImportOutcomeNotice.test.tsx（+132）；src/ui/ImportPanel.tsx（+17/−11）；src/ui/importOutcomeStore.ts（+4）
- src/ui/NativeCollectorPanel.tsx（+26/−12）/ NativeCollectorPanel.test.tsx
- src/ui/listViewStore.ts（+35/−2）/ listViewStore.test.ts、navigation.ts、lastTab.ts、TabNav.tsx、App.tsx（+3）

【审查重点】
1. 160×115 紧凑卡：名字最多 5 个字、多形态只显示基础名（「雪绒鸟_夏天的样子」→「雪绒鸟」）、性格固定右上角；窄屏溢出、长名字截断是否可能挤压奖牌/蛋组。
2. 配窝卡片：数据来自游戏实际配对（layEggCouples），是否与家园数据一致；一公一母缺失时的降级。
3. 身高/体重两位小数在家园与精灵库统一（含种公选择弹层入口，跨组件一致性）。
4. 家园不再显示小窝文字、学院小窝整张卡变绿——条件判断是否会被其他状态误命中。
5. ImportOutcomeNotice：触发条件（仅当对方已接单且本机确有该蛋）、一键结单动作是否正确、重复弹提示。
6. NativeCollectorPanel 与导入链路的新增字段是否与 parseBackup 输出一致（undefined 崩溃风险）。
7. listViewStore/navigation/lastTab 的状态隔离与刷新后恢复。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig；AGENTS.md；docs/产品交互规范.md；docs/domain/**；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性/安全。中：违反明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B7.md。编号 B7-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/调用链）、影响面（什么操作触发、用户看到什么）、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B7-01): …，提交前记录 git rev-parse HEAD 写入 B7.md 的「处理记录」。
【验证】修复后跑 npx vitest run src/ui/Home.test.tsx src/ui/PetCard.test.tsx src/ui/PetAvatar.test.tsx src/ui/ImportOutcomeNotice.test.tsx src/ui/NativeCollectorPanel.test.tsx src/ui/listViewStore.test.ts src/domain/petAvatar.test.ts src/domain/petIcons.test.ts 与 npx tsc -b。
【硬性禁止】删文件/目录、重命名公共接口、改 migrations/schema、改 CI/CD、改 lockfile、git reset --hard/rebase/force push、顺带重构或格式化、升级依赖、为让测试通过改断言。
【遇以下立即停下问我】涉及布局细节（元素位置/大小/间距）的改动——按 AGENTS.md 约定先给可交互 HTML 或截图方案确认，不要直接改代码。
````

---

## B8 UI D：种公阵列与弹层

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端（手机优先，安卓 WebView）+ Cloudflare Functions + D1。需求口径以 src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目为准，UI 规范见 docs/产品交互规范.md。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- src/ui/StudMatrix.tsx（新增 +598，共 575 行）/ StudMatrix.test.tsx（+257，新增）；src/ui/studMatrixStore.ts（新增 +43）
- src/ui/DemandPublishSheet.tsx（新增 +264，共 253 行）
- src/ui/Coverage.tsx（+61）/ CoverageMatrix.tsx（+2）
- src/ui/primitives/NatureSelect.tsx（新增 +161）/ primitives/primitives.test.tsx（+30）
- src/ui/RecommendedNatureEditor.tsx（+8/−5）/ 同名测试（+13）
- src/ui/MotherGradeInventory.tsx、GenderRatioSpecies.tsx、Dashboard.tsx、SwapWishCard.tsx、SuggestionCard.tsx、GuideModal.tsx、MotherView.tsx、PetList.tsx、MotherSharing.tsx、MotherGroupSetup.tsx、MotherResourceEditor.tsx（+27/−19）

【审查重点】
1. 种公阵列：64×58 格子、名字超长只显示基础名（完整名在悬停/弹层）、「荐」标记；同格多只时换代表是否持久化（studMatrixStore）。
2. 手机滑动：种公阵列只横向滚动，触摸表格区域时整页仍能上下滑（touch-action / preventDefault 处理，2026-10-28b 明确修过「上下滑不动」）。
3. 淡黄推荐格点击 → 选小组 → 把该种公需求发到该组需求中心：跨组件动作的参数传递、失败提示、重复发布。
4. DemandPublishSheet：每只精灵带头像、常用性格 3 列、一行 3 只、「更多」只展开当前这只；选择态在重新打开时是否残留。
5. NatureSelect（新增原语）：键盘/触摸可用性、受控值同步、空值语义。
6. Coverage / MotherGradeInventory / GenderRatioSpecies 的口径是否与域模型（domain）一致，避免同一判定两处实现。
7. 跨组件一致性：卡片名字截断规则在多处是否重复实现（重复逻辑归中/建议）。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig；AGENTS.md；docs/产品交互规范.md；docs/domain/**；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性/安全。中：违反明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B8.md。编号 B8-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/调用链）、影响面、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B8-01): …，提交前记录 git rev-parse HEAD 写入 B8.md 的「处理记录」。
【验证】修复后跑 npx vitest run src/ui/StudMatrix.test.tsx src/ui/primitives/primitives.test.tsx src/ui/RecommendedNatureEditor.test.tsx src/ui/Coverage.test.tsx（如不存在则跳过该文件）与 npx tsc -b。
【硬性禁止】删文件/目录、重命名公共接口、改 migrations/schema、改 CI/CD、改 lockfile、git reset --hard/rebase/force push、顺带重构或格式化、升级依赖、为让测试通过改断言。
【遇以下立即停下问我】涉及布局细节（位置/大小/间距）的改动——按 AGENTS.md 先给可交互 HTML 或截图方案确认。
````

---

## B9 契约与采集链路

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端 + Cloudflare Pages Functions + D1 + 安卓抓包解码（src/pcap-decoder）。需求口径以 src/data/changelog.json 的 2026-10-26*~2026-10-28c 条目为准。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- src/api/collectionGroups.ts（+193/−1，共 622 行）/ collectionGroups.test.ts（+78，新增）
- src/api/motherGroups.ts（+20）/ motherGroups.test.ts（±4）
- src/shared/collectionGroups.ts（+108/−6，共 397 行）
- src/shared/motherGroups.ts（+79/−4，共 209 行）
- src/pcap/homeProtocol.test.ts（+219，新增）
- src/pcap-decoder/tools/pcap-json-app/src/home.js（新增 +366，共 349 行）、home.d.ts（+77）、core.js（+93/−5）
- tools/data-pipeline/trim-catalog.mjs（+38/−5）、tools/data-pipeline/tests/egg-fallback.test.mjs（+11/−12）

【审查重点】
1. 前后端同口径：src/shared/* 是两侧共用契约，校验（账号数/蛋数/产线/性格数/请求体大小）在 shared 与 functions 是否一致；前端放宽而后端收紧会造成运行时 400。
2. criteriaId 解析兜底（src/api/collectionGroups.ts 约 135 用 MOTHER_CRITERIA_ID 兜底）与后端「只认 all-mothers-v2」的语义错位。
3. 抓包协议（homeProtocol / home.js / core.js）：字节边界、包长截断、异常包、编码（UTF-8/UTF-16）、字段缺失；新增解析是否会影响旧抓包。
4. 数据管线 trim-catalog.mjs：首领进化按 is_lord_evolution 排除是否正确、是否漏排除或误排除；生成物 catalog.gen.json 只用于比对，不审文件本身。
5. 请求层：超时、重试、并发、错误码映射、敏感信息（token）是否进日志。

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig；AGENTS.md；docs/产品交互规范.md；docs/domain/**；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。指不出依据的降为「建议」。

【分级】高：逻辑错误/与需求不符/并发边界异常/明显性能/数据正确性（编码、精度、时区）/安全（注入、敏感信息泄露）。中：违反明确规范/过度复杂/职责耦合/重复逻辑/错误处理不一致/可测试性差。低：死代码/无用导入/命名注释。不确定：证据不足或需业务判断，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B9.md。编号 B9-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段/调用链）、影响面、修复建议、置信度。末尾给：问题数量统计、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，每个问题独立提交 fix(cr-B9-01): …，提交前记录 git rev-parse HEAD 写入 B9.md 的「处理记录」。
【验证】修复后跑 npx vitest run src/api/collectionGroups.test.ts src/api/motherGroups.test.ts src/pcap/homeProtocol.test.ts src/pcap/decodeCapture.test.ts src/pcap/readCaptureFile.test.ts 与 npm run test:data-pipeline 与 npx tsc -b。
【硬性禁止】删文件/目录、重命名公共接口、改 migrations/schema、改 CI/CD、改 lockfile、git reset --hard/rebase/force push、顺带重构或格式化、升级依赖、为让测试通过改断言、手改 src/data/catalog.gen.json。
【遇以下立即停下问我】需要改抓包协议字段、涉及线上数据、影响面无法静态确认。
````

---

## B10 集成测试、e2e 与删除核对

````text
你是资深代码审查工程师。项目：d:\desk\洛克工具箱（「洛克王国工具箱」）——React18+TS+Vite 前端 + Cloudflare Pages Functions + D1；集成测试用本地 wrangler pages dev + 临时 D1。

【任务】只读审查（先不改代码），范围：git 3824a7a..aeb0231 中
- tools/test/collection-groups-api.test.mjs（+258/−255）
- tools/test/mother-groups-api.test.mjs（+36/−3）
- tools/test/verify-mother-groups-schema.mjs（+48/−7）
- e2e/ 全部 9 个被改动的 spec（android-collector、coverage、dashboard、mother-sharing、mother-sharing-live、product-refactor、product-states、refactor-fixes）+ e2e/helpers/motherGroupsMock.ts（+9/−3）
- 删除文件核对：src/ui/StudGroupResources.tsx（−417）、StudGroupResources.test.tsx（−210）、StudResourceEditor.tsx（−266）

【审查重点】
1. 测试是否真的覆盖本轮新增分支。尤其：被移除成员作为「需求方」的已完成单是否保留（现有用例只覆盖「他承接的记录被释放」）；需求 complete/withdraw 的并发窗口；母本发布体积上限；全量图鉴数字段。
2. 断言质量：有没有为了迁就实现而把断言改松（对比 3824a7a 版本的断言）；跳过/skip/超时放宽；mock 与真实行为脱节（e2e/helpers/motherGroupsMock.ts）。
3. 集成测试的隔离：临时 D1、进程清理、端口占用、并行安全、失败后是否留残留。
4. 删除文件：全局检索（代码、路由、动态 import、配置、序列化入口）确认无引用后再下结论。此前预检：代码内无引用，仅 docs/ 提及。
5. e2e 选择器与新 UI（紧凑卡、64×58 格子、弹层改居中）是否同步，会不会因为文案/结构变化而假通过。

【要跑的验证（本批必须实跑）】
- npm run test:mother-groups:api（起本地 wrangler + 临时 D1，只监听 127.0.0.1；约几分钟）
- npx playwright test --list（先看清单）
- npx playwright test e2e/mother-sharing.spec.ts e2e/refactor-fixes.spec.ts（只跑与本次改动最相关的；若环境起不来，记录原因并标「未验证」）

【规范依据白名单】仓库无 .eslintrc/.editorconfig。中风险只能引：tsconfig；AGENTS.md（含「不要随便跑全量测试」）；docs/产品交互规范.md；src/data/changelog.json 条目；同模块既有写法（写明「依据：参照 xxx 第 N 行」）。

【分级】高：逻辑错误/与需求不符/并发边界异常/数据正确性/安全；测试覆盖不到的真实高风险分支也记为高（注明「测试缺口」）。中：断言过松、mock 与实现脱节、测试互相污染、可维护性差。低：命名/注释/重复夹具。不确定：证据不足，标置信度+需谁确认。

【输出】写文件 docs/code-review/2026-10-29/B10.md。编号 B10-H01/M01/L01/U01。每条必须含：等级、文件:行号、标题、问题描述（含代码片段）、影响面、修复建议、置信度。末尾给：问题数量统计、删除文件核对结论（可否安全删除）、本批最该先修的 1~3 条、范围外备注。

【纪律】本阶段禁止修改任何代码。**不得删除任何文件**（只给结论）。禁止 git 写操作。审查完先汇报，再按「高→中→低」修复：每批最多 3 个问题/3 个文件，独立提交 fix(cr-B10-01): …，提交前记录 git rev-parse HEAD。
【硬性禁止】删文件/目录、重命名公共接口、改 migrations/schema、改 CI/CD 与部署配置、改 lockfile、git reset --hard/rebase/force push、顺带重构、升级依赖。**尤其禁止为了让测试通过而改断言**——认为断言本身错误时先报告，由我决定。
【遇以下立即停下问我】认为某条断言写错了、需要放宽 e2e 超时、涉及线上环境数据。
````
