package com.localdatatool.toolbox.capture;

import org.junit.Test;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** 悬浮球几何口径（px）：夹紧、初始位置、面板默认落点。 */
public class OverlayGeometryTest {

    private static final int EDGE = 8;

    @Test public void clampKeepsRectInsideScreen() {
        assertArrayEquals(new int[] { 0, 0 }, OverlayGeometry.clamp(-20, -30, 52, 52, 390, 844, 0));
        assertArrayEquals(new int[] { 338, 792 }, OverlayGeometry.clamp(9999, 9999, 52, 52, 390, 844, 0));
        assertArrayEquals(new int[] { 8, 8 }, OverlayGeometry.clamp(0, 0, 52, 52, 390, 844, EDGE));
    }

    @Test public void landscapeScreenAllowsFullWidth() {
        // 横屏 844x390：球可以拖到最右侧，不再被竖屏宽度卡在左半屏
        int[] right = OverlayGeometry.clamp(9999, 200, 52, 52, 844, 390, 0);
        assertEquals(844 - 52, right[0]);
        int[] middle = OverlayGeometry.clamp(600, 200, 52, 52, 844, 390, 0);
        assertEquals(600, middle[0]);
    }

    @Test public void startPositionSitsNearRightEdge() {
        int[] position = OverlayGeometry.startPosition(52, 52, 390, 844, 16, 0.42f);
        assertEquals(390 - 52 - 16, position[0]);
        assertEquals(Math.round(844 * 0.42f), position[1]);
    }

    @Test public void panelOpensOnTheOppositeSideOfTheBall() {
        // 球在左半屏 → 面板贴右边缘
        int[] right = OverlayGeometry.oppositeOfBall(268, 258, 8, 100, 52, 52, 375, 812, EDGE);
        assertEquals(375 - 268 - EDGE, right[0]);
        // 球在右半屏 → 面板贴左边缘
        int[] left = OverlayGeometry.oppositeOfBall(268, 258, 315, 100, 52, 52, 375, 812, EDGE);
        assertEquals(EDGE, left[0]);
    }

    @Test public void panelNeverCoversTheBall() {
        int[][] balls = {
            { 0, 0 }, { 338, 0 }, { 0, 792 }, { 338, 792 }, { 169, 396 }, { 280, 400 }, { 60, 400 }
        };
        for (int[] ball : balls) {
            int[] position = OverlayGeometry.oppositeOfBall(
                268, 300, ball[0], ball[1], 52, 52, 390, 844, EDGE);
            assertFalse(
                "球在 " + ball[0] + "," + ball[1] + " 时面板压住了球",
                OverlayGeometry.overlaps(
                    position[0], position[1], 268, 300, ball[0], ball[1], 52, 52, EDGE));
        }
    }

    @Test public void panelAlwaysStaysOnScreen() {
        int[][] balls = {
            { 0, 0 }, { 338, 0 }, { 0, 792 }, { 338, 792 }, { 169, 396 }
        };
        for (int[] ball : balls) {
            int[] position = OverlayGeometry.oppositeOfBall(
                268, 300, ball[0], ball[1], 52, 52, 390, 844, EDGE);
            assertTrue(position[0] >= EDGE);
            assertTrue(position[1] >= EDGE);
            assertTrue(position[0] + 268 <= 390 - EDGE);
            assertTrue(position[1] + 300 <= 844 - EDGE);
        }
    }
}
