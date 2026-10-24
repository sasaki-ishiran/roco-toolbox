package com.localdatatool.toolbox.capture;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import static org.junit.Assert.*;

public class CaptureSnapshotTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    @Test public void snapshotNeverReadsNewlyAppendedRecords() throws Exception {
        File file = temp.newFile();
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(new byte[]{1,2,3}); }
        CaptureSnapshot snapshot = new CaptureSnapshot(file, 3, "capture-1.pcap");
        try (FileOutputStream out = new FileOutputStream(file, true)) { out.write(new byte[]{4,5}); }
        try (InputStream in = snapshot.open()) {
            assertArrayEquals(new byte[]{1,2,3}, in.readAllBytes());
            assertEquals(-1, in.read());
        }
    }
    @Test public void truncatedSnapshotIsAnErrorNotAShortSuccess() throws Exception {
        File file = temp.newFile();
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(new byte[]{1,2}); }
        CaptureSnapshot snapshot = new CaptureSnapshot(file, 3, "capture-1.pcap");
        try (InputStream in = snapshot.open()) { in.readAllBytes(); fail("must reject truncated snapshot"); }
        catch (IOException expected) { }
    }
}
