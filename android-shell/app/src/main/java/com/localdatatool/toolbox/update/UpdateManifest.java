package com.localdatatool.toolbox.update;

import org.json.JSONObject;

/**
 * 远端版本清单（android/version.json）的不可变模型（2026-11-08）。
 *
 * <p>字段：{@code versionName / versionCode / apkUrl / notes / minSupportedVersionCode}。
 * 只有 {@code versionCode} 与 {@code apkUrl} 是必需项；其余缺失时按兜底值处理，
 * 清单本身不可用时 {@link #parse} 返回 {@code null}，由上层给出可读提示。</p>
 */
public final class UpdateManifest {

    public final String versionName;
    public final int versionCode;
    public final String apkUrl;
    public final String notes;
    /** 0 表示没有设置「最低可用版本」 */
    public final int minSupportedVersionCode;

    private UpdateManifest(String versionName, int versionCode, String apkUrl,
                           String notes, int minSupportedVersionCode) {
        this.versionName = versionName;
        this.versionCode = versionCode;
        this.apkUrl = apkUrl;
        this.notes = notes;
        this.minSupportedVersionCode = minSupportedVersionCode;
    }

    public static UpdateManifest parse(String json) {
        if (json == null || json.trim().isEmpty()) return null;
        JSONObject object;
        try {
            object = new JSONObject(json);
        } catch (Exception error) {
            return null;
        }
        int versionCode = object.optInt("versionCode", 0);
        if (versionCode <= 0) return null;
        String apkUrl = object.optString("apkUrl", "").trim();
        if (!apkUrl.startsWith("https://") && !apkUrl.startsWith("http://")) return null;
        String versionName = object.optString("versionName", "").trim();
        if (versionName.isEmpty()) versionName = "新版本";
        String notes = object.optString("notes", "").trim();
        int minSupported = Math.max(0, object.optInt("minSupportedVersionCode", 0));
        return new UpdateManifest(versionName, versionCode, apkUrl, notes, minSupported);
    }

    public boolean isNewerThan(int currentVersionCode) {
        return versionCode > currentVersionCode;
    }

    /** 当前版本低于清单里的最低可用版本时，本次更新属于必要更新。 */
    public boolean isRequiredFor(int currentVersionCode) {
        return minSupportedVersionCode > 0 && currentVersionCode < minSupportedVersionCode;
    }
}
