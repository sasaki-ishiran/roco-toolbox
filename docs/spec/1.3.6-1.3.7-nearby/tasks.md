# 任务清单（1.3.6 / 1.3.7）

> 顺序即执行顺序。P0 = 先修 bug 并汇报；P1 = 预览确认后再落代码。

## T0 验证前提（不动代码）
- [ ] T0.1 读 `nativeCollector.readCaptureSnapshotBytes` / `decodeInWorker`，确认窗口字节是文件尾切片还是绝对偏移切片，确定 `windowBase` 来源。
- [ ] T0.2 在 `src/pcap/liveWindow.test.ts` 写失败用例：定长尾窗滑动后新增 330/307 帧必须被应用。
- [ ] T0.3 确认「站立 30s 后 self 变 null」与「换场景后 330 被跳过」可复现（单测或真实包）。

## T1 地图/坐标（P0，1.3.6）
- [ ] T1.1 `core.js`：`options.windowBase` + 绝对偏移去重键；`nearbyBaseline.windowBase/windowMark`；满足条件清 `applied`。
- [ ] T1.2 `core.js`：`wildSelfScene`，self 不因单轮缺失置空；输出 `nearbySelfScene`；增加 `perf` 计数（解密帧 / 跳过帧）。
- [ ] T1.3 `nativeCollector.ts` + `decodeInWorker.ts` + worker：`readCaptureSnapshotBytes` 返回 `{bytes, base}` 并透传 `windowBase`。
- [ ] T1.4 `useCaptureProgress.ts`：self 沿用上一帧；写 `selfScene` / `selfAt`；记录读取/解码耗时。
- [ ] T1.5 `nearbyStore.ts`：`NearbySnapshot` 增加 `selfScene` / `selfAt`。
- [ ] T1.6 `NearbyMap.tsx`：self 位移平移跟随、换场景重新居中、去掉 `interacted` 永久闩锁、无底图渲染雷达降级。
- [ ] T1.7 `NearbyPanelController.java`：`showsMapArea` 允许无 self 但有 mapPets；估算中心 + `estimated=true`。
- [ ] T1.8 补单测：`liveWindow.test.ts`、`NearbyMap.test.ts`、`overlayPayload`（self 缺失估算中心）。
- [ ] T1.9 跑相关单测 + `tsc`，汇报修复前后行为差异。

## T2 卡顿量化（P0，1.3.6）
- [ ] T2.1 payload 组装 / 推送计数（`useNearbyOverlayPush.ts`）。
- [ ] T2.2 解码耗时、读取耗时、字节数、窗口大小（`useCaptureProgress.ts`）。
- [ ] T2.3 解密帧数 / `applied` 跳过帧数（`core.js` → `analysis.perf`）。
- [ ] T2.4 壳侧 `updateNearby/render/fillList/updateViewLayout/evaluateJavascript` 计数（`NearbyPanelController.java`，5s 汇总日志）。
- [ ] T2.5 `overlay-map.html` 的 `update()` / `innerHTML` 计数。
- [ ] T2.6 出 `docs/perf/1.3.6-附近实时性.md`：六项指标 + 结论 + 是否建议优化（不擅自优化）。

## T3 预览（P1，先确认再改代码）
- [ ] T3.1 单个可交互 HTML（375 画布）：列表新行序 + 六种底色（浅/深，显示 WCAG 对比度）+ 两种排布方案。
- [ ] T3.2 同 HTML：无底图雷达降级视图、悬浮球去圈前后、附近页「显示/隐藏悬浮球」按钮位置、战斗卡片去三角前后。
- [ ] T3.3 导出 375 / 390 截图各一张，交用户确认。

## T4 列表行重排（P1，预览确认后，1.3.6 或 1.3.7）
- [ ] T4.1 `trunc1` 截断工具 + 单测（12.38→12.3，0.29→0.2，负数与 null）。
- [ ] T4.2 `overlayPayload.ts` 补 `heightPct/weightPct/voiceDb/voiceLabel`。
- [ ] T4.3 `NearbyOverlayModel.java` 解析新字段；`NearbyPanelController.java` 新行布局、底色、`listSignature` 补字段。
- [ ] T4.4 `Nearby.tsx` `NearbyRowItem` 同步新字段与底色，去掉稀有/炫彩/异色/需求独立标签。
- [ ] T4.5 单测 + 更新 `dev` 预览。

## T5 更新入口（P1，1.3.7）
- [ ] T5.1 核实线上 `version.json` 内容、apkUrl、latest.apk 是否等于当前包。
- [ ] T5.2 `UpdateController.java` 清单链路修复（可信路径、版本比较、下载、安装）。
- [ ] T5.3 `public/android/version.json` 写当前版本 + 版本化 apkUrl；发布脚本同步 latest.apk。
- [ ] T5.4 `Profile.tsx` 一行卡片（检查更新 / 当前版本 / 检查→更新 / 发现新版本），不动连点 5 次切服。
- [ ] T5.5 端到端验证：点检查 → 更新 → 下载 → 拉起安装。

## T6 悬浮球外观 + 隐藏（P1，1.3.7）
- [ ] T6.1 `BattleOverlayController.java` 去外圈边框/呼吸，命中态改描边 + 角标。
- [ ] T6.2 长按 500ms 且位移 < slop → 隐藏；`SharedPreferences` 持久化。
- [ ] T6.3 `nativeCollector.ts` + 壳桥：`setOrbHidden` / `readOrbHidden`。
- [ ] T6.4 `Nearby.tsx` 采集开关旁「显示/隐藏悬浮球」按钮，隐藏后仍可见。
- [ ] T6.5 重开 App 验证隐藏状态保持。

## T7 战斗卡片去三角（P1，1.3.7）
- [ ] T7.1 定位三角装饰与对应热区。
- [ ] T7.2 删除装饰 + padding/热区，确认右上角无空白与误触。

## T8 出包与自检（每版各一次）
- [ ] T8.1 `tsc` + 相关单测。
- [ ] T8.2 `assembleDebug` + `testDebugUnitTest`。
- [ ] T8.3 `aapt dump badging` 核对 versionName / versionCode。
- [ ] T8.4 同签名覆盖安装包上传下载站；回传直链 + 字节数 + SHA-256；生产别名用唯一 `--commit-hash` 前移。

## T9 1.3.7 包体核对与补丁（2026-11-10）
- [x] T9.1 只读核对 11 项（两行 / 274 / 六色 / 级 / 百分位 / 地图 240-120-投影 / 球外观 / 长按隐藏 / 三角）。
- [x] T9.2 结论：仅 `overlay-map.html` 缺失（仍是 11-08 的 300/150 + `declared_width` 投影）。
- [x] T9.3 用 overlay-panel 版 `overlay-map.html` 覆盖 collector-shell 同名文件。
- [x] T9.4 `build.gradle` → 1.3.8 / 30，`assembleDebug` + `testDebugUnitTest`。
- [x] T9.5 解包校验 assets（240 / 120 / `/ side`）与 dex（「级」/`RocoServer`），`aapt dump badging` 核对版本。
- [x] T9.6 上传下载站（版本化包 + latest + version.json 1.3.8/30），回报直链、字节数、SHA-256。
- [x] T9.7 已拍板（2026-11-10）：列表滚动与 `mapPets` 都补，但不单独出包，等 1.3.8 真机确认后与下一版（1.3.9 / 31）一起做。

## T10 下一版（1.3.9 / 31，2026-11-10 已完成）
- [x] T10.1 对齐构建树：以 `d:\desk\洛克工具箱\android-shell` 为唯一权威树，迁入 1.3.8 状态并打 tag `shell-v1.3.8`（见 spec §十一）。
- [x] T10.2 列表改可滚动；内容不满一屏时触摸交回面板拖动。
- [x] T10.3 地图用 `mapPets` 全量点，列表仍按筛选。
- [x] T10.4 加 preBuild 守卫（版本号 / 240 / 120 / `/ side` / 274 / 长按隐藏 / siteOrigin），编译期拦截「补一处丢一处」。
- [x] T10.5 出 1.3.9 / 31，真机冷启动 16s 无 `AndroidRuntime:E` 后再上传。
- [x] T10.6 `RocoPerf` 原生日志：每 5 秒一行（`payload` 推送次数 / `render` 面板重绘 / `webviewMapPush` 地图重绘 / `parseAvg`·`parseMax` 单次解析耗时）。
- [x] T10.7 上传下载站：`roco-toolbox-latest.apk` 4,239,290 B，SHA-256 `76D0F1667E9507D8C6B76243F71B4ACAE161F22E36D670D838FCBA375D3AD6B9`；`version.json` 1.3.9 / 31。

## T11 待办：正式服「停止采集后白屏」（2026-11-10，先记录不修）
- 现象：正式站（老 bundle `index-C_6hLomo.js`）+ 1.3.8 壳，点「停止采集」后整页全白；杀掉 App 重开恢复；内测站无此问题。
- 已排除：正式站当前部署资源自洽（HTML 引用的 `index-C_6hLomo.js`、`core-C9d1O_hS.js`、CSS、worker 全部 200，SW 预缓存 27 项无缺失）；新开浏览器访问 `roco-toolbox.pages.dev` 正常渲染、无 console 报错。
- 结论：大概率是老网页 bundle 在停止采集后的状态更新里抛未捕获异常把 React 根组件带崩（新 bundle 未复现），不是部署回滚缺资源。若要兜，优先网页侧修（给停止链路加 error boundary / try-catch），需另发一次正式站构建；壳侧无需为一处兼容再发版。
- 未做：按用户要求 1.3.9 优先，白屏暂不修。

### T9 执行结果（2026-11-10）
- [x] T9.3 已覆盖，assets 校验 `VIEW_METERS = 240`、`DOT_RADIUS_METERS = 120`、`(selfX - originX) / side`。
- [x] T9.4 版本 1.3.8 / 30，`testDebugUnitTest` 与 `assembleDebug` 通过。
- [x] T9.5 dex 校验：classes3 含 `RocoServer` / `RocoPrefs` / `RocoCaptureBridge` / `ServerBridge` / 测试站地址；classes5 含「级」。
- [x] T9.6 生产直链已生效：`latest.apk` 4,237,374 B，SHA-256 `DD3CD21994549E13CB16BCC766CE02D8C9B2BA3D2F97B5EC4591725581EA84A4`。
- [x] T9.8 闪退修复：`ServerConfig` 移到 `onCreate` 内创建；真机冷启动 16 秒无崩溃、采集状态正常。
- [x] T9.9 测试站采集桥白名单回归：`CaptureBridgePolicy` / `CaptureController` 跟随当前 origin。
