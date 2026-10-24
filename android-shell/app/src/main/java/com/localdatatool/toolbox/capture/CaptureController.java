package com.localdatatool.toolbox.capture;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.*;
import android.os.Build;
import android.webkit.*;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Small, versioned bridge. Never accepts paths or external download URLs. */
public final class CaptureController {
    private static final int VPN_REQUEST = 8195, NOTICE_REQUEST = 8196;
    private static final String ORIGIN = "https://roco-toolbox.pages.dev";
    private static final String FILE_PREFIX = "https://roco-share.invalid/collector/";
    public interface ImportReady { void ready(String name, String url); }
    private final Activity activity;
    private final ImportReady imported;
    private final Map<String, CaptureSnapshot> grants = new ConcurrentHashMap<>();
    private volatile boolean trusted;
    private boolean permissionPending;
    private boolean awaitingLaunch;
    public CaptureController(Activity activity, ImportReady imported) { this.activity = activity; this.imported = imported; }
    public void setPage(String url) {
        Uri uri = url == null ? Uri.EMPTY : Uri.parse(url);
        trusted = "https".equals(uri.getScheme()) && "roco-toolbox.pages.dev".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    public void invalidatePage() { trusted = false; }
    public void destroy() {
        trusted = false; grants.clear();
        if (awaitingLaunch && "starting".equals(CaptureVpnService.STATE.phase))
            CaptureVpnService.STATE.update("idle", "页面已关闭，已取消启动采集");
        awaitingLaunch = permissionPending = false;
    }
    public String getState() {
        if (!trusted) return "{}";
        CaptureState state = CaptureVpnService.STATE;
        try {
            JSONArray rows = new JSONArray();
            CaptureFiles files = CaptureVpnService.files(activity);
            for (File file : files.list()) rows.put(new JSONObject().put("id", file.getName()).put("name", file.getName())
                .put("size", file.length()).put("createdAt", Long.parseLong(file.getName().substring(8, file.getName().length() - 5)))
                .put("valid", files.valid(file)));
            return new JSONObject().put("version", 1).put("supported", Build.VERSION.SDK_INT >= 26)
                .put("phase", state.phase).put("message", state.message).put("packets", state.packets).put("bytes", state.bytes).put("files", rows)
                .put("progressVersion", 1).put("fileId", state.fileId).put("savedBytes", state.savedBytes).toString();
        } catch (Exception error) {
            return "{\"version\":1,\"supported\":" + (Build.VERSION.SDK_INT >= 26) + ",\"phase\":\"failed\",\"packets\":0,\"bytes\":0,\"files\":[],\"message\":"
                + JSONObject.quote("无法读取本机采集文件：" + CaptureVpnService.friendly(error)) + "}";
        }
    }
    public String startCapture() {
        if (!trusted) return "请在工具箱内使用采集";
        if (Build.VERSION.SDK_INT < 26) return "内置采集需要 Android 8 或以上，仍可手动导入文件";
        if (!CaptureVpnService.STATE.begin()) return "采集正在进行或保存中";
        activity.runOnUiThread(() -> {
            awaitingLaunch = true;
            if (!trusted || activity.isFinishing()) { CaptureVpnService.STATE.update("idle", "已取消启动采集"); return; }
            try {
                activity.getPackageManager().getApplicationInfo(CaptureVpnService.GAME_PACKAGE, 0);
                if (CaptureVpnService.files(activity).list().size() >= CaptureFiles.MAX_FILES) throw new IOException("已有 10 个采集文件，请先导出或删除旧文件");
                if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    permissionPending = true;
                    activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTICE_REQUEST);
                } else askVpn();
            } catch (Exception error) { CaptureVpnService.STATE.update("failed", "无法启动采集：请确认已安装洛克王国官方包；" + CaptureVpnService.friendly(error)); }
        });
        return "";
    }
    private void askVpn() {
        if (Build.VERSION.SDK_INT < 26 || !trusted || !"starting".equals(CaptureVpnService.STATE.phase)) {
            CaptureVpnService.STATE.update("idle", "已取消启动采集"); return;
        }
        try {
            Intent permission = VpnService.prepare(activity);
            if (permission == null) launch();
            else { permissionPending = true; activity.startActivityForResult(permission, VPN_REQUEST); }
        } catch (Exception error) { CaptureVpnService.STATE.update("failed", CaptureVpnService.friendly(error)); }
    }
    private void launch() {
        permissionPending = false;
        awaitingLaunch = false;
        if (Build.VERSION.SDK_INT >= 26 && "starting".equals(CaptureVpnService.STATE.phase)) try {
            activity.startForegroundService(new Intent(activity, CaptureVpnService.class).setAction(CaptureVpnService.START));
        } catch (Exception error) { CaptureVpnService.STATE.update("failed", "启动采集失败：" + CaptureVpnService.friendly(error)); }
    }
    public boolean activityResult(int request, int result) {
        if (request != VPN_REQUEST) return false;
        permissionPending = false;
        if (result == Activity.RESULT_OK && trusted) launch();
        else CaptureVpnService.STATE.update("idle", "已取消系统 VPN 授权，可重新开始");
        return true;
    }
    public boolean permissionsResult(int request) {
        if (request != NOTICE_REQUEST) return false;
        permissionPending = false; askVpn(); return true;
    }
    public String stopCapture() {
        if (!trusted) return "请在工具箱内停止采集";
        activity.runOnUiThread(() -> {
            if (!trusted) return;
            if (permissionPending) { awaitingLaunch = false; CaptureVpnService.STATE.update("idle", "已取消启动采集"); return; }
            if (CaptureVpnService.STATE.busy()) activity.startService(new Intent(activity, CaptureVpnService.class).setAction(CaptureVpnService.STOP));
        });
        return "";
    }
    public String openGame() {
        if (!trusted) return "请在工具箱内打开游戏";
        activity.runOnUiThread(() -> {
            if (!trusted) return;
            try {
                Intent game = activity.getPackageManager().getLaunchIntentForPackage(CaptureVpnService.GAME_PACKAGE);
                if (game == null) throw new IOException("未找到洛克王国官方安卓包 com.tencent.nrc");
                activity.startActivity(game);
            } catch (Exception error) {
                CaptureVpnService.STATE.update(CaptureVpnService.STATE.busy() ? CaptureVpnService.STATE.phase : "failed",
                    "无法打开游戏：" + CaptureVpnService.friendly(error));
            }
        });
        return "";
    }
    private File requireFile(String id, boolean importable) throws IOException {
        if (!trusted) throw new IOException("请在工具箱内使用采集文件");
        if (CaptureVpnService.STATE.busy()) throw new IOException("请先停止采集并等待保存完成");
        CaptureFiles files = CaptureVpnService.files(activity);
        File file = files.require(id);
        if (importable && !files.valid(file)) throw new IOException("该文件未完整保存或没有游戏数据，请重新采集；原文件可导出");
        return file;
    }
    public String importCapture(String id) {
        try {
            File file = requireFile(id, true);
            String token = UUID.randomUUID().toString();
            grants.put(token, new CaptureSnapshot(file, file.length(), ""));
            // At most ten files are retained; expire old grants without retaining byte arrays.
            if (grants.size() > 20) { grants.clear(); grants.put(token, new CaptureSnapshot(file, file.length(), "")); }
            activity.runOnUiThread(() -> { if (trusted) imported.ready(file.getName(), FILE_PREFIX + token); });
            return "";
        } catch (Exception error) { return CaptureVpnService.friendly(error); }
    }
    public String inspectCapture() throws Exception {
        if (!trusted) throw new IOException("请在工具箱内查看采集进度");
        CaptureState state = CaptureVpnService.STATE;
        synchronized (state) {
            if (!"capturing".equals(state.phase) || state.savedBytes <= 24 || state.fileId.isEmpty()) return "";
            File file = CaptureVpnService.files(activity).require(state.fileId);
            CaptureSnapshot snapshot = new CaptureSnapshot(file, state.savedBytes, state.fileId);
            if (snapshot.size > file.length() || snapshot.size > CaptureFiles.MAX_BYTES) throw new IOException("采集快照尚未保存，请稍后重试");
            String token = UUID.randomUUID().toString();
            if (grants.size() > 20) grants.clear();
            grants.put(token, snapshot);
            return new JSONObject().put("id", file.getName()).put("size", snapshot.size).put("url", FILE_PREFIX + token).toString();
        }
    }
    public String shareCapture(String id) {
        try {
            File file = requireFile(id, false);
            Uri uri = FileProvider.getUriForFile(activity, "com.localdatatool.toolbox.fileprovider", file);
            activity.runOnUiThread(() -> {
                if (!trusted) return;
                Intent send = new Intent(Intent.ACTION_SEND).setType("application/vnd.tcpdump.pcap")
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri("本机采集文件", uri));
                try { activity.startActivity(Intent.createChooser(send, "导出原始采集文件")); }
                catch (Exception error) { CaptureVpnService.STATE.update("failed", "无法导出：" + CaptureVpnService.friendly(error)); }
            });
            return "";
        } catch (Exception error) { return CaptureVpnService.friendly(error); }
    }
    public String deleteCapture(String id) {
        try { requireFile(id, false); CaptureVpnService.files(activity).delete(id); return ""; }
        catch (Exception error) { return CaptureVpnService.friendly(error); }
    }
    public WebResourceResponse intercept(Uri uri) {
        if (uri == null || !uri.toString().startsWith(FILE_PREFIX)) return null;
        try {
            String token = uri.toString().substring(FILE_PREFIX.length());
            CaptureSnapshot grant = trusted ? grants.get(token) : null;
            if (grant == null) throw new IOException("unknown capture grant");
            if (grant.session.isEmpty()) requireFile(grant.file.getName(), true);
            else if (!grant.session.equals(CaptureVpnService.STATE.fileId)) throw new IOException("expired capture session");
            CaptureVpnService.files(activity).require(grant.file.getName());
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", ORIGIN); headers.put("Cache-Control", "no-store");
            headers.put("Content-Length", Long.toString(grant.size));
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, grant.open());
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }
}
