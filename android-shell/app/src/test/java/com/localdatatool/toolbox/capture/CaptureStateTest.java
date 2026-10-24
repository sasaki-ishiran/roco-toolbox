package com.localdatatool.toolbox.capture;

import org.junit.Test;
import static org.junit.Assert.*;

public class CaptureStateTest {
    @Test public void duplicateStartDoesNotResetCounters() {
        CaptureState state = new CaptureState();
        assertTrue(state.begin()); state.packet(12);
        assertFalse(state.begin()); assertEquals(1, state.packets);
        state.update("stopping", "保存中"); assertFalse(state.begin());
        state.update("idle", "已停止"); assertTrue(state.begin()); assertEquals(0, state.packets);
    }
    @Test public void permissionCancellationAndFailureCanRetry() {
        CaptureState state = new CaptureState();
        state.begin(); state.update("idle", "已取消系统 VPN 授权");
        assertFalse(state.busy()); assertTrue(state.begin());
        state.update("failed", "权限已被撤销"); assertTrue(state.begin());
    }
}
