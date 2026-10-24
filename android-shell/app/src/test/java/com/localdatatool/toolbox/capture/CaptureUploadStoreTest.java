package com.localdatatool.toolbox.capture;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.*;

public class CaptureUploadStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void persistedTaskAndUidSurviveReload() throws Exception {
        File directory = temporary.newFolder();
        CaptureUploadStore store = new CaptureUploadStore(directory);
        store.update("capture-1.pcap", "persisted", "a1234567-1234-4567-8123-123456789abc", "293143",
            "角色数据已完整保存到云端", 100, 100, true, true);

        JSONObject reloaded = new CaptureUploadStore(directory).get("capture-1.pcap");
        assertEquals("persisted", reloaded.getString("state"));
        assertEquals("293143", reloaded.getString("gameId"));
        assertTrue(reloaded.getBoolean("deduplicated"));
        assertEquals(100, reloaded.getInt("progress"));
    }

    @Test public void interruptedUploadWithoutTaskIdBecomesFailedNotRetried() throws Exception {
        File directory = temporary.newFolder();
        Files.write(new File(directory, "capture-uploads.json").toPath(),
            ("[{\"fileName\":\"capture-1.pcap\",\"state\":\"uploading\",\"message\":\"正在上传\"}]")
                .getBytes(StandardCharsets.UTF_8));
        JSONObject row = new CaptureUploadStore(directory).get("capture-1.pcap");
        assertEquals("failed", row.getString("state"));
        assertTrue(row.getString("message").contains("中断"));
    }

    @Test public void acceptedTaskWithoutFinalResultResumesAsPending() throws Exception {
        File directory = temporary.newFolder();
        Files.write(new File(directory, "capture-uploads.json").toPath(),
            ("[{\"fileName\":\"capture-1.pcap\",\"state\":\"processing\","
                + "\"captureId\":\"a1234567-1234-4567-8123-123456789abc\"}]")
                .getBytes(StandardCharsets.UTF_8));
        JSONObject row = new CaptureUploadStore(directory).get("capture-1.pcap");
        assertEquals("pending", row.getString("state"));
        assertEquals("a1234567-1234-4567-8123-123456789abc", row.getString("captureId"));
    }

    @Test public void deleteRemovesPersistedRecord() throws Exception {
        File directory = temporary.newFolder();
        CaptureUploadStore store = new CaptureUploadStore(directory);
        store.update("capture-1.pcap", "persisted", "a1234567-1234-4567-8123-123456789abc", "293143",
            "ok", 100, 100, false, true);
        store.remove("capture-1.pcap");
        assertFalse(new CaptureUploadStore(directory).get("capture-1.pcap").has("state"));
    }
}
