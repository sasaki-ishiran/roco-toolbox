package com.localdatatool.toolbox.capture;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.SpannableString;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.ReplacementSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

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
    private static final String CARD_TITLE = "战斗采集 · 赛季奇遇";

    private static final int COLOR_ORB_IDLE = 0xFF334155;
    private static final int COLOR_ORB_HIT = 0xFFF43F5E;
    private static final int COLOR_CARD_BG = 0xFFFFFFFF;
    private static final int COLOR_TITLE = 0xFF1E293B;
    private static final int COLOR_CHIP_BG = 0xFFF1F5F9;
    private static final int COLOR_CHIP_TEXT = 0xFF475569;
    private static final int COLOR_HOT_BG = 0xFFFEF3C7;
    private static final int COLOR_HOT_TEXT = 0xFFB45309;
    private static final int COLOR_PRIMARY_BG = 0xFF1E293B;
    private static final int COLOR_EMPTY_TEXT = 0xFF94A3B8;

    private static final int ORB_DP = 52;
    private static final int CARD_DP = 216;
    private static final int EDGE_DP = 8;
    private static final int DRAG_SLOP_DP = 8;

    private final Activity activity;
    private final WindowManager windowManager;
    private final SharedPreferences prefs;

    private View orb;
    private WindowManager.LayoutParams orbParams;
    private LinearLayout card;
    private WindowManager.LayoutParams cardParams;
    private TextView fieldsView1;
    private TextView fieldsView2;
    private ValueAnimator pulse;
    private JSONObject lastPayload;

    /** 拖动状态：down 时的原始坐标与球当时的左上角 */
    private float downRawX;
    private float downRawY;
    private int startX;
    private int startY;
    private boolean dragged;

    public BattleOverlayController(Activity activity) {
        this.activity = activity;
        this.windowManager = (WindowManager) activity.getSystemService(Context.WINDOW_SERVICE);
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 有没有「显示在其他应用上层」权限。 */
    public boolean canDraw() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(activity);
    }

    /**
     * 网页推来最新状态。
     *
     * @return {@code ok} 已显示 / 已隐藏；{@code need-permission} 需要用户重新授权
     */
    public String update(JSONObject payload) {
        lastPayload = payload;
        boolean visible = payload != null && payload.optBoolean("visible", false);
        if (!canDraw()) {
            removeAll();
            return visible ? "need-permission" : "ok";
        }
        if (!visible) {
            removeAll();
            return "ok";
        }
        render(payload);
        // 权限在、窗口却没挂上（系统回收 / ROM 拒绝 addView）：不能对外说「已经显示」
        return orb == null ? "need-permission" : "ok";
    }

    /** 用户从系统设置页回来：如果还在采集，把上次的状态重新画上去。 */
    public void onResume() {
        if (lastPayload == null) return;
        update(lastPayload);
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
        removeAll();
        lastPayload = null;
    }

    private void render(JSONObject payload) {
        // 字段非空不代表窗口还在：撤销悬浮窗权限、ROM 回收悬浮窗之后 View 已 detach，
        // 此时必须整体重建，否则球会永久消失，网页还以为显示正常。
        if (orb != null && !orb.isAttachedToWindow()) removeAll();
        if (orb == null) addOrb();
        if (orb == null) return;
        if (card != null && !card.isAttachedToWindow()) removeCard();
        setHit(payload.optBoolean("hit", false));
        if (card != null && fieldsView1 != null && fieldsView2 != null) {
            JSONArray fields = payload.optJSONArray("fields");
            fieldsView1.setText(buildFields(fields, 1));
            fieldsView2.setText(buildFields(fields, 2));
            fieldsView1.setVisibility(fieldsView1.getText().length() == 0 ? View.GONE : View.VISIBLE);
            fieldsView2.setVisibility(fieldsView2.getText().length() == 0 ? View.GONE : View.VISIBLE);
            // 换个体后标签宽度会变（自适应宽度），要重新算一次避让位置
            placeCard();
        }
    }

    private void addOrb() {
        int size = dp(ORB_DP);
        ImageView view = new ImageView(activity);
        view.setScaleType(ImageView.ScaleType.FIT_CENTER);
        // 球里放工具箱的桌面图标，留一圈底色
        view.setPadding(dp(10), dp(10), dp(10), dp(10));
        try {
            view.setImageDrawable(activity.getApplicationInfo().loadIcon(activity.getPackageManager()));
        } catch (Exception ignored) {
            // 拿不到图标就只显示纯色球
        }
        GradientDrawable shape = new GradientDrawable();
        shape.setShape(GradientDrawable.OVAL);
        shape.setColor(COLOR_ORB_IDLE);
        view.setBackground(shape);
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

        orb.setOnTouchListener(this::onTouch);
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
                return true;
            case MotionEvent.ACTION_MOVE: {
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                // 手指抖动不算拖动，否则想点开详情会变成挪球
                if (!dragged && Math.hypot(dx, dy) < dp(DRAG_SLOP_DP)) return true;
                dragged = true;
                orbParams.x = startX + Math.round(dx);
                orbParams.y = startY + Math.round(dy);
                clampToScreen(orbParams);
                safeUpdate(orb, orbParams);
                placeCard();
                return true;
            }
            case MotionEvent.ACTION_UP: {
                orbParams.x = startX + Math.round(event.getRawX() - downRawX);
                orbParams.y = startY + Math.round(event.getRawY() - downRawY);
                clampToScreen(orbParams);
                safeUpdate(orb, orbParams);
                if (dragged) {
                    prefs.edit().putInt(KEY_X, orbParams.x).putInt(KEY_Y, orbParams.y).apply();
                    placeCard();
                } else {
                    toggleCard();
                }
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                dragged = false;
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
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        layout.addView(title);

        // 固定两排：第一排名字/性别/等级/性格/声音，第二排身高体重（2026-11-08）
        JSONArray fields = lastPayload == null ? null : lastPayload.optJSONArray("fields");
        int maxWidth = Math.max(dp(180), screenSize().x - dp(48));
        fieldsView1 = buildFieldsView(maxWidth, buildFields(fields, 1), 6);
        fieldsView2 = buildFieldsView(maxWidth, buildFields(fields, 2), 2);
        layout.addView(fieldsView1);
        LinearLayout.LayoutParams row2Params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        row2Params.topMargin = dp(4);
        layout.addView(fieldsView2, row2Params);

        // 宽度跟着内容走（标签自适应），不再固定 216dp，声音带负号也不会被挤成三行
        cardParams = new WindowManager.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
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

    /** 单排字段 TextView：宽度随内容，超出 maxWidth 才换行（兜底，正常一排放得下）。 */
    private TextView buildFieldsView(int maxWidth, CharSequence text, int topMarginDp) {
        TextView view = new TextView(activity);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        view.setTextColor(COLOR_CHIP_TEXT);
        // 关掉字体默认上下留白，否则小标签会在行内偏上、看起来没有垂直居中
        view.setIncludeFontPadding(false);
        view.setLineSpacing(dpF(4), 1f);
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
     * 卡片贴在球旁边，尽量不挡球、也不出屏。
     *
     * 顺序：右侧 → 左侧 → 哪边空间大贴哪边；垂直方向以球为中心。
     * 两边都挤不下时改为球的上方 / 下方，避免卡片盖住球。
     */
    private void placeCard() {
        if (card == null || cardParams == null || orbParams == null) return;
        Point screen = screenSize();
        int gap = dp(EDGE_DP);
        int width = cardWidth();
        int height = cardHeight(width);
        int orbLeft = orbParams.x;
        int orbTop = orbParams.y;
        int orbRight = orbLeft + orbParams.width;
        int orbBottom = orbTop + orbParams.height;

        int x;
        if (orbRight + gap + width <= screen.x - gap) {
            x = orbRight + gap;
        } else if (orbLeft - gap - width >= gap) {
            x = orbLeft - gap - width;
        } else {
            // 左右都放不下：贴向空间更大的一侧，稍后改为上下排布
            x = orbLeft + orbParams.width / 2 < screen.x / 2 ? screen.x - width - gap : gap;
        }

        int y = orbTop + orbParams.height / 2 - height / 2;
        y = Math.max(gap, Math.min(y, Math.max(gap, screen.y - height - gap)));

        // 左右都挤不下时卡片会压住球，这里统一兜底改成球的上方 / 下方
        if (overlaps(x, y, width, height, orbLeft, orbTop, orbRight, orbBottom, gap)) {
            int above = orbTop - gap - height;
            int below = orbBottom + gap;
            if (above >= gap) y = above;
            else if (below + height <= screen.y - gap) y = below;
        }

        x = Math.max(gap, Math.min(x, Math.max(gap, screen.x - width - gap)));
        y = Math.max(gap, Math.min(y, Math.max(gap, screen.y - height - gap)));
        cardParams.x = x;
        cardParams.y = y;
        safeUpdate(card, cardParams);
    }

    private static boolean overlaps(int x, int y, int width, int height,
                                    int left, int top, int right, int bottom, int gap) {
        return x < right + gap && x + width > left - gap && y < bottom + gap && y + height > top - gap;
    }

    /**
     * 卡片真实宽度。宽度是 WRAP_CONTENT，addView 后 / measure 前
     * 都先主动量一次，否则避让会当成 0 宽处理。
     */
    private int cardWidth() {
        if (card == null) return dp(CARD_DP);
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

    private void setHit(boolean next) {
        if (orb != null) {
            GradientDrawable shape = new GradientDrawable();
            shape.setShape(GradientDrawable.OVAL);
            shape.setColor(next ? COLOR_ORB_HIT : COLOR_ORB_IDLE);
            orb.setBackground(shape);
        }
        if (next) startPulse();
        else stopPulse();
    }

    private void startPulse() {
        if (pulse != null || orb == null) return;
        pulse = ValueAnimator.ofFloat(1f, 0.72f);
        pulse.setDuration(700);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.addUpdateListener(animation -> {
            if (orb != null) orb.setAlpha((float) animation.getAnimatedValue());
        });
        pulse.start();
    }

    private void stopPulse() {
        if (pulse != null) {
            pulse.cancel();
            pulse = null;
        }
        if (orb != null) orb.setAlpha(1f);
    }

    /** 详情字段：每个字段一个圆角小标签，和网页里的小标签保持一致；只取指定排。 */
    private CharSequence buildFields(JSONArray fields, int row) {
        if (fields == null || fields.length() == 0) {
            if (row == 2) return "";
            String empty = "进入赛季奇遇战后，这里会显示个体数据";
            SpannableString text = new SpannableString(empty);
            text.setSpan(new ForegroundColorSpan(COLOR_EMPTY_TEXT), 0, empty.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            return text;
        }
        SpannableStringBuilder builder = new SpannableStringBuilder();
        for (int index = 0; index < fields.length(); index++) {
            JSONObject field = fields.optJSONObject(index);
            if (field == null) continue;
            if (field.optInt("row", 1) != row) continue;
            String value = field.optString("text", "");
            if (value.isEmpty()) continue;
            boolean primary = field.optBoolean("primary", false);
            boolean hot = field.optBoolean("hot", false);
            if (builder.length() > 0) builder.append(' ');
            int start = builder.length();
            builder.append(value);
            int end = builder.length();
            int background = primary ? COLOR_PRIMARY_BG : hot ? COLOR_HOT_BG : COLOR_CHIP_BG;
            int foreground = primary ? Color.WHITE : hot ? COLOR_HOT_TEXT : COLOR_CHIP_TEXT;
            builder.setSpan(
                new ChipSpan(background, foreground, dpF(6), dp(6), dp(3)),
                start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return builder;
    }

    private void removeAll() {
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
        stopPulse();
        if (orb == null) return;
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
    private Point screenSize() {
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
        params.x = Math.max(0, screen.x - params.width - dp(16));
        params.y = Math.max(0, Math.round(screen.y * 0.42f));
        clampToScreen(params);
    }

    /** 拖动 / 屏幕旋转后：只夹在屏幕内，绝不换位置。 */
    private void clampToScreen(WindowManager.LayoutParams params) {
        Point screen = screenSize();
        params.x = Math.max(0, Math.min(params.x, Math.max(0, screen.x - params.width)));
        params.y = Math.max(0, Math.min(params.y, Math.max(0, screen.y - params.height)));
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
