package com.localdatatool.toolbox.capture;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffColorFilter;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.SpannableString;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.ReplacementSpan;
import android.util.TypedValue;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 战斗采集悬浮球（系统级，2026-11-08）。
 *
 * 网页里的元素只能在应用内显示；玩家切到游戏后要看提醒，必须由壳自己用
 * {@link WindowManager} 画一层 {@code TYPE_APPLICATION_OVERLAY} 窗口，浮在其它应用上方。
 *
 * 分工：
 * - 网页（BattleHudOrb）负责解码战斗帧、判断是否命中目标，把状态推过来；
 * - 这里只做展示：圆形小球（默认深灰 / 命中变红 + 呼吸）、点击展开详情、拖动并记住位置。
 *
 * 位置存在 SharedPreferences，下次采集 / 重启应用都还在原处。
 * 没有「显示在其他应用上层」权限时不会 addView（Android 8+ 会直接抛异常），
 * 而是回 {@code need-permission}，让网页给出授权入口。
 */
public final class BattleOverlayController {

    private static final String PREFS = "battle-overlay";
    private static final String KEY_X = "x";
    private static final String KEY_Y = "y";
    /** 长按隐藏后的状态存档：重开 App / 重新采集都保持隐藏，直到用户在附近页点「显示悬浮球」 */
    private static final String KEY_HIDDEN = "hidden";
    private static final String CARD_TITLE = "战斗采集 · 赛季奇遇";

    private static final int COLOR_CARD_BG = 0xFFFFFFFF;
    private static final int COLOR_TITLE = 0xFF1E293B;
    private static final int COLOR_CHIP_BG = 0xFFF1F5F9;
    private static final int COLOR_CHIP_TEXT = 0xFF475569;
    private static final int COLOR_HOT_BG = 0xFFFEF3C7;
    private static final int COLOR_HOT_TEXT = 0xFFB45309;
    private static final int COLOR_PRIMARY_BG = 0xFF1E293B;
    private static final int COLOR_EMPTY_TEXT = 0xFF94A3B8;
    /** 命中时图标本身的颜色（不额外加圈 / 红点 / 色块） */
    private static final int COLOR_HIT_ICON = 0xFFE11D48;

    private static final int ORB_DP = 52;
    /**
     * 图标本体缩放（2026-11-10 定稿 0.85）：只缩画面，不缩触摸热区。
     * 球窗口仍是 {@link #ORB_DP}（52dp 热区），靠内边距把图标等比收进 0.85 倍的空间，
     * 拖动、夹取、命中染色都不受影响。
     */
    private static final float ORB_ICON_SCALE = 0.85f;
    /** 详情卡固定宽度（2026-11-13）：320dp ≈ 375 屏的 85%，13sp 的第一排标签正好排满。 */
    private static final int CARD_WIDTH_DP = 320;
    private static final int EDGE_DP = 8;
    private static final int DRAG_SLOP_DP = 8;
    /** 长按判定：按住 500ms 且位移不超过 slop 才算长按隐藏，超过按拖动处理 */
    private static final long LONG_PRESS_MS = 500L;
    /**
     * 拖拽结束吸边阈值（2026-11-10）：球中心距屏幕左右边缘 8dp 以内就吸附到该边，
     * 只对齐 x，保留原来的上下位置（不上下吸）。
     */
    private static final int SNAP_THRESHOLD_DP = 8;
    /** 吸附后多久没有操作开始半透明（常量，方便以后调）。 */
    private static final long SNAP_FADE_DELAY_MS = 3000L;
    /** 吸附静置后的透明度：50%。 */
    private static final float SNAP_IDLE_ALPHA = 0.5f;

    private final Activity activity;
    private final WindowManager windowManager;
    private final SharedPreferences prefs;
    private final DisplayManager displayManager;

    /** 展开面板（附近 + 命中区）；球的拖动 / 夹取 / 避让仍由本类负责（2026-11-08） */
    private final NearbyPanelController nearbyPanel;
    private View orb;
    private WindowManager.LayoutParams orbParams;
    private LinearLayout card;
    private WindowManager.LayoutParams cardParams;
    private TextView fieldsView1;
    private TextView fieldsView2;
    /** 卡片内容宽（px，已扣掉左右内边距）：两排标签按它做两端对齐 */
    private int cardContentWidth;
    private JSONObject lastPayload;

    /** 拖动状态：down 时的原始坐标与球当时的左上角 */
    private float downRawX;
    private float downRawY;
    private int startX;
    private int startY;
    private boolean dragged;
    /** 本次按下是否已经触发长按隐藏（触发后抬手不再当点击） */
    private boolean longPressed;
    /** 当前吸附到哪一侧：0 未吸附，1 左边缘，2 右边缘（面板按它决定向左 / 向右展开） */
    private int snappedSide;
    /** 手指是否正按在球上：按着的时候不做半透明 */
    private boolean pressed;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable longPressHide = () -> {
        if (dragged || orb == null) return;
        longPressed = true;
        setOrbHidden(true);
    };
    /** 吸附后 3 秒无操作：图标降到 50%；任何按下都会立刻恢复 100% 并重排这个定时器。 */
    private final Runnable snapFade = () -> {
        if (orb == null || pressed || snappedSide == 0) return;
        orb.setAlpha(SNAP_IDLE_ALPHA);
    };
    /** 点击球的回调；面板侧接管展开逻辑时设置，默认展开内置的命中卡。 */
    private TapListener tapListener;

    /** 点击球（非拖动）的回调。 */
    public interface TapListener { void onTap(); }

    /**
     * 设置点击回调。面板侧实现自己的展开逻辑时用它接管，**不需要改拖动/位置代码**。
     * 传 null 恢复默认（展开内置命中卡）。
     */
    public void setTapListener(TapListener listener) { this.tapListener = listener; }

    public BattleOverlayController(Activity activity) {
        this.activity = activity;
        // 必须用 Application 的 WindowManager：Activity 的 WindowManager 带着 Activity 窗口令牌，
        // 窗口会被限制在 Activity 自己的显示区域里（竖屏宽度），横屏游戏里就表现为「只能拖到左半屏」。
        Context appContext = activity.getApplicationContext();
        this.windowManager = (WindowManager) appContext.getSystemService(Context.WINDOW_SERVICE);
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.displayManager = (DisplayManager) appContext.getSystemService(Context.DISPLAY_SERVICE);
        this.nearbyPanel = new NearbyPanelController(activity);
        // 附近面板接管点击：有附近数据就展开面板（命中区 + 地图 + 列表），
        // 没推过数据时仍是原来的命中卡，球的拖动 / 位置代码不动。
        setTapListener(() -> {
            if (nearbyPanel.hasNearbyData()) {
                removeCard();
                // 展开前把球当前坐标同步过去，面板按「球在哪侧就从另一侧展开」定默认落点
                syncPanelAnchor();
                nearbyPanel.toggle();
            } else {
                toggleCard();
            }
        });
        if (displayManager != null) {
            displayManager.registerDisplayListener(displayListener, new Handler(Looper.getMainLooper()));
        }
    }

    /**
     * 横竖屏切换 / 折叠屏展开时重新夹位置并让卡片重新避让（2026-11-08）。
     *
     * Activity 在后台（用户在游戏里）时也要响应旋转，所以监听的是显示服务，而不是 Activity 的配置变化。
     */
    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int displayId) { }
        @Override public void onDisplayRemoved(int displayId) { }
        @Override public void onDisplayChanged(int displayId) {
            if (displayId != Display.DEFAULT_DISPLAY) return;
            if (orbParams != null) {
                clampToScreen(orbParams);
                safeUpdate(orb, orbParams);
                syncPanelAnchor();
            }
            placeCard();
            Point screen = screenSize();
            nearbyPanel.onScreenChanged(screen.x, screen.y);
        }
    };

    /** 有没有「显示在其他应用上层」权限。 */
    public boolean canDraw() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(activity);
    }

    /**
     * 网页推来最新状态。
     *
     * @return {@code ok} 已显示 / 已隐藏；{@code need-permission} 需要用户授权
     */
    public String update(JSONObject payload) {
        lastPayload = payload;
        boolean visible = payload != null && payload.optBoolean("visible", false);
        nearbyPanel.updateBattle(payload);
        if (!canDraw()) {
            removeAll();
            return visible || nearbyPanel.nearbyVisible() ? "need-permission" : "ok";
        }
        if (!visible) {
            removeCard();
            if (!nearbyPanel.nearbyVisible()) removeAll();
            return "ok";
        }
        render(payload);
        return "ok";
    }

    /**
     * 网页推来「附近」面板数据（含 panels 配置）。
     * 只负责显隐与转发，球的绘制仍走 {@link #update}。
     */
    public String updateNearby(JSONObject payload) {
        if (!canDraw()) {
            nearbyPanel.updateNearby(payload);
            removeAll();
            return "need-permission";
        }
        nearbyPanel.updateNearby(payload);
        if (!nearbyPanel.nearbyVisible()) {
            boolean battleVisible = lastPayload != null && lastPayload.optBoolean("visible", false);
            if (!battleVisible) removeAll();
            return "ok";
        }
        // 附近数据到了就以面板为准，旧命中卡不再叠在球旁边
        removeCard();
        if (orb == null && !readOrbHidden()) addOrb();
        syncPanelAnchor();
        return "ok";
    }

    /** 用户从系统设置页回来：如果还在采集，把上次的状态重新画上去。 */
    public void onResume() {
        if (lastPayload != null) update(lastPayload);
        nearbyPanel.reapply();
        if (nearbyPanel.nearbyVisible() && orb == null && !readOrbHidden() && canDraw()) addOrb();
    }

    /** 跳系统设置授予悬浮窗权限。 */
    public String requestPermission() {
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
            return "";
        } catch (Exception error) {
            return "无法打开悬浮窗权限设置，请到系统设置里手动开启";
        }
    }

    public void destroy() {
        main.removeCallbacks(longPressHide);
        main.removeCallbacks(snapFade);
        if (displayManager != null) displayManager.unregisterDisplayListener(displayListener);
        removeAll();
        nearbyPanel.release();
        lastPayload = null;
    }

    private void render(JSONObject payload) {
        if (orb == null && !readOrbHidden()) addOrb();
        if (orb == null) return;
        setHit(payload.optBoolean("hit", false));
        syncPanelAnchor();
        if (card != null && fieldsView1 != null && fieldsView2 != null) {
            JSONArray fields = payload.optJSONArray("fields");
            fieldsView1.setText(buildFields(fields, 1, cardContentWidth));
            fieldsView2.setText(buildFields(fields, 2, cardContentWidth));
            fieldsView1.setVisibility(fieldsView1.getText().length() == 0 ? View.GONE : View.VISIBLE);
            fieldsView2.setVisibility(fieldsView2.getText().length() == 0 ? View.GONE : View.VISIBLE);
            // 换个体后高度会变（第二排可能换行 / 变空），要重新算一次避让位置
            placeCard();
        }
    }

    private void addOrb() {
        int size = dp(ORB_DP);
        ImageView view = new ImageView(activity);
        view.setScaleType(ImageView.ScaleType.FIT_CENTER);
        // 1.3.6 起只放图标本体：不再加白底方框 / 边框 / 呼吸，命中只改图标颜色
        try {
            view.setImageDrawable(activity.getApplicationInfo().loadIcon(activity.getPackageManager()));
        } catch (Exception ignored) {
            // 拿不到图标就留空球，不影响点击与拖动
        }
        // 只缩小图标本体：视图（= 触摸热区）仍是 ORB_DP，内边距让 FIT_CENTER 等比缩到 0.7 倍
        int iconInset = Math.round(size * (1f - ORB_ICON_SCALE) / 2f);
        view.setPadding(iconInset, iconInset, iconInset, iconInset);
        orb = view;

        orbParams = new WindowManager.LayoutParams(
            size, size,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        orbParams.gravity = Gravity.TOP | Gravity.START;
        orbParams.x = prefs.getInt(KEY_X, -1);
        orbParams.y = prefs.getInt(KEY_Y, -1);
        applyStartPosition(orbParams);
        // 上次退出时就停在边上：按存档位置恢复吸附状态，3 秒无操作照样半透明
        snappedSide = snapSideOf(orbParams);

        orb.setOnTouchListener(this::onTouch);
        scheduleSnapFade();
        try {
            windowManager.addView(orb, orbParams);
        } catch (Exception error) {
            orb = null;
            orbParams = null;
        }
    }

    private boolean onTouch(View view, MotionEvent event) {
        if (orbParams == null) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                startX = orbParams.x;
                startY = orbParams.y;
                dragged = false;
                longPressed = false;
                // 按下立刻恢复不透明，并取消「3 秒无操作」的半透明排期
                pressed = true;
                main.removeCallbacks(snapFade);
                view.setAlpha(1f);
                main.postDelayed(longPressHide, LONG_PRESS_MS);
                return true;
            case MotionEvent.ACTION_MOVE: {
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                // 手指抖动不算拖动，否则想点开详情会变成挪球
                if (!dragged && Math.hypot(dx, dy) < dp(DRAG_SLOP_DP)) return true;
                dragged = true;
                // 拖动中视为「已脱离吸附」：保持 100% 不透明，松手后再按新位置判定
                if (snappedSide != 0) {
                    snappedSide = 0;
                    main.removeCallbacks(snapFade);
                }
                main.removeCallbacks(longPressHide);
                orbParams.x = startX + Math.round(dx);
                orbParams.y = startY + Math.round(dy);
                clampToScreen(orbParams);
                safeUpdate(orb, orbParams);
                syncPanelAnchor();
                placeCard();
                return true;
            }
            case MotionEvent.ACTION_UP: {
                main.removeCallbacks(longPressHide);
                pressed = false;
                if (longPressed) return true;
                orbParams.x = startX + Math.round(event.getRawX() - downRawX);
                orbParams.y = startY + Math.round(event.getRawY() - downRawY);
                clampToScreen(orbParams);
                // 拖动结束才做吸边判定：只对齐 x，y 保持用户松手时的位置
                if (dragged) snappedSide = snapSideOf(orbParams);
                safeUpdate(orb, orbParams);
                syncPanelAnchor();
                scheduleSnapFade();
                if (dragged) {
                    prefs.edit().putInt(KEY_X, orbParams.x).putInt(KEY_Y, orbParams.y).apply();
                    placeCard();
                } else if (tapListener != null) {
                    tapListener.onTap();
                } else {
                    toggleCard();
                }
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                main.removeCallbacks(longPressHide);
                pressed = false;
                dragged = false;
                longPressed = false;
                scheduleSnapFade();
                return true;
            default:
                return false;
        }
    }

    private void toggleCard() {
        if (card != null) {
            removeCard();
        } else {
            addCard();
        }
    }

    private void addCard() {
        if (card != null || orbParams == null) return;

        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable background = new GradientDrawable();
        background.setColor(COLOR_CARD_BG);
        background.setCornerRadius(dpF(16));
        layout.setBackground(background);
        layout.setPadding(dp(12), dp(10), dp(12), dp(10));

        TextView title = new TextView(activity);
        title.setText(CARD_TITLE);
        title.setTextColor(COLOR_TITLE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        layout.addView(title);

        // 固定两排：第一排名字/性别/等级/性格/声音，第二排身高体重（2026-11-08）
        JSONArray fields = lastPayload == null ? null : lastPayload.optJSONArray("fields");
        int cardWidth = cardBoxWidth();
        cardContentWidth = Math.max(0, cardWidth - dp(12) * 2);
        fieldsView1 = buildFieldsView(cardContentWidth, buildFields(fields, 1, cardContentWidth), 6);
        fieldsView2 = buildFieldsView(cardContentWidth, buildFields(fields, 2, cardContentWidth), 5);
        layout.addView(fieldsView1);
        LinearLayout.LayoutParams row2Params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        row2Params.topMargin = dp(5);
        layout.addView(fieldsView2, row2Params);

        // 固定 320dp（2026-11-13）：宽度不再跟着内容走，第二排右侧那截空白由两端对齐吃掉
        cardParams = new WindowManager.LayoutParams(
            cardWidth, WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        cardParams.gravity = Gravity.TOP | Gravity.START;

        card = layout;
        try {
            windowManager.addView(card, cardParams);
        } catch (Exception error) {
            card = null;
            fieldsView1 = null;
            fieldsView2 = null;
            return;
        }
        placeCard();
    }

    /** 单排字段 TextView：两排都按卡片内容宽排（两端对齐由 span 计算，超宽才换行兜底）。 */
    private TextView buildFieldsView(int maxWidth, CharSequence text, int topMarginDp) {
        TextView view = new TextView(activity);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        view.setTextColor(COLOR_CHIP_TEXT);
        // 关掉字体默认上下留白，否则小标签会在行内偏上、看起来没有垂直居中
        view.setIncludeFontPadding(false);
        view.setLineSpacing(dpF(5), 1f);
        view.setMaxWidth(maxWidth);
        view.setText(text);
        // 空排（如还没进战斗时的第二排）不占位
        if (text.length() == 0) view.setVisibility(View.GONE);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(topMarginDp);
        view.setLayoutParams(params);
        return view;
    }

    /**
     * 详情卡（没有附近数据时的兜底）贴在球的另一侧，尽量不挡球、也不出屏。
     *
     * <p>只做一条规则：球在左半屏就贴右侧，在右半屏就贴左侧；横向仍重叠时改到球的上方 / 下方。
     * 不再逐级试位置的「智能避让」（用户反馈效果差、还容易盖住球）。</p>
     */
    private void placeCard() {
        if (card == null || cardParams == null || orbParams == null) return;
        Point screen = screenSize();
        int gap = dp(EDGE_DP);
        int width = cardWidth();
        int height = cardHeight(width);
        int[] position = OverlayGeometry.oppositeOfBall(
            width, height,
            orbParams.x, orbParams.y, orbParams.width, orbParams.height,
            screen.x, screen.y, gap);
        cardParams.x = position[0];
        cardParams.y = position[1];
        safeUpdate(card, cardParams);
    }

    /**
     * 卡片固定宽度：320dp；屏幕更窄时退回「屏宽 − 48dp」的上限保护
     * （两侧各留 8dp 边距 + 悬浮球的可视余地）。
     */
    private int cardBoxWidth() {
        return Math.min(dp(CARD_WIDTH_DP), Math.max(dp(180), screenSize().x - dp(48)));
    }

    /**
     * 卡片真实宽度。宽度是固定值，addView 后 / measure 前仍主动量一次，
     * 避免避让把还没布局的卡片当成 0 宽处理。
     */
    private int cardWidth() {
        if (card == null) return cardBoxWidth();
        if (card.getWidth() > 0) return card.getWidth();
        card.measure(
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        return Math.max(card.getMeasuredWidth(), dp(120));
    }

    /**
     * 卡片真实高度。刚 addView 时 {@code getHeight()} 还是 0，
     * 直接拿它算避让会把卡片当成 0 高，看起来像「压在小球上」。
     */
    private int cardHeight(int width) {
        if (card == null) return dp(120);
        if (card.getHeight() > 0) return card.getHeight();
        card.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        return Math.max(card.getMeasuredHeight(), dp(60));
    }

    /**
     * 隐藏 / 显示悬浮球（1.3.6）：长按球 500ms 隐藏，附近页的「显示悬浮球」恢复。
     * 隐藏只是摘掉窗口，采集照常跑；状态写进 SharedPreferences，重开 App 仍然隐藏。
     */
    public String setOrbHidden(boolean hidden) {
        prefs.edit().putBoolean(KEY_HIDDEN, hidden).apply();
        if (hidden) {
            removeCard();
            nearbyPanel.remove();
            removeOrb();
            return "ok";
        }
        if (orb == null && canDraw()) {
            addOrb();
            if (lastPayload != null) render(lastPayload);
        }
        return "ok";
    }

    /** 悬浮球当前是否被用户隐藏（网页用它决定按钮文案）。 */
    public boolean readOrbHidden() {
        return prefs.getBoolean(KEY_HIDDEN, false);
    }

    private void setHit(boolean next) {
        // 命中只改图标本身的颜色：不呼吸、不加圈、不加红点
        if (orb instanceof ImageView) {
            ((ImageView) orb).setColorFilter(next
                ? new PorterDuffColorFilter(COLOR_HIT_ICON, PorterDuff.Mode.SRC_IN)
                : null);
        }
    }

    /**
     * 详情字段：每个字段一个圆角小标签，和网页里的小标签保持一致；只取指定排。
     *
     * <p>两端对齐（2026-11-13）：卡片固定宽度后，按 {@code contentWidth} 把剩余空隙摊到标签之间——
     * 第一排有 4 个空隙就均分；第二排只有 2 个标签，多出来的全给中间那个空隙，形成左右贴边。
     * 内容本身放不下时（例如系统字体放大到 1.3×）退回单个空格分隔，交给 TextView 换行兜底。</p>
     */
    private CharSequence buildFields(JSONArray fields, int row, int contentWidth) {
        List<String> values = new ArrayList<>();
        List<Integer> backgrounds = new ArrayList<>();
        List<Integer> foregrounds = new ArrayList<>();
        if (fields != null) {
            for (int index = 0; index < fields.length(); index++) {
                JSONObject field = fields.optJSONObject(index);
                if (field == null) continue;
                if (field.optInt("row", 1) != row) continue;
                String value = field.optString("text", "");
                if (value.isEmpty()) continue;
                boolean primary = field.optBoolean("primary", false);
                boolean hot = field.optBoolean("hot", false);
                values.add(value);
                backgrounds.add(primary ? COLOR_PRIMARY_BG : hot ? COLOR_HOT_BG : COLOR_CHIP_BG);
                foregrounds.add(primary ? Color.WHITE : hot ? COLOR_HOT_TEXT : COLOR_CHIP_TEXT);
            }
        }
        if (values.isEmpty()) {
            if (row == 2) return "";
            String empty = "进入赛季奇遇战后，这里会显示个体数据";
            SpannableString text = new SpannableString(empty);
            text.setSpan(new ForegroundColorSpan(COLOR_EMPTY_TEXT), 0, empty.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            return text;
        }

        // 按 TextView 实际使用的字号量一遍每枚标签的宽度（ChipSpan.getSize 的算法），
        // 用它算两端对齐的间隙，而不是靠布局权重——权重会把单枚标签也拉宽、圆角变形。
        Paint measure = new Paint(Paint.ANTI_ALIAS_FLAG);
        measure.setTextSize(spF(13));
        int chipsTotal = 0;
        for (int i = 0; i < values.size(); i++) {
            chipsTotal += (int) Math.ceil(measure.measureText(values.get(i))) + dp(8) * 2;
        }
        int gaps = values.size() - 1;
        // 留 2dp 余量：span 累计宽度四舍五入后比卡片内容宽多 1px 就会触发换行
        int target = Math.max(0, contentWidth - dp(2));
        int baseGap = dp(3);
        boolean justify = gaps > 0 && chipsTotal + baseGap * gaps <= target;
        int spare = justify ? target - chipsTotal - baseGap * gaps : 0;

        SpannableStringBuilder builder = new SpannableStringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                int gapStart = builder.length();
                builder.append(' ');
                if (justify) {
                    // 余数补给第一个空隙，整排正好铺满内容宽
                    int extra = i == 1 ? spare % gaps : 0;
                    builder.setSpan(
                        new GapSpan(baseGap + spare / gaps + extra),
                        gapStart, gapStart + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
            }
            int start = builder.length();
            builder.append(values.get(i));
            builder.setSpan(
                new ChipSpan(backgrounds.get(i), foregrounds.get(i), dpF(7), dp(8), dp(4)),
                start, builder.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return builder;
    }

    /** 把球当前屏幕坐标同步给面板（面板只在展开时用来算默认落点，之后不再跟着球走）。 */
    private void syncPanelAnchor() {
        if (orbParams == null) return;
        Point screen = screenSize();
        // 吸附在右边缘时面板向左展开，其余情况一律在球的右侧（不做智能避让）
        nearbyPanel.setOrbRect(
            orbParams.x, orbParams.y, orbParams.width, screen.x, screen.y, snappedSide == 2);
    }

    /**
     * 吸边判定（2026-11-10）：球中心距屏幕左右边缘 8dp 以内就吸附到该边。
     * 只改 x、不动 y，所以吸附本身不会让球上下跳。
     *
     * @return 0 未吸附，1 左边缘，2 右边缘
     */
    private int snapSideOf(WindowManager.LayoutParams params) {
        Point screen = screenSize();
        float centerX = params.x + params.width / 2f;
        int threshold = dp(SNAP_THRESHOLD_DP);
        if (centerX <= threshold) {
            params.x = 0;
            return 1;
        }
        if (centerX >= screen.x - threshold) {
            params.x = screen.x - params.width;
            return 2;
        }
        return 0;
    }

    /** 吸附且 3 秒无操作后半透明；没吸附则立刻恢复 100%。 */
    private void scheduleSnapFade() {
        main.removeCallbacks(snapFade);
        if (orb == null) return;
        if (snappedSide == 0) {
            orb.setAlpha(1f);
            return;
        }
        main.postDelayed(snapFade, SNAP_FADE_DELAY_MS);
    }

    private void removeAll() {
        nearbyPanel.remove();
        removeCard();
        removeOrb();
    }

    private void removeCard() {
        if (card == null) return;
        try {
            windowManager.removeView(card);
        } catch (Exception ignored) {
            // Activity 已销毁 / 窗口已不在：忽略
        }
        card = null;
        fieldsView1 = null;
        fieldsView2 = null;
    }

    private void removeOrb() {
        if (orb == null) return;
        main.removeCallbacks(snapFade);
        snappedSide = 0;
        pressed = false;
        try {
            windowManager.removeView(orb);
        } catch (Exception ignored) {
            // 同上
        }
        orb = null;
        orbParams = null;
    }

    private void safeUpdate(View view, WindowManager.LayoutParams params) {
        if (view == null || params == null) return;
        try {
            windowManager.updateViewLayout(view, params);
        } catch (Exception ignored) {
            // 窗口还没加上 / 已移除：下次位置变化时再更新
        }
    }

    @SuppressWarnings("deprecation")
    Point screenSize() {
        // 悬浮窗的坐标是「整块屏幕」，不是 Activity 的窗口。Activity 退到后台后
        // getCurrentWindowMetrics 可能还停在旋转前的尺寸（横屏时只有左半屏能拖动、
        // 卡片避让到中间），所以直接问显示服务要当前旋转下的真实屏幕尺寸。
        Display display = displayManager == null ? null : displayManager.getDisplay(Display.DEFAULT_DISPLAY);
        if (display == null) {
            display = Build.VERSION.SDK_INT >= 30 ? activity.getDisplay() : windowManager.getDefaultDisplay();
        }
        if (display != null) {
            Point real = new Point();
            display.getRealSize(real);
            if (real.x > 0 && real.y > 0) return real;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            Rect bounds = windowManager.getCurrentWindowMetrics().getBounds();
            return new Point(bounds.width(), bounds.height());
        }
        Point size = new Point();
        windowManager.getDefaultDisplay().getSize(size);
        return size;
    }

    /**
     * 首次显示：没存过位置才放到右侧偏下；存过就只夹到屏幕内。
     *
     * 这里必须和拖动分开写——旧版把「越界」和「没位置」都当成 x<0 处理，
     * 结果拖到左边缘时小球会瞬间跳到右侧默认位置。
     */
    private void applyStartPosition(WindowManager.LayoutParams params) {
        if (params.x >= 0 && params.y >= 0) {
            clampToScreen(params);
            return;
        }
        Point screen = screenSize();
        int[] position = OverlayGeometry.startPosition(
            params.width, params.height, screen.x, screen.y, dp(16), 0.42f);
        params.x = position[0];
        params.y = position[1];
        clampToScreen(params);
    }

    /** 把球夹进屏幕（不留边距，允许贴到 0）。 */
    private void clampToScreen(WindowManager.LayoutParams params) {
        Point screen = screenSize();
        int[] position = OverlayGeometry.clamp(
            params.x, params.y, params.width, params.height, screen.x, screen.y, 0);
        params.x = position[0];
        params.y = position[1];
    }

    private static int overlayType() {
        return Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private int dp(int value) {
        return Math.round(dpF(value));
    }

    private float dpF(float value) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics());
    }

    /** sp → px：和 {@code TextView.setTextSize(SP, …)} 同一套换算，量标签宽度时才和实际渲染一致。 */
    private float spF(float value) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, value, activity.getResources().getDisplayMetrics());
    }

    /** 两端对齐用的空隙：占一个空格位置，但不画任何东西，宽度由调用方算好。 */
    private static final class GapSpan extends ReplacementSpan {

        private final int width;

        GapSpan(int width) {
            this.width = width;
        }

        @Override
        public int getSize(Paint base, CharSequence text, int start, int end, Paint.FontMetricsInt metrics) {
            return width;
        }

        @Override
        public void draw(Canvas canvas, CharSequence text, int start, int end, float x,
                         int top, int y, int bottom, Paint base) {
            // 只有宽度，没有内容
        }
    }

    /**
     * 圆角标签背景：给一段文字画底色，与网页的 chip 一致。
     *
     * 垂直方向按字体基线做对称扩展（{@code ascent - paddingVertical} ~
     * {@code descent + paddingVertical}），所以无论行高怎么变，
     * 文字都落在底色正中间；同时 {@link #getSize} 把这段高度写回
     * {@link Paint.FontMetricsInt}，否则底色会盖到相邻两行上。
     */
    private static final class ChipSpan extends ReplacementSpan {

        private final int background;
        private final int foreground;
        private final float radius;
        private final int paddingHorizontal;
        private final int paddingVertical;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        ChipSpan(int background, int foreground, float radius, int paddingHorizontal, int paddingVertical) {
            this.background = background;
            this.foreground = foreground;
            this.radius = radius;
            this.paddingHorizontal = paddingHorizontal;
            this.paddingVertical = paddingVertical;
        }

        @Override
        public int getSize(Paint base, CharSequence text, int start, int end, Paint.FontMetricsInt metrics) {
            if (metrics != null) {
                Paint.FontMetricsInt font = base.getFontMetricsInt();
                metrics.ascent = font.ascent - paddingVertical;
                metrics.descent = font.descent + paddingVertical;
                metrics.top = font.top - paddingVertical;
                metrics.bottom = font.bottom + paddingVertical;
            }
            return (int) Math.ceil(base.measureText(text, start, end)) + paddingHorizontal * 2;
        }

        @Override
        public void draw(Canvas canvas, CharSequence text, int start, int end, float x,
                         int top, int y, int bottom, Paint base) {
            float width = base.measureText(text, start, end);
            Paint.FontMetricsInt font = base.getFontMetricsInt();
            // y 是文字基线：以基线为基准上下各扩一段，底色自然包住文字且上下等距
            float rectTop = y + font.ascent - paddingVertical;
            float rectBottom = y + font.descent + paddingVertical;
            paint.setColor(background);
            canvas.drawRoundRect(
                new RectF(x, rectTop, x + width + paddingHorizontal * 2, rectBottom),
                radius, radius, paint);
            int previous = base.getColor();
            base.setColor(foreground);
            canvas.drawText(text, start, end, x + paddingHorizontal, y, base);
            base.setColor(previous);
        }
    }
}
