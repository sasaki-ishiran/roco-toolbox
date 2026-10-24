package com.localdatatool.toolbox.capture;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/** 对真实 HTTP 对端验证与原版 1.2.6 相同的请求头、流式原包与轮询语义。 */
public class CaptureUploaderTest {
    private static final String BASE = "https://danking.cn/capture-api";
    private static final String TOKEN = "android-test-token";
    private static final String ID = "a1234567-1234-4567-8123-123456789abc";
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void uploadMatchesUpstreamIdentityAndOnlyPersistedSucceeds() throws Exception {
        File file = pcap(131117);
        byte[] original = Files.readAllBytes(file.toPath());
        Probe probe = new Probe();
        try (MockApi api = new MockApi(
            reply(202, task("queued")), reply(200, task("decoding")), reply(200, task("persisted")))) {
            CaptureUploader.Result result = api.client(5).upload(file, probe);
            assertTrue(result.persisted());
            assertEquals(ID, result.captureId);
            assertEquals("293143", result.gameId);
            assertEquals(Arrays.asList("uploading", "queued", "decoding", "persisted"), probe.states);
            assertEquals(original.length, probe.sent);
            assertEquals(original.length, probe.total);
            assertEquals(3, api.requests.size());
            Request upload = api.requests.get(0);
            assertEquals("POST /capture-api/v3/captures/upload HTTP/1.1", upload.line);
            assertEquals("application/octet-stream", upload.headers.get("Content-Type"));
            assertEquals("Bearer " + TOKEN, upload.headers.get("Authorization"));
            assertEquals("cn.danking.collector", upload.headers.get("X-Collector-App"));
            assertEquals("1.2.6", upload.headers.get("X-Collector-Version"));
            assertEquals("46", upload.headers.get("X-Collector-VersionCode"));
            assertEquals(TOKEN, upload.headers.get("X-Collector-Release-Token"));
            assertNull(upload.headers.get("Content-Encoding"));
            assertEquals(Instant.ofEpochMilli(file.lastModified()).toString(), upload.headers.get("X-Capture-Time"));
            assertEquals(hex(MessageDigest.getInstance("SHA-256").digest(original)), upload.headers.get("X-SHA256"));
            assertArrayEquals(original, upload.body);
            for (int index = 1; index < api.requests.size(); index++) {
                Request poll = api.requests.get(index);
                assertEquals("GET /capture-api/v3/captures/" + ID + " HTTP/1.1", poll.line);
                assertEquals("Bearer " + TOKEN, poll.headers.get("Authorization"));
                assertEquals(0, poll.body.length);
            }
            assertArrayEquals(original, Files.readAllBytes(file.toPath()));
        }
    }

    @Test public void deduplicatedPersistedIsSuccess() throws Exception {
        try (MockApi api = new MockApi(reply(200, task("persisted", true)))) {
            CaptureUploader.Result result = api.client(1).resume(ID, null);
            assertTrue(result.persisted());
            assertTrue(result.deduplicated);
            assertEquals("293143", result.gameId);
        }
    }

    @Test public void resumeOnlyQueriesAcceptedIdWithoutPosting() throws Exception {
        try (MockApi api = new MockApi(reply(200, task("persisted")))) {
            assertTrue(api.client(2).resume(ID, null).persisted());
            assertEquals(1, api.requests.size());
            assertTrue(api.requests.get(0).line.startsWith("GET "));
        }
    }

    @Test public void pollFailureKeepsTaskIdAndOriginalFile() throws Exception {
        File file = pcap(70);
        try (MockApi api = new MockApi(reply(202, task("queued")), reply(503, "{\"message\":\"worker unavailable\"}"))) {
            CaptureUploader.Result result = api.client(5).upload(file, new Probe());
            assertEquals("pending", result.state);
            assertEquals(ID, result.captureId);
            assertTrue(result.message.contains("worker unavailable"));
            assertEquals(2, api.requests.size());
            assertTrue(file.isFile());
        }
    }

    @Test public void tooLargeNeverOpensNetwork() throws Exception {
        File large = pcap(70);
        try (RandomAccessFile file = new RandomAccessFile(large, "rw")) {
            file.setLength(CaptureUploader.MAX_UPLOAD_BYTES + 1);
        }
        CaptureUploader.ConnectionFactory forbidden = url -> { fail("Network must not be used"); return null; };
        CaptureUploader client = new CaptureUploader(BASE, TOKEN, forbidden, millis -> {}, 1, 0);
        assertTrue(assertThrows(IOException.class, () -> client.upload(large, null)).getMessage().contains("5 MiB"));
        assertEquals(CaptureUploader.MAX_UPLOAD_BYTES + 1, large.length());
    }

    @Test public void invalidConfigurationNeverOpensNetwork() throws Exception {
        CaptureUploader.ConnectionFactory forbidden = url -> { fail("Network must not be used"); return null; };
        for (String base : Arrays.asList("http://api.danking.cn/api", "https://example.com/api",
            "https://api.danking.cn:8443/api", "https://api.danking.cn/api?redirect=1", "https://u@api.danking.cn/api",
            "https://danking.cn/not-capture", "https://capture.danking.cn/capture-api",
            "https://capture.danking.cn:443/capture-api", "https://capture.danking.cn:18444/capture-api",
            "https://capture.danking.cn.evil.example:18443/capture-api")) {
            CaptureUploader client = new CaptureUploader(base, TOKEN, forbidden, millis -> {}, 1, 0);
            assertThrows(IOException.class, () -> client.upload(pcap(70), null));
        }
        CaptureUploader unconfigured = new CaptureUploader(BASE, "", forbidden, millis -> {}, 1, 0);
        assertThrows(IOException.class, () -> unconfigured.upload(pcap(70), null));
        CaptureUploader.Result pending = unconfigured.resume(ID, null);
        assertEquals("pending", pending.state);
        assertEquals(ID, pending.captureId);
    }

    @Test public void updateRequiredIsActionable() throws Exception {
        try (MockApi api = new MockApi(reply(426, "{}"))) {
            CaptureUploader.Result result = api.client(1).resume(ID, null);
            assertEquals("pending", result.state);
            assertEquals(ID, result.captureId);
            assertTrue(result.message.contains("426"));
            assertTrue(result.message.contains("更新采集器"));
        }
    }

    @Test public void invalidPcapMagicIsRejectedBeforeNetwork() throws Exception {
        CaptureUploader.ConnectionFactory forbidden = url -> { fail("Network must not be used"); return null; };
        File file = temporary.newFile();
        Files.write(file.toPath(), "not a capture at all, just text".getBytes(StandardCharsets.UTF_8));
        CaptureUploader client = new CaptureUploader(BASE, TOKEN, forbidden, millis -> {}, 1, 0);
        assertTrue(assertThrows(IOException.class, () -> client.upload(file, null)).getMessage().contains("PCAP"));
    }

    private File pcap(int size) throws IOException {
        File file = temporary.newFile();
        byte[] bytes = new byte[size];
        bytes[0] = (byte) 0xd4; bytes[1] = (byte) 0xc3; bytes[2] = (byte) 0xb2; bytes[3] = (byte) 0xa1;
        for (int index = 4; index < size; index++) bytes[index] = (byte) index;
        Files.write(file.toPath(), bytes);
        assertTrue(file.setLastModified(1_783_000_123_000L));
        return file;
    }

    private static String task(String state) { return task(state, false); }
    private static String task(String state, boolean deduplicated) {
        return "{\"ok\":true,\"captureId\":\"" + ID + "\",\"gameId\":293143,\"status\":\"" + state
            + "\",\"deduplicated\":" + deduplicated + "}";
    }
    private static Reply reply(int status, String body) { return new Reply(status, body, ""); }
    private static String hex(byte[] values) {
        StringBuilder text = new StringBuilder();
        for (byte value : values) text.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return text.toString();
    }

    private static final class Probe implements CaptureUploader.Listener {
        final List<String> states = new ArrayList<>();
        long sent, total;
        @Override public void progress(long bytesSent, long totalBytes) {
            assertTrue(bytesSent >= sent); assertTrue(bytesSent <= totalBytes);
            sent = bytesSent; total = totalBytes;
        }
        @Override public void status(CaptureUploader.Result result) {
            if (!"uploading".equals(result.state)) assertEquals(ID, result.captureId);
            states.add(result.state);
        }
    }

    private static final class Request {
        final String line;
        final Map<String, String> headers;
        final byte[] body;
        Request(String line, Map<String, String> headers, byte[] body) {
            this.line = line; this.headers = headers; this.body = body;
        }
    }
    private static final class Reply {
        final int status;
        final byte[] body;
        final String headers;
        Reply(int status, String body, String headers) {
            this.status = status; this.body = body.getBytes(StandardCharsets.UTF_8); this.headers = headers;
        }
    }

    /** 只使用 Android SDK 也有的 API 的最小 HTTP 对端。 */
    private static final class MockApi implements AutoCloseable {
        final ServerSocket server;
        final List<Request> requests = Collections.synchronizedList(new ArrayList<>());
        final AtomicReference<Throwable> failure = new AtomicReference<>();
        final Thread thread;
        volatile boolean closing;

        MockApi(Reply... replies) throws IOException {
            server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            thread = new Thread(() -> {
                int index = 0;
                while (!closing) {
                    try (Socket socket = server.accept()) {
                        socket.setSoTimeout(5000);
                        InputStream input = socket.getInputStream();
                        String requestLine = line(input);
                        Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
                        String header;
                        while (!(header = line(input)).isEmpty()) {
                            int colon = header.indexOf(':');
                            if (colon < 1) throw new IOException("Malformed test request header");
                            headers.put(header.substring(0, colon).trim(), header.substring(colon + 1).trim());
                        }
                        int length = Integer.parseInt(headers.getOrDefault("Content-Length", "0"));
                        byte[] body = new byte[length];
                        int position = 0;
                        while (position < length) {
                            int count = input.read(body, position, length - position);
                            if (count < 0) throw new IOException("Incomplete HTTP request body");
                            position += count;
                        }
                        requests.add(new Request(requestLine, headers, body));
                        Reply reply = index < replies.length ? replies[index++] : reply(500, "{}");
                        OutputStream output = socket.getOutputStream();
                        output.write(("HTTP/1.1 " + reply.status + " Test\r\nContent-Type: application/json\r\n"
                            + "Content-Length: " + reply.body.length + "\r\nConnection: close\r\n"
                            + reply.headers + "\r\n").getBytes(StandardCharsets.US_ASCII));
                        output.write(reply.body);
                        output.flush();
                    } catch (SocketException socketClosed) {
                        if (closing) return;
                    } catch (Throwable error) {
                        if (!closing) failure.compareAndSet(null, error);
                        return;
                    }
                }
            }, "capture-uploader-mock-api");
            thread.setDaemon(true);
            thread.start();
        }

        String origin() { return "http://127.0.0.1:" + server.getLocalPort(); }
        CaptureUploader client(int maxPolls) {
            return new CaptureUploader(BASE, TOKEN, url -> {
                assertEquals("https", url.getProtocol());
                assertEquals("danking.cn", url.getHost());
                return (HttpURLConnection) new URL(origin() + url.getPath()).openConnection();
            }, millis -> {}, maxPolls, 0);
        }
        @Override public void close() throws Exception {
            closing = true;
            server.close();
            thread.join(3000);
            assertFalse("Mock HTTP peer did not shut down", thread.isAlive());
            if (failure.get() != null) throw new AssertionError("Mock HTTP peer failed", failure.get());
        }
        private static String line(InputStream input) throws IOException {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            for (;;) {
                int value = input.read();
                if (value < 0) throw new IOException("HTTP peer closed before headers");
                if (value == '\n') break;
                if (value != '\r') bytes.write(value);
                if (bytes.size() > 16384) throw new IOException("HTTP header too long");
            }
            return new String(bytes.toByteArray(), StandardCharsets.US_ASCII);
        }
    }
}
