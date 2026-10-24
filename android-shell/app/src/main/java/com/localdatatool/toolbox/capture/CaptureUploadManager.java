package com.localdatatool.toolbox.capture;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 串行上传本机原包到蛋神助手云端。任务编号落盘，重启后继续查询而不是重复上传。
 * 同一时间只允许一个文件上传，避免多个 5 MiB 请求互相拖慢并占用手机流量。
 */
final class CaptureUploadManager {
    private static CaptureUploadManager instance;
    private final CaptureUploadStore store;
    private final String token;
    private final Set<String> running = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "roco-capture-upload");
        thread.setDaemon(true);
        return thread;
    });

    /** 进程内单例：Activity 重建后不能丢掉在途上传，也不能重复 POST 同一文件。 */
    static synchronized CaptureUploadManager get(File directory, String token) {
        if (instance == null) instance = new CaptureUploadManager(directory, token);
        return instance;
    }

    private CaptureUploadManager(File directory, String token) {
        store = new CaptureUploadStore(directory);
        this.token = token == null ? "" : token.trim();
    }

    boolean busy() { return !running.isEmpty(); }

    boolean busy(String name) { return running.contains(name); }

    JSONObject get(String name) { return store.get(name); }

    void remove(String name) {
        try { store.remove(name); } catch (IOException ignored) { }
    }

    /** 同步校验并启动后台上传；返回给网页的可读错误，空串表示已开始。 */
    synchronized String upload(File file) throws IOException {
        String name = file.getName();
        JSONObject record = store.get(name);
        String state = record.optString("state");
        if ("persisted".equals(state)) return "该文件已上传蛋神助手";
        if (running.contains(name)) return "该文件正在上传或查询";
        if (!running.isEmpty()) throw new IOException("已有文件正在上传，请等待完成");
        if (file.length() > CaptureUploader.MAX_UPLOAD_BYTES)
            throw new IOException("蛋神助手云端单文件上限为 5 MiB，请重新采集较短的一次");
        String captureId = record.optString("captureId", "");
        boolean resume = !captureId.isEmpty() && ("pending".equals(state) || "processing".equals(state));
        running.add(name);
        try {
            store.update(name, resume ? "processing" : "uploading", captureId, "",
                resume ? "正在查询云端结果，原文件不会重复上传" : "正在上传原始抓包",
                0, 0, false, true);
        } catch (IOException error) {
            running.remove(name);
            throw error;
        }
        final String initialId = resume ? captureId : "";
        worker.execute(() -> run(file, initialId));
        return "";
    }

    private void run(File file, String initialId) {
        String name = file.getName();
        String[] acceptedId = {initialId};
        long[] totalBytes = {initialId.isEmpty() ? 0L : file.length()};
        try {
            CaptureUploader.Listener listener = new CaptureUploader.Listener() {
                @Override public void progress(long sent, long total) {
                    totalBytes[0] = total;
                    updateProgress(name, sent, total);
                }
                @Override public void status(CaptureUploader.Result result) {
                    if (!result.captureId.isEmpty()) acceptedId[0] = result.captureId;
                    persist(name, result, totalBytes[0]);
                }
            };
            CaptureUploader uploader = new CaptureUploader(token);
            CaptureUploader.Result result = initialId.isEmpty()
                ? uploader.upload(file, listener)
                : uploader.resume(initialId, listener);
            persist(name, result, file.length());
        } catch (Exception error) {
            try {
                store.update(name, acceptedId[0].isEmpty() ? "failed" : "pending", acceptedId[0], "",
                    CaptureVpnService.friendly(error), -1, -1, false, true);
            } catch (IOException ignored) { }
        } finally {
            running.remove(name);
        }
    }

    private void updateProgress(String name, long sent, long total) {
        try {
            store.update(name, "uploading", "", "", "正在上传原始抓包", sent, total, false, false);
        } catch (IOException ignored) {
            // 进度只是展示信息；真正的终态随后会以 durable 方式再写一次。
        }
    }

    private void persist(String name, CaptureUploader.Result result, long total) {
        try {
            store.update(name, uiState(result.state), result.captureId, result.gameId,
                result.message, result.persisted() ? total : -1, total, result.deduplicated, true);
        } catch (IOException ignored) { }
    }

    private static String uiState(String state) {
        if ("persisted".equals(state) || "failed".equals(state)
            || "pending".equals(state) || "uploading".equals(state)) return state;
        return "processing";
    }
}
