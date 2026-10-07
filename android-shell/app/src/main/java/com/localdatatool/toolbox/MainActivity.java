package com.localdatatool.toolbox;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
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
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        webView.setBackgroundColor(PAGE_BACKGROUND);
        // 网页「导出全部数据」改为分享：壳从这里把备份文本拿出去调起系统分享面板
        webView.addJavascriptInterface(new ShareBridge(), "RocoShare");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                injectPendingShare();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
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
        });
        setContentView(webView);
        handleShareIntent(getIntent());
        webView.loadUrl(SITE_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
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
        cancelPendingFileChooser();
        super.onDestroy();
    }

    /** 把等待中的文件选择回调作废（回 null），避免 WebView 一直等它。 */
    private void cancelPendingFileChooser() {
        if (filePathCallback == null) return;
        filePathCallback.onReceiveValue(null);
        filePathCallback = null;
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
        if (captureBytes != null) {
            String name = (captureName == null || captureName.isEmpty()) ? "capture.pcap" : captureName;
            script = "(function(){window.__rocoPendingShare={kind:'capture',name:" + JSONObject.quote(name)
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
     * 网页「导出全部数据」→ 分享（1.1.4，2026-10-04 用户拍板）。
     *
     * 网页端 `shareToNative()` 调用 `window.RocoShare.shareBackup(text, fileName)`；
     * 壳把文本写进自己的缓存目录，用 FileProvider 生成 content:// 分享出去
     * （QQ / 微信等收到的是一个 JSON 文件，另一台设备「用其他应用打开」即可导入）。
     *
     * 为什么写文件而不是直接塞 EXTRA_TEXT：备份可能超过 1 MB，Binder 传大文本会崩；
     * 文件走 content:// 没有这个限制，且接收方拿到的是可保存的备份文件。
     * FileProvider 拿不到（异常）时降级成 EXTRA_TEXT 文本分享。
     *
     * 2026-10-05 修复（华为平板拉不起分享面板）：
     * - `@JavascriptInterface` 回调跑在 WebView 的 JavaBridge 后台线程，直接 startActivity
     *   在华为 EMUI/HarmonyOS 上会被「后台弹出界面」管控静默拦下（小米较宽松所以正常）。
     * - 现在把弹面板包进 runOnUiThread（回到主线程），并给 chooser 加
     *   FLAG_ACTIVITY_NEW_TASK（以独立 Task 弹窗，国产 ROM 的标准要求）。
     * - 文件写入仍留在当前线程（IO 不占主线程）。
     */
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
