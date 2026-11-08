package com.localdatatool.toolbox.update;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * 更新流程的纯逻辑：检查、下载失败、权限被拒、可以安装。
 * 网络与系统权限都以接口注入，单测里用假的实现跑分支。
 */
public class UpdateManagerTest {

    private File directory;
    private File target;
    private Recorder listener;

    @Before public void setUp() throws Exception {
        directory = Files.createTempDirectory("roco-update").toFile();
        target = new File(directory, "updates/roco-latest.apk");
        listener = new Recorder();
    }

    @After public void tearDown() {
        File parent = target.getParentFile();
        if (parent != null) {
            File[] files = parent.listFiles();
            if (files != null) for (File file : files) file.delete();
            parent.delete();
        }
        directory.delete();
    }

    private UpdateManager manager(String manifest, UpdateManager.Downloader downloader, boolean canInstall) {
        return new UpdateManager(
            16, target,
            () -> manifest,
            downloader,
            () -> canInstall);
    }

    private static String manifest(int versionCode, int minSupported) {
        return "{\"versionName\":\"1.3.0\",\"versionCode\":" + versionCode
            + ",\"apkUrl\":\"https://cdn.example.com/roco-latest.apk\","
            + "\"notes\":\"横屏修复\",\"minSupportedVersionCode\":" + minSupported + "}";
    }

    private static final UpdateManager.Downloader NO_DOWNLOAD = (url, file, progress) -> {
        throw new IOException("不应走到下载");
    };

    @Test public void sameVersionIsUpToDate() {
        manager(manifest(16, 0), NO_DOWNLOAD, true).check(listener);
        assertEquals("up-to-date", listener.state);
    }

    @Test public void olderManifestIsUpToDate() {
        manager(manifest(15, 0), NO_DOWNLOAD, true).check(listener);
        assertEquals("up-to-date", listener.state);
    }

    @Test public void newerManifestIsAvailable() {
        manager(manifest(17, 0), NO_DOWNLOAD, true).check(listener);
        assertEquals("available", listener.state);
        assertNotNull(listener.manifest);
        assertEquals(17, listener.manifest.versionCode);
        assertFalse(listener.required);
    }

    @Test public void minSupportedMakesUpdateRequired() {
        manager(manifest(17, 17), NO_DOWNLOAD, true).check(listener);
        assertEquals("available", listener.state);
        assertTrue(listener.required);
    }

    @Test public void malformedManifestFailsLoudly() {
        manager("{\"versionName\":\"broken\"}", NO_DOWNLOAD, true).check(listener);
        assertEquals("check-failed", listener.state);
        assertFalse(listener.message.isEmpty());
    }

    @Test public void networkErrorFailsLoudly() {
        UpdateManager manager = new UpdateManager(16, target,
            () -> { throw new IOException("断网了"); },
            NO_DOWNLOAD, () -> true);
        manager.check(listener);
        assertEquals("check-failed", listener.state);
        assertTrue(listener.message.contains("断网了"));
    }

    @Test public void downloadFailureIsReported() {
        UpdateManager manager = manager(manifest(17, 0),
            (url, file, progress) -> { throw new IOException("服务器 500"); }, true);
        manager.download(UpdateManifest.parse(manifest(17, 0)), listener);
        assertEquals("download-failed", listener.state);
        assertTrue(listener.message.contains("服务器 500"));
    }

    @Test public void emptyDownloadIsTreatedAsFailure() {
        UpdateManager manager = manager(manifest(17, 0),
            (url, file, progress) -> {
                File parent = file.getParentFile();
                if (parent != null) parent.mkdirs();
                file.createNewFile();
            }, true);
        manager.download(UpdateManifest.parse(manifest(17, 0)), listener);
        assertEquals("download-failed", listener.state);
        assertFalse(listener.message.isEmpty());
    }

    @Test public void successfulDownloadReportsReady() throws Exception {
        UpdateManager manager = manager(manifest(17, 0),
            (url, file, progress) -> {
                File parent = file.getParentFile();
                if (parent != null) parent.mkdirs();
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write("apk-bytes".getBytes(StandardCharsets.UTF_8));
                }
                progress.onProgress(100);
            }, true);
        manager.download(UpdateManifest.parse(manifest(17, 0)), listener);
        assertEquals("ready", listener.state);
        assertEquals(100, listener.progress);
        assertTrue(listener.file.exists());
        assertEquals("apk-bytes",
            new String(Files.readAllBytes(listener.file.toPath()), StandardCharsets.UTF_8));
    }

    @Test public void installWithoutDownloadSaysNoFile() {
        UpdateManager manager = manager(manifest(17, 0), NO_DOWNLOAD, true);
        assertEquals(UpdateManager.InstallResult.NO_FILE, manager.install());
    }

    @Test public void installWithoutPermissionIsBlocked() throws Exception {
        UpdateManager manager = manager(manifest(17, 0),
            (url, file, progress) -> {
                File parent = file.getParentFile();
                if (parent != null) parent.mkdirs();
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write(new byte[] { 1, 2, 3 });
                }
            }, false);
        manager.download(UpdateManifest.parse(manifest(17, 0)), listener);
        assertEquals(UpdateManager.InstallResult.NEED_PERMISSION, manager.install());
    }

    @Test public void installWithPermissionIsReady() {
        UpdateManager manager = manager(manifest(17, 0),
            (url, file, progress) -> {
                File parent = file.getParentFile();
                if (parent != null) parent.mkdirs();
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write(new byte[] { 1, 2, 3 });
                }
            }, true);
        manager.download(UpdateManifest.parse(manifest(17, 0)), listener);
        assertEquals(UpdateManager.InstallResult.READY, manager.install());
        assertEquals(target, manager.downloadedFile());
    }

    private static final class Recorder implements UpdateManager.Listener {
        String state = "";
        UpdateManifest manifest;
        boolean required;
        String message = "";
        File file;
        int progress = -1;

        @Override public void onUpToDate() { state = "up-to-date"; }

        @Override public void onAvailable(UpdateManifest value, boolean isRequired) {
            state = "available";
            manifest = value;
            required = isRequired;
        }

        @Override public void onCheckFailed(String value) {
            state = "check-failed";
            message = value;
        }

        @Override public void onProgress(int percent) {
            progress = percent;
        }

        @Override public void onReady(File apk) {
            state = "ready";
            file = apk;
        }

        @Override public void onDownloadFailed(String value) {
            state = "download-failed";
            message = value;
        }
    }
}
