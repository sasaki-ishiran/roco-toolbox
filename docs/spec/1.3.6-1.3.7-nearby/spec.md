# 1.3.6 / 1.3.7 附近功能修复与改版 — 规格

状态：待用户确认（Spec Mode）
日期：2026-11-10
范围：地图/坐标跟随、卡顿量化、列表行重排与底色、更新入口、悬浮球外观与隐藏、战斗卡片装饰
不包含：切服逻辑（`ServerConfig` / `MainActivity` 切服段 / `ServerAddressPanel` / `Profile` 连点 5 次入口）、教程（`tour.ts`）

---

## 一、已确认的代码事实（只读核查结论）

| 事实 | 位置 |
| --- | --- |
| 页面地图只认 10003 一张底图，其他场景 `worldMapForScene()` 返回 null | `src/pcap/worldMap.ts:21-41` |
| 页面地图无底图时整块 `return null`（换场景后直接消失） | `src/ui/NearbyMap.tsx:199` |
| 页面地图一旦拖动/缩放，`interacted.current` 永久为 true，之后 self 变化不再重新居中 | `src/ui/NearbyMap.tsx:74,132-135,186-190` |
| 悬浮窗地图区要求 `selfX/selfY` 非空，self 为 null 时整块地图区隐藏（连雷达兜底也不给） | `NearbyPanelController.java:585,875-879` |
| 悬浮窗地图按每帧 `scene` 查 `maps.json` 并重算投影，未知场景走雷达底图（壳侧机制本身没问题） | `assets/overlay-map.html:150-161` |
| 悬浮窗列表宽度仅 124dp，行内容重建靠 `listSignature` 去重 | `NearbyPanelController.java:624-635,658-676` |
| 附近页发起的会话只解文件尾 2MiB；「我的」页发起的会话全量解 | `src/collector/useNearbyFeed.ts:37,80,90` |
| live 循环每轮解码后直接 `writeNearbySnapshot({ self: analysis.nearbySelf ?? null })`，null 会覆盖上一轮有效 self | `src/collector/useCaptureProgress.ts:158-174` |
| 自身坐标只取「当前解码窗口里最后一个上行 opcode 307」，且附到该 flow 全部事件 | `core.js:1322-1351,1459-1460` |
| 窗口化去重键为 `${flowKey}#${fileOffset}`，只有 `bytes.length < baseline.size`（文件被裁剪）才清空已应用集合 | `core.js:2069-2072,2131-2141` |
| 基线保存/恢复 self：`nearbyBaseline.self`，新账号创建时继承 | `core.js:2112,2183` |
| `LiveNearbyPet` 已带 `heightPct / weightPct / voiceDb`，声音牌子在 `kinds` 的 `high / low` | `src/collector/captureProgress.ts:41-51` |
| 版本清单只有 `public/android/version.json`；更新控制器在壳 | `public/android/version.json`、`update/UpdateController.java` |

---

## 二、根因判断（bug 1：地图/坐标不跟随）

三层叠加，任何一层都足以复现用户描述：

1. **数据层（主因）**：附近页发起的采集只解 2MiB 尾窗。`self` 只来自窗口内最后一个 307 上行帧；玩家站立不动时没有 307 帧，窗口一滑就再也找不到 → `nearbySelf=null`（表现为「只有第一次点开始采集正常」）。
2. **去重层（放大）**：`applied` 键用窗口内相对 `fileOffset`。定长尾窗滑动后同一偏移会被新帧复用，新 307 / 330 帧被当成「已应用」直接跳过（core.js:2131-2141），而 `applied` 只在文件变小时清空（:2069），定长尾窗永远不触发 → 走动、换场景后精灵与坐标一起冻结。
3. **渲染层**：
   - 壳：`self` 为 null 时 `showsMapArea()` 为 false，连「未知场景走雷达」的兜底也进不去（NearbyPanelController.java:875-879）。
   - 页面：换到非 10003 场景 `NearbyMap` 直接 `return null`；手动拖过一次后 `interacted` 永久闩锁，不再跟随 self（NearbyMap.tsx:74,132-135,199）。

**必须先验证、后修改**（避免拍脑袋）：
- V1：读 `nativeCollector.readCaptureSnapshotBytes` 与 `decodeInWorker`，确认窗口字节是「文件尾部切片」还是「绝对偏移切片」，据此确定 `windowBase` 从哪来。
- V2：在 `src/pcap/liveWindow.test.ts` 写一个失败用例：同一文件追加数据、尾窗定长滑动后，新 330/307 必须被应用（当前预期会被 `applied` 吃掉）。
- V3：真机/模拟数据确认「站立 30s 后 self 变 null」。

---

## 三、设计决定

### A1 地图/坐标跟随（1.3.6）

1. **解码去重改绝对偏移**
   - `core.js` `extractFlowEvents(bytes, options)` 增加 `options.windowBase`（窗口首字节在文件中的绝对偏移），去重键改 `${flowKey}#${windowBase + fileOffset}`，`event.absoluteOffset` 一并带出。
   - `nearbyBaseline` 增加 `windowBase` 与 `windowMark`（首帧签名）。以下任一情况清空 `applied`：`bytes.length < size`（已有）、`windowBase` 回退、`windowMark` 变化。
   - `readCaptureSnapshotBytes` 返回 `{ bytes, base }`（涉及 `nativeCollector.ts` 与其调用点）；worker 协议增加 `windowBase` 透传（`decodeInWorker.ts` + worker 实现）。
2. **self 跨轮保活**
   - `core.js` 新增 `wildSelfScene`；场景变化时只标脏，不把 `wildSelf` 置 null；输出 `nearbySelfScene`。
   - `useCaptureProgress.ts` 写快照时：`self = analysis.nearbySelf ?? (sceneUnchanged ? 上一帧.self : 上一帧.self)`；同时写 `selfScene`、`selfAt`。即 self 永不因「本轮没解到」被清空，场景变化只影响「可信度」标记。
   - `nearbyStore.ts` 的 `NearbySnapshot` 增加可选 `selfScene?: number | null`、`selfAt?: number`。
3. **渲染跟随**
   - `NearbyMap.tsx`：删除 `interacted` 永久闩锁。改为「self 位移 → 视图按同一位移平移，保留用户缩放/偏移」：
     ```
     const lastSelf = useRef<MapPoint | null>(null);
     useEffect(() => {
       const prev = lastSelf.current; lastSelf.current = self;
       if (!map || !self || !prev || map !== lastMap.current) { lastMap.current = map; centerOnSelf(); return; }
       const a = projectToPixel(map, prev), b = projectToPixel(map, self);
       setView(v => ({ ...v, tx: v.tx - (b.px - a.px) * v.scale, ty: v.ty - (b.py - a.py) * v.scale }));
     }, [map, self]);
     ```
     保留 `centerOnSelf` 用于首帧 / 换场景 / 容器尺寸变化。
   - `NearbyMap.tsx`：无底图场景不再 `return null`，渲染「雷达降级视图」（self 为圆心、120m 参考圈、精灵按世界坐标相对落点）。**这是新增视觉，纳入预览确认。**
4. **壳侧**
   - `showsMapArea()` 改为：`mapView != null && (self 有效 || mapPets 非空)`；self 缺失时以 `mapPets` 最近点为中心、`estimated=true`。
   - `pushMapData` 保持每轮 `render()` 推送；面板展开首帧（`onPageFinished`）已补推，无需改。
   - 场景切换不重建 WebView：`overlay-map.html` 每帧按 `state.scene` 查表并重算 `projectArt`，已满足；补 `failedArt` 只在加载失败时记录、不跨场景误伤（现状已按文件名记录）。

### A2 卡顿量化（1.3.6，只加度量不改算法）

采集以下指标，滚动 60 轮，debug 包默认开、release 关（`localStorage['roco.perf']==='1'` 或 `BuildConfig.DEBUG`）：

| 指标 | 埋点位置 |
| --- | --- |
| 每秒 payload 组装次数 | `src/nearby/useNearbyOverlayPush.ts`（组装入口 + 推送入口各一计数） |
| 每轮解码耗时 / 读取耗时 / 字节数 / 窗口字节数 | `useCaptureProgress.ts` 的 `runCheck` 前后 `performance.now()` |
| 每轮解密帧数 vs `applied` 跳过帧数 | `core.js` `decryptFrameOnce` 命中数与 `applyEvent` 跳过数，随 `analysis.perf` 返回 |
| `updateNearby` / `render` / `fillList` / `updateViewLayout` / `evaluateJavascript` 次数 | `NearbyPanelController.java` 计数，每 5s `Log.d("RocoPerf", ...)` |
| WebView `update()` 调用次数 / `innerHTML` 重写次数 | `overlay-map.html` 计数，每 5s `console.log` |

产出：`docs/perf/1.3.6-附近实时性.md`（一次性数据报告：指标表 + 结论 + 是否建议优化）。
**不在本批预置优化**；若数据显示明确热点（如每秒全量 payload、每轮全量重解码），先出数据结论再单独确认改法。

### A3 列表行重排 + 底色（需预览后再落代码）

字段顺序（第一排）：`精灵名 · 距离 · 方位箭头 · xx级 · 高：xx.x% · 重：xx.x% · 声音`

- 高/重百分比：`trunc1(v) = Math.trunc(v * 10) / 10` 后 `toFixed(1)`，**截断不四舍五入**；`null` 显示 `—`。
- 声音：`kinds` 含 `high` → `婉转声`，`low` → `粗嗓门`；都没有则不显示该字段（不占位）。
- 稀有 / 炫彩 / 异色 / 污染 / 命中需求不再出独立标签，改为**卡片底色**，优先级：
  `需求 > 炫彩 > 异色 > 污染 > 稀有 > 普通`（同时命中取最高优先级）。
- 「可提醒」不占底色：保留左侧 3dp 红色竖条 + 普通底色，避免和底色语义打架。
- 底色方案（浅色 / 深色，文字对比度均 ≥ 8:1，预览页显示实测 WCAG 值）：

| 语义 | 浅色底 / 文字 | 深色底 / 文字 |
| --- | --- | --- |
| 普通 | `#FFFFFF` / `#0F172A` | `#16233B` / `#E2E8F0` |
| 稀有 | `#FEF3C7` / `#78350F` | `#3B2A08` / `#FDE68A` |
| 炫彩 | `#FCE7F3` / `#831843` | `#3B0A22` / `#F9A8D4` |
| 异色 | `#FFEDD5` / `#7C2D12` | `#3B1A06` / `#FDBA74` |
| 污染 | `#EDE9FE` / `#4C1D95` | `#2A1B4D` / `#DDD6FE` |
| 命中需求 | `#DCFCE7` / `#14532D` | `#052E1A` / `#A7F3D0` |

- **排版冲突（需预览决策）**：悬浮窗列表可用宽度约 124dp，7 个字段单行放不下（估算 ≥164dp）。预览给两个方案：
  - 方案 1：面板加宽到约 196dp，第一排单行放全 7 项；
  - 方案 2（推荐）：面板宽度不变，第一排只放「名 · 距离箭头 · Lv」，第二行按同一顺序承接「高 · 重 · 声音」。
- 改动点：`overlayPayload.ts`（payload 补 `heightPct/weightPct/voiceDb/voiceLabel`）、`NearbyOverlayModel.java`（解析新字段）、`NearbyPanelController.java`（行布局、`listSignature` 补高/重/声音，否则百分比变化不刷新）、`Nearby.tsx` 的 `NearbyRowItem`（页面列表同步同一口径）。

### B1 更新入口（1.3.7，选 A：一行卡片）

- `src/ui/Profile.tsx`：一行卡片，左「检查更新 / 当前版本 x.y.z」，右按钮「检查」；查到新版按钮变「更新」，卡片副标题显示「发现新版本 x.y.z」。**不改**版本号连点 5 次切服。
- `UpdateController.java`：清单地址改走可信路径（不复用旧缓存），版本比较 → 下载 → `FileProvider` 安装整链路验证。
- `public/android/version.json`：写入当前版本、`apkUrl` 用版本化路径（如 `android/roco-toolbox-1.3.7.apk`），发布时同步覆盖 `android/latest.apk` 指向当前包。
- 先核实线上清单现状（WebFetch `https://roco-toolbox-downloads.pages.dev/android/version.json`），把「清单版本 / apkUrl 是否存在 / latest.apk 是否等于当前包」写进汇报。

### B2 悬浮球外观（1.3.7）

- `BattleOverlayController.java`：删除外圈边框与呼吸动画，只留图标本体；命中状态改为图标描边颜色 + 右上 4dp 角标（不新增点击热区）。
- 预览确认「小尺寸下仍清晰、命中态可区分」。

### B3 悬浮球隐藏（1.3.7）

- 长按隐藏：`ACTION_DOWN` 记时间与坐标；移动超过 `DRAG_SLOP` → 拖动；`ACTION_UP` 时长 ≥ 500ms 且位移 < slop → 隐藏。
- 持久化：`SharedPreferences` 存 `orbHidden`，重开 App 保持。
- 「附近」页按钮：`Nearby.tsx` 采集开关旁加「显示悬浮球 / 隐藏悬浮球」按钮，经桥（`nativeCollector.ts` 新增 `setOrbHidden(boolean)` / `readOrbHidden()`）驱动 `BattleOverlayController`。隐藏时该按钮始终可见，是唯一恢复入口。
- 不碰 `MainActivity` 的切服段；桥方法加在悬浮球控制器已有的 JS 接口上。

### B4 战斗收集卡片右上角三角（1.3.7）

- 定位装饰来源（优先查 `BattleOverlayController` 的卡片绘制与 `NearbyPanelController` 的命中区），删除三角 + 对应 padding/点击热区，确认右上角无空白与误触区。
- 预览确认删除前后对比。

---

## 四、版本与发布安排（2026-11-10 用户定稿）

- **只出一版：1.3.6 / versionCode 27**，壳内这轮改动全部攒齐再打包（地图跟随 + 卡顿 + 列表排布与底色 + 更新入口 + 悬浮球去圈与隐藏 + 卡片三角），不再一小批打一版。
- 只靠网页就能生效的改动（`src/` → bundle）直接部署到测试站 / 下载站，不为此出 APK。
- 出包时：同签名覆盖安装、上传下载站、回传直链 + 字节数 + SHA-256；自检 `tsc`、相关单测、`assembleDebug + testDebugUnitTest`、`aapt dump badging` 版本号。
- 汇报节奏：修完 bug / 出预览 / 出包各汇报一次；需拍板的点一次性列出。

---

## 五、验收

1. 换场景后悬浮窗地图区仍在（未知场景走雷达），走动时点位随 self 移动；页面地图同样跟随，不再因拖动一次就冻结。
2. 站立 30s 后 self 不清空；换场景后 330 全量精灵能刷出来。
3. `liveWindow.test.ts` 覆盖：窗口滑动后新帧不被 `applied` 跳过；`windowBase` 回退清空；同场景 self 沿用。
4. `NearbyMap.test.ts` 覆盖：self 位移 → 视图平移；换场景重新居中；无底图场景不返回空。
5. 卡顿报告给出六项指标的真实数字与结论。
6. 预览 HTML（375 宽）：列表新行序 + 六种底色（浅/深）+ 无底图雷达降级 + 悬浮球外观前后 + 附近页按钮位置 + 战斗卡片去三角前后，用户确认后再改代码。
7. 更新入口：线上清单版本与包一致，点「检查 → 更新」能下载并拉起安装。

---

## 六、待用户决策

1. 列表第一排：方案 1（面板加宽）还是方案 2（两行、顺序不变）？
2. 版本拆分是否按「1.3.6 先出 bug 批、1.3.7 出 UI 批」执行？
3. 底色表是否需要按预览再微调（对比度/深浅）？

---

## 七、1.3.7 包体核对（2026-11-10，只读）

背景：1.3.6 与 1.3.7 分别在不同构建树里改过悬浮窗，需要确认 1.3.7（`D:\roco-build\collector-shell`，versionCode 29）没有丢 1.3.6 的改动。

| # | 检查项 | 期望 | 实测位置 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | 列表两行 | 第一行「距离·箭头·xx级」，第二行「高·重·声音」 | `NearbyOverlayModel.java:316-334`（`metaTextLine1` / `metaTextLine2`） | 通过 |
| 2 | 面板宽度 | 274dp | `NearbyOverlayModel.java:22` `PANEL_WIDTH = 274` | 通过 |
| 3 | 六种卡片底色 | 需求>炫彩>异色>污染>稀有>普通 | `NearbyOverlayModel.java:284-296` `toneOf`；`NearbyPanelController.java:820` 描边/底色 | 通过 |
| 4 | 「xx级」文案 | 拼接 `xx级`，全树无 `Lv` | `NearbyOverlayModel.java:321`；全仓 grep `Lv` 无命中 | 通过 |
| 5 | 百分位截断 | 只截断不四舍五入，保留一位小数 | `NearbyOverlayModel.java:298-307` `pctText` | 通过 |
| 6 | 地图视野 | `VIEW_METERS = 240` | `assets/overlay-map.html:56` 实为 300 | **缺失** |
| 7 | 地图点位半径 | `DOT_RADIUS_METERS = 120` | 同文件 `:57` 实为 150 | **缺失** |
| 8 | 底图投影 | 世界坐标差 `/ side_units` | 同文件 `:97-98` 实为 `/ declared_width` | **缺失** |
| 9 | 悬浮球去外圈/红点/呼吸 | 只留图标本体，命中只改颜色 | `BattleOverlayController.java:270,505` | 通过 |
| 10 | 长按隐藏 | 500ms + 位移 < slop，SharedPreferences 持久化 | `BattleOverlayController.java:62,81,309,481` | 通过 |
| 11 | 战斗采集卡三角 | 已删 | `NearbyPanelController.java:386`（注释「1.3.6 起删掉」） | 通过 |

结论：1.3.7 的 `overlay-map.html` 仍是 2026-11-08 的旧版（无雷达兜底、300/150、投影除 `declared_width`），而 240/120 那版只存在于 `D:\roco-build\overlay-panel\android-shell`（2026-11-10 00:47）。其余 10 项均在 1.3.7 源码中。

## 八、补丁决定（本次）

### D1 地图改版补齐（必须，用户已明确指示）

- 用 `D:\roco-build\overlay-panel\android-shell\app\src\main\assets\overlay-map.html` 覆盖 `D:\roco-build\collector-shell\app\src\main\assets\overlay-map.html`。
- 该版本包含：`VIEW_METERS = 240`、`DOT_RADIUS_METERS = 120`、投影 `/ side_units`、雷达兜底、`mapPets || pets`、需求角标、5s 性能计数。
- 兼容性：两树 `assets/maps/maps.json` 与 `10003.webp` 字节一致；`window.RocoOverlayMap.init/update` 接口不变，壳端 `file:///android_asset/overlay-map.html` 调用不变。

### D2 待你拍板（不在已确认清单内，先不擅自改）

已拍板（2026-11-10，用户确认）：
1. **列表滚动 → 补**。改可上下滚动；内容不满一屏时把触摸交回面板拖动，能滚才滚。
2. **`mapPets` → 补**。地图恢复全量附近点，列表仍按筛选。
3. **节奏：不单独出包**。等用户确认 1.3.8 不闪退后再出下一版（1.3.9 / 31），这两条一起做。

原问题（保留背景）：
1. **列表滚动**：collector-shell 没有 `ScrollView`，列表上限 `MAX_ROWS = 8`（`NearbyOverlayModel.java:20,93`）；overlay-panel 有 `PanelScrollView`。1.3.7 是「最多 8 行、面板高度取 max(地图 120dp, 列表)」，不是「可上下滑动」。
2. **地图点位范围**：collector-shell 的 `NearbyOverlayModel` 只解析 `pets`（`:86`），壳推送地图也只给 `pets`（`NearbyPanelController.java:743-754`），所以地图只画筛选后的点；网页 payload 已带 `mapPets`（全部附近精灵）。

## 十一、构建树对齐（2026-11-10，事实核查）

现状不是「两棵」，是**三份并行副本**：

| 树 | 版本控制 | 与 1.3.8 的关系 |
| --- | --- | --- |
| `d:\desk\洛克工具箱\android-shell` | 主仓 git（工作区有未提交改动） | 274 / 六色 / 两行 / 战斗球 与 collector 一致；**没有 `ServerConfig.java`**；`overlay-map.html` 仍是 11-08 旧版 |
| `D:\roco-build\collector-shell` | **无 git** | 实际打出 1.3.7 / 1.3.8 的树（含切服、崩溃修复、新地图） |
| `D:\roco-build\overlay-panel` | 独立 git（`feature/overlay-panel`，工作区未提交） | 有 ScrollView、`mapPets`、雷达兜底；面板仍是旧版 268 / 无六色 |

「补一处丢一处」的根因：**从无版本控制的副本构建**，改动却分散在主仓、overlay 仓和 collector 副本三处，构建时只看其中一份。

对齐做法（待执行）：

1. 唯一权威树定为 `d:\desk\洛克工具箱\android-shell`：与网页同仓、可 review、可回滚、可与网页同一提交发版。
2. 一次性把 1.3.8 实际发版状态迁入权威树：`ServerConfig.java`、`MainActivity` 切服段、新 `overlay-map.html`、`CaptureBridgePolicy` / `CaptureController` 修复、`build.gradle` 1.3.8/30；提交并打 tag `shell-v1.3.8`。
3. 把 overlay-panel 的 ScrollView / `mapPets` 先在其 git 里提交留存，再按条目移植到权威树（下一版一起做）。
4. 归档旧树：`collector-shell` 改名 `_archive/collector-shell-1.3.8`（只读），`overlay-panel` 只作参考；所有构建命令固定 `cwd=d:\desk\洛克工具箱\android-shell`。
5. 编译期守卫（写进 `android-shell/app/build.gradle` 的 preBuild，不靠记忆）：版本号与 `version.json` 一致；assets 含 `VIEW_METERS = 240`、`DOT_RADIUS_METERS = 120`、`/ side`；`NearbyOverlayModel` 含 `PANEL_WIDTH = 274`；`BattleOverlayController` 含长按隐藏；`CaptureBridgePolicy` 使用 `siteOrigin`。任一不满足直接 fail。
6. 发版流程固定为：改权威树 → 单测 → `assembleDebug` → 真机冷启动（`force-stop` + `logcat -c` + 启动 + 16s + `pidof` + `AndroidRuntime:E` 必须为空）→ 上传 → 回读 SHA-256。

## 九、版本与发布

- 1.3.7 / 29 已发给用户，字节不能复用，补丁版出 **1.3.8 / versionCode 30**；`MainActivity` 的切服段保持不动。
- 出包后自检：`aapt dump badging` 版本号；解包 `assets/overlay-map.html` 必须含 `VIEW_METERS = 240`、`DOT_RADIUS_METERS = 120`、`/ side`；dex 含「级」「RocoServer」；`testDebugUnitTest`。
- 下载站更新：`roco-toolbox-1.3.8.apk` + `latest.apk` + `version.json`（1.3.8 / 30），回报字节数与 SHA-256。

## 十、1.3.7 启动闪退（发布级，2026-11-10）

真机崩溃栈（`adb logcat -b crash -d`，与用户抓的日志一致）：

```
java.lang.RuntimeException: Unable to instantiate activity ComponentInfo{com.localdatatool.toolbox/...MainActivity}:
  java.lang.NullPointerException: Attempt to invoke virtual method
  'android.content.SharedPreferences android.content.Context.getSharedPreferences(java.lang.String, int)'
  on a null object reference
    at com.localdatatool.toolbox.ServerConfig.<init>(ServerConfig.java:74)
    at com.localdatatool.toolbox.MainActivity.<init>(MainActivity.java:70)
```

根因：`serverConfig` 写成字段初始化器 `new ServerConfig(this)`，字段初始化发生在 `Activity.attachBaseContext` 之前，`this` 的 base context 为 null。

修复：字段改为 `private ServerConfig serverConfig;`，在 `onCreate` 里 `super.onCreate` 之后创建。

同一批还查出第二个回归（不闪退但功能失效）：`CaptureBridgePolicy` 与 `CaptureController.setPage` 只放行 `https://roco-toolbox.pages.dev`，而 1.3.7/1.3.8 默认测试站 → `RocoCapture` 消息被静默丢弃，网页 10 秒超时后报「无法读取本机采集状态」。修复：白名单改为跟随 `serverConfig.origin()`（`CaptureBridgePolicy.allows(origin, mainFrame, siteOrigin)` + `CaptureController.setSiteOrigin()`，切服时同步）。

真机验证：1.3.8 冷启动 16 秒，进程存活、无 `AndroidRuntime` 崩溃、采集状态正常显示「开始采集 / 附近强提醒 已开启」。
