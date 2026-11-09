package com.localdatatool.toolbox.capture;
import org.junit.Test;
import static org.junit.Assert.*;
public class CaptureBridgePolicyTest {
    @Test public void onlyOfficialMainFrameMayDispatch() {
        assertTrue(CaptureBridgePolicy.allows("https://roco-toolbox.pages.dev", true));
        assertTrue(CaptureBridgePolicy.allows("https://roco-toolbox.pages.dev:443", true));
        for (String origin : new String[]{"https://roco-toolbox.pages.dev", "https://example.com", "null", "about:srcdoc", "data:text/html,x"})
            assertFalse(CaptureBridgePolicy.allows(origin, false));
        for (String origin : new String[]{"http://roco-toolbox.pages.dev", "https://evil.roco-toolbox.pages.dev", "https://roco-toolbox.pages.dev:444", "https://roco-toolbox.pages.dev.evil.com", "null", null})
            assertFalse(CaptureBridgePolicy.allows(origin, true));
    }

    /** 1.3 默认测试站：白名单必须跟着当前 origin 走，否则原生桥静默丢弃消息。 */
    @Test public void currentSiteOriginMayDispatch() {
        String test = "https://test.roco-toolbox.pages.dev";
        assertTrue(CaptureBridgePolicy.allows(test, true, test));
        assertTrue(CaptureBridgePolicy.allows(test + ":443", true, test));
        assertFalse(CaptureBridgePolicy.allows("https://roco-toolbox.pages.dev", true, test));
        assertFalse(CaptureBridgePolicy.allows(test, false, test));
        assertFalse(CaptureBridgePolicy.allows(null, true, test));
    }
}
