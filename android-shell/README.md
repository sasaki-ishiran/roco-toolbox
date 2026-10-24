# 洛克工具箱 Android 壳与本机采集

网页界面仍来自 `https://roco-toolbox.pages.dev/`。1.2.0 增加本机采集桥，必须配套部署包含 `NativeCollectorPanel` 的网页才能显示入口；旧网页、旧 APK 继续支持原来的分享与文件导入。

使用：我的 → 游戏数据 → 本机采集。完全退出游戏和其他 VPN/加速器后开始采集，同意系统授权，再打开游戏重新登录，依次查看精灵仓库、背包和蛋仓。回工具箱停止保存，然后明确点「解析并导入」。是否收齐以实际返回数据为准，工具箱不自动声明完整。

- 原包在应用私有 `files/captures/`，最多 10 个、单个上限 128MiB；导入不删除原包。
- 正常停止会排空队列、flush/fsync/close 后才移除 `.incomplete`。异常中断、队列丢包或超限的文件保留，可导出、确认删除，禁止一键导入。
- 仅游戏走 VPN，socket 由原生 `protect` 后转发；没有作者云端、更新接口或采集令牌。私有云同步沿用用户设置，小组资源仍需手动发布。
- 新版原包通过随机授权 URL 交给 Web Worker 读取解析，Java 与主页面不保留整文件字节数组。
- 采集桥使用 AndroidX WebMessageListener，仅接受官方来源的主页面消息。系统 WebView 需支持 `WEB_MESSAGE_LISTENER` 和 `DOCUMENT_START_SCRIPT`；不支持时隐藏采集入口，更新系统 WebView 后可用，手动文件导入不依赖该桥。
- 卸载应用会删除其本机数据；更新应使用同包名、同签名且更高 versionCode 的覆盖安装。构建验收记录会核对签名。

构建及组件许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。真机验收需要检查系统授权取消、通知栏停止、实际登录与数据导入、VPN 撤销、切后台和连续启动停止；桌面浏览器模拟桥不能代替这些检查。
