package com.localdatatool.toolbox.capture;

/**
 * 悬浮球的几何口径（2026-11-08）。
 *
 * <p>悬浮球本体、详情卡、以及展开面板都从这里取「夹紧 / 初始位置 / 面板默认落点」的算法，
 * 避免各写一套。纯整数计算，不依赖 Android，单位统一为**屏幕像素 px**
 * （调用方先把 dp 换算成 px）。</p>
 *
 * <p>屏幕尺寸的唯一来源是 {@link BattleOverlayController#screenSize()}：它按当前旋转取
 * DisplayManager 的真实屏幕尺寸（Activity 退到后台也不会停在旋转前的旧值）。</p>
 */
public final class OverlayGeometry {

    private OverlayGeometry() { }

    /**
     * 把矩形夹进屏幕内，四周至少留 {@code edge}。
     *
     * @return {left, top}
     */
    public static int[] clamp(int x, int y, int width, int height,
                              int screenWidth, int screenHeight, int edge) {
        int minX = Math.max(0, edge);
        int minY = Math.max(0, edge);
        int maxX = Math.max(minX, screenWidth - width - minX);
        int maxY = Math.max(minY, screenHeight - height - minY);
        return new int[] {
            Math.max(minX, Math.min(x, maxX)),
            Math.max(minY, Math.min(y, maxY))
        };
    }

    /**
     * 首次显示位置：贴右侧、按屏幕高度比例放垂直位置，然后夹紧。
     *
     * @param verticalRatio 0~1，例如 0.42 表示从顶部往下 42% 处
     * @return {left, top}
     */
    public static int[] startPosition(int width, int height,
                                      int screenWidth, int screenHeight,
                                      int edge, float verticalRatio) {
        int right = Math.max(0, screenWidth - width - edge);
        int top = Math.round(screenHeight * Math.max(0f, Math.min(1f, verticalRatio)));
        return clamp(right, top, width, height, screenWidth, screenHeight, edge);
    }

    /**
     * 面板 / 详情卡的默认落点：球在哪一侧，就从另一侧展开。
     *
     * <p>只做三条规则，不再逐级试位置：</p>
     * <ol>
     *   <li>横向：球心在左半屏就贴右边缘，在右半屏就贴左边缘；</li>
     *   <li>纵向先对齐球，若横向仍与球重叠，再放到球上方或下方；</li>
     *   <li>最后夹进屏幕（上下都放不下时贴向离球最远的垂直边）。</li>
     * </ol>
     *
     * <p>球本身不动，面板默认不压住球；用户之后可以自己拖面板。</p>
     *
     * @param gap 面板与屏边 / 面板与球之间的间距（px）
     * @return {left, top}
     */
    public static int[] oppositeOfBall(int width, int height,
                                       int ballX, int ballY, int ballWidth, int ballHeight,
                                       int screenWidth, int screenHeight, int gap) {
        int edge = Math.max(0, gap);
        boolean ballOnRight = ballX + ballWidth / 2 >= screenWidth / 2;
        int x = ballOnRight ? edge : screenWidth - width - edge;
        int y = ballY;
        int[] spot = clamp(x, y, width, height, screenWidth, screenHeight, edge);
        x = spot[0];
        y = spot[1];

        if (overlaps(x, y, width, height, ballX, ballY, ballWidth, ballHeight, gap)) {
            int above = ballY - gap - height;
            int below = ballY + ballHeight + gap;
            if (above >= edge) {
                y = above;
            } else if (below + height <= screenHeight - edge) {
                y = below;
            } else {
                // 上下都放不下：贴向离球最远的那条横边，宁可溢出也不压球
                y = ballY + ballHeight / 2 < screenHeight / 2 ? screenHeight - height - edge : edge;
            }
        }

        return clamp(x, y, width, height, screenWidth, screenHeight, edge);
    }

    /** 两个矩形是否相交（含间距）。 */
    public static boolean overlaps(int x, int y, int width, int height,
                                   int otherX, int otherY, int otherWidth, int otherHeight, int gap) {
        return x < otherX + otherWidth + gap && x + width > otherX - gap
            && y < otherY + otherHeight + gap && y + height > otherY - gap;
    }
}
