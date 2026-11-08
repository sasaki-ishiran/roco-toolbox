package com.localdatatool.toolbox.update;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.localdatatool.toolbox.BuildConfig;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 应用内更新（2026-11-08）：启动静默检查 + 手动检查，下载 APK 后调起系统安装器。
 *
 * <p>清单地址只在这里配置一次（{@link #MANIFEST_URL}），APK 地址由清单里的
 * {@code apkUrl} 决定（固定指向最新版），不把地址散落到别处。</p>
 *
 * <p>清单与安装包都不进 APK：清单放在站点静态目录，安装包放在清单指向的固定地址。</p>
 */
public final class UpdateController {

    /** 唯一配置点：远端版本清单地址（Cloudflare 静态资源）。 */
    public static final String MANIFEST_URL = "https://roco-toolbox.pages.dev/android/version.json";

    private static final String PREFS = "roco_update";
    private static final String KEY_SKIPPED = "skippedVersionCode";
    private static final String APK_NAME = "roco-toolbox-latest.apk";
    private static final String AUTHORITY = "com.localdatatool.toolbox.fileprovider";

    private final Activity activity;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final UpdateManager manager;
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    private boolean destroyed;
    private boolean settingsOpened;
    private UpdateManifest pendingManifest;
    private AlertDialog progressDialog;
    private ProgressBar progressBar;
    private TextView progressText;

    public UpdateController(Activity activity) {
        this.activity = activity;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.manager = new UpdateManager(
            BuildConfig.VERSION_CODE, apkFile(), this::readManifest, this::downloadApk,
            this::canInstallPackage);
    }

    /** 启动时静默检查；失败不打扰用户。 */
    public void checkSilently() {
        check(true);
    }

    /** 设置 / 关于页的「检查更新」。 */
    public void checkManually() {
        check(false);
    }

    /** 从系统「安装未知应用」设置页回来：权限拿到了就直接装。 */
    public void onResume() {
        if (!settingsOpened) return;
        settingsOpened = false;
        if (pendingManifest == null) return;
        if (canInstallPackage()) {
            installDownloaded();
        } else {
            toast("还没有允许「安装未知应用」，更新包已下载好，允许后可以继续安装。");
        }
    }

    public void destroy() {
        destroyed = true;
        dismissProgress();
        worker.shutdownNow();
    }

    private void check(boolean silent) {
        if (destroyed) return;
        worker.execute(() -> manager.check(new UpdateManager.Listener() {
            @Override public void onUpToDate() {
                if (!silent) main.post(() -> dialog("已是最新版本",
                    "当前已是最新版本 v" + BuildConfig.VERSION_NAME + "。"));
            }

            @Override public void onAvailable(UpdateManifest manifest, boolean required) {
                int skipped = prefs.getInt(KEY_SKIPPED, -1);
                if (silent && !required && skipped == manifest.versionCode) return;
                main.post(() -> showAvailable(manifest, required));
            }

            @Override public void onCheckFailed(String message) {
                if (silent) return;
                main.post(() -> dialog("检查更新失败", message));
            }

            @Override public void onProgress(int percent) { }

            @Override public void onReady(File apk) { }

            @Override public void onDownloadFailed(String message) { }
        }));
    }

    private void showAvailable(UpdateManifest manifest, boolean required) {
        if (destroyed || activity.isFinishing()) return;
        String notes = manifest.notes.isEmpty() ? "修复了一些问题。" : manifest.notes;
        String message = (required ? "这个版本已不被支持，请更新后再使用。\n\n" : "")
            + notes + "\n\n当前版本 v" + BuildConfig.VERSION_NAME
            + " → 新版本 v" + manifest.versionName;
        new AlertDialog.Builder(activity)
            .setTitle("新版 v" + manifest.versionName + " 可更新")
            .setMessage(message)
            .setPositiveButton("立即更新", (dialog, which) -> startDownload(manifest))
            .setNegativeButton("稍后", (dialog, which) -> {
                if (!required) prefs.edit().putInt(KEY_SKIPPED, manifest.versionCode).apply();
            })
            .show();
    }

    private void startDownload(UpdateManifest manifest) {
        if (destroyed || downloading.get()) return;
        downloading.set(true);
        cancelled.set(false);
        showProgress(manifest);
        worker.execute(() -> manager.download(manifest, new UpdateManager.Listener() {
            @Override public void onUpToDate() { }

            @Override public void onAvailable(UpdateManifest value, boolean required) { }

            @Override public void onCheckFailed(String message) { }

            @Override public void onProgress(int percent) {
                main.post(() -> updateProgress(percent));
            }

            @Override public void onReady(File apk) {
                downloading.set(false);
                main.post(() -> {
                    dismissProgress();
                    pendingManifest = manifest;
                    installDownloaded();
                });
            }

            @Override public void onDownloadFailed(String message) {
                downloading.set(false);
                main.post(() -> {
                    dismissProgress();
                    if (cancelled.get()) return;
                    new AlertDialog.Builder(activity)
                        .setTitle("下载失败")
                        .setMessage(message + "\n\n可以检查网络后重试。")
                        .setPositiveButton("重试", (dialog, which) -> startDownload(manifest))
                        .setNegativeButton("取消", null)
                        .show();
                });
            }
        }));
    }

    private void installDownloaded() {
        if (pendingManifest == null) return;
        UpdateManager.InstallResult result = manager.install();
        if (result == UpdateManager.InstallResult.NO_FILE) {
            dialog("安装包还没准备好", "请重新检查更新后再试。");
            return;
        }
        if (result == UpdateManager.InstallResult.NEED_PERMISSION) {
            showInstallPermission();
            return;
        }
        File apk = manager.downloadedFile();
        if (!isValidApk(apk)) {
            dialog("安装包无法识别", "下载的文件不完整，请重新检查更新后再试。");
            return;
        }
        launchInstaller(apk);
    }

    private void showInstallPermission() {
        new AlertDialog.Builder(activity)
            .setTitle("需要允许安装未知应用")
            .setMessage("系统要求先允许「洛克工具箱」安装应用，才能继续安装更新。")
            .setPositiveButton("去设置", (dialog, which) -> openInstallSettings())
            .setNegativeButton("取消", (dialog, which) ->
                toast("没有允许安装，更新包已下载好，之后可以再试。"))
            .show();
    }

    private void openInstallSettings() {
        try {
            settingsOpened = true;
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
        } catch (Exception error) {
            settingsOpened = false;
            dialog("打不开系统设置", "请到系统设置里允许「洛克工具箱」安装未知应用后重试。");
        }
    }

    private void launchInstaller(File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(activity, AUTHORITY, apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception error) {
            dialog("无法打开安装器", "请稍后重试：" + describe(error));
        }
    }

    private boolean isValidApk(File apk) {
        if (apk == null || !apk.exists() || apk.length() == 0) return false;
        try {
            PackageInfo info = activity.getPackageManager()
                .getPackageArchiveInfo(apk.getAbsolutePath(), 0);
            return info != null && activity.getPackageName().equals(info.packageName);
        } catch (Exception error) {
            return false;
        }
    }

    private boolean canInstallPackage() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        try {
            return activity.getPackageManager().canRequestPackageInstalls();
        } catch (Exception error) {
            return true;
        }
    }

    private String readManifest() throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(MANIFEST_URL).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(10000);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept", "application/json");
            int code = connection.getResponseCode();
            if (code / 100 != 2) throw new IOException("版本服务返回 " + code);
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int length;
                while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                return output.toString("UTF-8");
            }
        } catch (UnknownHostException error) {
            throw new IOException("网络不可用，请检查网络后重试");
        } catch (SocketTimeoutException error) {
            throw new IOException("连接超时，请稍后重试");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void downloadApk(String apkUrl, File target, UpdateManager.Progress progress)
        throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(apkUrl).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Cache-Control", "no-cache");
            int code = connection.getResponseCode();
            if (code / 100 != 2) throw new IOException("下载地址返回 " + code);
            // minSdk 23：getContentLengthLong 是 API 24 才有的，这里用 int 版本
            long total = connection.getContentLength();
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("无法创建下载目录");
            }
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                long read = 0;
                int length;
                int last = -1;
                while ((length = input.read(buffer)) != -1) {
                    if (cancelled.get()) throw new IOException("已取消下载");
                    output.write(buffer, 0, length);
                    read += length;
                    if (total > 0) {
                        int percent = (int) Math.min(100, read * 100 / total);
                        if (percent != last) {
                            last = percent;
                            progress.onProgress(percent);
                        }
                    }
                }
            }
        } catch (UnknownHostException error) {
            throw new IOException("网络不可用，请检查网络后重试");
        } catch (SocketTimeoutException error) {
            throw new IOException("下载超时，请稍后重试");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private File apkFile() {
        return new File(new File(activity.getCacheDir(), "updates"), APK_NAME);
    }

    private void showProgress(UpdateManifest manifest) {
        if (destroyed || activity.isFinishing()) return;
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (activity.getResources().getDisplayMetrics().density * 20);
        box.setPadding(padding, padding / 2, padding, 0);
        progressText = new TextView(activity);
        progressText.setText("正在下载 v" + manifest.versionName + "… 0%");
        progressBar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setIndeterminate(true);
        LinearLayout.LayoutParams barParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        barParams.topMargin = padding / 4;
        box.addView(progressText);
        box.addView(progressBar, barParams);
        progressDialog = new AlertDialog.Builder(activity)
            .setTitle("正在下载更新")
            .setView(box)
            .setCancelable(false)
            .setNegativeButton("取消", (dialog, which) -> {
                cancelled.set(true);
                dismissProgress();
            })
            .create();
        progressDialog.show();
    }

    private void updateProgress(int percent) {
        if (progressDialog == null || !progressDialog.isShowing()) return;
        if (progressBar != null) {
            progressBar.setIndeterminate(false);
            progressBar.setProgress(percent);
        }
        if (progressText != null) {
            progressText.setText("正在下载… " + percent + "%");
        }
    }

    private void dismissProgress() {
        if (progressDialog != null && progressDialog.isShowing()) progressDialog.dismiss();
        progressDialog = null;
        progressBar = null;
        progressText = null;
    }

    private void dialog(String title, String message) {
        if (destroyed || activity.isFinishing()) return;
        new AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("知道了", null)
            .show();
    }

    private void toast(String message) {
        if (destroyed) return;
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
    }

    private static String describe(Exception error) {
        String message = error == null ? null : error.getMessage();
        return message == null || message.trim().isEmpty() ? "请稍后重试" : message;
    }
}
