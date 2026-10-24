package com.localdatatool.toolbox.capture;

/** Process-local state; raw files and interruption markers are persisted independently. */
public final class CaptureState {
    public volatile String phase = "idle";
    public volatile String message = "开始前退出游戏，授权后重新登录并查看仓库、背包与蛋仓";
    public volatile long packets, bytes;
    public volatile String fileId = "";
    public volatile long savedBytes;
    public synchronized boolean busy() {
        return "starting".equals(phase) || "capturing".equals(phase) || "stopping".equals(phase);
    }
    public synchronized boolean begin() {
        if (busy()) return false;
        packets = bytes = 0;
        fileId = ""; savedBytes = 0;
        phase = "starting"; message = "等待系统 VPN 授权";
        return true;
    }
    public synchronized void update(String phase, String message) { this.message = message; this.phase = phase; }
    public synchronized void packet(int size) { packets++; bytes += size; }
}
