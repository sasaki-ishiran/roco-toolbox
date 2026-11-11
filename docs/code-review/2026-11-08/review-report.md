# 2026-11-08 整体代码审查报告

> 流程依据：`docs/code-review/REVIEW-PLAYBOOK.md`（基线固化 → 分批发包 → 只读审查 → 分批修复 → 收尾验收）
> 本轮性质：**只读**，未修改源码、未 commit、未部署。

## 0. 基线固化

| 项 | 值 |
| --- | --- |
| 范围 | `224aab5..087434f`（今天全部 21 个提交） |
| 规模 | 238 个文件，约 +33,000 行 |
| 隔离方式 | `git worktree add D:\desk\lk-cr-head 087434f --detach`（工作区脏，编译/测试全部在 worktree 内做） |

### 基线验证（worktree 内真实输出）

| 命令 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过（无输出） |
| `npx vitest run` | **151 文件通过 / 1 跳过，1326 用例通过**（74s） |
| `node tools/test/verify-mother-groups-schema.mjs` | 通过（迁移与 schema 一致、级联行为正确） |
| `node tools/lint-copy.mjs` | 基线 087434f 上**失败，退出码 1**（新增 1 条，见 M-1）；23:33 的 `e1f2f3c` 修复后现为**通过（新增 0 条）** |

### 审查期间落地的增量提交（按 playbook §11 复核）

审查开始时 HEAD 为 `087434f`；期间又落了两个提交，已做增量复核：

| 提交 | 内容 | 复核结论 |
| --- | --- | --- |
| `e1f2f3c`（23:33） | 为定稿文案「按你的口径算的全部缺口」加 `copy-lint-ignore` | 通过：`node tools/lint-copy.mjs` 现退出码 0，M-1 关闭；这是一条**定点豁免**，后续别再往 baseline 里塞同类词 |
| `779b08c`（23:38） | 「添加想收」已选不再被父组件刷新清空 | 修复正确，`npx vitest run src/ui/DemandPublishSheet.test.tsx` 4 条通过；但**同一处只修了 wish 模式，发需求模式仍会被父组件刷新重置**，见 F-8 |

### 基线里标注「在改，跳过」的文件

工作区当前有未提交改动，**不在本轮审查范围**（按用户要求单独列出）：

- `android-shell/**`（悬浮面板与采集，含 `BattleOverlayController.java`、`CaptureController.java`、`capture-bridge.js`）
- `src/collector/**`（`nativeCollector.ts`、`useCaptureProgress.ts`、`autoImportFlow.ts`）
- `src/ui/plan/**`（「添加想收」流程）
- `src/ui/DemandPublishSheet.tsx`（已带未入库的文案 lint 豁免补丁）

> 说明：安卓壳与采集链路的结论全部基于 **worktree 中的已提交版本**；工作区正在改的部分需要改完后单独复审。

---

## 1. 分批结论

### ① 收集计划后端（D1 表 / 接口 / 纯函数状态机 / 归档红线）

**结论：状态机与归档红线守住了，接口测试覆盖较全（21 条 API 用例 + 40 条纯函数用例，含「不影响历史结单」回归），但有 2 条会让人「漏看/漏接」的状态缺陷和 2 条读写成本问题。**

#### B-1（P1）同一颗蛋可以突破「进行中最多 8 条」，还会把仍有需求在跑的计划退回「想收」

- **问题描述**：`functions/_lib/collectionGroupsStore.ts:2006-2026` 的 `ensureDemandPlan` 直接把计划写成 `status='active'`，没有走 `MAX_ACTIVE_PLANS` 判断；而 `:2608-2623` 的 `capActivePlans` 在下次新建/开始时按 `created_at` 保留最早的 8 条，把多出来的**无条件**改成 `backlog`，不检查这条计划上是否还有待接单/已认领的需求。结果：①「最多 8 条」形同虚设；②被退回想收的计划如果还挂着需求，`GroupSquareView` 只列 `active` 计划，需求会从广场消失，承接人手里的「已接单」变成悬空；③`planAlertsStore` 也只统计 `active`，发布人不会收到红点。
- **推荐方案**：两条口径都下沉到服务端：①`ensureDemandPlan` 复用与 `createCollectionPlans` 相同的额度判断，满 8 条时不再自动转 `active`，返回值里带 `overflow`；②`capActivePlans` 的降级 SQL 加 `AND NOT EXISTS (未结单需求)`，保证被降级的计划一定是干净的空计划（首选；比在降级后再补通知可靠）。
- **修复后效果**：用户不会再看到「明明发了需求，广场里却没有」；承接人手里的单不会莫名消失。验收：`node tools/test/run-mother-groups-local.mjs`（补「9 条进行中 + 新发需求」与「降级不碰有需求的计划」两条用例）。

#### B-2（P1）「已完成」的结单记录会让一条空计划在界面上永远显示已完成，并继续占额度

- **问题描述**：`src/shared/collectionPlans.ts:165` 只要该蛋有归档结单就返回第 5 步，而第 5 步在卡面映射成「已完成」（绿色）。触发路径：计划完成 → 用户又给同一颗蛋发需求（自动复活成 `active`）→ 中途撤回需求 → 此时无未结单需求、但有归档，`plan.status` 仍是 `active`，卡面显示「已完成」，却仍算在「进行中 8 条」里。`shouldAutoCompletePlan` 只在「确认结单」那一瞬间调用，撤回路径不会把它收干净。
- **推荐方案**：纯函数层面只在 `plan.status === 'done'` 时由归档返回 5；`active + 无未结单需求 + 有归档` 返回 0（还没发需求）。同时在撤回需求的接口里补一次「全结单后自动完成」判定，与服务端口径对齐。
- **修复后效果**：进行中区域不再出现假「已完成」，8 条额度也不会被一条空计划白占。验收：`npx vitest run src/shared/collectionPlans.test.ts`（补「复活 → 撤回 → 应回到 0 且不占额度」）。

#### B-3（P2）读取计划列表会顺带写库，而且把全组历史结单一次性读出来

- **问题描述**：`readCollectionPlans` 每次 GET 都会调 `adoptOrphanDemandPlans`（`:2033`，先 SELECT 再按需 INSERT），并且无 `LIMIT` 地把该组 `collection_group_demand_completions` 全量读出（只为判断「这颗蛋有没有结单过」）。现在有 30s（收集页）+ 60s（红点）两路轮询，老组的归档只会越积越多，单次读成本随时间线性上涨。
- **推荐方案**：①把「有没有结单」改成聚合查询（`SELECT demander_account_id, egg_game_id ... GROUP BY` 或存在性子查询），不要拉全表；②`adoptOrphanDemandPlans` 的读改写要么并进需求发布接口（写入时补计划），要么在接口层加更长的节流，避免每轮轮询都跑写语句。
- **修复后效果**：老组、大组打开「小组」页不再越来越慢；D1 读行数下降。验收：`node tools/test/run-mother-groups-local.mjs` + 用 90 天归档的种子数据测一次响应体大小。

#### B-4（P2）发布计划「完成/删除」时，承接人手里的单会静默消失

- **问题描述**：`completeCollectionPlan` / `deleteCollectionPlan` 会物理删掉该蛋下所有非 `done` 需求（`:2800` 附近），承接人侧没有任何「你的单已被撤回」的提示。现有的 `cancelledNotice` 只覆盖「需求方离开小组」这一种场景。
- **推荐方案**：删需求前统计受影响的承接人，复用现有 notice 通道给承接人一条「你接的 N 条需求已被发布人撤回」；不新增表、不改归档。
- **修复后效果**：承接人不会一直等一个已经不存在的单。验收：`node tools/test/run-mother-groups-local.mjs`（补「完成计划后承接人看到 notice」）。

---

### ② 收集计划前端（两页卡型 / DETAIL / 埋点 / 红点）

**结论：卡型与五步文案口径统一，`demandKeyOf` 与详情页反查键一致；但有 4 条会直接造成误删、看不见计划、点了没反应、双方状态不一致的问题。**

#### F-1（P1）删除计划没有二次确认，一次误触就删掉需求和别人的认领

- **问题描述**：`src/ui/plan/PlanDetailSheet.tsx:150-155` 的「删除计划」直接调 `onDelete(plan)`；同一页的「直接完成」反而有 `window.confirm`。删除会同时清掉该蛋下的需求与「我能提供」标记（含别人已认领的单），不可撤销。
- **推荐方案**：删除前加确认弹层，文案说明后果（「会同时撤回这颗蛋的需求和别人的认领，不可恢复」）；如果该蛋有进行中需求，确认按钮降级成危险色并默认聚焦「取消」。
- **修复后效果**：误触不会造成不可逆的数据丢失。验收：`npx vitest run src/ui/plan/PlanDetailSheet.test.tsx`（补「点删除先出确认、取消不调接口」）。

#### F-2（P1）超过 8 条的计划在「我的收集」里彻底不显示

- **问题描述**：`src/ui/plan/MyCollectionView.tsx:62` 对进行中计划 `slice(0, 8)`，而计划总数又没有别的地方承载。配合 B-1（发需求可绕过上限），第 9 条及以后既不在「进行中」，也不在「想收 / 已完成」，用户在自己的页面里找不到这条计划。页头也没有「进行中 8/8」的额度提示。
- **推荐方案**：不截断渲染，只把超出部分统一进「想收」分组并保留 `active` 真实状态；或在页头显示「进行中 8/8 · 还有 N 条未开始」并给入口。推荐前者（用户看到的就是全部），改动只在这一处。
- **修复后效果**：用户不会「建了计划却找不到」。验收：`npx vitest run src/ui/plan/MyCollectionView.test.tsx`（补 9 条进行中的渲染用例）。

#### F-3（P1）详情页点「开始」，满 8 条时完全没反馈

- **问题描述**：`plans.actions.start()` 会返回 `{ overflow, notice }`，卡面路径（`GroupPlanHub.tsx` 的 `handleAction`）会把 `notice` 显示出来，但详情页 `onStart` 直接丢弃返回值。用户在「想收」详情里点开始，接口成功返回「已满 8 条，留在想收」，界面没有任何变化，会连点。
- **推荐方案**：详情页 `onStart` 复用 `handleAction('start')`，把 `notice` 显示在详情页顶部提示条；或直接关闭详情并把提示交给列表页统一显示。
- **修复后效果**：用户能立刻知道「为什么没开始」。验收：`npx vitest run src/ui/plan/PlanDetailSheet.test.tsx`（满 8 条时应出现提示文案）。

#### F-4（P1）「已上窝」勾选与服务端不同步，双方可能对不上账

- **问题描述**：`src/ui/HomeDemandPlacements.tsx:328-333` 先本地打勾，然后**只在勾上时**调接口；取消勾选直接 `return`，服务端 `placed_at` 仍在。另外接口失败（非 404）时本地勾选也没有回滚。后果：①用户勾错了取消不掉，发布人照样看到「待我确认」并可能确认结单；②网络失败时本机显示已上窝、发布人永远看不到，两边各看一套状态。
- **推荐方案**：①补一个「取消上窝」的服务端能力（`DELETE .../placed` 或 `placed=false`），勾掉时同步；②失败时回滚本地勾选并提示重试，不要用「已先记在本机」掩盖非 404 的失败（当前只有 404 会这么提示，其他错误仅显示一句话但勾还在）。
- **修复后效果**：勾选状态与发布人看到的完全一致，误勾可撤销。验收：`npx vitest run src/ui/HomeDemandPlacements.test.tsx`（勾→取消→再勾 三次请求断言）。

#### F-5（P2）同一个蛋有多条已认领需求时，「去确认」一次只确认一条，数字按计划算

- **问题描述**：`GroupPlanHub.tsx` 的 `confirm` 分支用 `find` 取第一条 `claimed` 需求；页头 `needsConfirm`（`MyCollectionView.tsx:79`）统计的是**计划数**而不是**需求条数**，但文案是「待确认 X」。
- **推荐方案**：确认动作支持「这个蛋的全部已上窝需求一次结单」（一次批量），或至少在按钮上标出「还有 N 条」；页头统计改成需求条数，与红点口径统一。
- **修复后效果**：不会出现「确认完一个还剩一个，但数字已经是 0」。验收：`npx vitest run src/ui/plan/GroupPlanHub.test.tsx`。

#### F-6（P2）「进行中但还没发需求」的计划，五步进度整条灰、也没有当前步

- **问题描述**：`planStepIndex` 对 `progressStep=0` 返回 -1，详情页五步全部渲染成「未开始」，与头部「还没发需求」重复，用户看不出下一步该做什么。
- **推荐方案**：第 0 步按「当前步」高亮（`current = stepIndex <= index` 的第一条），文案统一为「先发需求」。
- **修复后效果**：用户能看出「下一步是发需求」。验收：`npx vitest run src/ui/plan/PlanDetailSheet.test.tsx`。

#### F-7（P2）页签红点只认「上次进入的组」，切组后仍按旧组算

- **问题描述**：`src/ui/plan/usePlanBadge.ts:23-52` 的依赖是 `[accountId]`，`readLastGroupId` 变化不会重跑，切到另一个小组后红点仍按旧组数据算，最长持续到刷新/切账号。
- **推荐方案**：把 `readLastGroupId` 的结果提升为 state 并在进入/切换小组时更新（`CollectionGroups` 已经有切换入口），作为 effect 依赖。
- **修复后效果**：红点与当前小组一致，不漏新单。验收：`npx vitest run src/ui/plan/usePlanBadge.test.ts`（切组后应重新拉取）。

#### F-8（P1，增量复核发现）「发需求」弹层里改好的性格/性别，会被一次后台轮询悄悄重置

- **问题描述**：`779b08c` 把「添加想收」的重置从 `items` 依赖里摘出来了，但同一个组件里**发需求模式的重置仍然依赖 `items`**（`src/ui/DemandPublishSheet.tsx:123-129`）。而调用方每次渲染都会新建数组：`GroupPlanHub.tsx:312-320` 的 `publishItems` 是内联构造，`MotherGroupResources.tsx:3703` 是 `publishItems ?? []`。收集页有 30s 轮询，父组件一刷新，用户刚选的性别（母→公）、体型、声音、性格全部回到默认值；此时点确认，发出去的是默认口径的需求，用户很难察觉。
- **推荐方案**：与 wish 模式同样的处理——发需求的草稿重置只跟 `[open]`（以及计划 id）走，`items` 只用于首次初始化；或调用方用 `useMemo` 把 `publishItems` 按 `publishPlan?.eggGameId` 稳定住。推荐前者的组件内修复（调用方有多处，改组件更彻底）。
- **修复后效果**：用户在选择过程中不会被后台刷新打断，不会发出参数错误的需求。验收：`npx vitest run src/ui/DemandPublishSheet.test.tsx`（补「重渲染后已选性别/性格保留」一条）。

---

### ③ 悬浮窗网页侧 + 附近雷达

**结论：payload 与壳侧字段名/单位/坐标系对得上，800ms 节流与 8 条上限合理；但推送只挂在「附近」页这一条，直接让「别的页签开始采集」完全失效，雷达还有一处南北镜像。**

#### O-1（P0）从「我的」页开始采集，游戏里根本不会出现附近面板；切页签后画面还会僵住

- **问题描述**：推送逻辑只写在 `src/ui/Nearby.tsx:463-489`，而 `src/App.tsx:270` 只在「附近」页签渲染 `Nearby`。用户在「我的」页点开始采集（`BattleHudOrb` 仍在后台解码写快照）后直接进游戏，`Nearby` 从未挂载，一次 payload 都没推过；采集中途切到别的页签，`Nearby` 卸载，壳侧停在最后一帧、不会收起，停止采集时也没有 `visible=false`（`lastShellPush` 是组件内 ref）。
- **推荐方案**：把推送 effect 搬到全局常驻的 `BattleHudOrb`（它已经持有解码后的快照与采集状态），`Nearby` 只负责页面展示；卸载/`pagehide` 时兜底推一次隐藏。只保留一处节流器，避免两个组件各推一半造成抖动。
- **修复后效果**：不管从哪个页签开始采集，进游戏都能看到面板；停止采集或切页后一定收起。验收：真机从「我的」开始采集 → 切到游戏看球与展开面板 → 回工具箱停止 → 球消失。

#### O-2（P0）雷达把南北画反了，和地图页给出的方位互相矛盾

- **问题描述**：项目坐标口径是 **y 轴指向南**（`public/maps/maps.json` 的 `"y":"south"`，`src/pcap/worldMap.ts:54-58` 直接把 `y` 映射到图片纵坐标）。但 `src/pcap/nearbyRadar.ts:198` 用 `ny = -dy/scale`，`:99` 用 `atan2(dx, dy)` 把「正南」算成 0°（北），而渲染端 `src/ui/NearbyRadar.tsx:87` 又是 `cy = center + ny*radius` 直接向下画。结果：玩家正南方的精灵被画到圆心上方的北侧、标成「北 ↑」，地图页却落在中心下方；照箭头走会走反。`nearbyRadar.test.ts` 里「+y → 北」的断言把这个错误固化成了“正确行为”。
- **推荐方案**：`ny = dy/scale`，`bearingOf` 改为 `atan2(dx, -dy)`（0=北、顺时针）；测试里的「正 y → 北」改为「正 y → 南」，并补一条「雷达方位与 `projectToPixel` 上下一致」的用例。
- **修复后效果**：雷达与地图对同一只精灵给出同一个方位，按箭头走方向正确。验收：`npx vitest run src/pcap/nearbyRadar.test.ts src/pcap/worldMap.test.ts`。

#### O-3（P1）手机面板的「我」和 120m 圈跟 PC 不在同一个位置

- **问题描述**：`src/nearby/overlayPayload.ts:59-61` 只用 `snapshot.self`，缺失时退回精灵几何中位数；「附近」页与 PC 悬浮窗用的是 `captureSelf ?? 里程计 self`（`Nearby.tsx:280-288`）。真实抓包几乎没有自身坐标，于是手机端中心锁在精灵堆、PC 端跟着人走，同一只精灵两边距离和方位都不同，面板上「中心为估算」的提示也对不上。
- **推荐方案**：把页面已经算好的 `mapSelf` 作为参数传进 `buildNearbyOverlayPayload`，纯函数只负责组装；不要在两个地方各算一套中心。
- **修复后效果**：手机面板与 PC 悬浮窗同心、同距离。验收：`npx vitest run src/nearby/overlayPayload.test.ts`（补「传入 self 则 origin=self」）。

#### O-4（P1）面板里看不出「哪只是我要抓的需求精灵」，而且 alert 被当成需求用

- **问题描述**：`overlayPayload.ts:73` 的 `alert` 只来自 `pet.alertReason`（稀有提醒）；需求命中是另一套 `demandHitsForPet`（`Nearby.tsx:190`），payload 里没有对应字段。面板规格（`docs/手机悬浮窗-面板规格.md` §1.5/§2.3）要求「需求红圈 + 需求牌」；PC 侧 `desktop/overlay/overlay.js:76/89/177` 又把 `alert` 渲染成玫红环和「需求」标签，语义被张冠李戴。
- **推荐方案**：payload 增加 `demand: boolean`（`demandHits.length > 0`）并置最高排序；稀有提醒单独用琥珀色标签，两套语义拆开；壳侧缺字段按 `false` 兜底。
- **修复后效果**：手机上也能一眼看到「这只就是我要的」，稀有与需求不再混为一谈。验收：`npx vitest run src/nearby/overlayPayload.test.ts`（新用例：`alertReason=null` + `demand=true` 排第一）。

#### O-5（P1）PC 端抓到 128MiB 后整块采集状态被判无效，雷达变空、停不下来

- **问题描述**：`src/collector/nativeCollector.ts:116-126` 规定 `savedBytes > 128MiB` 就抛「本机采集状态无效」；桌面端 `desktop/capture/manager.cjs:169` 原样透传文件大小，`worker.cjs` 没有滚动裁剪，`manager.cjs:184` 对超限文件还直接返回空串。长时间挂机（PC 只过滤游戏端口也会到 128MiB）之后，「我的」和「附近」都读不到状态，停止/保存按钮失效，雷达在没有任何提示的情况下变空。
- **推荐方案**：到上限时主动停止采集并给出明确状态（「本次采集已达 128MiB 上限，可先解析导入」），同时 `inspect` 对超限文件返回可识别的状态而不是空串。不建议复用安卓的滚动裁剪——那会丢历史包，桌面端解析导入更依赖完整性。
- **修复后效果**：挂多久都能正常停止和导入，雷达不会莫名空白。验收：`npx vitest run src/collector/nativeCollector.test.ts`（补 `savedBytes>128MiB` 用例）+ 手动挂机复现。

#### O-6（P1）实时巡检每轮把整份抓包复制一遍，PC 挂久了越刷越卡

- **问题描述**：`src/collector/useCaptureProgress.ts:147-150` 拿到 `readCaptureSnapshotBytes` 返回的**全量累积缓存**后 `bytes.slice()` 再 transfer，而 worker 只解析尾部 `windowBytes`（2MiB）。安卓侧文件被裁到 4MiB 尚可，PC 端文件到几十 MB 后每 0.5–1.5s 复制一整份，主线程明显卡顿，2MiB 窗口的性能优化在 IPC 这一段被抵消。
- **推荐方案**：只把 `bytes.subarray(size - windowBytes)` 送 worker（worker 已支持从窗口起点扫描，需要同步调整「文件偏移 = 绝对偏移」的基准），主线程缓存也只保留最近 `windowBytes`，按偏移滑动。
- **修复后效果**：PC 挂 1 小时和挂 5 分钟手感一致。验收：`npx vitest run src/collector/useCaptureProgress.test.tsx`（断言送入 worker 的字节数 ≤ windowBytes）。

#### O-7（P2）面板主题与地图标定不在 payload 里，壳只能硬编码

- **问题描述**：`src/nearby/overlayBridge.ts` 只下发 version/panels/payload，没有 `theme`；地图标定 `originX/originY/sideUnits` 在 `src/pcap/worldMap.ts:21-32`，方案文档 §7 要求不要复制数值，但壳拿不到，只能抄常量——换地图即错位。
- **推荐方案**：payload 增加 `map`（标定 + 尺寸，`null` 时壳回退列表）与 `theme`（跟随 PC 设置）。
- **修复后效果**：PC 换明色手机也亮；以后加地图不用重发 APK。验收：`npx vitest run src/pcap/worldMap.test.ts src/nearby/overlayPayload.test.ts`。

#### O-8（P2）坏的自身坐标会推出 NaN 中心，测试只覆盖顺利路径

- **问题描述**：`overlayPayload.ts:59` 不校验 `self` 有限性，NaN 经 JSON 变成 `{x:null,y:null}`，壳算出的中心是 NaN；PC 侧 `desktop/overlay/overlay.js:121` 有 `Number.isFinite` 兜底。测试未覆盖切页签/卸载、无快照收起、NaN self。
- **推荐方案**：照 `overlay.js` 校验，非有限数退回中位数并置 `selfEstimated`；补齐 3 条分支测试。
- **修复后效果**：坏数据下地图仍落在有人区域。验收：`npx vitest run src/nearby/overlayPayload.test.ts`。

#### O-9（P2）换一局采集后，「附近」页仍显示上一局的精灵和场景

- **问题描述**：`src/collector/nearbyStore.ts:22` 是模块级快照，`Nearby` 直接消费，从不校验 `snapshot.session` 是否等于当前 `state.fileId`。停下来保留最后一帧是有意的，但**开始新一局**（尤其在「我的」页发起、附近页冷启动要全量解十几秒）时会继续显示旧场景，甚至把旧数据推给悬浮窗。
- **推荐方案**：渲染/推送前加新鲜度门槛：`snapshot.session !== state.fileId` 或超过 N 分钟未更新就按「等待数据」处理；「保留最后一帧」只限同一 session。
- **修复后效果**：换局后不会误以为旧稀有还在附近。验收：`npx vitest run src/ui/Nearby.test.tsx`。

---

### ④ 安卓壳（今日已提交部分）

**结论：桥接方法名与网页调用一致，前台服务声明齐全；但滚动裁剪的增量协议、悬浮窗重建、稀有提醒 id 三处会直接表现为「数据错 / 球没了 / 提醒漏」。工作区未提交的面板改动未纳入。**

#### A-1（P1）战斗模式裁剪文件后，网页的增量拼接可能错帧

- **问题描述**：`PcapWriter.trimIfNeeded`（`PcapWriter.java:58-101`）静默把文件重写成「24B 头 + 最近 4MiB」，对外只暴露长度；`CaptureController.intercept` 只回 `X-Capture-From/Total`，没有代次标识。网页 `nativeCollector.ts:160-191` 仅在「缓存长度 > 快照长度」时回落全量。若两次裁剪之间没完成一次读取（缓存 8MiB → 裁到 4MiB → 又涨回 8.2MiB），长度判断通过，网页把重写后的片段拼到旧前缀后面，帧头错位、解析丢包。
- **推荐方案**：给快照加代次（`CaptureState` 增 `trimVersion`），拦截器回 `X-Capture-Generation`，网页缓存记录该值，不一致即整份重读（比 mtime 可靠，mtime 只有秒级）。
- **修复后效果**：长战斗采集后包数不再突然回落。验收：真机战斗连采 6 分钟，观察「已解析包数」只增不减。

#### A-2（P1）悬浮球被系统回收或权限被撤销后不会重建，且失败仍报成功

- **问题描述**：`BattleOverlayController.java:150-152` 只在 `orb == null` 时 `addOrb()`；Android 12+ 撤销悬浮窗权限或 ROM 回收窗口后，字段仍非空但 View 已 detach，之后 `safeUpdate` 吞掉异常（`:493-500`），球永久不出现。`addOrb` 失败只置空（`:195-200`），`update()` 仍然返回 `"ok"`，网页以为已经显示。
- **推荐方案**：`render` 前判断 `orb.isAttachedToWindow()`，未挂载先 `removeAll()` 再 add；`addOrb` 失败置标记，让 `update()` 返回 `"need-permission"`，网页提示重新授权。
- **修复后效果**：撤销权限再授予后，回工具箱球立刻重现。验收：真机操作一遍。

#### A-3（P1）连续两只稀有只提醒一次；没给通知权限时还假装成功

- **问题描述**：`CaptureController.java:209-210` 固定 `notify(9528)`，并在 10 秒后 `cancel(9528)`。两只精灵 5 秒内先后出现时，第二条会被第一条的定时器提前取消。Android 13+ 未授予 `POST_NOTIFICATIONS` 时 `notify` 静默失败但仍返回成功，而 `startCapture`（`:88`）是检查该权限的，两处口径不一致。
- **推荐方案**：通知 id 递增或按标题 hash 分配，取消定时器与 id 配对；发通知前检查权限，未授权返回可读错误让网页引导授权。
- **修复后效果**：连续稀有都能看到，「开了没反应」变成明确提示。验收：真机连刷两只稀有，两条通知各自停留 10 秒。

#### A-4（P2）悬浮球规格 52dp（文档 48dp）、卡片完全不可点，展开后长期遮挡画面

- **问题描述**：`BattleOverlayController.java:70` 的 `ORB_DP=52`，卡片 `WRAP_CONTENT` 且带 `FLAG_NOT_TOUCHABLE`（`:285-292`），与 `docs/手机悬浮窗-面板规格.md` §1.1/§1.4/§4.1 不一致；卡片没有自动收起，只能再点球。
- **推荐方案**：尺寸按规格改；如果坚持卡片不可点，至少加「N 秒无更新自动收起」，避免长期压在游戏画面上。
- **修复后效果**：挂机时不再长期遮挡。验收：真机展开卡片 30 秒不操作应自动收起。

#### A-5（P2）桥接回调在 UI 线程做文件 IO

- **问题描述**：`MainActivity.java:282-296` 在 `WebMessageListener` 回调里直接跑 `CaptureFiles.require()`（`getCanonicalFile()` 走文件系统）和快照创建；实时巡检几百毫秒一轮，长期拖慢主线程。
- **推荐方案**：这些 action 投到单线程执行器，结果用 `runOnUiThread` 回包。
- **修复后效果**：采集全程界面不再掉帧。验收：采集中连续滑动「我的」页无卡顿。

---

### ⑤ 埋点与文案 lint

**结论：埋点没有隐私泄漏，`track` 只在正式环境发送；文案闸门在审查基线上是红的（已由 e1f2f3c 修复），失败路径仍然全都不上报。**

#### M-1（~~P0~~ 已修复于 e1f2f3c）HEAD 上 `npm run verify` 曾直接失败，发版被自己卡死

- **问题描述**：审查基线 `087434f` 上 `tools/lint-copy.mjs` 退出码 1，新增命中 `src/ui/DemandPublishSheet.tsx:288` 的「按你的口径算的全部缺口」。`package.json` 的 `verify` 已包含该步骤，`deploy:test` / `deploy:prod` 都以 `verify` 开头，按该 HEAD 发版会被拦住。
- **推荐方案**：优先改文案而不是加豁免；若这条是用户定稿必须保留，则把 `copy-lint-ignore` 正式提交，且不要把它同时登记进 baseline（否则等于双份豁免）。
- **修复后效果**：已在 `e1f2f3c` 按「定点豁免」处理，`node tools/lint-copy.mjs` 现退出码 0（新增 0 / 存量 15）。后续同类定稿文案请沿用「行级 `copy-lint-ignore`」，不要扩 baseline。

#### M-2（P1）失败与拦截路径全都没埋点，漏斗必然偏乐观

- **问题描述**：`src/api/collectionGroups.ts:686/705/986/1012` 只在成功分支打点。认领被抢（`DEMAND_TAKEN`，恰恰是最需要知道的「卡在哪一步」）、发布报错、满 8 条自动落想收，全都不上报。
- **推荐方案**：加统一失败事件 `demand_fail { step, code, overflow? }`，在 catch 与 `overflow === true` 分支各打一次；只报错误码，不带文案。
- **修复后效果**：能回答「卡在发布/认领/开始哪一步」。验收：`npx vitest run src/api/collectionGroups.test.ts`（新增失败分支用例）。

#### M-3（P1）`plan_import` 永远不会触发；同一个 count 字段两种含义

- **问题描述**：`plan_import` 依赖 `bulk: true`，但全仓没有任何生产代码传 `bulk: true`（只有测试里有），批量「添加想收」实际都记成 `plan_create`。另外 `placement_mark` 两处口径冲突：`GroupPlanHub.tsx:203` 传 `1`，`demandPlacementStore.ts:80` 传「已标记总数」，注释却说 count 是累计总数，两者不能相加。
- **推荐方案**：`GroupPlanHub` 的 `addWish` 按 `eggGameIds.length > 1` 传 `bulk`，或删掉这个死字段避免误导；`placement_mark` 统一成 `{ count: 1 }`（配合同事件多次上报）或统一成累计总数，二选一并改注释。
- **修复后效果**：能区分「批量导入」与「手动加一条」，上窝数可加总。验收：`npx vitest run src/api/analytics.test.ts`。

#### M-4（P2）`tab_view` 会重复上报

- **问题描述**：`src/App.tsx:163-179` 的 effect 依赖整个 `navigation` 对象，`consume-focus` 等操作也会换新对象，同一次进页会多报一次。
- **推荐方案**：依赖改成 `navigation.page`，或把打点挪到页签点击处。
- **修复后效果**：`tab_view` 次数与真实切页一致。验收：单测断言一次 `consume-focus` 不产生新事件。

#### M-5（P2）lint 规则既会误判也会漏判

- **问题描述**：`tools/lint-copy.mjs` 把「口径」当说明词，而它是产品在用词（基线里已有 5 处）；跨行 `className` 的提示段大量逃检；基线只比总条数，删一条再加一条即可绕过。
- **推荐方案**：关键词去掉「口径」；className 检测改为跨行匹配开标签；报告里列出「基线中已不存在的条目」便于燃尽。
- **修复后效果**：闸门只拦真新增的说明性文案。验收：`node tools/lint-copy.mjs` 在删掉任意一条存量文案后仍不报新增。

#### M-6（P2）文案减负删掉了「怎么做」的动作指引

- **问题描述**：`src/ui/ImportPanel.tsx:485` 删掉了「采集器里点分享选洛克工具箱会自动导入」，而 `src/ui/tour.ts:188-201` 的「我的」段只说「采集或选文件导入」，全应用再无处讲这条安卓主路径；同段也删掉了「换设备首选云同步」。`src/ui/Home.tsx:255/271` 删掉「重新采集一次会更准」，空态只剩问题描述没有下一步。
- **推荐方案**：只补回「怎么做」一句（自动导入、换设备选云同步、疑似过期就重采），描述性归因继续删；或在 tour 里补 import 段。
- **修复后效果**：安卓用户能找到自动导入入口，过期提示可行动。验收：`npx vitest run src/ui/ImportPanel.test.tsx src/ui/Home.test.tsx`。

---

### ⑥ 工程清理与版本号

**结论：`swapViewStore`、`nearby-map-check.html` 删除干净（全仓无残留引用，`roco.swapView` 由 `App.tsx:46` 内联兜底，行为不变）；`pets.json` 与 `catalog.gen.json` 662/662 同源一致。**

#### E-1（P1）整批「收集计划」没写进更新说明，用户升级看不到新功能

- **问题描述**：`src/data/changelog.json` 最新一条仍是 `2026-11-08c`（实时采集提速），之后 5 个提交（`3b0d031`、`e369510`、`eb43ae9`、`4e3cd37`、`087434f`）都是用户可见的新页面（我的收集 / 组内广场 / 添加想收），全文没有「收集计划 / 想收」字样，与 `src/data/changelog.ts` 的「每次发版加一条」约定不符。
- **推荐方案**：发版前补一条 `2026-11-08d`，用产品语言写三件事：小组里能给每颗蛋建「想收」、进度五步（待接单 → 已认领 → 已上窝 → 待我确认 → 已完成）、广场一键接单与「我能提供」备注。
- **修复后效果**：用户升级弹窗能看到这一页怎么用。验收：刷新后弹窗出现该条，`npx vitest run src/data/changelog.test.ts` 仍过。

#### E-2（P2）版本号三套并存，没有一处说明各自含义

- **问题描述**：`package.json` 是 `1.3.2`、安卓壳 `1.2.4`、README 里的蛋神客户端协议是 `1.2.9`。另外 `package.json` 顶部 `"main": "desktop/main.cjs"` 是给 Electron 用的，放在 Web 工程根上容易让人误以为网页入口改成了 CJS。
- **推荐方案**：README 明写「1.2.9 指蛋神客户端协议，非本应用版本」；`main` 字段加注释或挪到 `desktop/` 的独立 `package.json`（后者改动大，建议先只补文档）。
- **修复后效果**：交接/排障时不会再认错版本。验收：README 搜「协议」能看到说明。

#### E-3（P2）`.gitignore` 忽略的原型 HTML 其实已经入库，规则空转

- **问题描述**：`.gitignore:18` 写了 `地图与悬浮窗-预览.html`，但该文件本批已被提交（`git ls-files` 可命中）；已跟踪文件不受忽略规则影响，「原型不入库」没有达成。`.gitignore:17` 的 `手机悬浮窗原型.html` 在仓库和工作区都不存在，而 `docs/手机悬浮窗-面板规格.md:3` 声明全部数值取自这个「冻结版」原型，他人无法复核。
- **推荐方案**：二选一——把 `地图与悬浮窗-预览.html` 移出版本库（`git rm --cached`，本地保留），或删掉这条无效规则；规格文档改注明「原型为本地设计物料，数值以下表为准」。
- **修复后效果**：仓库不再混入设计物料，规格依据可追溯。验收：`git ls-files | Select-String 预览` 无结果，或文档已注明。

---

### ⑦ 文档与 e2e

**结论：`/plans/**` 路由挂载正确，`verify-mother-groups-schema.mjs` 能真实拦住 schema 漂移；但 e2e 的 mock 与真实规则相反，等于这条主流程没有测试保护。**

#### D-1（P1）e2e mock 把「你能补的」判定写反了，测试全绿但线上观感不同

- **问题描述**：`e2e/helpers/motherGroupsMock.ts:257-258` 无条件返回 `matchableEggIds: [3001]`，注释还写「3001 是 A 资源里没有、B 在收的蛋」。真实口径相反：`functions/_lib/collectionGroupsStore.ts:2562` 调 `matchablePlanEggIds`（`src/shared/collectionPlans.ts:181-196`）要求「我发布过的资源里**有**这颗蛋」；按种子数据（A 只发布 3003，B 在收 3001/3002/3006），真实接口会返回 `[]`。于是 `e2e/collection-plans.spec.ts:103` 断言的「我号里有这颗蛋」在线上不成立，卡片理由会变「图鉴里有、需要现孵」，排序从第 1 档掉到第 3 档。
- **推荐方案**：mock 按真实规则算（`mine = A 资源里的 eggGameIds`，与其他成员 `active` 计划求交），或把 A 的资源补上 3001；同时补一条「没这颗蛋 → 理由为‘图鉴里有、需要现孵’」的用例。
- **修复后效果**：广场卡片理由与排序在测试与线上一致。验收：`npx playwright test e2e/collection-plans.spec.ts`。

#### D-2（P2）收集计划文档里写的批量接口不存在

- **问题描述**：`docs/收集计划-细化方案-2026-11-08.md:68` 写 `POST .../plans/batch`，实际路由只有 `POST .../plans`（`functions/_lib/collectionPlans.ts:126`），同文档 251 行的接口表又写 `/plans`，一篇里两套口径，照 §2 实现会 404。
- **推荐方案**：68 行改成 `POST /plans`（`eggGameIds` 数组本身即批量）。
- **修复后效果**：按文档实现即可跑通。验收：文档内搜 `plans/batch` 为 0 条。

#### D-3（P2）数据字段说明的图鉴版本已过期

- **问题描述**：`docs/domain/数据字段说明.md:8` 写「625 只精灵，版本 `s4-2026-09-24`」；实际 `data/pets.json` 与 `src/data/catalog.gen.json` 均为 **662 只、`s5-2026-10-31`**（已逐条比对，键完全对应）。
- **推荐方案**：改为 662 只 / `s5-2026-10-31`，并注明「以 `catalog.gen.json` 的 `dataVersion` 为准」。
- **修复后效果**：文档与数据同源，新人不会按 625 只判断规模。验收：脚本读两个文件数量一致。

---

## 2. 需要拍板（只有这 3 条）

### 拍板 1：雷达方位到底以哪边为准（影响已发布给用户的方位显示）

文档/落图证据（`maps.json` 的 `"y":"south"` + `projectToPixel` 直接映射）与代码 + 现有测试（`+y → 北`）互相矛盾。

**我的推荐**：以地图落图为准，改代码（O-2）。理由：地图点位是实测标定的，雷达只是派生视图；若反过来改地图，会让所有已标定的地图点位失效。若确认是文档写错，则保留代码、把 `maps.json` 的轴注释与测试注释一并改对，也需要一次拍板。

### 拍板 2：「发需求」是否要受「进行中最多 8 条」约束

当前发需求会无条件把计划拉成进行中（B-1）。两种口径：①也受 8 条限制，满额时提示「先完成一条」；②允许发需求突破上限，只限制「手动开始」。

**我的推荐**：选 ①。理由：8 条上限是为了让「我的收集」一屏看得完、不让计划烂尾；如果发需求能无限突破，这个上限就失去意义，还会引发 B-1 的「需求消失」。

### 拍板 3：桌面端到 128MiB 时「停止并提示」还是「滚动裁剪」

**我的推荐**：停止并提示（O-5）。理由：桌面端主用「解析后导入」，裁剪会丢历史包、影响导入完整性；安卓端裁剪是为了实时面板的低延迟，两者目标不同。

---

## 3. 今天踩过的坑（下次避雷）

1. **文案闸门没在提交前跑**：`920ab27` 引入的「口径」文案让 HEAD 的 `verify` 直接红，`deploy` 前置就断了；靠工作区一个未提交补丁兜着。→ 提交前至少跑一次 `node tools/lint-copy.mjs`。
2. **测试把错误口径写成了断言**：`nearbyRadar.test.ts` 断言「+y → 北」，与 `maps.json` 的 y=south 相反，绿灯反而保护了镜像 bug。→ 涉及坐标/单位的纯函数，先用一张真实地图点反查一次再写断言。
3. **e2e mock 自己编数据**：`motherGroupsMock.ts:257` 的注释直接写着「3001 是 A 资源里没有」，与真实「必须我有这颗蛋」相反，e2e 永远绿、线上不一致。→ mock 的期望值必须从真实纯函数推出来，不能手写。
4. **文档与代码两套接口**：细化方案写 `/plans/batch`，实现是 `/plans`；同篇文档两个说法。
5. **并行改动 + 工作区脏**：面板字段未接线导致工作区编译不过，只能 `git worktree` 隔离审。→ 多会话并行时，审查/验证一律在 worktree 做，别在工作区编译。
6. **规则只在一个入口生效**：8 条上限只写在「新建/开始」，「发需求自动进行中」没接；同类问题还有 `placement_mark` 两个入口两种 count。
7. **读接口里藏写操作**：`adoptOrphanDemandPlans` 在 GET 里补数据，叠加 30s/60s 双轮询后成本被低估。
8. **版本与更新说明脱节**：整批收集计划功能没进 changelog，用户升级后不知道有这页。

---

## 4. 本轮审查结论

### 计数

| 级别 | 条数 | 说明 |
| --- | --- | --- |
| **P0** | **2** | O-1 非「附近」页开始采集时悬浮面板完全不工作、O-2 雷达南北镜像（M-1 文案闸门已在 `e1f2f3c` 修复，不再计入） |
| **P1** | **18** | 数据/状态不一致与主流程失效：B-1、B-2、F-1、F-2、F-3、F-4、F-8、O-3、O-4、O-5、O-6、A-1、A-2、A-3、M-2、M-3、D-1、E-1 |
| **P2** | **17** | 体验与可维护性：B-3、B-4、F-5、F-6、F-7、O-7、O-8、O-9、A-4、A-5、M-4、M-5、M-6、E-2、E-3、D-2、D-3 |

> 另有 1 条 P0（M-1）在审查期间由 `e1f2f3c` 修复，已复核通过。

### 建议修复顺序（按「用户会漏掉什么、数据会不会错」）

1. **第 1 批（发布前必修，一起改）**：O-1 + O-2 + F-1 + E-1。
   - E-1 是用户可见说明、F-1 是唯一一条「一次误触就丢数据」，不改别发。
   - O-1/O-2 决定「手机端这个功能到底成不成立」。
2. **第 2 批（数据一致性，必须一起改）**：B-1 + B-2 + F-2 + F-3 + F-4 + F-8。
   - 前 5 条共用一个状态机与同一条上限口径；F-8 会让用户把「错的需求口径」发出去，属于同一类「静默改用户输入」。
3. **第 3 批（采集可靠性，同链路一起改）**：A-1 + A-2 + A-3 + O-5 + O-6。
   - 全部落在「采集会话/文件/通知」这条链路上，改完一起真机 + PC 各验一次。
4. **第 4 批（体验与工程）**：其余 P2 + M-2/M-3/D-1。

### 可直接派给修复会话的清单（文件 → 改什么 → 验收）

| # | 文件 | 改什么 | 验收方式 |
| --- | --- | --- | --- |
| 1 | `src/ui/DemandPublishSheet.tsx:123-129` | 发需求模式的草稿重置只跟 `open`（+ 计划 id）走，别依赖 `items` 身份 | `npx vitest run src/ui/DemandPublishSheet.test.tsx`（补「重渲染后已选保留」） |
| 2 | `src/ui/BattleHudOrb.tsx` + `src/ui/Nearby.tsx:463-489` | 推送 effect 搬到全局组件，卸载/`pagehide` 兜底推 `visible=false` | 真机从「我的」开始采集 → 游戏内出现球与面板 |
| 3 | `src/pcap/nearbyRadar.ts:99,198` + 测试 | `ny = dy/scale`、`atan2(dx,-dy)`；测试改「+y → 南」 | `npx vitest run src/pcap/nearbyRadar.test.ts src/pcap/worldMap.test.ts` |
| 4 | `src/ui/plan/PlanDetailSheet.tsx:150-155` | 删除计划加二次确认 | `npx vitest run src/ui/plan/PlanDetailSheet.test.tsx` |
| 5 | `src/data/changelog.json` | 补 `2026-11-08d` 收集计划条目 | 刷新后弹窗出现；`npx vitest run src/data/changelog.test.ts` |
| 6 | `functions/_lib/collectionGroupsStore.ts:2006-2026,2608-2623` | 发需求受 8 条约束；降级只碰无未结单需求的计划 | `node tools/test/run-mother-groups-local.mjs` |
| 7 | `src/shared/collectionPlans.ts:157-166` | 归档只在 `done` 时返回 5；撤回后补自动完成判定 | `npx vitest run src/shared/collectionPlans.test.ts` |
| 8 | `src/ui/plan/MyCollectionView.tsx:62` | 去掉 `slice(0,8)`，超出部分与「想收」一起展示 | `npx vitest run src/ui/plan/MyCollectionView.test.tsx` |
| 9 | `src/ui/plan/PlanDetailSheet.tsx` 的 `onStart` | 透传并显示 `overflow` 提示 | 满 8 条时点开始出现提示 |
| 10 | `src/ui/HomeDemandPlacements.tsx:328-333` + 接口 | 取消勾选同步服务端；失败回滚勾选 | `npx vitest run src/ui/HomeDemandPlacements.test.tsx` |
| 11 | `src/nearby/overlayPayload.ts:59-61,73` | 传 `mapSelf`；加 `demand` 字段，稀有与需求拆开 | `npx vitest run src/nearby/overlayPayload.test.ts` |
| 12 | `desktop/capture/manager.cjs:169,184` + `nativeCollector.ts:116-126` | 到 128MiB 主动停止并给明确状态 | `npx vitest run src/collector/nativeCollector.test.ts` |
| 13 | `src/collector/useCaptureProgress.ts:147-150` | 只送尾部窗口，缓存只留 `windowBytes` | `npx vitest run src/collector/useCaptureProgress.test.tsx` |
| 14 | `PcapWriter.java` + `CaptureController.java` + `nativeCollector.ts:160-191` | 加裁剪代次并整份重读 | 真机战斗连采 6 分钟，包数只增不减 |
| 15 | `BattleOverlayController.java:150-200,493-500` | `isAttachedToWindow` 重建；失败返回明确状态 | 真机撤销/恢复权限后回工具箱看球 |
| 16 | `CaptureController.java:209-210` | 通知 id 唯一 + 配对取消 + 权限检查 | 真机连刷两只稀有，两条都停留 10 秒 |
| 17 | `src/api/collectionGroups.ts:686,705,986,1012` | 失败分支统一打点 | `npx vitest run src/api/collectionGroups.test.ts` |
| 18 | `src/api/collectionGroups.ts:986` + `analytics.ts` 注释 | `bulk` 真实传值或删字段；`placement_mark` count 口径统一 | `npx vitest run src/api/analytics.test.ts` |
| 19 | `e2e/helpers/motherGroupsMock.ts:257-258` | 按真实「我有这颗蛋」规则生成 `matchableEggIds` | `npx playwright test e2e/collection-plans.spec.ts` |
| 20 | `docs/收集计划-细化方案-2026-11-08.md:68`、`docs/domain/数据字段说明.md:8` | 接口路径与图鉴数量/版本改对 | 文档内搜 `plans/batch` 为 0；662/s5 一致 |

> 第 2~5 条是「发布前必修」；第 1、6~10 条属于状态机/输入一致性，必须同一批改完再验收；第 14~16 条需要真机，不要只跑单测。M-1（文案闸门）已由 `e1f2f3c` 关闭，无需再派。
