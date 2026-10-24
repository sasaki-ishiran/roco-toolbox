package com.localdatatool.toolbox.capture;

/** Caller check shared by the origin-aware WebMessage bridge and its tests. */
public final class CaptureBridgePolicy {
    private CaptureBridgePolicy() {}
    public static boolean allows(String origin, boolean mainFrame) {
        if (!mainFrame || origin == null) return false;
        return "https://roco-toolbox.pages.dev".equals(origin)
            || "https://roco-toolbox.pages.dev:443".equals(origin);
    }
}
