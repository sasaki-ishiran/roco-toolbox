package com.localdatatool.toolbox.capture;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.*;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.webkit.*;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import com.localdatatool.toolbox.BuildConfig;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Small, versioned bridge. Never accepts paths or external download URLs. */
public final class CaptureController {
    private static final int VPN_REQUEST = 8195, NOTICE_REQUEST = 8196;
    private static final String FILE_PREFIX = "https://roco-share.invalid/collector/";
    /** 当前站点 origin（内测可切换，见 com.localdatatool.toolbox.ServerConfig）；只有它算可信页面。 */
    private volatile String siteOrigin = "https://roco-toolbox.pages.dev";
    public interface ImportReady { void ready(String name, String url); }
    private final Activity activity;
    private final ImportReady imported;
    private final Map<String, CaptureSnapshot> grants = new ConcurrentHashMap<>();
    private volatile boolean trusted;
    private boolean permissionPending;
    private boolean awaitingLaunch;
    public CaptureController(Activity activity, ImportReady imported) { this.activity = activity; this.imported = imported; }
    public void setSiteOrigin(String origin) { this.siteOrigin = origin; }
    public void setPage(String url) {
        Uri uri = url == null ? Uri.EMPTY : Uri.parse(url);
        String host = uri.getHost();
        String page = host == null ? "" : "https://" + host
            + (uri.getPort() == -1 || uri.getPort() == 443 ? "" : ":" + uri.getPort());
        trusted = "https".equals(uri.getScheme()) && siteOrigin.equals(page);
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
            // 正在写的文件带 .incomplete 标记，属正常状态；忙碌时不要把它当成「残缺文件」返回，
            // 否则刚点开始采集就会出现「未完整保存或没有可用数据」。
            boolean writing = "starting".equals(state.phase) || "capturing".equals(state.phase)
                || "stopping".equals(state.phase);
            for (File file : files.list()) {
                if (writing && file.getName().equals(state.fileId)) continue;
                JSONObject row = new JSONObject().put("id", file.getName()).put("name", file.getName())
                    .put("size", file.length()).put("createdAt", Long.parseLong(file.getName().substring(8, file.getName().length() - 5)))
                    .put("valid", files.valid(file));
                rows.put(row);
            }
            return new JSONObject().put("version", 1).put("supported", Build.VERSION.SDK_INT >= 26)
                .put("phase", state.phase).put("message", state.message).put("packets", state.packets).put("bytes", state.bytes).put("files", rows)
                .put("progressVersion", 1).put("fileId", state.fileId).put("savedBytes", state.savedBytes).toString();
        } catch (Exception error) {
            return "{\"version\":1,\"supported\":" + (Build.VERSION.SDK_INT >= 26) + ",\"phase\":\"failed\",\"packets\":0,\"bytes\":0,\"files\":[],\"message\":"
                + JSONObject.quote("无法读取本机采集文件：" + CaptureVpnService.friendly(error)) + "}";
        }
    }
    public String startCapture(String mode) {
        if (!trusted) return "请在小布助手内使用采集";
        if (Build.VERSION.SDK_INT < 26) return "内置采集需要 Android 8 或以上，仍可手动导入文件";
        if (!CaptureVpnService.STATE.begin(mode)) return "采集正在进行或保存中";
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
        if (!trusted) return "请在小布助手内停止采集";
        activity.runOnUiThread(() -> {
            if (!trusted) return;
            if (permissionPending) { awaitingLaunch = false; CaptureVpnService.STATE.update("idle", "已取消启动采集"); return; }
            if (CaptureVpnService.STATE.busy()) activity.startService(new Intent(activity, CaptureVpnService.class).setAction(CaptureVpnService.STOP));
        });
        return "";
    }
    public String openGame() {
        if (!trusted) return "请在小布助手内打开游戏";
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
        if (!trusted) throw new IOException("请在小布助手内使用采集文件");
        if (CaptureVpnService.STATE.busy()) throw new IOException("请先停止采集并等待保存完成");
        CaptureFiles files = CaptureVpnService.files(activity);
        File file = files.require(id);
        if (importable && files.trimmed(file)) throw new IOException("该文件为战斗模式采集，只保留最近一段，不能完整导入；可导出原始文件");
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
    /**
     * 稀有精灵通知（2026-11-05）。独立渠道，10 秒后自动消失，震动 300ms。
     * 与采集前台通知分开，避免被正在进行的采集通知覆盖。
     */
    public String notifyRareAlert(String title, String body) {
        if (!trusted) return "请在小布助手内使用提醒";
        try {
            String safeTitle = title == null ? "" : title.trim();
            String safeBody = body == null ? "" : body.trim();
            if (safeTitle.length() > 80) safeTitle = safeTitle.substring(0, 80);
            if (safeBody.length() > 500) safeBody = safeBody.substring(0, 500);
            if (safeTitle.isEmpty()) return "提醒标题为空";
            NotificationManager manager = activity.getSystemService(NotificationManager.class);
            if (manager == null) return "系统通知不可用";
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = new NotificationChannel("roco_rare", "稀有精灵提醒", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("附近刷出稀有精灵时提醒");
                manager.createNotificationChannel(channel);
            }
            Intent open = new Intent(activity, com.localdatatool.toolbox.MainActivity.class);
            PendingIntent content = PendingIntent.getActivity(activity, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(activity, "roco_rare")
                .setSmallIcon(com.localdatatool.toolbox.R.drawable.ic_capture)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safeBody))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(content);
            manager.notify(9528, builder.build());
            new Handler(Looper.getMainLooper()).postDelayed(() -> manager.cancel(9528), 10000);
            try {
                Vibrator vibrator = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator != null) vibrator.vibrate(300);
            } catch (Exception ignored) { }
            return "";
        } catch (Exception error) {
            return "提醒发送失败：" + CaptureVpnService.friendly(error);
        }
    }
    public String inspectCapture() throws Exception {
        if (!trusted) throw new IOException("请在小布助手内查看采集进度");
        CaptureState state = CaptureVpnService.STATE;
        synchronized (state) {
            if (!"capturing".equals(state.phase) || state.savedBytes <= 24 || state.fileId.isEmpty()) return "";
            File file = CaptureVpnService.files(activity).require(state.fileId);
            // 滚动裁剪正在 rename 时文件会短暂变小：按实际长度截断快照，本轮直接跳过，
            // 不让网页收到「快照尚未保存」的错误（下一轮就恢复了）。
            long size = Math.min(state.savedBytes, file.length());
            if (size <= 24) return "";
            CaptureSnapshot snapshot = new CaptureSnapshot(file, size, state.fileId);
            if (snapshot.size > CaptureFiles.MAX_BYTES) throw new IOException("采集快照尚未保存，请稍后重试");
            String token = UUID.randomUUID().toString();
            if (grants.size() > 20) grants.clear();
            grants.put(token, snapshot);
            return new JSONObject().put("id", file.getName()).put("size", snapshot.size).put("url", FILE_PREFIX + token).toString();
        }
    }
    public String shareCapture(String id) {
        try {
            File file = requireFile(id, false);
            Uri uri = FileProvider.getUriForFile(activity, BuildConfig.APPLICATION_ID + ".fileprovider", file);
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
        try {
            requireFile(id, false);
            CaptureVpnService.files(activity).delete(id);
            return "";
        } catch (Exception error) { return CaptureVpnService.friendly(error); }
    }
    public WebResourceResponse intercept(Uri uri) {
        if (uri == null || !uri.toString().startsWith(FILE_PREFIX)) return null;
        try {
            // token 从 path 取，避免实时巡检的 ?from=N 增量参数被当成 token 的一部分
            String path = uri.getPath() == null ? "" : uri.getPath();
            String token = path.substring(path.lastIndexOf('/') + 1);
            CaptureSnapshot grant = trusted ? grants.get(token) : null;
            if (grant == null) throw new IOException("unknown capture grant");
            if (grant.session.isEmpty()) requireFile(grant.file.getName(), true);
            else if (!grant.session.equals(CaptureVpnService.STATE.fileId)) throw new IOException("expired capture session");
            CaptureVpnService.files(activity).require(grant.file.getName());
            // 增量读取（2026-11-08）：网页记住已读位置后只取 [from, size) 这一段，
            // 不再每轮把几十 MB 整个文件重新搬过 WebView。
            long from = 0;
            try {
                String raw = uri.getQueryParameter("from");
                if (raw != null) from = Long.parseLong(raw);
            } catch (Exception ignored) {
                from = 0;
            }
            if (from < 0 || from > grant.size) throw new IOException("invalid capture range");
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", siteOrigin); headers.put("Cache-Control", "no-store");
            headers.put("Content-Length", Long.toString(grant.size - from));
            headers.put("X-Capture-From", Long.toString(from));
            headers.put("X-Capture-Total", Long.toString(grant.size));
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, grant.open(from));
        } catch (Exception error) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }
}
