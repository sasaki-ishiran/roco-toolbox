package com.localdatatool.toolbox.capture;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import static org.junit.Assert.*;

public class CaptureFilesTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    @Test public void rejectPathsAndUnknownFiles() throws Exception {
        CaptureFiles files = new CaptureFiles(temp.newFolder());
        for (String id : new String[]{"../x", "capture-1.pcap/../x", "x.pcap", "capture-1.pcap"}) {
            try { files.require(id); fail(id); } catch (IOException expected) { }
        }
    }
    @Test public void interruptedCaptureRemainsVisibleButNotImportable() throws Exception {
        File directory = temp.newFolder();
        CaptureFiles files = new CaptureFiles(directory);
        File file = files.create();
        try (PcapWriter writer = new PcapWriter(file, 1024)) { writer.append(ipv4(), 1000); }
        CaptureFiles recovered = new CaptureFiles(directory);
        assertEquals(1, recovered.list().size());
        assertFalse(recovered.valid(file));
        recovered.complete(file);
        assertTrue(recovered.valid(file));
    }
    @Test public void noAutomaticDeletionAtFileLimit() throws Exception {
        CaptureFiles files = new CaptureFiles(temp.newFolder());
        for (int i = 0; i < 10; i++) files.create();
        try { files.create(); fail("must require user cleanup"); } catch (IOException expected) { }
        assertEquals(10, files.list().size());
    }
    @Test public void pcapLimitNeverWritesHalfARecord() throws Exception {
        File file = temp.newFile();
        try (PcapWriter writer = new PcapWriter(file, 70)) {
            assertTrue(writer.append(ipv4(), 1000));
            assertFalse(writer.append(ipv4(), 1001));
        }
        assertEquals(68, file.length()); // 24 + 16 + Ethernet14 + IP14
    }
    @Test public void deletingFileAlsoRemovesInterruptionMarker() throws Exception {
        CaptureFiles files = new CaptureFiles(temp.newFolder());
        File file = files.create();
        files.delete(file.getName());
        assertEquals(0, files.list().size());
        assertFalse(new File(file + ".incomplete").exists());
    }
    @Test public void symbolicLinksCannotEscapeCaptureDirectory() throws Exception {
        File root = temp.newFolder();
        File external = temp.newFile();
        try {
            java.nio.file.Files.createSymbolicLink(new File(root, "capture-1.pcap").toPath(), external.toPath());
        } catch (UnsupportedOperationException | IOException denied) { return; }
        try { new CaptureFiles(root).require("capture-1.pcap"); fail("escaped"); }
        catch (IOException expected) { }
    }
    private static byte[] ipv4() { byte[] ip = new byte[14]; ip[0] = 0x45; return ip; }
}
