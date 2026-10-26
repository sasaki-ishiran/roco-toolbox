package com.localdatatool.toolbox.capture;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;

/**
 * 每个原包的上传状态与云端任务编号。
 *
 * 任务编号必须落盘：POST 已经受理、但响应或后续查询网络中断时，重开应用应继续
 * GET 同一个任务，而不是再次上传文件。上传进度只在内存里高频更新，落盘最多每秒一次。
 * 陈旧的上传中状态在加载时降级为失败，不自动重发（POST 是否到达服务端无法确定）。
 */
final class CaptureUploadStore {
    private final File file;
    private final LinkedHashMap<String, JSONObject> records = new LinkedHashMap<>();
    private long lastSaved;

    CaptureUploadStore(File directory) {
        file = new File(directory, "capture-uploads.json");
        if (!file.isFile()) return;
        try (InputStream input = new FileInputStream(file)) {
            JSONArray rows = new JSONArray(new String(readAll(input), StandardCharsets.UTF_8));
            for (int index = 0; index < rows.length(); index++) {
                JSONObject item = rows.getJSONObject(index);
                String state = item.optString("state");
                if ("uploading".equals(state) || "processing".equals(state)) {
                    boolean accepted = !item.optString("captureId").isEmpty();
                    item.put("state", accepted ? "pending" : "failed")
                        .put("message", accepted ? "等待继续查询云端结果" : "上次上传已中断，可重新上传");
                }
                records.put(item.getString("fileName"), item);
            }
        } catch (Exception ignored) {
            // 记录文件损坏不影响原包本身；下次更新会覆盖它。
        }
    }

    synchronized JSONObject get(String name) {
        JSONObject row = records.get(name);
        if (row == null) return new JSONObject();
        try { return new JSONObject(row.toString()); }
        catch (Exception error) { return new JSONObject(); }
    }

    /** 重新上传前清掉旧任务号：否则进程被杀后重启会把旧任务当成在途任务继续查询。 */
    synchronized void clearCaptureId(String name) throws IOException {
        JSONObject row = records.get(name);
        if (row == null || row.optString("captureId").isEmpty()) return;
        row.remove("captureId");
        save();
    }

    synchronized void update(String name, String state, String captureId, String gameId,
                             String message, long sent, long total, boolean deduplicated,
                             boolean durable) throws IOException {
        JSONObject row = records.get(name);
        if (row == null) row = new JSONObject();
        try {
            row.put("fileName", name);
            row.put("state", state).put("message", message == null ? "" : message)
                .put("updatedAt", System.currentTimeMillis());
            if (captureId != null && !captureId.isEmpty()) row.put("captureId", captureId);
            if (gameId != null && !gameId.isEmpty()) row.put("gameId", gameId);
            if (deduplicated) row.put("deduplicated", true);
            if (sent >= 0) row.put("bytesSent", sent);
            if (total >= 0) row.put("totalBytes", total);
            long bytes = row.optLong("bytesSent");
            long size = row.optLong("totalBytes");
            row.put("progress", size > 0 ? Math.min(100, (int) (bytes * 100 / size)) : 0);
        } catch (Exception error) {
            throw new IOException("无法保存上传进度", error);
        }
        records.put(name, row);
        if (durable || System.currentTimeMillis() - lastSaved >= 1000) save();
    }

    synchronized void remove(String name) throws IOException {
        JSONObject previous = records.remove(name);
        if (previous == null) return;
        try { save(); }
        catch (IOException error) { records.put(name, previous); throw error; }
    }

    private void save() throws IOException {
        File directory = file.getParentFile();
        if (directory != null && !directory.isDirectory() && !directory.mkdirs())
            throw new IOException("无法保存上传记录");
        File temporary = new File(directory, file.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(rows().toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        if (!temporary.renameTo(file)) {
            // 某些文件系统不支持覆盖式 rename；先删旧文件再重试一次。
            if (file.exists() && !file.delete()) {
                temporary.delete();
                throw new IOException("无法保存上传记录");
            }
            if (!temporary.renameTo(file)) {
                temporary.delete();
                throw new IOException("无法保存上传记录");
            }
        }
        lastSaved = System.currentTimeMillis();
    }

    private JSONArray rows() throws IOException {
        JSONArray result = new JSONArray();
        try {
            for (JSONObject item : records.values()) result.put(new JSONObject(item.toString()));
        } catch (Exception error) {
            throw new IOException("无法保存上传记录", error);
        }
        return result;
    }

    private static byte[] readAll(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }
}
