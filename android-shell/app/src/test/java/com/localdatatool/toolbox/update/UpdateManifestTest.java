package com.localdatatool.toolbox.update;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * 远端版本清单（version.json）的解析与兜底。
 */
public class UpdateManifestTest {

    @Test public void parsesFullManifest() {
        UpdateManifest manifest = UpdateManifest.parse("{"
            + "\"versionName\":\"1.3.0\","
            + "\"versionCode\":17,"
            + "\"apkUrl\":\"https://cdn.example.com/roco-latest.apk\","
            + "\"notes\":\"修好了横屏拖动\","
            + "\"minSupportedVersionCode\":16}");
        assertNotNull(manifest);
        assertEquals("1.3.0", manifest.versionName);
        assertEquals(17, manifest.versionCode);
        assertEquals("https://cdn.example.com/roco-latest.apk", manifest.apkUrl);
        assertEquals("修好了横屏拖动", manifest.notes);
        assertEquals(16, manifest.minSupportedVersionCode);
    }

    @Test public void optionalFieldsFallBack() {
        UpdateManifest manifest = UpdateManifest.parse(
            "{\"versionCode\":18,\"apkUrl\":\"https://cdn.example.com/x.apk\"}");
        assertNotNull(manifest);
        assertEquals("新版本", manifest.versionName);
        assertEquals("", manifest.notes);
        assertEquals(0, manifest.minSupportedVersionCode);
    }

    @Test public void invalidJsonIsRejected() {
        assertNull(UpdateManifest.parse("not a json"));
        assertNull(UpdateManifest.parse(""));
        assertNull(UpdateManifest.parse(null));
    }

    @Test public void missingRequiredFieldsAreRejected() {
        assertNull(UpdateManifest.parse("{\"apkUrl\":\"https://cdn.example.com/x.apk\"}"));
        assertNull(UpdateManifest.parse("{\"versionCode\":18}"));
        assertNull(UpdateManifest.parse("{\"versionCode\":0,\"apkUrl\":\"https://x/y.apk\"}"));
        assertNull(UpdateManifest.parse("{\"versionCode\":-3,\"apkUrl\":\"https://x/y.apk\"}"));
    }

    @Test public void nonHttpApkUrlIsRejected() {
        assertNull(UpdateManifest.parse("{\"versionCode\":18,\"apkUrl\":\"ftp://x/y.apk\"}"));
        assertNull(UpdateManifest.parse("{\"versionCode\":18,\"apkUrl\":\"/relative.apk\"}"));
    }

    @Test public void newerVersionCodeMeansUpgrade() {
        UpdateManifest manifest = UpdateManifest.parse(
            "{\"versionName\":\"1.3.0\",\"versionCode\":17,\"apkUrl\":\"https://x/y.apk\"}");
        assertTrue(manifest.isNewerThan(16));
        assertFalse(manifest.isNewerThan(17));
        assertFalse(manifest.isNewerThan(18));
    }

    @Test public void minSupportedMarksRequiredUpdate() {
        UpdateManifest manifest = UpdateManifest.parse(
            "{\"versionCode\":18,\"apkUrl\":\"https://x/y.apk\",\"minSupportedVersionCode\":17}");
        assertTrue(manifest.isRequiredFor(16));
        assertFalse(manifest.isRequiredFor(17));
    }

    @Test public void missingMinSupportedIsNeverRequired() {
        UpdateManifest manifest = UpdateManifest.parse(
            "{\"versionCode\":18,\"apkUrl\":\"https://x/y.apk\"}");
        assertFalse(manifest.isRequiredFor(1));
    }
}
