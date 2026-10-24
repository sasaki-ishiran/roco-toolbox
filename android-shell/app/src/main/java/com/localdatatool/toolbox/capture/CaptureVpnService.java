package com.localdatatool.toolbox.capture;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.net.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import com.localdatatool.toolbox.MainActivity;
import com.localdatatool.toolbox.R;
import java.io.*;
import java.net.InetAddress;
import java.util.*;
import java.util.concurrent.*;

/** Local VPN forwarding only; there is no upload client or game credential here. */
public final class CaptureVpnService extends VpnService {
    public static final String GAME_PACKAGE = "com.tencent.nrc";
    public static final String START = "com.localdatatool.toolbox.capture.START";
    public static final String STOP = "com.localdatatool.toolbox.capture.STOP";
    public static final CaptureState STATE = new CaptureState();
    private static final int NOTICE = 8195;
    private static final String CHANNEL = "local-game-capture";
    private final ArrayBlockingQueue<Packet> queue = new ArrayBlockingQueue<>(4096);
    private volatile boolean running, stopping, valid;
    private volatile String failure;
    private ParcelFileDescriptor tunnel;
    private Thread network, writer;
    private File capture;
    private CaptureFiles files;
    public static CaptureFiles files(Context context) throws IOException {
        return new CaptureFiles(new File(context.getFilesDir(), "captures"));
    }
    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "本机游戏采集", NotificationManager.IMPORTANCE_LOW));
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if (STOP.equals(intent.getAction())) { requestStop(null); return START_NOT_STICKY; }
        if (!START.equals(intent.getAction()) || running || network != null) return START_NOT_STICKY;
        if (Build.VERSION.SDK_INT < 26 || !"starting".equals(STATE.phase)) { stopSelf(); return START_NOT_STICKY; }
        try {
            Notification notice = notification("仅采集洛克王国游戏流量，点击返回工具箱");
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTICE, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NOTICE, notice);
            getPackageManager().getApplicationInfo(GAME_PACKAGE, 0);
            Builder builder = new Builder().setSession("洛克工具箱 · 本机采集").setMtu(1500)
                .addAddress("10.215.173.2", 32).addAddress("fd66:646b::2", 128)
                .addRoute("0.0.0.0", 0).addRoute("::", 0)
                .addAllowedApplication(GAME_PACKAGE).setBlocking(false);
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            LinkProperties properties = cm.getLinkProperties(cm.getActiveNetwork());
            List<InetAddress> dns = properties == null ? Collections.emptyList() : properties.getDnsServers();
            if (dns.isEmpty()) { builder.addDnsServer("223.5.5.5"); builder.addDnsServer("119.29.29.29"); }
            else for (InetAddress address : dns) builder.addDnsServer(address);
            files = files(this);
            capture = files.create();
            PcapWriter output = new PcapWriter(capture, CaptureFiles.MAX_BYTES);
            try {
                tunnel = builder.establish();
                if (tunnel == null) throw new IOException("未获得系统 VPN 授权，请重新开始");
            } catch (Exception error) { output.close(); throw error; }
            running = valid = true; stopping = false; failure = null;
            STATE.update("capturing", "采集中：请重新登录游戏，依次打开精灵仓库、背包与蛋仓，再回来停止保存");
            writer = new Thread(() -> writeLoop(output), "roco-pcap-writer");
            network = new Thread(this::networkLoop, "roco-vpn");
            writer.start(); network.start();
        } catch (Exception | LinkageError error) {
            closeTunnel(); STATE.update("failed", friendly(error));
            removeNotice(); stopSelf();
        }
        return START_NOT_STICKY;
    }
    private void networkLoop() {
        try {
            String result = NativeTunnel.run(tunnel.getFd(), new NativeTunnel.Callback() {
                @Override public boolean onReady() { return running && !stopping; }
                @Override public boolean protectSocket(int fd) { return protect(fd); }
                @Override public void onPacket(byte[] data, boolean outgoing) {
                    if (!GamePacketFilter.shouldRecord(data)) return;
                    STATE.packet(data.length);
                    if (!queue.offer(new Packet(data, System.currentTimeMillis()))) requestStop("采集队列繁忙，发生丢包；原文件已保留，请重新采集");
                }
                @Override public void onNativeError(String message) { requestStop("转发失败：" + message); }
            });
            if (result != null && !result.isEmpty()) { failure = "转发失败：" + result; valid = false; }
        } catch (Exception | LinkageError error) { failure = friendly(error); valid = false; }
        finally {
            running = false;
            STATE.update("stopping", "正在排空队列并保存本机文件");
            closeTunnel();
            boolean interrupted = false;
            while (writer != null && writer.isAlive()) try { writer.join(); } catch (InterruptedException error) { interrupted = true; }
            if (interrupted) Thread.currentThread().interrupt();
            if (valid) try { files.complete(capture); } catch (IOException error) { failure = friendly(error); valid = false; }
            final String phase = valid ? "idle" : "failed";
            final String message = valid
                ? "已停止并保存原始文件，请点「解析并导入」；是否收齐以解析结果为准"
                : (failure == null ? "本次采集未完整保存，原文件已保留，请重新采集" : failure);
            // Finish on the service thread before exposing idle: an immediate restart
            // must not be discarded by the previous run's non-null thread guard.
            new Handler(Looper.getMainLooper()).post(() -> {
                network = writer = null;
                removeNotice(); stopSelf();
                STATE.update(phase, message);
            });
        }
    }
    private void writeLoop(PcapWriter output) {
        boolean writable = true;
        long flushed = 0;
        try {
            while (running || !queue.isEmpty()) {
                Packet packet = queue.poll(300, TimeUnit.MILLISECONDS);
                if (packet != null && writable && !output.append(packet.data, packet.time)) {
                    writable = false; requestStop("采集已达到 128MiB 上限，原文件已保留，请重新采集");
                }
                if (System.currentTimeMillis() - flushed > 1000) { output.flush(); flushed = System.currentTimeMillis(); }
            }
        } catch (Exception error) { requestStop("保存失败：" + friendly(error)); }
        finally { try { output.close(); } catch (IOException error) { failure = "保存失败：" + friendly(error); valid = false; } }
    }
    private void requestStop(String error) {
        if (error != null) { valid = false; failure = error; }
        stopping = true;
        if (network == null) {
            STATE.update(error == null ? "idle" : "failed", error == null ? "已取消采集" : error);
            removeNotice(); stopSelf(); return;
        }
        STATE.update("stopping", "正在保存，请稍候");
        try { NativeTunnel.stop(); } catch (LinkageError ignored) { }
    }
    @Override public void onRevoke() { requestStop("系统 VPN 已被关闭或被其他应用替换，请重新采集"); }
    @Override public void onDestroy() {
        if (running) requestStop("采集服务被系统中止，原文件已保留");
        super.onDestroy();
    }
    private void closeTunnel() { if (tunnel != null) { try { tunnel.close(); } catch (IOException ignored) { } tunnel = null; } }
    @SuppressWarnings("deprecation") private void removeNotice() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
    }
    private Notification notification(String message) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, CaptureVpnService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_capture)
            .setContentTitle("洛克工具箱 · 本机采集").setContentText(message).setOngoing(true)
            .setContentIntent(open).addAction(0, "停止并保存", stop).build();
    }
    public static String friendly(Throwable error) {
        return error.getMessage() == null ? "无法完成本机采集，请重试" : error.getMessage();
    }
    private static final class Packet {
        final byte[] data; final long time;
        Packet(byte[] data, long time) { this.data = data; this.time = time; }
    }
}
