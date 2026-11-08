package com.localdatatool.toolbox.capture;

/**
 * 悬浮球的几何口径（2026-11-08）。
 *
 * <p>悬浮球本体、详情卡、以及后续的展开面板都从这里取「夹紧 / 初始位置 / 贴球避让 /
 * 球心朝向」的算法，避免各写一套。纯整数计算，不依赖 Android，单位统一为**屏幕像素 px**
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
     * 详情卡 / 面板贴在球旁边：右侧 → 左侧 → 空间大的一侧；再不行就放球的上方 / 下方；
     * 最后夹进屏幕。全程保证不压住球。
     *
     * @param gap 面板与球、面板与屏幕边之间的间距（px）
     * @return {left, top}
     */
    public static int[] besideBall(int width, int height,
                                   int ballX, int ballY, int ballWidth, int ballHeight,
                                   int screenWidth, int screenHeight, int gap) {
        int ballRight = ballX + ballWidth;
        int ballBottom = ballY + ballHeight;
        int x;
        if (ballRight + gap + width <= screenWidth - gap) {
            x = ballRight + gap;
        } else if (ballX - gap - width >= gap) {
            x = ballX - gap - width;
        } else {
            // 左右都放不下：先贴向空间更大的一侧，下面再改成上下排布
            x = ballX + ballWidth / 2 < screenWidth / 2 ? screenWidth - width - gap : gap;
        }

        int y = ballY + ballHeight / 2 - height / 2;
        int[] first = clamp(x, y, width, height, screenWidth, screenHeight, gap);
        x = first[0];
        y = first[1];

        if (overlaps(x, y, width, height, ballX, ballY, ballWidth, ballHeight, gap)) {
            int above = ballY - gap - height;
            int below = ballBottom + gap;
            if (above >= gap) y = above;
            else if (below + height <= screenHeight - gap) y = below;
        }

        return clamp(x, y, width, height, screenWidth, screenHeight, gap);
    }

    /** 两个矩形是否相交（含间距）。 */
    public static boolean overlaps(int x, int y, int width, int height,
                                   int otherX, int otherY, int otherWidth, int otherHeight, int gap) {
        return x < otherX + otherWidth + gap && x + width > otherX - gap
            && y < otherY + otherHeight + gap && y + height > otherY - gap;
    }

    /**
     * 球心在屏幕的哪个角，供展开面板决定朝哪个方向展开。
     *
     * @return 0 = 左上，1 = 右上，2 = 左下，3 = 右下
     */
    public static int cornerOf(int ballX, int ballY, int ballWidth, int ballHeight,
                               int screenWidth, int screenHeight) {
        boolean right = ballX + ballWidth / 2 >= screenWidth / 2;
        boolean bottom = ballY + ballHeight / 2 >= screenHeight / 2;
        return (bottom ? 2 : 0) + (right ? 1 : 0);
    }
}
