package com.localdatatool.toolbox.capture;

/** Caller check shared by the origin-aware WebMessage bridge and its tests. */
public final class CaptureBridgePolicy {
    private CaptureBridgePolicy() {}

    public static boolean allows(String origin, boolean mainFrame) {
        return allows(origin, mainFrame, "https://roco-toolbox.pages.dev");
    }

    /**
     * 只放行当前站点的主框架。
     *
     * <p>1.3 内测包默认测试站，切服后页面 origin 会变；白名单写死正式站会让原生桥
     * 静默丢弃消息，网页侧 10 秒超时后报「无法读取本机采集状态」（1.3.7 实测）。</p>
     */
    public static boolean allows(String origin, boolean mainFrame, String siteOrigin) {
        if (!mainFrame || origin == null || siteOrigin == null) return false;
        return origin.equals(siteOrigin) || origin.equals(siteOrigin + ":443");
    }
}
