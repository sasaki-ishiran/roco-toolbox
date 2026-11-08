package com.localdatatool.toolbox;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import com.localdatatool.toolbox.capture.CaptureController;
import com.localdatatool.toolbox.capture.CaptureBridgePolicy;
import com.localdatatool.toolbox.capture.CaptureVpnService;
import com.localdatatool.toolbox.capture.BattleOverlayController;
import com.localdatatool.toolbox.update.UpdateController;

/**
 * 「洛克工具箱」的原生壳。只做三件事：
 *
 * 1. 用 WebView 打开线上网页 —— 所以以后改网页只要重新部署，不需要重装这个 APK；
 * 2. 注册成系统分享目标，让采集器的「分享」面板里出现「洛克工具箱」；
 *    微信 / QQ 的「用其他应用打开」是 VIEW 意图（文件挂在 intent.data 上），也一并接住；
 * 3. 把分享进来的内容交给网页：JSON 直接把文本塞进去；抓包（PCAP）是二进制，
 *    走拦截请求让网页自己取字节，交给网页里已有的解析与导入流程。
 *
 * 另外必须挂一个 {@link WebChromeClient}：网页上的「导入抓包数据 / 导入备份」用的是
 * `<input type="file">`，没有它就调不到 onShowFileChooser（文件选择器根本不弹）；
 * 「重置导入数据」用的是 window.confirm()，没有 onJsConfirm 时**恒返回 false**，
 * 函数会在确认处直接早退，看起来就像按钮坏了。
 *
 * 网页侧的接收端在 src/share/nativeShare.ts。
 * 之所以做这个壳：安卓上浏览器版的分享目标（Web Share Target）必须由 Google 的
 * 服务器生成 WebAPK 才能生效，国行机器上这一步经常走不通，原生壳没有这个问题。
 */
public class MainActivity extends Activity {

    private static final String SITE_URL = "https://roco-toolbox.pages.dev/";

    /**
     * 允许留在 WebView 内导航的域名（含它的预览子域）。其余链接一律交给系统浏览器：
     * 页脚的 Wiki / CC BY-SA 外链是 {@code target="_blank"}，壳不接管就表现成「点了没反应」。
     *
     * 顺带收窄了 JS 桥的暴露面：主框架永远只停在自家站点上，
     * 别的来源就没机会拿到 {@code RocoShare} 这个注入接口。
     */
    private static final String SITE_HOST = "roco-toolbox.pages.dev";

    /**
     * 网页从这个地址取分享进来的抓包。这个域名是假的、永远不会真的联网 ——
     * 壳在 shouldInterceptRequest 里把它拦下来直接返回字节。
     *
     * 用一个不同于站点的来源，是为了绕开网页自己的 Service Worker（它只接管同源请求）；
     * 响应也必须带上跨域头，否则网页那边取不到。
     * 必须与网页侧 src/share/nativeShare.ts 的 SHELL_CAPTURE_URL 保持一致。
     */
    private static final String CAPTURE_URL = "https://roco-share.invalid/capture.pcap";

    /** 网页底色，让状态栏那一条和页面看起来是一体的，同时避免加载时闪白 */
    private static final int PAGE_BACKGROUND = 0xFFF8FAFC;
    /** 单次分享的数据上限，超过就提示；正常采集数据只有几 MB */
    private static final int MAX_SHARE_BYTES = 32 * 1024 * 1024;

    /** 网页点「导入抓包数据 / 导入备份」时起的文件选择器 */
    private static final int REQUEST_FILE_CHOOSER = 1001;

    private WebView webView;
    private CaptureController collector;
    /** 战斗采集悬浮球（系统级，浮在游戏上方；2026-11-08） */
    private BattleOverlayController battleOverlay;
    /** 应用内更新：启动静默检查 + 网页「检查更新」手动检查（2026-11-08） */
    private UpdateController updater;
    /**
     * 启动后延迟几秒静默检查一次更新。
     * 等首屏渲染完再查，避免更新提示和页面加载抢焦点；无更新 / 失败都不打扰用户。
     */
    private final Runnable silentUpdateCheck = () -> {
        if (updater != null) updater.checkSilently();
    };
    /**
     * 后台实时刷新的心跳（2026-11-08）。
     *
     * 用户切到游戏后，工具箱页面不可见，WebView 会把 setTimeout / setInterval 节流到
     * 每分钟一次甚至暂停，悬浮球就会「有时候一直不刷新」。这里由原生每秒唤醒页面一次
     * （evaluateJavascript 不受页面定时器节流影响），网页侧再按需补一轮解析。
     */
    private final Handler liveTick = new Handler(Looper.getMainLooper());
    private final Runnable liveTickTask = new Runnable() {
        @Override public void run() {
            if (webView != null && !webView.isShown() && CaptureVpnService.STATE.busy()) {
                webView.evaluateJavascript("window.__rocoLiveTick&&window.__rocoLiveTick()", null);
            }
            liveTick.postDelayed(this, 1200);
        }
    };
    private boolean captureBridgeInstalled;
    private String collectedCaptureUrl;
    /** 等文件选择器回结果的回调；WebView 只认一次，回完必须置空 */
    private ValueCallback<Uri[]> filePathCallback;
    /** 分享进来的抓包字节，等网页来取 */
    private byte[] captureBytes;
    private String captureName;
    /** 分享进来的文本（JSON），加载完页面后直接注入 */
    private String textPayload;
    private String textName;
    /** 网页还没加载完时先攒着，加载完成后注入 */
    private boolean pageReady;
    /**
     * 本次分享是否已经交给网页。
     * 页面每次加载完成（含部署新版本后网页自己刷新）都会触发 onPageFinished，
     * 不加这个标记就会把同一份数据反复注入、反复导入一遍。
     */
    private boolean shareInjected;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // 调试构建允许用电脑的 chrome://inspect 看页面，排查真机问题时用得上
            WebView.setWebContentsDebuggingEnabled(true);
        }
        webView = new WebView(this);
        collector = new CaptureController(this, (name, url) -> {
            captureBytes = null; captureName = name; collectedCaptureUrl = url;
            textPayload = null; textName = null; shareInjected = false;
            injectPendingShare();
        });
        battleOverlay = new BattleOverlayController(this);
        updater = new UpdateController(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        webView.setBackgroundColor(PAGE_BACKGROUND);
        // 网页「导出全部数据」改为分享：壳从这里把备份文本拿出去调起系统分享面板
        webView.addJavascriptInterface(new ShareBridge(), "RocoShare");
        // 网页「设置 / 关于」页的「检查更新」入口（网页侧调用 window.RocoUpdate.check()）
        webView.addJavascriptInterface(new UpdateBridge(), "RocoUpdate");
        installCaptureWebMessageBridge();
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                pageReady = false;
                collector.invalidatePage();
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                collector.setPage(url);
                pageReady = true;
                injectPendingShare();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse localCapture = collector.intercept(request.getUrl());
                if (localCapture != null) return localCapture;
                // 网页来取分享进来的抓包：直接把字节给它，不让它真的去联网
                if (captureBytes != null && CAPTURE_URL.equals(request.getUrl().toString())) {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    headers.put("Cache-Control", "no-store");
                    return new WebResourceResponse(
                        "application/octet-stream", null, 200, "OK", headers,
                        new ByteArrayInputStream(captureBytes));
                }
                return null;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // 只处理主文档：子资源失败（包括取抓包）不该把整页顶掉
                if (request.isForMainFrame()) {
                    showMessage("打不开网页，请检查手机网络后重试。");
                }
            }

            /** 页面导航：本站继续在 WebView 里走，其余交系统浏览器（见 openExternalIfNeeded）。 */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternalIfNeeded(request.getUrl());
            }

            /** API 23 及以下只有这个旧签名（minSdk 23）。 */
            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternalIfNeeded(Uri.parse(url));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                // 上一次的选择器还没回结果就又点了一次：先把上一次作废。
                // 不回的话 WebView 会一直等着它，之后再也弹不出来。
                cancelPendingFileChooser();

                filePathCallback = callback;
                try {
                    // 不直接用 params.createIntent()：网页的 accept 里混了 MIME 与扩展名
                    // （application/json、.pcap），部分机型的选择器会把整批文件都过滤掉，
                    // 表现成「一个文件都选不了」。放宽成任意文件最稳——
                    // 页面侧本来就会按魔数 / 内容自己分流并给出可读报错。
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                    startActivityForResult(Intent.createChooser(intent, "选择文件"), REQUEST_FILE_CHOOSER);
                    return true;
                } catch (Exception error) {
                    cancelPendingFileChooser();
                    showMessage("打不开文件选择器：" + error.getMessage());
                    return false;
                }
            }

            /**
             * 网页里的 window.confirm()。不实现这个回调时它会恒返回 false，
             * 于是「重置导入数据」在确认处直接早退——看起来就像按钮坏了。
             */
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle(getString(R.string.app_name))
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle(getString(R.string.app_name))
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // 这个网页不需要摄像头 / 麦克风；显式拒绝，别让默认行为以后变化时打开权限
                request.deny();
            }

            /**
             * {@code target="_blank"} 的链接不会走 shouldOverrideUrlLoading，而是来这里要一个新窗口。
             * 我们不开新窗口：用 hit-test 取到地址后交系统浏览器，返回 false 表示不创建。
             */
            @Override
            public boolean onCreateWindow(
                WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView.HitTestResult hit = view.getHitTestResult();
                String url = hit == null ? null : hit.getExtra();
                if (url != null) {
                    openExternalIfNeeded(Uri.parse(url));
                }
                return false;
            }
        });
        setContentView(webView);
        handleShareIntent(getIntent());
        webView.loadUrl(SITE_URL);
        liveTick.postDelayed(liveTickTask, 1500);
        // 首屏加载完再看有没有新版，避免更新弹窗和页面加载抢焦点
        liveTick.postDelayed(silentUpdateCheck, 3000);
    }

    private void installCaptureWebMessageBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        WebViewCompat.addWebMessageListener(webView, "RocoCaptureBridge",
            Collections.singleton("https://" + SITE_HOST), (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (!CaptureBridgePolicy.allows(sourceOrigin.toString(), isMainFrame)) return;
                String requestId = "";
                try {
                    JSONObject request = new JSONObject(message.getData());
                    requestId = request.getString("requestId");
                    String action = request.optString("action");
                    String id = request.has("id") ? request.optString("id", null) : null;
                    String result;
                    if ("getState".equals(action)) result = collector.getState();
                    else if ("inspectCapture".equals(action)) result = collector.inspectCapture();
                    else if ("startCapture".equals(action)) result = collector.startCapture(request.optString("mode", "full"));
                    else if ("stopCapture".equals(action)) result = collector.stopCapture();
                    else if ("openGame".equals(action)) result = collector.openGame();
                    else if ("importCapture".equals(action)) result = collector.importCapture(id);
                    else if ("uploadCapture".equals(action)) result = collector.uploadCapture(id);
                    else if ("shareCapture".equals(action)) result = collector.shareCapture(id);
                    else if ("deleteCapture".equals(action)) result = collector.deleteCapture(id);
                    else if ("notifyRareAlert".equals(action)) result = collector.notifyRareAlert(
                        request.optString("title"), request.optString("body"));
                    // 系统悬浮窗：球浮在游戏上方，网页只推状态（2026-11-08）
                    else if ("updateBattleOverlay".equals(action)) result = battleOverlay.update(readOverlay(request));
                    // 附近面板：地图 + 紧凑列表 + 可选的顶部命中区（2026-11-08）
                    else if ("updateNearbyOverlay".equals(action)) result = battleOverlay.updateNearby(readJson(request, "nearby"));
                    else if ("requestOverlayPermission".equals(action)) result = battleOverlay.requestPermission();
                    else if ("canDrawOverlay".equals(action)) result = battleOverlay.canDraw() ? "true" : "false";
                    else throw new IllegalArgumentException("未知的采集操作");
                    reply.postMessage(new JSONObject().put("requestId", requestId).put("result", result).toString());
                } catch (Exception error) {
                    try { reply.postMessage(new JSONObject().put("requestId", requestId).put("error", CaptureVpnService.friendly(error)).toString()); }
                    catch (Exception ignored) { }
                }
            });
        captureBridgeInstalled = true;
        try (InputStream input = getAssets().open("capture-bridge.js")) {
            ByteArrayOutputStream text = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int length;
            while ((length = input.read(buffer)) != -1) text.write(buffer, 0, length);
            WebViewCompat.addDocumentStartJavaScript(webView, text.toString("UTF-8"), Collections.singleton("https://" + SITE_HOST));
        } catch (Exception error) { showMessage("无法加载本机采集入口：" + CaptureVpnService.friendly(error)); }
    }

    /**
     * 悬浮窗载荷既可能是 JSON 对象（新网页），也可能是 JSON 字符串（旧网页把 payload
     * 二次 stringify 了）。两种都收下，避免网页缓存旧版时球彻底不显示。
     */
    private static JSONObject readOverlay(JSONObject request) {
        return readJson(request, "overlay");
    }

    /** 悬浮窗载荷既可能是对象，也可能是二次 stringify 的字符串，两种都收。 */
    private static JSONObject readJson(JSONObject request, String key) {
        JSONObject object = request.optJSONObject(key);
        if (object != null) return object;
        String raw = request.optString(key, "");
        if (raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception ignored) {
            return null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 用户可能刚去系统设置里授予了悬浮窗权限：回来时把还在采集的球重新画上
        if (battleOverlay != null) battleOverlay.onResume();
        // 用户可能刚从「安装未知应用」设置页回来：权限拿到就把已下载的包接着装上
        if (updater != null) updater.onResume();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (collector != null && collector.activityResult(requestCode, resultCode)) return;
        if (requestCode != REQUEST_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        // 不管用户选没选，都必须回一次结果（取消时回 null），
        // 否则那个 <input type="file"> 会一直处于等待状态，之后再点都没反应
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
        }
    }

    @Override
    protected void onDestroy() {
        liveTick.removeCallbacks(liveTickTask);
        liveTick.removeCallbacks(silentUpdateCheck);
        cancelPendingFileChooser();
        if (collector != null) collector.destroy();
        if (updater != null) { updater.destroy(); updater = null; }
        // 悬浮窗必须在这里摘掉：Activity 没了还留着窗口会泄漏
        if (battleOverlay != null) { battleOverlay.destroy(); battleOverlay = null; }
        if (webView != null) {
            // WebView 持有 Activity 与 JS 引擎线程，不按标准序列销毁会一直泄漏。
            // 先摘掉注入的 JS 接口，再断开页面、销毁。
            webView.removeJavascriptInterface("RocoShare");
            webView.removeJavascriptInterface("RocoUpdate");
            if (captureBridgeInstalled) WebViewCompat.removeWebMessageListener(webView, "RocoCaptureBridge");
            webView.loadUrl("about:blank");
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (collector != null && collector.permissionsResult(requestCode)) return;
        super.onRequestPermissionsResult(requestCode, permissions, results);
    }

    /** 把等待中的文件选择回调作废（回 null），避免 WebView 一直等它。 */
    private void cancelPendingFileChooser() {
        if (filePathCallback == null) return;
        filePathCallback.onReceiveValue(null);
        filePathCallback = null;
    }

    /**
     * 本站（及其预览子域）的链接继续在 WebView 里走；其余一律交系统浏览器打开。
     *
     * @return true 表示已经接管，WebView 不要再导航到该地址。
     */
    private boolean openExternalIfNeeded(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        boolean internal =
            "https".equals(scheme)
                && host != null
                && (host.equals(SITE_HOST) || host.endsWith("." + SITE_HOST));
        if (internal || "about".equals(scheme)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            showMessage("打不开这个链接：" + error.getMessage());
        }
        return true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    /**
     * 接住分享或「用其他应用打开」进来的内容：
     * - SEND（系统分享面板 / 采集器的「分享」）：文件在 EXTRA_STREAM 上，没有文件时看 EXTRA_TEXT；
     * - VIEW（微信 / QQ 点开文件 →「用其他应用打开」）：文件在 intent.data 上。
     * 采集器的「分享文件」给的是抓包（二进制），必须按字节读 ——
     * 当文本读会把文件损坏。其余情况（JSON 等）按 UTF-8 文本处理。
     */
    @SuppressWarnings("deprecation")
    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        boolean fromSend = Intent.ACTION_SEND.equals(action);
        boolean fromView = Intent.ACTION_VIEW.equals(action);
        if (!fromSend && !fromView) return;

        Uri stream = fromSend
            ? intent.getParcelableExtra(Intent.EXTRA_STREAM)
            : intent.getData();
        if (stream != null) {
            byte[] bytes;
            try {
                bytes = readBytes(stream);
            } catch (Exception error) {
                showMessage("无法读取分享的文件：" + error.getMessage());
                return;
            }
            String name = displayName(stream);
            collectedCaptureUrl = null;
            if (looksLikeCapture(bytes)) {
                captureBytes = bytes;
                captureName = name;
                textPayload = null;
                textName = null;
            } else {
                textPayload = decodeText(bytes);
                textName = name;
                captureBytes = null;
                captureName = null;
            }
        } else if (fromSend) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null || text.trim().isEmpty()) return;
            textPayload = text;
            textName = null;
            captureBytes = null;
            collectedCaptureUrl = null;
            captureName = null;
        } else {
            // VIEW 但没有文件（理论上不会有）：没东西可导入，正常打开网页就行
            return;
        }
        shareInjected = false;
        injectPendingShare();
    }

    /** 把分享到的内容交给网页；网页侧收到后会走它自己的解析与导入流程。 */
    private void injectPendingShare() {
        if (!pageReady || shareInjected) return;
        String script;
        if (captureBytes != null || collectedCaptureUrl != null) {
            String name = (captureName == null || captureName.isEmpty()) ? "capture.pcap" : captureName;
            script = "(function(){window.__rocoPendingShare={kind:'capture',name:" + JSONObject.quote(name)
                + ",url:" + JSONObject.quote(collectedCaptureUrl == null ? CAPTURE_URL : collectedCaptureUrl)
                + "};window.dispatchEvent(new Event('roco-share'));})()";
        } else if (textPayload != null) {
            script = "(function(){window.__rocoPendingShare={kind:'text',name:"
                + JSONObject.quote(textName == null ? "" : textName)
                + ",text:" + JSONObject.quote(textPayload)
                + "};window.dispatchEvent(new Event('roco-share'));})()";
        } else {
            return;
        }
        // 只交一次：清掉文本内容，抓包字节留着给 shouldInterceptRequest 取
        shareInjected = true;
        textPayload = null;
        textName = null;
        webView.evaluateJavascript(script, null);
    }

    /** 按文件头判断是不是抓包文件：经典 PCAP 与 PCAPNG 的几种魔数。 */
    private static boolean looksLikeCapture(byte[] bytes) {
        if (bytes.length < 4) return false;
        long magic = ((long) (bytes[0] & 0xFF) << 24)
            | ((long) (bytes[1] & 0xFF) << 16)
            | ((long) (bytes[2] & 0xFF) << 8)
            | (bytes[3] & 0xFF);
        return magic == 0xa1b2c3d4L   // 经典 PCAP，大端
            || magic == 0xd4c3b2a1L   // 经典 PCAP，小端（采集器默认输出的就是这种）
            || magic == 0xa1b23c4dL   // 经典 PCAP，纳秒，大端
            || magic == 0x4d3cb2a1L   // 经典 PCAP，纳秒，小端
            || magic == 0x0a0d0d0aL;  // PCAPNG（网页那边会给出可读的提示）
    }

    private static String decodeText(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private byte[] readBytes(Uri uri) throws Exception {
        ContentResolver resolver = getContentResolver();
        InputStream input = resolver.openInputStream(uri);
        if (input == null) throw new IllegalStateException("分享的文件打不开");
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[65536];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_SHARE_BYTES) throw new IllegalStateException("文件超过 32 MB");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } finally {
            input.close();
        }
    }

    /** 取分享文件的原名（只用于界面提示，取不到不影响导入）。 */
    private String displayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(
                uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // 拿不到名字就用默认名
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    /** 用一条带重试链接的提示页取代当前页面。 */
    private void showMessage(String message) {
        pageReady = false;
        String html = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>"
            + "<body style=\"margin:0;padding:24px;font-family:sans-serif;line-height:1.8;color:#334155\">"
            + "<h1 style=\"font-size:18px\">洛克工具箱</h1>"
            + "<p>" + escapeHtml(message) + "</p>"
            + "<p><a href=\"" + SITE_URL + "\">点这里重试</a></p>"
            + "</body></html>";
        webView.loadDataWithBaseURL(SITE_URL, html, "text/html", "utf-8", null);
    }

    private static String escapeHtml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /**
     * 网页「设置 / 关于」页的「检查更新」（2026-11-08）。
     *
     * 网页侧调用 `window.RocoUpdate.check()` 即可；壳负责请求远端清单、弹提示、
     * 下载 APK 并调起系统安装器。`version()` 供页面显示当前客户端版本。
     */
    private class UpdateBridge {
        @JavascriptInterface
        public void check() {
            runOnUiThread(() -> {
                if (updater != null) updater.checkManually();
            });
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")";
        }
    }

    /** 网页「导出全部数据」→ 分享（1.1.4）：写缓存文件再经 FileProvider 交给系统分享面板。 */
    private class ShareBridge {
        /** 在当前线程（后台线程）准备好 Intent 后，切主线程弹系统分享面板。 */
        private void showChooser(Intent shareIntent, String fallbackText, Exception buildError) {
            runOnUiThread(() -> {
                try {
                    startActivity(
                        Intent.createChooser(shareIntent, "分享数据备份")
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception chooserError) {
                    // FileProvider 异常降级：直接用文本分享（小备份够用，大备份可能被截断）
                    try {
                        Intent textIntent = new Intent(Intent.ACTION_SEND);
                        textIntent.setType("text/plain");
                        textIntent.putExtra(Intent.EXTRA_TEXT, fallbackText);
                        startActivity(
                            Intent.createChooser(textIntent, "分享数据备份")
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception fallbackError) {
                        showMessage("分享失败：" +
                            (buildError != null ? buildError.getMessage() : chooserError.getMessage()));
                    }
                }
            });
        }

        /** 网页调用：text 是完整备份 JSON，fileName 如「洛克工具箱备份-2026-10-04.json」。 */
        @JavascriptInterface
        public void shareBackup(String text, String fileName) {
            if (text == null || text.length() == 0) return;
            Exception buildError = null;
            Intent shareIntent;
            try {
                // 文件名可能带路径分隔符，清洗成纯文件名
                String safeName = fileName == null || fileName.isEmpty()
                    ? "roco-backup.json"
                    : fileName.replaceAll("[/\\\\]", "_");
                File dir = new File(getCacheDir(), "share");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IllegalStateException("缓存目录创建失败");
                }
                File file = new File(dir, safeName);
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write(text.getBytes(StandardCharsets.UTF_8));
                }

                Uri uri = FileProvider.getUriForFile(
                    MainActivity.this, "com.localdatatool.toolbox.fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                shareIntent = intent;
            } catch (Exception error) {
                buildError = error;
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_TEXT, text);
                shareIntent = intent;
            }
            showChooser(shareIntent, text, buildError);
        }
    }
}
