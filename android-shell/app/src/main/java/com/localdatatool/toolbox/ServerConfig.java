package com.localdatatool.toolbox;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;

/**
 * 服务器地址（2026-11-09）：1.3 内测包默认进测试站，内测时可连点版本号在测试站 / 正式站之间互切。
 *
 * <p>这个入口藏在「我的」页连点版本号后面，只给自己用：地址填错等于把采集数据交给那个站点，
 * 所以保存前必须真的探活（{@code /api/health} 的正文里要有 {@code "ok":true}），
 * 探不通就不写进去，避免把客户端指成白屏。</p>
 *
 * <p>只看 HTTP 200 不算数：主站对不存在的路径会回退成网页（200 + HTML），
 * 更新清单已经被这种「200」坑过一次。</p>
 */
public final class ServerConfig {

    /** 1.3 内测包默认地址：测试站（装上打开就是测试服）。 */
    public static final String DEFAULT_BASE_URL = "https://test.roco-toolbox.pages.dev";

    /** 正式站地址：连点版本号时在这两个地址之间互切。 */
    public static final String PRODUCTION_BASE_URL = "https://roco-toolbox.pages.dev";

    private static final String PREFS = "roco_server";
    private static final String KEY_BASE_URL = "baseUrl";
    private static final int PROBE_TIMEOUT_MS = 5000;
    private static final int PROBE_BODY_LIMIT = 4096;

    /** 保存 / 恢复默认的结果，桥接口转成 JSON 交给网页显示。 */
    public static final class Result {
        public final boolean ok;
        public final String message;
        public final String baseUrl;

        private Result(boolean ok, String message, String baseUrl) {
            this.ok = ok;
            this.message = message;
            this.baseUrl = baseUrl;
        }

        static Result success(String baseUrl) {
            return new Result(true, "已切换到 " + baseUrl + "，正在重新加载。", baseUrl);
        }

        static Result failure(String message) {
            return new Result(false, message, "");
        }

        public String toJson() {
            try {
                return new JSONObject()
                    .put("ok", ok)
                    .put("message", message)
                    .put("baseUrl", baseUrl)
                    .toString();
            } catch (Exception error) {
                return "{\"ok\":false,\"message\":\"保存失败\",\"baseUrl\":\"\"}";
            }
        }
    }

    private final SharedPreferences prefs;

    public ServerConfig(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 当前生效地址（不带末尾斜杠）。 */
    public String baseUrl() {
        String saved = prefs.getString(KEY_BASE_URL, "");
        return saved == null || saved.isEmpty() ? DEFAULT_BASE_URL : saved;
    }

    public String origin() {
        return originOf(baseUrl());
    }

    public String host() {
        return hostOf(baseUrl());
    }

    public String defaultUrl() {
        return DEFAULT_BASE_URL;
    }

    /** 正式站地址：网页侧连点版本号时用来算「切到哪一边」。 */
    public String productionUrl() {
        return PRODUCTION_BASE_URL;
    }

    /**
     * 连点版本号的一键互切：正式 ⇄ 默认（测试）。
     *
     * <p>自家两个地址直接写，不探活：手机上冷启动 / VPN 下探活经常超过 5 秒，
     * 一旦超时网页就会弹「服务器地址」面板，看起来像要手输地址。
     * 切错也只是页面打不开，连点一次就能切回来。</p>
     */
    public Result toggle() {
        String target = PRODUCTION_BASE_URL.equals(baseUrl()) ? DEFAULT_BASE_URL : PRODUCTION_BASE_URL;
        prefs.edit().putString(KEY_BASE_URL, target).apply();
        return Result.success(target);
    }

    /** 自家两个站点（测试 / 正式）：可信地址，保存时不再探活。 */
    public static boolean isFirstParty(String baseUrl) {
        return DEFAULT_BASE_URL.equals(baseUrl) || PRODUCTION_BASE_URL.equals(baseUrl);
    }

    /**
     * 探活通过才保存。失败时返回带原因的文案，网页直接显示，不做二次包装。
     */
    public Result apply(String raw) {
        String base;
        try {
            base = normalize(raw);
        } catch (IllegalArgumentException error) {
            return Result.failure(error.getMessage());
        }
        // 自家两个站不需要探活：断网时也要能切回去（页面自己能显示失败原因）
        if (isFirstParty(base)) {
            prefs.edit().putString(KEY_BASE_URL, base).apply();
            return Result.success(base);
        }
        try {
            String body = read(base + "/api/health");
            if (!healthy(body)) {
                return Result.failure("探活失败：" + base + "/api/health 返回的不是 {\"ok\":true}"
                    + "（收到：" + preview(body) + "），地址没有保存。");
            }
        } catch (Exception error) {
            return Result.failure("探活失败：" + base + "/api/health 打不开（" + describe(error)
                + "），地址没有保存。");
        }
        prefs.edit().putString(KEY_BASE_URL, base).apply();
        return Result.success(base);
    }

    /**
     * 恢复默认地址（1.3 内测包是测试站）。这里不做探活：默认地址是已知可用的，
     * 用户点了就必须能回去，不能因为当下断网把人卡在自定义地址上。
     */
    public Result reset() {
        prefs.edit().remove(KEY_BASE_URL).apply();
        return Result.success(DEFAULT_BASE_URL);
    }

    /** 只接受 https，去掉末尾多余斜杠；不合法时抛出带中文原因的异常。 */
    public static String normalize(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("地址不能为空");
        String stripped = value;
        while (stripped.endsWith("/")) stripped = stripped.substring(0, stripped.length() - 1);
        URI uri;
        try {
            uri = new URI(stripped);
        } catch (Exception error) {
            throw new IllegalArgumentException("地址格式不正确（填写的是 " + value + "）");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("只支持 https 地址（填写的是 " + value + "）");
        }
        if (uri.getHost() == null || uri.getHost().isEmpty()) {
            throw new IllegalArgumentException("地址里没有主机名（填写的是 " + value + "）");
        }
        return stripped;
    }

    /** {@code https://host[:port]}，用于 WebView 的桥来源与页面可信判定。 */
    public static String originOf(String baseUrl) {
        try {
            URI uri = new URI(baseUrl == null ? "" : baseUrl);
            String host = uri.getHost();
            if (host == null) return DEFAULT_BASE_URL;
            String scheme = uri.getScheme() == null ? "https" : uri.getScheme().toLowerCase();
            int port = uri.getPort();
            boolean defaultPort = port == -1 || (port == 443 && "https".equals(scheme));
            return scheme + "://" + host + (defaultPort ? "" : ":" + port);
        } catch (Exception error) {
            return DEFAULT_BASE_URL;
        }
    }

    public static String hostOf(String baseUrl) {
        try {
            String host = new URI(baseUrl == null ? "" : baseUrl).getHost();
            return host == null || host.isEmpty() ? hostOf(DEFAULT_BASE_URL) : host;
        } catch (Exception error) {
            return hostOf(DEFAULT_BASE_URL);
        }
    }

    /** 健康检查口径：正文是 JSON 且 {@code ok === true}。HTML / 空正文都不算通。 */
    public static boolean healthy(String body) {
        if (body == null || body.trim().isEmpty()) return false;
        try {
            return new JSONObject(body).optBoolean("ok", false);
        } catch (Exception error) {
            return false;
        }
    }

    private static String read(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(PROBE_TIMEOUT_MS);
            connection.setReadTimeout(PROBE_TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept", "application/json");
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[1024];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    output.write(buffer, 0, length);
                    if (output.size() >= PROBE_BODY_LIMIT) break;
                }
                return new String(output.toByteArray(), "UTF-8");
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String preview(String body) {
        String text = body == null ? "" : body.replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) return "空正文";
        return text.length() > 100 ? text.substring(0, 100) + "…" : text;
    }

    private static String describe(Exception error) {
        String message = error == null ? null : error.getMessage();
        return message == null || message.trim().isEmpty() ? "网络不可用" : message;
    }
}
