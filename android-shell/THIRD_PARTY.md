# 安卓本机采集组件来源与许可

集成日期：2026-10-24。此文件与完整许可证一同随 APK 放在 `assets/licenses/`。工具箱源代码：<https://github.com/sasaki-ishiran/roco-toolbox/tree/codex/android-collector>；对应构建提交及校验值见同次交付的验收报告。可以自行修改、构建并用自己的密钥签名安装，无需作者服务或凭据。

## 蛋神助手 Android 采集器

- 来源：用户提供的 `android-collector-1.2.6-source/android-collector` 完整源码；原作者发布站点 <https://danking.cn/>。
- 上游声明：GNU GPL v3；沿用工程现有 `GPL-3.0-only` 许可。完整 GPL 文本在根目录 `LICENSE` 和 APK `assets/licenses/GPL-3.0.txt`。
- 引入 `app/src/main/cpp/collector_tunnel.c`、`CMakeLists.txt`、`NativeTunnel.java`、`GamePacketFilter.java`；`PcapWriter.java` 根据其 `PcapFile.java` 的以太网 PCAP 写法改编；`CaptureUploader.java`、`CaptureUploadStore.java` 根据其 `CaptureUploadClient.java`、`CaptureUploadStore.java` 的 V3 原包上传与任务持久化逻辑改编（去掉本地解析 JSON 上传，只保留原始 PCAP）。
- 修改：JNI/Java 包名改为 `com.localdatatool.toolbox.capture`；重写持久文件生命周期、写入上限与关闭同步；保留转发与 TCP/8195 过滤；重写服务、授权、通知和受限桥；上传改为单任务串行、由网页按钮触发、失败可见。未引入其更新、会员、悬浮窗或原生解析服务。
- 上传使用原版公开 Android 客户端的应用身份、版本号与发布凭据；凭据不进源码，构建时由本机 `local.properties` 的 `capture.token` 注入。
- 保留的上游技术说明见 `UPSTREAM-THIRD-PARTY.md`。它描述原作者版本，不表示工具箱启用了其中的更新、会员或悬浮窗功能（上传已按本文件第 9 条接入）。

## zdtun

- 上游：<https://github.com/emanuele-f/zdtun>，Emanuele Faranda。
- 原采集器固定版本：`80b7941d4e685d8354346820878eaec0e35b6b1e`；引入的是该采集器已经修改的快照，目录为 `app/src/main/cpp/third_party/zdtun/`，工具箱未再修改其中代码。
- 许可：LGPL-3.0-or-later，完整文本 `COPYING` / `assets/licenses/LGPL-3.0.txt`；底层 GPL 文本 `COPYING.GPL` / `assets/licenses/GPL-3.0.txt`。
- 原采集器改动：新增 `prepare_socket` 回调，在 socket 连接前调用 Android `protect`；支持时使用 `MSG_NOSIGNAL`；同一 socket 同时处理可读与可写；ICMPv6 读取进入已有处理器。完整解释见保留的上游说明。
- Android 产物保持独立动态库 `libzdtun.so`，`libcollector_tunnel.so` 动态链接它。完整修改后源代码、头文件、JNI、Java、构建脚本都提供在本仓库，允许替换库并重建安装。
- `third_party/uthash.h` 保留 Troy D. Hanson 的 BSD 风格许可；其他文件原版权头保持原样。

## 构建与使用

消息桥依赖 AndroidX WebKit 1.12.1（Apache-2.0，源码 <https://android.googlesource.com/platform/frameworks/support/+/androidx-main/webkit/>），同时检查准确来源与主页面身份，不使用传统全框架采集 JS 注入。

JDK 17+、Android SDK 35、NDK 28.2.13676358、CMake 3.22.1、Gradle wrapper 8.11.1。Windows 使用 `tools/build-android.ps1`，或在 Android 工程执行 `gradlew assembleDebug testDebugUnitTest lintDebug`。首次获取依赖可给脚本加 `-Online`。脚本中的 SDK/JDK/暂存目录均可用参数覆盖；签名密钥不是构建源码的一部分。

本机采集需要 Android 8+，目标游戏包为 `com.tencent.nrc`，记录 TCP/8195。应用本身仍支持 Android 6/7 查看和导入数据。无需 Root 或额外安装 PCAPdroid。PCAPdroid 仅为上游架构参考，未引入其应用源码。
