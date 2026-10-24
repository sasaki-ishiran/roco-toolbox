package com.localdatatool.toolbox.capture;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * 蛋神助手 Android 采集器 1.2.6 的 V3 原包上传协议。
 *
 * 上传端点是蛋神助手自己的云端采集服务，不是工具箱的 Cloudflare 后端。服务端会校验
 * 应用包名、版本号和发布令牌，所以这里按原版公开客户端身份发送请求头；令牌由构建时
 * 从本机 local.properties 注入，不进版本库。
 *
 * 只在后台线程调用；流式上传原始 PCAP，不经过 multipart，也不做截断。
 */
final class CaptureUploader {
    static final long MAX_UPLOAD_BYTES = 5L * 1024L * 1024L;
    static final String API_BASE = "https://capture.danking.cn:18443/capture-api";
    static final String UPSTREAM_APP = "cn.danking.collector";
    static final String UPSTREAM_VERSION = "1.2.6";
    static final int UPSTREAM_VERSION_CODE = 46;
    private static final int MAX_RESPONSE_BYTES = 256 * 1024;
    private static final long POLL_DEADLINE_NANOS = 180_000_000_000L;

    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }
    interface Sleeper { void sleep(long millis) throws InterruptedException; }
    interface Listener {
        void progress(long bytesSent, long totalBytes);
        void status(Result result);
    }

    static final class Result {
        final String state;
        final String captureId;
        final String gameId;
        final String message;
        final boolean deduplicated;

        Result(String state, String captureId, String gameId, String message, boolean deduplicated) {
            this.state = state;
            this.captureId = captureId;
            this.gameId = gameId;
            this.message = message;
            this.deduplicated = deduplicated;
        }

        boolean persisted() { return "persisted".equals(state); }
    }

    private final String apiBase;
    private final String token;
    private final ConnectionFactory connections;
    private final Sleeper sleeper;
    private final int maxPolls;
    private final long pollIntervalMillis;

    CaptureUploader(String token) {
        this(API_BASE, token, url -> (HttpURLConnection) url.openConnection(),
            Thread::sleep, 90, 2000L);
    }

    CaptureUploader(String apiBase, String token, ConnectionFactory connections,
                    Sleeper sleeper, int maxPolls, long pollIntervalMillis) {
        this.apiBase = apiBase == null ? "" : apiBase.trim();
        this.token = token == null ? "" : token.trim();
        this.connections = connections;
        this.sleeper = sleeper;
        this.maxPolls = Math.max(0, maxPolls);
        this.pollIntervalMillis = Math.max(0L, pollIntervalMillis);
    }

    Result upload(File file, Listener listener) throws IOException {
        validateConfiguration();
        checkInterrupted();
        if (file == null || !file.isFile()) throw new IOException("本地抓包文件不存在");
        long length = file.length();
        long modified = file.lastModified();
        if (length <= 24L) throw new IOException("抓包文件尚无可上传的数据，请完成游戏登录后重试");
        if (length > MAX_UPLOAD_BYTES)
            throw new IOException("蛋神助手云端单文件上限为 5 MiB，完整抓包已保留；请重新开始一次较短的完整登录采集");
        if (modified <= 0L) throw new IOException("无法读取采集时间，请重新保存该文件");
        validatePcapMagic(file);
        notifyStatus(listener, new Result("uploading", "", "", "正在校验并上传原始抓包", false));
        if (listener != null) listener.progress(0L, length);
        String sha256 = sha256(file);
        requireUnchanged(file, length, modified);

        JSONObject payload;
        HttpURLConnection connection = connection("/v3/captures/upload", "POST");
        try {
            connection.setRequestProperty("Content-Type", "application/octet-stream");
            connection.setRequestProperty("X-Capture-Time", captureTime(modified));
            connection.setRequestProperty("X-SHA256", sha256);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(length);
            try (InputStream input = new BufferedInputStream(new FileInputStream(file));
                 OutputStream output = new BufferedOutputStream(connection.getOutputStream(), 65536)) {
                byte[] buffer = new byte[65536];
                long sent = 0L;
                while (sent < length) {
                    checkInterrupted();
                    int count = input.read(buffer, 0, (int) Math.min(buffer.length, length - sent));
                    if (count < 0) throw new IOException("抓包文件在上传过程中发生变化，请停止采集后重试");
                    output.write(buffer, 0, count);
                    sent += count;
                    if (listener != null) listener.progress(sent, length);
                }
                output.flush();
                requireUnchanged(file, length, modified);
            }
            payload = response(connection, 200, 202);
        } finally {
            connection.disconnect();
        }
        String captureId = payload.optString("captureId", "").trim();
        if (!validCaptureId(captureId)) throw new IOException("云端未返回有效任务编号，本地抓包已保留");
        Result initial = taskResult(payload, captureId);
        notifyStatus(listener, initial);
        return poll(initial, listener, false);
    }

    Result resume(String captureId, Listener listener) throws IOException {
        if (!validCaptureId(captureId)) throw new IOException("云端抓包任务编号无效");
        Result initial = new Result("pending", captureId, "", "正在查询已上传任务，原文件不会重复上传", false);
        try {
            validateConfiguration();
            checkInterrupted();
        } catch (IOException error) {
            Result pending = pending(initial, error.getMessage());
            notifyStatus(listener, pending);
            return pending;
        }
        return poll(initial, listener, true);
    }

    private Result poll(Result initial, Listener listener, boolean queryImmediately) {
        Result current = initial;
        long started = System.nanoTime();
        for (int attempt = 0; attempt < maxPolls; attempt++) {
            if (current.persisted() || "failed".equals(current.state)) return current;
            if (System.nanoTime() - started >= POLL_DEADLINE_NANOS) break;
            try {
                if (!queryImmediately || attempt > 0) sleeper.sleep(pollIntervalMillis);
                checkInterrupted();
                HttpURLConnection connection = connection("/v3/captures/" + current.captureId, "GET");
                JSONObject payload;
                try { payload = response(connection, 200); }
                finally { connection.disconnect(); }
                String returnedId = payload.optString("captureId", "").trim();
                if (!current.captureId.equalsIgnoreCase(returnedId))
                    throw new IOException("云端返回的任务编号不一致，已保留原任务供稍后查询");
                current = taskResult(payload, current.captureId);
                notifyStatus(listener, current);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                Result pending = pending(current, "查询已暂停");
                notifyStatus(listener, pending);
                return pending;
            } catch (IOException error) {
                Result pending = pending(current, error.getMessage());
                notifyStatus(listener, pending);
                return pending;
            }
        }
        if (current.persisted() || "failed".equals(current.state)) return current;
        Result pending = pending(current, "云端仍在处理");
        notifyStatus(listener, pending);
        return pending;
    }

    private static Result taskResult(JSONObject payload, String captureId) {
        String state = payload.optString("status", "").trim();
        String gameId = payload.optString("gameId", "").trim();
        if (!gameId.matches("\\d{5,12}")) gameId = "";
        boolean deduplicated = payload.optBoolean("deduplicated", false);
        if ("failed".equals(state))
            return new Result("failed", captureId, gameId,
                message(payload, "云端解析失败，请保留文件并重新采集完整登录过程"), deduplicated);
        if ("persisted".equals(state)) {
            if (gameId.isEmpty())
                return new Result("pending", captureId, "", "云端未返回有效游戏 UID，正在继续确认入库结果", deduplicated);
            return new Result("persisted", captureId, gameId, "角色数据已完整保存到云端", deduplicated);
        }
        if (payload.has("ok") && !payload.optBoolean("ok", false))
            return new Result("failed", captureId, gameId, message(payload, "云端未接受该抓包任务"), deduplicated);
        switch (state) {
            case "receiving": return new Result(state, captureId, gameId, "云端正在接收抓包", deduplicated);
            case "decoding": return new Result(state, captureId, gameId, "云端正在校验并保存数据", deduplicated);
            case "persisting": return new Result(state, captureId, gameId, "云端正在保存角色数据", deduplicated);
            case "queued": return new Result(state, captureId, gameId, "数据已上传，正在等待云端保存", deduplicated);
            default: return new Result("pending", captureId, gameId, "抓包已上传，正在确认云端入库结果", deduplicated);
        }
    }

    private static Result pending(Result previous, String detail) {
        return new Result("pending", previous.captureId, previous.gameId,
            concise(detail, "暂时无法查询云端状态") + "；任务编号和本地文件已保留，可继续查询，无需重复上传",
            previous.deduplicated);
    }

    private static void notifyStatus(Listener listener, Result result) {
        if (listener != null) listener.status(result);
    }

    private void validateConfiguration() throws IOException {
        if (token.isEmpty()) throw new IOException("当前安装包未配置蛋神助手上传凭据，暂时无法上传");
        if (token.indexOf('\r') >= 0 || token.indexOf('\n') >= 0)
            throw new IOException("当前安装包的上传凭据配置无效");
        URL url;
        try { url = new URL(apiBase.replaceAll("/+$", "")); }
        catch (Exception error) { throw new IOException("蛋神助手云端采集地址配置无效"); }
        boolean standardPort = url.getPort() == -1 || url.getPort() == 443;
        boolean officialEndpoint = standardPort && (
            ("danking.cn".equalsIgnoreCase(url.getHost()) && "/capture-api".equals(url.getPath()))
            || ("api.danking.cn".equalsIgnoreCase(url.getHost()) && "/miniapp/api".equals(url.getPath())));
        boolean physicalEndpoint = "capture.danking.cn".equalsIgnoreCase(url.getHost())
            && url.getPort() == 18443 && "/capture-api".equals(url.getPath());
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !(officialEndpoint || physicalEndpoint)
            || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null)
            throw new IOException("蛋神助手云端采集地址必须为官方 HTTPS 接口");
    }

    private HttpURLConnection connection(String path, String method) throws IOException {
        HttpURLConnection connection = connections.open(new URL(apiBase.replaceAll("/+$", "") + path));
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout("POST".equals(method) ? 60_000 : 15_000);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-Collector-App", UPSTREAM_APP);
        connection.setRequestProperty("X-Collector-Version", UPSTREAM_VERSION);
        connection.setRequestProperty("X-Collector-VersionCode", Integer.toString(UPSTREAM_VERSION_CODE));
        connection.setRequestProperty("X-Collector-Release-Token", token);
        return connection;
    }

    private static JSONObject response(HttpURLConnection connection, int... allowed) throws IOException {
        int status = connection.getResponseCode();
        if (status == 426) throw new IOException("蛋神助手要求更新采集器版本（HTTP 426），本机原包仍保留");
        boolean accepted = false;
        for (int code : allowed) if (status == code) accepted = true;
        if (status >= 300 && status < 400)
            throw new IOException("蛋神助手接口返回重定向，已停止请求以保留原始上传目标");
        byte[] bytes = readLimited(accepted ? connection.getInputStream() : connection.getErrorStream());
        JSONObject payload = null;
        try { if (bytes.length > 0) payload = new JSONObject(new String(bytes, StandardCharsets.UTF_8)); }
        catch (JSONException ignored) { /* Error pages are not always JSON. */ }
        if (!accepted) {
            String fallback = status == 413 ? "蛋神助手云端拒绝该文件大小，本机原包已保留"
                : status == 401 || status == 403 ? "蛋神助手云端未通过采集身份验证，本机原包已保留"
                : status == 429 ? "上传或查询过于频繁，请稍后重试"
                : "蛋神助手云端请求失败（HTTP " + status + "）";
            throw new IOException(payload == null ? fallback : message(payload, fallback));
        }
        if (payload == null) throw new IOException("云端返回的任务结果不是有效 JSON");
        return payload;
    }

    private static byte[] readLimited(InputStream stream) throws IOException {
        if (stream == null) return new byte[0];
        try (InputStream input = stream; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                checkInterrupted();
                if (bytes.size() + count > MAX_RESPONSE_BYTES) throw new IOException("云端任务响应超出允许大小");
                bytes.write(buffer, 0, count);
            }
            return bytes.toByteArray();
        }
    }

    private static String message(JSONObject payload, String fallback) {
        String value = payload.optString("message", "").trim();
        if (value.isEmpty()) value = payload.optString("error", "").trim();
        return concise(value, fallback);
    }

    private static String concise(String value, String fallback) {
        String result = value == null ? "" : value.replaceAll("[\\p{Cntrl}]+", " ").trim();
        if (result.isEmpty()) result = fallback;
        return result.length() > 300 ? result.substring(0, 300) : result;
    }

    private static boolean validCaptureId(String value) {
        return value != null && value.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }

    private static void checkInterrupted() throws InterruptedIOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("网络操作已暂停");
    }

    private static void requireUnchanged(File file, long length, long modified) throws IOException {
        if (!file.isFile() || file.length() != length || file.lastModified() != modified)
            throw new IOException("抓包文件仍在变化，请停止实时采集后再上传");
    }

    private static void validatePcapMagic(File file) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            long magic = 0L;
            for (int index = 0; index < 4; index++) magic = (magic << 8) | input.read();
            if (magic != 0xd4c3b2a1L && magic != 0xa1b2c3d4L && magic != 0x4d3cb2a1L
                && magic != 0xa1b23c4dL && magic != 0x0a0d0d0aL)
                throw new IOException("文件不是 PCAP 或 PCAPNG 抓包，请选择完整抓包文件");
        }
    }

    private static String sha256(File file) throws IOException {
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException error) { throw new IOException("无法校验抓包文件", error); }
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) { checkInterrupted(); digest.update(buffer, 0, count); }
        }
        StringBuilder value = new StringBuilder(64);
        for (byte item : digest.digest()) value.append(String.format(Locale.ROOT, "%02x", item & 255));
        return value.toString();
    }

    /** 与 Java 8 的 Instant.toString() 一致；避免在 minSdk 23 的壳里加载 java.time。 */
    private static String captureTime(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        String base = format.format(new Date(millis));
        int fraction = (int) Math.floorMod(millis, 1000L);
        return fraction == 0 ? base + "Z" : base + String.format(Locale.ROOT, ".%03dZ", fraction);
    }
}
