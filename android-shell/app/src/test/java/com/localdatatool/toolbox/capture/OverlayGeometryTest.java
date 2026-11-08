package com.localdatatool.toolbox.capture;

import org.junit.Test;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** 悬浮球几何口径（px）：夹紧、初始位置、贴球避让、四角判定。 */
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

    @Test public void cardPrefersRightThenLeftThenAboveBelow() {
        // 球在左上：右侧放得下
        int[] right = OverlayGeometry.besideBall(200, 120, 20, 100, 52, 52, 390, 844, EDGE);
        assertEquals(20 + 52 + EDGE, right[0]);

        // 球在右上：右侧放不下，改左侧
        int[] left = OverlayGeometry.besideBall(200, 120, 320, 100, 52, 52, 390, 844, EDGE);
        assertEquals(320 - EDGE - 200, left[0]);

        // 球在屏幕正中、左右都放不下：改到上方或下方，且不压住球
        int[] noRoom = OverlayGeometry.besideBall(200, 120, 170, 380, 52, 52, 390, 844, EDGE);
        assertFalse(OverlayGeometry.overlaps(noRoom[0], noRoom[1], 200, 120, 170, 380, 52, 52, EDGE));
    }

    @Test public void cardAlwaysStaysOnScreen() {
        int[][] balls = {
            { 0, 0 }, { 338, 0 }, { 0, 792 }, { 338, 792 }, { 169, 396 }
        };
        for (int[] ball : balls) {
            int[] position = OverlayGeometry.besideBall(260, 200, ball[0], ball[1], 52, 52, 390, 844, EDGE);
            assertTrue(position[0] >= EDGE);
            assertTrue(position[1] >= EDGE);
            assertTrue(position[0] + 260 <= 390 - EDGE);
            assertTrue(position[1] + 200 <= 844 - EDGE);
        }
    }

    @Test public void cornerOfReportsNearestCorner() {
        assertEquals(0, OverlayGeometry.cornerOf(8, 8, 52, 52, 390, 844));
        assertEquals(1, OverlayGeometry.cornerOf(330, 8, 52, 52, 390, 844));
        assertEquals(2, OverlayGeometry.cornerOf(8, 784, 52, 52, 390, 844));
        assertEquals(3, OverlayGeometry.cornerOf(330, 784, 52, 52, 390, 844));
    }
}
