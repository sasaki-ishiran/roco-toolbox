package com.localdatatool.toolbox.capture;

/** Process-local state; raw files and interruption markers are persisted independently. */
public final class CaptureState {
    public volatile String phase = "idle";
    public volatile String message = "开始前退出游戏，授权后重新登录并查看仓库、背包与蛋仓";
    public volatile long packets, bytes;
    public volatile String fileId = "";
    public volatile long savedBytes;
    /** 采集模式：battle = 附近 / 战斗浮窗发起（允许滚动裁剪）；full = 导入导向。 */
    public volatile String mode = "full";
    /**
     * 采集从「进行中」落到空闲时回调一次（2026-11-10）。
     * 宿主用它把后台渲染进程优先级恢复默认：降级只跟「采集停止」这一个事件走，
     * 不放在心跳里按 busy 判断，避免 busy 短暂闪断就把保障永久撤掉。
     */
    public volatile Runnable onIdle;
    public synchronized boolean busy() {
        return "starting".equals(phase) || "capturing".equals(phase) || "stopping".equals(phase);
    }
    public synchronized boolean begin() { return begin("full"); }
    public synchronized boolean begin(String mode) {
        if (busy()) return false;
        this.mode = "battle".equals(mode) ? "battle" : "full";
        packets = bytes = 0;
        fileId = ""; savedBytes = 0;
        phase = "starting"; message = "等待系统 VPN 授权";
        return true;
    }
    public synchronized void update(String phase, String message) {
        boolean wasBusy = busy();
        this.message = message;
        this.phase = phase;
        if (wasBusy && !busy()) {
            Runnable listener = onIdle;
            if (listener != null) listener.run();
        }
    }
    public synchronized void packet(int size) { packets++; bytes += size; }
}
