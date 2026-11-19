package com.localdatatool.toolbox;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 身份救援（2026-11-12，1.5.4）：把测试站 origin 里仍然有效的登录态搬进正式站 origin。
 *
 * <p>为什么需要：1.3.8 ~ 1.5.2 的公开包默认打开测试站，用户在这段时间里开的号、
 * 建的组，令牌和 accountId 都存在测试站 origin 的 localStorage。1.5.3 把默认站改回
 * 正式站后，这些身份在正式站里「看不见」，但服务端 D1 里的账号和令牌仍然有效。</p>
 *
 * <p>为什么不用 deviceId 自动找回：deviceId 由网页生成（crypto.randomUUID），
 * 只存在 localStorage 的 {@code roco.deviceId}，按 origin 隔离；换站后就是新 id，
 * 服务端虽然有 devices 映射，也匹配不回旧账号。</p>
 *
 * <p>边界：只在「正式包 + 当前打开正式站 + 正式站没有身份 + 本次安装没救援过」时执行；
 * 只把已有令牌搬过来，不改变任何人打开的站点；测试站也没有身份就静默跳过；
 * 超时 2.5 秒放弃且不落标记，下次启动还能重试；任何异常都不能阻塞启动。</p>
 */
final class IdentityRescue {

    private static final String PREFS = "roco_rescue";
    private static final String KEY_DONE = "done";
    private static final String PRODUCTION = "https://roco-toolbox.pages.dev";
    private static final String TEST = "https://test.roco-toolbox.pages.dev";
    private static final long TIMEOUT_MS = 2500;

    /** 探测页：任意同源文档都行，用清单文件避免把整个网页再跑一遍。 */
    private static final String PROBE_PATH = "/android/version.json";

    interface Callback {
        void onFinished();
    }

    static void runIfNeeded(Activity activity, ServerConfig server, Callback callback) {
        if (!"production".equals(BuildConfig.CHANNEL) || !PRODUCTION.equals(server.baseUrl())) {
            callback.onFinished();
            return;
        }
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
        if (prefs.getBoolean(KEY_DONE, false)) {
            callback.onFinished();
            return;
        }
        new IdentityRescue(activity, prefs, callback).start();
    }

    private final Activity activity;
    private final SharedPreferences prefs;
    private final Callback callback;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private WebView webView;
    private boolean finished;
    private boolean awaitingPage;
    private int step;

    private IdentityRescue(Activity activity, SharedPreferences prefs, Callback callback) {
        this.activity = activity;
        this.prefs = prefs;
        this.callback = callback;
    }

    private void start() {
        try {
            webView = new WebView(activity);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            webView.setAlpha(0f);
            webView.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    onPageReady();
                }
            });
            activity.addContentView(webView, new FrameLayout.LayoutParams(1, 1));
            handler.postDelayed(this::onTimeout, TIMEOUT_MS);
            load(PRODUCTION + PROBE_PATH, 1);
        } catch (Exception error) {
            finish();
        }
    }

    private void load(String url, int nextStep) {
        if (finished) return;
        step = nextStep;
        awaitingPage = true;
        try {
            webView.loadUrl(url);
        } catch (Exception error) {
            finish();
        }
    }

    private void onPageReady() {
        if (finished || !awaitingPage) return;
        awaitingPage = false;
        if (step == 1) {
            evaluate("localStorage.getItem('roco.deviceToken')||''", value -> {
                if (finished) return;
                if (!unquote(value).isEmpty()) {
                    // 正式站本来就有身份：绝不覆盖
                    markDone();
                    finish();
                    return;
                }
                load(TEST + PROBE_PATH, 2);
            });
        } else if (step == 2) {
            evaluate("JSON.stringify({t:localStorage.getItem('roco.deviceToken')||'',"
                + "a:localStorage.getItem('roco.accountId')||'',"
                + "v:localStorage.getItem('roco.syncVersion')||''})", value -> {
                if (finished) return;
                JSONObject identity = parseIdentity(value);
                if (identity == null || identity.optString("t").isEmpty()) {
                    // 测试站也没有身份：静默跳过
                    markDone();
                    finish();
                    return;
                }
                load(PRODUCTION + PROBE_PATH, 3);
                pending = identity;
            });
        } else if (step == 3) {
            writeIdentity(pending == null ? new JSONObject() : pending);
        }
    }

    private JSONObject pending;

    private void writeIdentity(JSONObject identity) {
        String token = identity.optString("t");
        if (token.isEmpty()) {
            finish();
            return;
        }
        StringBuilder js = new StringBuilder();
        js.append("localStorage.setItem('roco.deviceToken',").append(JSONObject.quote(token)).append(");");
        String account = identity.optString("a");
        if (!account.isEmpty()) {
            js.append("localStorage.setItem('roco.accountId',").append(JSONObject.quote(account)).append(");");
        }
        String version = identity.optString("v");
        if (!version.isEmpty()) {
            js.append("localStorage.setItem('roco.syncVersion',").append(JSONObject.quote(version)).append(");");
        }
        js.append("'ok'");
        evaluate(js.toString(), value -> {
            markDone();
            finish();
        });
    }

    private interface ValueCallback {
        void onValue(String raw);
    }

    private void evaluate(String script, ValueCallback callback) {
        try {
            webView.evaluateJavascript(script, value -> {
                if (finished) return;
                try {
                    callback.onValue(value);
                } catch (Exception error) {
                    finish();
                }
            });
        } catch (Exception error) {
            finish();
        }
    }

    private void onTimeout() {
        if (finished) return;
        // 超时不落标记：下次启动还能再试
        finish();
    }

    private void markDone() {
        try {
            prefs.edit().putBoolean(KEY_DONE, true).apply();
        } catch (Exception ignored) {
            // 标记写不进去只影响「下次再试一次」，不影响本次结果
        }
    }

    private void finish() {
        if (finished) return;
        finished = true;
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            try {
                ViewGroup parent = (ViewGroup) webView.getParent();
                if (parent != null) parent.removeView(webView);
                webView.destroy();
            } catch (Exception ignored) {
                // 销毁失败不影响主页面加载
            }
            webView = null;
        }
        callback.onFinished();
    }

    private static JSONObject parseIdentity(String raw) {
        try {
            return new JSONObject(unquote(raw));
        } catch (Exception error) {
            return null;
        }
    }

    /** evaluateJavascript 回传的是 JSON 字面量：字符串带引号，null 是 null。 */
    private static String unquote(String raw) {
        if (raw == null || raw.isEmpty() || "null".equals(raw)) return "";
        try {
            return new JSONArray("[" + raw + "]").getString(0);
        } catch (Exception error) {
            return "";
        }
    }
}
