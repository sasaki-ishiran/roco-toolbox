package com.localdatatool.toolbox.update;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

/**
 * 应用内更新的纯逻辑（2026-11-08）：检查清单 → 比较版本 → 下载 → 判断能否安装。
 *
 * <p>网络与系统权限都通过接口注入，单测里用假实现覆盖「清单异常 / 下载失败 / 权限被拒」
 * 分支；真正的 HTTP、系统安装器与弹窗在 {@link UpdateController}。</p>
 */
public final class UpdateManager {

    public enum InstallResult {
        /** 安装包已就绪，可以调起系统安装器 */
        READY,
        /** 系统还没允许「安装未知应用」 */
        NEED_PERMISSION,
        /** 还没下载好 */
        NO_FILE
    }

    public interface ManifestSource {
        String read() throws Exception;
    }

    public interface Downloader {
        void download(String apkUrl, File target, Progress progress) throws Exception;
    }

    public interface Progress {
        void onProgress(int percent);
    }

    public interface PermissionGate {
        boolean canInstall();
    }

    public interface Listener {
        void onUpToDate();

        void onAvailable(UpdateManifest manifest, boolean required);

        void onCheckFailed(String message);

        void onProgress(int percent);

        void onReady(File apk);

        void onDownloadFailed(String message);
    }

    private final int currentVersionCode;
    private final File targetFile;
    private final ManifestSource source;
    private final Downloader downloader;
    private final PermissionGate permissionGate;

    private boolean downloaded;

    public UpdateManager(int currentVersionCode, File targetFile, ManifestSource source,
                         Downloader downloader, PermissionGate permissionGate) {
        this.currentVersionCode = currentVersionCode;
        this.targetFile = targetFile;
        this.source = source;
        this.downloader = downloader;
        this.permissionGate = permissionGate;
    }

    /**
     * 多地址兜底：按顺序读，返回第一个能解析成清单的正文（拿不到 / 不是 JSON 都继续试下一个）。
     *
     * <p>主站对不存在的 {@code /android/version.json} 会回退成 SPA 首页（200 + HTML），
     * 直接当清单会解析失败；下载站才是稳定放清单的地方，所以两个地址都要试。</p>
     */
    public static ManifestSource firstValid(ManifestSource... sources) {
        return () -> {
            Exception firstError = null;
            for (ManifestSource source : sources) {
                try {
                    String json = source.read();
                    if (UpdateManifest.parse(json) != null) return json;
                } catch (Exception error) {
                    if (firstError == null) firstError = error;
                }
            }
            throw firstError != null ? firstError : new IOException("没有可用的版本清单");
        };
    }

    /**
     * 降级清单：把 {@code minSupportedVersionCode} 改成 0，表示「只提示更新、不做强制更新」。
     *
     * <p>用于主站旧路径 / 下载站这类可能被边缘缓存咬住的副本：它们拿到的版本号还能提醒用户，
     * 但不能因为一份旧清单就把人卡在更新页。</p>
     */
    public static String asNoticeOnly(String json) {
        try {
            JSONObject object = new JSONObject(json);
            object.put("minSupportedVersionCode", 0);
            return object.toString();
        } catch (Exception error) {
            return json;
        }
    }

    /** 同步执行（调用方自己放到后台线程）。 */
    public void check(Listener listener) {
        String json;
        try {
            json = source.read();
        } catch (Exception error) {
            listener.onCheckFailed(describe(error, "网络不可用"));
            return;
        }
        UpdateManifest manifest = UpdateManifest.parse(json);
        if (manifest == null) {
            listener.onCheckFailed("版本清单格式不正确");
            return;
        }
        if (!manifest.isNewerThan(currentVersionCode)) {
            listener.onUpToDate();
            return;
        }
        listener.onAvailable(manifest, manifest.isRequiredFor(currentVersionCode));
    }

    /** 同步执行（调用方自己放到后台线程）。 */
    public void download(UpdateManifest manifest, Listener listener) {
        downloaded = false;
        try {
            File parent = targetFile.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("无法创建下载目录");
            }
            if (targetFile.exists() && !targetFile.delete()) {
                throw new IOException("无法覆盖旧的安装包");
            }
            downloader.download(manifest.apkUrl, targetFile,
                percent -> listener.onProgress(Math.max(0, Math.min(100, percent))));
            if (!targetFile.exists() || targetFile.length() == 0) {
                throw new IOException("安装包下载不完整");
            }
            downloaded = true;
            listener.onReady(targetFile);
        } catch (Exception error) {
            downloaded = false;
            listener.onDownloadFailed(describe(error, "下载失败"));
        }
    }

    public InstallResult install() {
        if (!downloaded || targetFile == null || !targetFile.exists()) {
            return InstallResult.NO_FILE;
        }
        if (!permissionGate.canInstall()) return InstallResult.NEED_PERMISSION;
        return InstallResult.READY;
    }

    public File downloadedFile() {
        return downloaded ? targetFile : null;
    }

    private static String describe(Exception error, String fallback) {
        String message = error == null ? null : error.getMessage();
        if (message == null || message.trim().isEmpty()) return fallback;
        return message;
    }
}
