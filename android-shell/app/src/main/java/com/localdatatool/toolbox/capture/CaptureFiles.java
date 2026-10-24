package com.localdatatool.toolbox.capture;

import java.io.*;
import java.util.*;

/** Persistent raw captures. A marker survives process death until a clean close. */
public final class CaptureFiles {
    public static final long MAX_BYTES = 128L * 1024 * 1024;
    public static final int MAX_FILES = 10;
    private final File directory;
    public CaptureFiles(File directory) throws IOException {
        this.directory = directory.getCanonicalFile();
        if (!this.directory.isDirectory() && !this.directory.mkdirs()) throw new IOException("无法创建本机采集目录");
    }
    public synchronized List<File> list() throws IOException {
        File[] entries = directory.listFiles((dir, name) -> name.matches("capture-[0-9]+\\.pcap"));
        if (entries == null) throw new IOException("无法读取本机采集文件");
        List<File> files = new ArrayList<>();
        for (File file : entries) {
            try { files.add(require(file.getName())); } catch (IOException invalid) { /* Ignore escaped links. */ }
        }
        Collections.sort(files, (left, right) -> right.getName().compareTo(left.getName()));
        return files;
    }
    public synchronized File create() throws IOException {
        if (list().size() >= MAX_FILES) throw new IOException("已有 10 个采集文件，请先导出或删除旧文件");
        long stamp = System.currentTimeMillis();
        File file;
        do { file = new File(directory, "capture-" + stamp++ + ".pcap"); } while (!file.createNewFile());
        try (FileOutputStream marker = new FileOutputStream(marker(file))) {
            marker.write(1); marker.getFD().sync();
        } catch (IOException error) { file.delete(); throw error; }
        return file;
    }
    public synchronized File require(String id) throws IOException {
        if (id == null || !id.matches("capture-[0-9]+\\.pcap")) throw new IOException("无效的采集文件");
        File file = new File(directory, id);
        if (!file.isFile() || !directory.equals(file.getCanonicalFile().getParentFile())) throw new IOException("采集文件不存在");
        return file;
    }
    public synchronized boolean valid(File file) {
        return file.length() > 24 && file.length() <= MAX_BYTES && !marker(file).exists();
    }
    public synchronized void complete(File file) throws IOException {
        if (!marker(file).delete()) throw new IOException("采集状态未能保存，原始文件已保留");
    }
    public synchronized void delete(String id) throws IOException {
        File file = require(id);
        if (!file.delete()) throw new IOException("删除文件失败");
        File marker = marker(file);
        if (marker.exists() && !marker.delete()) throw new IOException("文件已删除，但中断标记未能清理");
    }
    private static File marker(File file) { return new File(file.getPath() + ".incomplete"); }
}
