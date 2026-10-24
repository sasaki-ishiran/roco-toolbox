package com.localdatatool.toolbox.capture;

import java.io.*;
import java.nio.*;

/** Ethernet PCAP output adapted from the operator-supplied collector 1.2.6. */
public final class PcapWriter implements Closeable {
    private final FileOutputStream fileOutput;
    private final BufferedOutputStream output;
    private final long limit;
    private long size = 24;
    private boolean closed;
    public PcapWriter(File file, long limit) throws IOException {
        this.limit = limit;
        fileOutput = new FileOutputStream(file);
        output = new BufferedOutputStream(fileOutput, 65536);
        output.write(ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(0xa1b2c3d4).putShort((short)2).putShort((short)4).putLong(0).putInt(65535).putInt(1).array());
    }
    public synchronized boolean append(byte[] ip, long time) throws IOException {
        if (closed) throw new IOException("采集文件已关闭");
        if (ip == null || ip.length == 0) throw new IOException("无效的数据包");
        int length = ip.length + 14;
        if (size + length + 16 > limit) return false;
        output.write(ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
            .putInt((int)(time / 1000)).putInt((int)((time % 1000) * 1000)).putInt(length).putInt(length).array());
        output.write(new byte[12]);
        output.write((ip[0] >>> 4 & 15) == 6 ? 0x86 : 0x08);
        output.write((ip[0] >>> 4 & 15) == 6 ? 0xdd : 0x00);
        output.write(ip);
        size += length + 16;
        return true;
    }
    public synchronized void flush() throws IOException { if (!closed) output.flush(); }
    public synchronized long flushSnapshot() throws IOException { flush(); return size; }
    @Override public synchronized void close() throws IOException {
        if (closed) return;
        closed = true;
        try { output.flush(); fileOutput.getFD().sync(); } finally { output.close(); }
    }
}
