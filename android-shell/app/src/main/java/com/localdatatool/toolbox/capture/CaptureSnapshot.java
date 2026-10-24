package com.localdatatool.toolbox.capture;

import java.io.*;

/** A read grant ends at a flushed PCAP record boundary, even as capture continues. */
final class CaptureSnapshot {
    final File file;
    final long size;
    final String session;
    CaptureSnapshot(File file, long size, String session) { this.file = file; this.size = size; this.session = session; }
    InputStream open() throws IOException {
        return new FilterInputStream(new FileInputStream(file)) {
            private long remaining = size;
            @Override public int read() throws IOException {
                if (remaining == 0) return -1;
                int value = in.read();
                if (value < 0) throw new EOFException("采集快照未完整保存，请稍后重试");
                remaining--; return value;
            }
            @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                if (length == 0) return 0;
                if (remaining == 0) return -1;
                int count = in.read(buffer, offset, (int)Math.min(remaining, length));
                if (count < 0) throw new EOFException("采集快照未完整保存，请稍后重试");
                remaining -= count; return count;
            }
            @Override public long skip(long count) throws IOException {
                long skipped = in.skip(Math.min(remaining, Math.max(0, count)));
                remaining -= skipped; return skipped;
            }
            @Override public int available() throws IOException { return (int)Math.min(remaining, in.available()); }
        };
    }
}
