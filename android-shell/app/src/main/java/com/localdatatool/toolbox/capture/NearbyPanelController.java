package com.localdatatool.toolbox.capture;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.ReplacementSpan;
import android.text.style.StyleSpan;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 「附近」悬浮面板（2026-11-08）。
 *
 * <p>只负责面板本身：展开后的命中区、标题行、内嵌网页小地图、精灵列表与脚注。
 * 球的图标 / 拖动 / 夹取仍由 {@link BattleOverlayController} 负责，本类通过
 * {@link #setOrbRect(int, int, int, int, int)} 拿球当前的屏幕坐标，只在**首次展开**时
 * 按「球在哪一侧就从另一侧展开」算一个不压住球的落点（{@link OverlayGeometry#oppositeOfBall}）。</p>
 *
 * <p>面板可拖动（按住标题栏 / 空白区），松手把位置写进 SharedPreferences，下次展开沿用；
 * 地图是 WebView，自己吃掉触摸，按在图上不会拖动面板。</p>
 */
public final class NearbyPanelController {

    private static final int CARD_RADIUS_DP = 12;
    private static final int TITLE_HEIGHT_DP = 14;
    private static final int MAP_RADIUS_DP = 8;
    /**
     * overlay-map.html 的版面尺寸（html/body 与脚本里的 SIZE 都写死 120px）。
     * 面板 214 后地图只有 {@link NearbyOverlayModel#MAP_SIZE}=90，整页按 90/120 缩放，
     * 否则自己点不在画面中心、240m 视野右下被裁掉。
     */
    private static final int ROW_RADIUS_DP = 6;
    /** 「可提醒」行左侧红条（1.3.6 起标签改底色，只有提醒保留一条 3dp 红条）。 */
    private static final int ALERT_BAR_DP = 3;
    /** 面板位置存档：拖过一次后，下次展开沿用。 */
    private static final String PREFS = "nearby-panel";
    private static final String KEY_PANEL_X = "x";
    private static final String KEY_PANEL_Y = "y";
    private static final int DRAG_SLOP_DP = 4;

    private final Activity activity;
    private final WindowManager windowManager;
    private final SharedPreferences prefs;
    private final String catalogJson;

    private JSONObject nearbyPayload;
    private JSONObject battlePayload;
    private boolean expanded;

    private FrameLayout panel;
    private WindowManager.LayoutParams panelParams;
    private LinearLayout hitBox;
    private TextView hitRow1;
    private TextView hitRow2;
    private TextView hitEmpty;
    private LinearLayout titleRow;
    private TextView titleText;
    private TextView estimatedBadge;
    private FrameLayout mapBox;
    private WebView mapView;
    private boolean mapReady;
    /** 列表外层滚动容器：高度与小地图对齐，超出上下滑动（1.3.9） */
    private ScrollView listScroll;
    private LinearLayout listBox;
    /** 列表内容签名：不变就不重建行，否则每秒推送都会打断滑动（1.3.9） */
    private String listSignature;
    private TextView footView;
    private boolean hasOrbRect;
    private int lastOrbX;
    private int lastOrbY;
    private int lastOrbSize;
    /** 球是否吸附在右边缘：是则面板向左展开，否则一律在球的右侧（2026-11-10）。 */
    private boolean lastOrbSnappedRight;
    private int lastScreenWidth;
    private int lastScreenHeight;
    /** 本次展开是否已经定过落点；用户拖过之后不再按默认规则重算 */
    private boolean positioned;
    private float downRawX;
    private float downRawY;
    private int dragStartX;
    private int dragStartY;
    private boolean dragging;

    // ── 卡顿量化（1.3.9）：RocoPerf 每 5 秒一行，真机 adb logcat -s RocoPerf 可看 ──
    private static final String PERF_TAG = "RocoPerf";
    private static final long PERF_INTERVAL_MS = 5000L;
    /** 网页推来的 payload 次数（约每秒 1 次） */
    private int perfPayloads;
    /** 其中面板展开 / 收起时的 payload 次数（2026-11-10：区分「render=0 是因为面板没开」） */
    private int perfPayloadOpen;
    private int perfPayloadClosed;
    /** 面板 re-render 次数 */
    private int perfRenders;
    /** 列表重建 / 因签名相同跳过重建的次数 */
    private int perfListRebuilds;
    private int perfSignatureSkips;
    /** 推给 WebView 重绘地图的次数 / 其中地图中心真的平移了的次数 */
    private int perfMapPushes;
    private int perfMapPans;
    private long perfParseUsTotal;
    private long perfParseUsMax;
    /**
     * 网页侧解码轮询实测（2026-11-10）：每轮「取增量字节 / worker 解码」耗时、
     * 每轮字节数、相邻两轮间隔。由 payload 的 perf 字段带上来，只在 RocoPerf 里打印。
     * -1 = 旧网页没有该字段（不是 0ms）。
     */
    private int perfReadAvg = -1;
    private int perfReadMax = -1;
    private int perfDecodeAvg = -1;
    private int perfDecodeMax = -1;
    private int perfRoundBytes = -1;
    private int perfRoundGap = -1;
    private int perfRoundCount = -1;
    private long perfSince = SystemClock.elapsedRealtime();
    /** 上一次推给地图的自身坐标：用来判断这次推送有没有平移 */
    private double lastPushedSelfX = Double.NaN;
    private double lastPushedSelfY = Double.NaN;
    /** 最近一次 render 的关键字段（payload 指纹 / 自身坐标 / 来源 / 最短距离） */
    private String lastFingerprint = "-";
    private String lastSelfSource = "-";
    private double lastSelfX = Double.NaN;
    private double lastSelfY = Double.NaN;
    private long lastSelfAt;
    private Double lastNearestM;
    private boolean released;
    private final Handler perfHandler = new Handler(Looper.getMainLooper());
    private final Runnable perfTick = () -> {
        logPerf(true);
        schedulePerf();
    };

    public NearbyPanelController(Activity activity) {
        this.activity = activity;
        // 必须用 Application 的 WindowManager：Activity 的 WindowManager 带着 Activity
        // 窗口令牌，窗口会被限制在 Activity 的显示区域里（竖屏宽度），横屏游戏里就表现为
        // 「只能拖到左半屏」。球和面板统一走这一份。
        this.windowManager = (WindowManager) activity.getApplicationContext()
            .getSystemService(Context.WINDOW_SERVICE);
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.lastScreenWidth = activity.getResources().getDisplayMetrics().widthPixels;
        this.lastScreenHeight = activity.getResources().getDisplayMetrics().heightPixels;
        String catalog = readAsset("maps/maps.json");
        this.catalogJson = catalog;
        // 常驻性能采样：不管面板展没展开都每 5 秒输出一行 RocoPerf
        schedulePerf();
    }

    /** 网页推来的附近 payload（含 panels 配置）；返回给网页的结果固定是 ok。 */
    public String updateNearby(JSONObject payload) {
        perfPayloads++;
        nearbyPayload = payload;
        rememberRoundPerf(payload);
        if (nearbyPayload == null || !nearbyPayload.optBoolean("visible", false)) {
            perfPayloadClosed++;
            collapse();
            logPerf();
            return "ok";
        }
        if (expanded) {
            perfPayloadOpen++;
            render();
        } else {
            perfPayloadClosed++;
        }
        logPerf();
        return "ok";
    }

    /** 战斗命中 payload：只用于命中区内容，球本身仍由 BattleOverlayController 画。 */
    public void updateBattle(JSONObject payload) {
        battlePayload = payload;
        if (expanded) render();
    }

    /** 附近数据是否可见（球要不要留着由它和战斗状态共同决定）。 */
    public boolean nearbyVisible() {
        return nearbyPayload != null && nearbyPayload.optBoolean("visible", false);
    }

    /** 网页有没有推过附近数据；没有推过时球点击保持收起。 */
    public boolean hasNearbyData() {
        return nearbyPayload != null;
    }

    public boolean isExpanded() {
        return expanded;
    }

    /** 球点击：有数据才展开；再点收起。 */
    public void toggle() {
        if (!nearbyVisible()) return;
        if (expanded) {
            collapse();
        } else {
            expanded = true;
            if (panel == null) addPanel();
            render();
        }
    }

    /**
     * 记录球当前的位置与屏幕尺寸，供**首次展开**时算默认落点：
     * 默认在球的右侧、与球同一垂直位置；球吸附在右边缘时改为向左展开。
     * 球拖动时只更新记录，不移动已经展开的面板。
     */
    public void setOrbRect(int orbX, int orbY, int orbSize, int screenWidth, int screenHeight,
                           boolean snappedRight) {
        hasOrbRect = true;
        lastOrbX = orbX;
        lastOrbY = orbY;
        lastOrbSize = orbSize;
        lastScreenWidth = screenWidth;
        lastScreenHeight = screenHeight;
        lastOrbSnappedRight = snappedRight;
    }

    /** 屏幕旋转 / 尺寸变化：把面板夹回新的屏幕范围，不重算默认落点。 */
    public void onScreenChanged(int screenWidth, int screenHeight) {
        lastScreenWidth = screenWidth;
        lastScreenHeight = screenHeight;
        if (panel == null || panelParams == null) return;
        clampPanel();
        safeUpdate();
    }

    /** 权限回来 / 屏幕变化后把已展开的面板重新挂回去。 */
    public void reapply() {
        if (!nearbyVisible() || !expanded) return;
        if (panel == null) addPanel();
        render();
    }

    /**
     * 面板落点（2026-11-10）：
     * <ul>
     *   <li>有球的位置 → 固定在球的右侧、与球同一垂直位置；球吸附在右边缘时向左展开。
     *       不做智能避让、不自动换边，只把结果夹回屏幕内；</li>
     *   <li>还没有球的位置 → 沿用存档位置；</li>
     *   <li>都没有 → 屏幕默认位置。</li>
     * </ul>
     */
    private void placePanel() {
        if (panel == null || panelParams == null) return;
        int edge = dp(NearbyOverlayModel.EDGE);
        if (!positioned) {
            int savedX = prefs.getInt(KEY_PANEL_X, Integer.MIN_VALUE);
            int savedY = prefs.getInt(KEY_PANEL_Y, Integer.MIN_VALUE);
            int[] spot;
            if (hasOrbRect) {
                int anchorX = lastOrbSnappedRight
                    ? lastOrbX - edge - panelParams.width
                    : lastOrbX + lastOrbSize + edge;
                spot = OverlayGeometry.clamp(anchorX, lastOrbY,
                    panelParams.width, panelParams.height,
                    lastScreenWidth, lastScreenHeight, edge);
            } else if (savedX != Integer.MIN_VALUE && savedY != Integer.MIN_VALUE) {
                spot = OverlayGeometry.clamp(savedX, savedY,
                    panelParams.width, panelParams.height,
                    lastScreenWidth, lastScreenHeight, edge);
            } else {
                spot = OverlayGeometry.startPosition(
                    panelParams.width, panelParams.height,
                    lastScreenWidth, lastScreenHeight, edge, 0.3f);
            }
            panelParams.x = spot[0];
            panelParams.y = spot[1];
            positioned = true;
        } else {
            clampPanel();
        }
        safeUpdate();
    }

    /** 把面板夹进当前屏幕（四边留 {@code EDGE}）。 */
    private void clampPanel() {
        if (panelParams == null) return;
        int[] spot = OverlayGeometry.clamp(
            panelParams.x, panelParams.y, panelParams.width, panelParams.height,
            lastScreenWidth, lastScreenHeight, dp(NearbyOverlayModel.EDGE));
        panelParams.x = spot[0];
        panelParams.y = spot[1];
    }

    /**
     * 面板拖动：按住标题栏 / 空白区就能拖走，松手记住位置。
     *
     * <p>地图是 WebView，它自己吃掉触摸，所以按在图上不会拖动面板；
     * 面板上的文字标签不消费事件，会把事件冒泡到这里。</p>
     */
    private boolean onPanelTouch(View view, MotionEvent event) {
        if (panelParams == null) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                dragStartX = panelParams.x;
                dragStartY = panelParams.y;
                dragging = false;
                return true;
            case MotionEvent.ACTION_MOVE: {
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                if (!dragging && Math.hypot(dx, dy) < dp(DRAG_SLOP_DP)) return true;
                dragging = true;
                panelParams.x = dragStartX + Math.round(dx);
                panelParams.y = dragStartY + Math.round(dy);
                clampPanel();
                safeUpdate();
                return true;
            }
            case MotionEvent.ACTION_UP:
                if (dragging) {
                    panelParams.x = dragStartX + Math.round(event.getRawX() - downRawX);
                    panelParams.y = dragStartY + Math.round(event.getRawY() - downRawY);
                    clampPanel();
                    safeUpdate();
                    prefs.edit()
                        .putInt(KEY_PANEL_X, panelParams.x)
                        .putInt(KEY_PANEL_Y, panelParams.y)
                        .apply();
                }
                dragging = false;
                return true;
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                return true;
            default:
                return false;
        }
    }

    /**
     * 收起面板（窗口摘掉，但保留已加载的网页小地图，下次展开直接复用）。
     */
    public void remove() {
        collapse();
    }

    /** Activity 销毁时彻底释放 WebView。 */
    public void release() {
        released = true;
        perfHandler.removeCallbacks(perfTick);
        collapse();
        destroyMap();
    }

    private void collapse() {
        expanded = false;
        positioned = false;
        dragging = false;
        if (panel == null) return;
        try {
            windowManager.removeView(panel);
        } catch (Exception ignored) {
            // 窗口已经不在：忽略
        }
        panel.removeAllViews();
        panel = null;
        panelParams = null;
        hitBox = null;
        hitRow1 = null;
        hitRow2 = null;
        hitEmpty = null;
        titleRow = null;
        titleText = null;
        estimatedBadge = null;
        mapBox = null;
        listScroll = null;
        listBox = null;
        listSignature = null;
        footView = null;
    }

    private void addPanel() {
        PanelTheme theme = theme();
        FrameLayout root = new FrameLayout(activity);
        root.setBackground(cardBackground(theme));
        root.setClipToOutline(true);

        panelParams = new WindowManager.LayoutParams(
            dp(NearbyOverlayModel.PANEL_WIDTH), dp(NearbyOverlayModel.HIT_HEIGHT),
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT);
        panelParams.gravity = Gravity.TOP | Gravity.START;
        panel = root;
        // 面板要能拖动，所以不再加 FLAG_NOT_TOUCHABLE；焦点仍然不抢，
        // 面板以外的触摸照旧交给游戏（FLAG_NOT_TOUCH_MODAL）。
        root.setOnTouchListener(this::onPanelTouch);

        hitBox = buildHitBox(theme);
        titleRow = buildTitleRow(theme);
        mapBox = buildMapBox();
        listBox = new LinearLayout(activity);
        listBox.setOrientation(LinearLayout.VERTICAL);
        // 列表比地图高时在框内上下滑动：高度与小地图对齐，不再把面板拉长
        listScroll = new PanelScrollView(activity);
        listScroll.setVerticalScrollBarEnabled(false);
        listScroll.setFillViewport(true);
        listScroll.setClipToPadding(false);
        listScroll.addView(listBox, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        listSignature = null;
        footView = text("", 9, theme.muted);
        footView.setGravity(Gravity.CENTER_VERTICAL);
        footView.setSingleLine(true);
        footView.setEllipsize(TextUtils.TruncateAt.END);

        root.addView(hitBox, frame(0, 0, NearbyOverlayModel.PANEL_WIDTH, NearbyOverlayModel.HIT_HEIGHT));
        root.addView(titleRow, frame(8, 0, NearbyOverlayModel.PANEL_WIDTH - 16, TITLE_HEIGHT_DP));
        root.addView(mapBox, frame(8, 0, NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.MAP_SIZE));
        root.addView(listScroll, frame(8, 0, NearbyOverlayModel.PANEL_WIDTH - 16, NearbyOverlayModel.EMPTY_BODY_HEIGHT));
        root.addView(footView, frame(8, 0, NearbyOverlayModel.PANEL_WIDTH - 16, NearbyOverlayModel.FOOT_TEXT_HEIGHT));

        try {
            windowManager.addView(root, panelParams);
        } catch (Exception error) {
            panel = null;
            panelParams = null;
            expanded = false;
            return;
        }
    }

    private LinearLayout buildHitBox(PanelTheme theme) {
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(8), dp(5), dp(8), dp(6));
        box.setBackground(hitBackground(theme));

        LinearLayout header = new LinearLayout(activity);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text(NearbyOverlayModel.HIT_TITLE, 11, theme.text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        // 右上角的小三角只是装饰，看起来像「点一下收起」，1.3.6 起删掉
        header.addView(title, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        box.addView(header, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(16)));

        hitRow1 = chipRow(theme);
        hitRow2 = chipRow(theme);
        box.addView(hitRow1, chipRowParams(2));
        box.addView(hitRow2, chipRowParams(2));

        hitEmpty = text(NearbyOverlayModel.HIT_EMPTY_TEXT, 9.5f, theme.muted);
        hitEmpty.setLineSpacing(dpF(1), 1f);
        box.addView(hitEmpty, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return box;
    }

    private TextView chipRow(PanelTheme theme) {
        TextView view = new TextView(activity);
        // 面板收到 214 后 chips 只剩 198 宽：字号与左右 padding 一起压一档，避免被截断
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
        view.setTextColor(theme.chipText);
        view.setIncludeFontPadding(false);
        view.setSingleLine(true);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setGravity(Gravity.CENTER_VERTICAL);
        return view;
    }

    private LinearLayout.LayoutParams chipRowParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(15));
        params.topMargin = dp(topMarginDp);
        return params;
    }

    private LinearLayout buildTitleRow(PanelTheme theme) {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        titleText = text("", 11, theme.text);
        titleText.setTypeface(Typeface.DEFAULT_BOLD);
        titleText.setSingleLine(true);
        estimatedBadge = text(NearbyOverlayModel.ESTIMATED_BADGE, 9, 0xFFF59E0B);
        estimatedBadge.setGravity(Gravity.CENTER);
        estimatedBadge.setPadding(dp(3), 0, dp(3), 0);
        estimatedBadge.setBackground(badgeBackground());
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(13));
        badgeParams.leftMargin = dp(5);
        row.addView(titleText, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        row.addView(estimatedBadge, badgeParams);
        return row;
    }

    private FrameLayout buildMapBox() {
        FrameLayout box = new FrameLayout(activity);
        box.setBackground(mapBackground());
        box.setClipToOutline(true);
        mapView = createMapView();
        if (mapView != null) {
            box.addView(mapView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        return box;
    }

    private WebView createMapView() {
        try {
            WebView view = new WebView(activity);
            view.setBackgroundColor(Color.TRANSPARENT);
            // 纯展示：不抢焦点、不吃触摸，触摸事件交给下面的游戏
            view.setFocusable(false);
            view.setFocusableInTouchMode(false);
            view.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
            view.setLongClickable(false);
            view.setHapticFeedbackEnabled(false);
            view.setOnTouchListener((v, event) -> true);
            WebSettings settings = view.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(false);
            settings.setAllowFileAccess(true);
            settings.setBlockNetworkLoads(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(false);
            settings.setLoadWithOverviewMode(false);
            settings.setTextZoom(100);
            // 地图页每 5 秒自己统计 update / rebuild / dots（见 overlay-map.html），
            // 只有把 console 转进 logcat 才能和壳端 RocoPerf 对照，否则看不出
            // 「地图点不跟」是没推送、还是重建了、还是点位全被裁掉（2026-11-10）。
            view.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onConsoleMessage(ConsoleMessage message) {
                    String text = message == null ? null : message.message();
                    if (text != null && text.startsWith("RocoPerf")) {
                        Log.i(PERF_TAG, text);
                        return true;
                    }
                    return false;
                }
            });
            view.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView webView, String url) {
                    return true;
                }
                /**
                 * 渲染进程被系统回收（2026-11-10 保活）：返回 true 保住进程，
                 * 下一轮主线程把这块地图 WebView 换掉并重载。重建后 onPageFinished
                 * 会重新 init 目录并 pushMapData()，地图状态自动恢复，面板布局不动。
                 */
                @Override public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    // 回调正跑在即将销毁的 client 里，不能在回调栈里销毁自己
                    perfHandler.post(() -> rebuildMapAfterRenderProcessGone(webView));
                    return true;
                }
                @Override public void onPageFinished(WebView webView, String url) {
                    mapReady = true;
                    // 地图页按容器尺寸自适应（overlay-map.html 读 innerWidth），面板缩到 90 时无需再整页缩放
                    if (catalogJson != null) {
                        webView.evaluateJavascript(
                            "window.RocoOverlayMap&&window.RocoOverlayMap.init("
                                + JSONObject.quote(catalogJson) + ")", null);
                    }
                    pushMapData();
                }
            });
            view.loadUrl("file:///android_asset/overlay-map.html");
            return view;
        } catch (Exception error) {
            return null;
        }
    }

    private void destroyMap() {
        if (mapView == null) return;
        try {
            mapView.loadUrl("about:blank");
            mapView.removeAllViews();
            mapView.destroy();
        } catch (Exception ignored) {
            // 已经销毁过：忽略
        }
        mapView = null;
        mapReady = false;
    }

    /**
     * 地图 WebView 的渲染进程被系统回收后的自愈（2026-11-10 保活）。
     *
     * <p>主页面自愈只重建了主 WebView；面板这块小地图是独立接线的 WebView，
     * 不跟着恢复的话表现就是「主页面活着、悬浮窗里的地图不动」。
     * 这里把死掉的视图摘掉、换一个新的，重载 overlay-map.html；
     * 接线、目录 init 与当前地图数据由 {@link #createMapView()} 的 onPageFinished
     * 自动重放，面板本身的布局与位置完全不动。</p>
     */
    private void rebuildMapAfterRenderProcessGone(WebView dead) {
        if (released || mapBox == null || dead != mapView) return;
        mapReady = false;
        if (dead.getParent() instanceof ViewGroup) {
            ((ViewGroup) dead.getParent()).removeView(dead);
        }
        try {
            dead.loadUrl("about:blank");
            dead.removeAllViews();
            dead.destroy();
        } catch (Exception ignored) {
            // 渲染进程已死：这些调用可能抛错，视图随后会被 GC
        }
        WebView fresh = createMapView();
        mapView = fresh;
        if (fresh != null) {
            mapBox.addView(fresh, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        } else {
            // 建不出来就留空，下一次展开会重新走 buildMapBox
            mapBox.setVisibility(View.GONE);
        }
    }

    private void render() {
        if (panel == null || panelParams == null) return;
        long parseStart = SystemClock.elapsedRealtimeNanos();
        NearbyOverlayModel model = NearbyOverlayModel.parse(nearbyPayload);
        long parseUs = (SystemClock.elapsedRealtimeNanos() - parseStart) / 1000L;
        perfRenders++;
        perfParseUsTotal += parseUs;
        perfParseUsMax = Math.max(perfParseUsMax, parseUs);
        if (model == null) {
            collapse();
            return;
        }
        // 排障快照（2026-11-10）：payload 到底有没有变化、自身坐标是不是同一份旧值
        lastFingerprint = fingerprint(model);
        lastSelfSource = model.selfSource != null
            ? model.selfSource
            : (model.selfX == null ? "none" : model.selfEstimated ? "odometry" : "packet");
        lastSelfX = model.selfX == null ? Double.NaN : model.selfX;
        lastSelfY = model.selfY == null ? Double.NaN : model.selfY;
        lastSelfAt = model.selfAt == null ? 0L : model.selfAt;
        lastNearestM = model.nearestM;
        PanelTheme theme = theme();
        panel.setBackground(cardBackground(theme));
        hitBox.setBackground(hitBackground(theme));

        boolean showBattle = model.battle;
        boolean hasHit = hasHitFields();
        boolean showNearby = model.nearby;
        int rows = model.shownRows();
        int hidden = model.hiddenCount();
        boolean hasMap = showNearby && hasMap(model);
        int hitHeight = !showBattle ? 0 : (hasHit ? NearbyOverlayModel.HIT_HEIGHT : NearbyOverlayModel.HIT_EMPTY_HEIGHT);
        int panelHeight = NearbyOverlayModel.panelHeight(
            showBattle, hasHit, showNearby, rows, hasMap, hidden);

        // ── 命中区 ─────────────────────────────────────
        hitBox.setVisibility(showBattle ? View.VISIBLE : View.GONE);
        if (showBattle) {
            setFrame(hitBox, 0, 0, NearbyOverlayModel.PANEL_WIDTH, hitHeight);
            hitEmpty.setVisibility(hasHit ? View.GONE : View.VISIBLE);
            hitRow1.setVisibility(hasHit ? View.VISIBLE : View.GONE);
            hitRow2.setVisibility(hasHit ? View.VISIBLE : View.GONE);
            if (hasHit) {
                hitRow1.setText(buildChips(theme, battlePayload.optJSONArray("fields"), 1,
                    battlePayload.optBoolean("hit", false)));
                hitRow2.setText(buildChips(theme, battlePayload.optJSONArray("fields"), 2, false));
                hitRow2.setVisibility(hitRow2.length() == 0 ? View.GONE : View.VISIBLE);
            }
        }

        // ── 标题行 ─────────────────────────────────────
        titleRow.setVisibility(showNearby ? View.VISIBLE : View.GONE);
        if (showNearby) {
            titleText.setText(model.titleText());
            titleText.setTextColor(theme.text);
            estimatedBadge.setVisibility(model.selfEstimated ? View.VISIBLE : View.GONE);
            setFrame(titleRow, 8, hitHeight + NearbyOverlayModel.TITLE_TOP_GAP,
                NearbyOverlayModel.PANEL_WIDTH - 16, TITLE_HEIGHT_DP);
        }

        // ── 地图 / 列表 / 脚注 ─────────────────────────
        mapBox.setVisibility(hasMap ? View.VISIBLE : View.GONE);
        listScroll.setVisibility(showNearby ? View.VISIBLE : View.GONE);
        if (showNearby) {
            int bodyTop = hitHeight + NearbyOverlayModel.BODY_TOP_GAP;
            // 列表可视高度不超过小地图：超出的条数在框内上下滑动，面板不再被列表拉长
            int bodyHeight = NearbyOverlayModel.bodyHeight(rows, hasMap);
            if (hasMap) {
                setFrame(mapBox, 8, bodyTop, NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.MAP_SIZE);
                setFrame(listScroll,
                    8 + NearbyOverlayModel.MAP_SIZE + NearbyOverlayModel.LIST_GAP,
                    bodyTop, NearbyOverlayModel.LIST_WIDTH, bodyHeight);
            } else {
                setFrame(listScroll, 8, bodyTop,
                    NearbyOverlayModel.PANEL_WIDTH - 16, bodyHeight);
            }
            // 内容签名不变就不重建：每秒推送都 removeAllViews 会把正在滑动的列表打断
            String signature = listSignature(model, rows);
            if (!signature.equals(listSignature)) {
                fillList(theme, model, rows);
                listSignature = signature;
                perfListRebuilds++;
            } else {
                perfSignatureSkips++;
            }
            footView.setVisibility(hidden > 0 ? View.VISIBLE : View.GONE);
            if (hidden > 0) {
                footView.setText(model.footText());
                footView.setTextColor(theme.muted);
                setFrame(footView, 8, panelHeight - 20,
                    NearbyOverlayModel.PANEL_WIDTH - 16, NearbyOverlayModel.FOOT_TEXT_HEIGHT);
            }
            pushMapData(model, hasMap);
        } else {
            footView.setVisibility(View.GONE);
        }

        panelParams.width = dp(NearbyOverlayModel.PANEL_WIDTH);
        panelParams.height = dp(panelHeight);
        placePanel();
    }

    /**
     * 列表内容签名（1.3.9 / 2026-11-12）：名称|等级|距离|箭头|牌子|命中原因|提醒|稀有|性格|性别|高|重|声音。
     * 每秒都会推送新 payload，但绝大多数字段没变；签名一致时保留现有行，
     * 用户正在滑动 / 点按就不会被 removeAllViews 打断。
     */
    private static String listSignature(NearbyOverlayModel model, int rows) {
        StringBuilder builder = new StringBuilder();
        builder.append(rows).append(model.waitingLogin() ? 'w' : '-');
        for (int index = 0; index < rows; index++) {
            NearbyOverlayModel.Pet pet = model.pets.get(index);
            builder.append('#').append(pet.name).append('|')
                .append(pet.level).append('|')
                .append(pet.distanceM == null ? "" : Math.round(pet.distanceM)).append('|')
                .append(pet.bearingArrow).append('|')
                .append(pet.bearingLabel).append('|')
                .append(TextUtils.join(",", pet.kinds)).append('|')
                .append(pet.reason).append('|')
                .append(pet.alert ? 'a' : '-')
                .append(pet.rare ? 'r' : '-').append('|')
                .append(pet.nature).append('|')
                .append(pet.gender).append('|')
                .append(pet.heightPct).append(',')
                .append(pet.weightPct).append(',')
                .append(pet.voiceDb);
        }
        return builder.toString();
    }

    /**
     * 列表：两行紧凑卡片（2026-11-12 档位二 214）——
     * 第一行「昵称 + Lv38」左对齐、「↗ 72m」右对齐（距离/方位永不省略）；
     * 第二行「高 · 重 · 声音」。行高 28 = 第一行 16 + 第二行 12。
     * 底色按 {@link NearbyOverlayModel#toneOf} 取六种之一，「可提醒」只在左侧留一条 3dp 红条。
     */
    private void fillList(PanelTheme theme, NearbyOverlayModel model, int rows) {
        listBox.removeAllViews();
        if (rows == 0) {
            listBox.addView(emptyState(theme, model.waitingLogin()));
            return;
        }
        for (int index = 0; index < rows; index++) {
            NearbyOverlayModel.Pet pet = model.pets.get(index);
            int tone = NearbyOverlayModel.toneOf(pet).ordinal();
            FrameLayout row = new FrameLayout(activity);
            row.setBackground(rowBackground(theme, tone));

            LinearLayout lines = new LinearLayout(activity);
            lines.setOrientation(LinearLayout.VERTICAL);
            // 两行总高正好等于行高 28：第 1 行 16、第 2 行 12，不留上下内边距
            int headHeight = 16;
            int lineHeight = NearbyOverlayModel.ROW_HEIGHT - headHeight;
            lines.setPadding(dp(6), 0, dp(6), 0);

            LinearLayout head = new LinearLayout(activity);
            head.setOrientation(LinearLayout.HORIZONTAL);
            head.setGravity(Gravity.CENTER_VERTICAL);

            TextView name = text("", 10, theme.rowText[tone]);
            name.setText(rowHeadText(pet, theme.rowText[tone]));
            name.setTypeface(Typeface.DEFAULT_BOLD);
            name.setSingleLine(true);
            name.setEllipsize(TextUtils.TruncateAt.END);
            name.setGravity(Gravity.CENTER_VERTICAL);

            // 右侧「↗ 72m」按内容测量，不给 ellipsize：名称太长时只省略名称
            TextView distance = text(NearbyOverlayModel.distanceArrowText(pet), 8,
                withAlpha(theme.rowText[tone], 0.82f));
            distance.setSingleLine(true);
            distance.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);

            LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.MATCH_PARENT, 1f);
            LinearLayout.LayoutParams distanceParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT);
            distanceParams.leftMargin = dp(4);
            head.addView(name, nameParams);
            head.addView(distance, distanceParams);

            TextView line2 = text(NearbyOverlayModel.metaTextLine2(pet), 7.5f,
                withAlpha(theme.rowText[tone], 0.72f));
            line2.setSingleLine(true);
            line2.setEllipsize(TextUtils.TruncateAt.END);
            line2.setGravity(Gravity.CENTER_VERTICAL);

            lines.addView(head, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(headHeight)));
            lines.addView(line2, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(lineHeight)));

            row.addView(lines, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(NearbyOverlayModel.ROW_HEIGHT)));
            if (pet.alert) {
                View bar = new View(activity);
                bar.setBackground(alertBarBackground());
                FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(
                    dp(ALERT_BAR_DP), dp(NearbyOverlayModel.ROW_HEIGHT - 8),
                    Gravity.START | Gravity.CENTER_VERTICAL);
                row.addView(bar, barParams);
            }

            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(NearbyOverlayModel.ROW_HEIGHT));
            if (index > 0) rowParams.topMargin = dp(NearbyOverlayModel.ROW_GAP);
            listBox.addView(row, rowParams);
        }
    }

    /** 第一行左侧：名称 10sp 粗体 + 等级「Lv38」8sp（同一个 TextView 里用 span 拉开字号与颜色）。 */
    private CharSequence rowHeadText(NearbyOverlayModel.Pet pet, int nameColor) {
        SpannableStringBuilder builder = new SpannableStringBuilder(pet.name);
        builder.setSpan(new StyleSpan(Typeface.BOLD), 0, builder.length(),
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        builder.setSpan(new ForegroundColorSpan(nameColor), 0, builder.length(),
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        String level = NearbyOverlayModel.levelText(pet);
        if (!level.isEmpty()) {
            int start = builder.length();
            builder.append(' ').append(level);
            // 相对名称 10sp 的 0.8 = 8sp；等级不跟名称一起加粗
            builder.setSpan(new RelativeSizeSpan(0.8f), start, builder.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            builder.setSpan(new StyleSpan(Typeface.NORMAL), start, builder.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            builder.setSpan(new ForegroundColorSpan(withAlpha(nameColor, 0.82f)),
                start, builder.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return builder;
    }

    private View emptyState(PanelTheme theme, boolean waitingLogin) {
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        TextView main = text(
            waitingLogin ? NearbyOverlayModel.WAITING_LOGIN : NearbyOverlayModel.EMPTY_NEARBY_TITLE,
            10, theme.muted);
        main.setGravity(Gravity.CENTER);
        box.addView(main);
        if (!waitingLogin) {
            TextView hint = text(NearbyOverlayModel.EMPTY_NEARBY_HINT, 9, theme.muted);
            hint.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.topMargin = dp(3);
            box.addView(hint, params);
        }
        box.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return box;
    }

    private CharSequence buildChips(PanelTheme theme, JSONArray fields, int row, boolean hit) {
        SpannableStringBuilder builder = new SpannableStringBuilder();
        if (fields != null) {
            for (int index = 0; index < fields.length(); index++) {
                JSONObject field = fields.optJSONObject(index);
                if (field == null) continue;
                if (field.optInt("row", 1) != row) continue;
                String value = field.optString("text", "");
                if (value.isEmpty()) continue;
                int background = field.optBoolean("primary", false)
                    ? theme.chipPrimaryBg
                    : field.optBoolean("hot", false) ? theme.chipHotBg : theme.chipBg;
                int foreground = field.optBoolean("primary", false)
                    ? theme.chipPrimaryText
                    : field.optBoolean("hot", false) ? theme.chipHotText : theme.chipText;
                appendChip(builder, value, background, foreground);
            }
        }
        if (row == 1 && hit) appendChip(builder, "命中目标", 0xFFF43F5E, Color.WHITE);
        return builder;
    }

    private void appendChip(SpannableStringBuilder builder, String value, int background, int foreground) {
        if (builder.length() > 0) builder.append(' ');
        int start = builder.length();
        builder.append(value);
        int end = builder.length();
        builder.setSpan(new ChipSpan(background, foreground, dpF(4), dp(3), dp(1)),
            start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    private boolean hasHitFields() {
        if (battlePayload == null) return false;
        JSONArray fields = battlePayload.optJSONArray("fields");
        if (fields == null || fields.length() == 0) return false;
        for (int index = 0; index < fields.length(); index++) {
            JSONObject field = fields.optJSONObject(index);
            if (field != null && !field.optString("text", "").isEmpty()) return true;
        }
        return false;
    }

    /**
     * 地图区只要拿到自身坐标就显示：有底图就叠底图，没有底图 overlay-map.html 画雷达兜底。
     * 2026-11-10：不再要求 scene 必须在 maps.json 里，避免切场景/传送后整块地图消失。
     */
    private boolean hasMap(NearbyOverlayModel model) {
        return mapView != null
            && model.selfX != null
            && model.selfY != null;
    }

    private void pushMapData() {
        if (nearbyPayload == null) return;
        NearbyOverlayModel model = NearbyOverlayModel.parse(nearbyPayload);
        pushMapData(model, model != null && hasMap(model));
    }

    private void pushMapData(NearbyOverlayModel model, boolean visible) {
        if (mapView == null || !mapReady || model == null || !visible) return;
        try {
            JSONObject data = new JSONObject();
            data.put("scene", model.scene);
            data.put("self", new JSONObject().put("x", model.selfX).put("y", model.selfY));
            data.put("estimated", model.selfEstimated);
            // 朝向：null 时地图画圆点（旧网页 / 站着不动没速度方向），不画「假装在指」的箭头
            if (model.selfHeading != null) data.put("heading", model.selfHeading);
            JSONArray pets = new JSONArray();
            // 地图画全部附近精灵（mapPets），列表仍按筛选口径（pets）
            for (NearbyOverlayModel.Pet pet : model.mapPets) {
                if (pet.x == null || pet.y == null) continue;
                JSONObject item = new JSONObject();
                item.put("x", pet.x);
                item.put("y", pet.y);
                item.put("rare", pet.rare);
                item.put("alert", pet.alert);
                item.put("kinds", new JSONArray(pet.kinds));
                pets.put(item);
            }
            data.put("pets", pets);
            String json = data.toString();
            mapView.evaluateJavascript(
                "window.RocoOverlayMap&&window.RocoOverlayMap.update(" + JSONObject.quote(json) + ")", null);
            perfMapPushes++;
            // 中心真的变了才算「平移」：payload 到了但坐标没变时 mapPush 会涨、mapPan 不涨
            if (Double.isNaN(lastPushedSelfX)
                || Math.abs(model.selfX - lastPushedSelfX) > 1
                || Math.abs(model.selfY - lastPushedSelfY) > 1) {
                perfMapPans++;
            }
            lastPushedSelfX = model.selfX;
            lastPushedSelfY = model.selfY;
        } catch (Exception ignored) {
            // 地图数据坏掉时保留上一帧，不影响列表
        }
    }

    /**
     * payload 内容指纹（2026-11-10）：场景 + 自身坐标 + 列表 / 地图条数 + 前三条 key 与距离。
     * 不含 updatedAt，否则每轮都变，就看不出「内容其实完全一样」。
     */
    private static String fingerprint(NearbyOverlayModel model) {
        StringBuilder builder = new StringBuilder();
        builder.append(model.scene).append('|')
            .append(model.selfX == null ? "-" : Math.round(model.selfX)).append(',')
            .append(model.selfY == null ? "-" : Math.round(model.selfY)).append('|')
            // 朝向单独变化（站着转身）也要推动地图重绘；按 5° 一档取整，避免抖动刷屏
            .append(model.selfHeading == null ? "-" : Math.round(model.selfHeading / 5)).append('|')
            .append(model.pets.size()).append('/').append(model.mapPets.size());
        int limit = Math.min(3, model.pets.size());
        for (int index = 0; index < limit; index++) {
            NearbyOverlayModel.Pet pet = model.pets.get(index);
            builder.append('#').append(pet.key).append(',')
                .append(pet.distanceM == null ? "-" : Math.round(pet.distanceM));
        }
        return Integer.toHexString(builder.toString().hashCode());
    }

    /**
     * 网页侧每轮解码耗时（2026-11-10）：payload 里带了 perf 就记下来，RocoPerf 每 5 秒打印一次。
     * 不参与渲染，只用于判断轮询到底卡在「取字节」还是「worker 解码」。
     */
    private void rememberRoundPerf(JSONObject payload) {
        JSONObject perf = payload == null ? null : payload.optJSONObject("perf");
        if (perf == null) return;
        perfReadAvg = perf.optInt("readAvg", -1);
        perfReadMax = perf.optInt("readMax", -1);
        perfDecodeAvg = perf.optInt("decodeAvg", -1);
        perfDecodeMax = perf.optInt("decodeMax", -1);
        perfRoundBytes = perf.optInt("bytes", -1);
        perfRoundGap = perf.optInt("gapAvg", -1);
        perfRoundCount = perf.optInt("rounds", -1);
    }

    /**
     * RocoPerf 采样（1.3.9）：每 5 秒一行，真机 `adb logcat -s RocoPerf` 直接可看。
     * 记录 payload 次数、render 次数、WebView 地图重绘次数、单次解析耗时（平均 / 最大）。
     */
    private void logPerf() {
        logPerf(false);
    }

    private void logPerf(boolean force) {
        long now = SystemClock.elapsedRealtime();
        long elapsed = now - perfSince;
        if (!force && elapsed < PERF_INTERVAL_MS) return;
        int renders = perfRenders;
        double avgMs = renders == 0 ? 0 : perfParseUsTotal / 1000.0 / renders;
        long selfAge = lastSelfAt > 0 ? System.currentTimeMillis() - lastSelfAt : -1;
        Log.d(PERF_TAG, String.format(java.util.Locale.US,
            "nearby window=%dms payload=%d open=%d closed=%d render=%d list=%d skip=%d"
                + " mapPush=%d mapPan=%d selfSrc=%s self=%.1f,%.1f age=%dms near=%s fp=%s"
                + " parseAvg=%.2fms parseMax=%.2fms"
                + " readAvg=%dms readMax=%dms decodeAvg=%dms decodeMax=%dms bytes=%d gap=%dms round=%d",
            elapsed, perfPayloads, perfPayloadOpen, perfPayloadClosed, perfRenders,
            perfListRebuilds, perfSignatureSkips, perfMapPushes, perfMapPans,
            lastSelfSource, lastSelfX, lastSelfY, selfAge,
            lastNearestM == null ? "-" : String.format(java.util.Locale.US, "%.0fm", lastNearestM),
            lastFingerprint, avgMs, perfParseUsMax / 1000.0,
            perfReadAvg, perfReadMax, perfDecodeAvg, perfDecodeMax,
            perfRoundBytes, perfRoundGap, perfRoundCount));
        perfPayloads = 0;
        perfPayloadOpen = 0;
        perfPayloadClosed = 0;
        perfRenders = 0;
        perfListRebuilds = 0;
        perfSignatureSkips = 0;
        perfMapPushes = 0;
        perfMapPans = 0;
        perfParseUsTotal = 0;
        perfParseUsMax = 0;
        perfSince = now;
    }

    private void schedulePerf() {
        if (released) return;
        perfHandler.removeCallbacks(perfTick);
        perfHandler.postDelayed(perfTick, PERF_INTERVAL_MS);
    }

    private void safeUpdate() {
        if (panel == null || panelParams == null) return;
        try {
            windowManager.updateViewLayout(panel, panelParams);
        } catch (Exception ignored) {
            // 窗口还没加上 / 已移除：下次渲染再试
        }
    }

    private TextView text(String value, float sizeSp, int color) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        return view;
    }

    private FrameLayout.LayoutParams frame(int leftDp, int topDp, int widthDp, int heightDp) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(widthDp), dp(heightDp));
        params.leftMargin = dp(leftDp);
        params.topMargin = dp(topDp);
        return params;
    }

    private void setFrame(View view, int leftDp, int topDp, int widthDp, int heightDp) {
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) view.getLayoutParams();
        if (params == null) params = new FrameLayout.LayoutParams(dp(widthDp), dp(heightDp));
        params.leftMargin = dp(leftDp);
        params.topMargin = dp(topDp);
        params.width = dp(widthDp);
        params.height = dp(heightDp);
        view.setLayoutParams(params);
    }

    private GradientDrawable cardBackground(PanelTheme theme) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(theme.panelBg);
        drawable.setCornerRadius(dpF(CARD_RADIUS_DP));
        drawable.setStroke(dp(1), theme.line);
        return drawable;
    }

    private GradientDrawable hitBackground(PanelTheme theme) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(theme.hitBg);
        drawable.setCornerRadii(new float[] {
            dpF(CARD_RADIUS_DP), dpF(CARD_RADIUS_DP),
            dpF(CARD_RADIUS_DP), dpF(CARD_RADIUS_DP), 0, 0, 0, 0 });
        return drawable;
    }

    /** 列表行背景：六种底色之一 + 1dp 淡描边（深浅各一套）。 */
    private GradientDrawable rowBackground(PanelTheme theme, int tone) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dpF(ROW_RADIUS_DP));
        drawable.setColor(theme.rowBg[tone]);
        drawable.setStroke(dp(1), theme.rowLine);
        return drawable;
    }

    /** 「可提醒」左侧红条。 */
    private GradientDrawable alertBarBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dpF(1.5f));
        drawable.setColor(0xFFF43F5E);
        return drawable;
    }

    private GradientDrawable badgeBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dpF(4));
        drawable.setColor(0x1AF59E0B);
        drawable.setStroke(dp(1), 0x55F59E0B);
        return drawable;
    }

    private GradientDrawable mapBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dpF(MAP_RADIUS_DP));
        drawable.setColor(0xFF0D1A26);
        return drawable;
    }

    private static int withAlpha(int color, float alpha) {
        return Color.argb(Math.round(alpha * 255), Color.red(color), Color.green(color), Color.blue(color));
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private int dp(int value) {
        return Math.round(dpF(value));
    }

    private float dpF(float value) {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics());
    }

    private String readAsset(String path) {
        try (InputStream input = activity.getAssets().open(path)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int length;
            while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) {
            return null;
        }
    }

    private PanelTheme theme() {
        boolean dark = (activity.getResources().getConfiguration().uiMode
            & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        return dark ? PanelTheme.dark() : PanelTheme.light();
    }

    /** 面板配色，取自 docs/手机悬浮窗-面板规格.md 的 token。 */
    private static final class PanelTheme {
        final int panelBg;
        final int line;
        final int text;
        final int muted;
        final int hitBg;
        final int chipBg;
        final int chipText;
        final int chipPrimaryBg;
        final int chipPrimaryText;
        final int chipHotBg;
        final int chipHotText;
        /** 六种列表底色与对应文字色，下标同 {@link NearbyOverlayModel.RowTone#ordinal()} */
        final int[] rowBg;
        final int[] rowText;
        final int rowLine;

        private PanelTheme(int panelBg, int line, int text, int muted, int hitBg,
                           int chipBg, int chipText, int chipPrimaryBg,
                           int chipPrimaryText, int chipHotBg, int chipHotText,
                           int[] rowBg, int[] rowText, int rowLine) {
            this.panelBg = panelBg;
            this.line = line;
            this.text = text;
            this.muted = muted;
            this.hitBg = hitBg;
            this.chipBg = chipBg;
            this.chipText = chipText;
            this.chipPrimaryBg = chipPrimaryBg;
            this.chipPrimaryText = chipPrimaryText;
            this.chipHotBg = chipHotBg;
            this.chipHotText = chipHotText;
            this.rowBg = rowBg;
            this.rowText = rowText;
            this.rowLine = rowLine;
        }

        static PanelTheme dark() {
            return new PanelTheme(
                0xFF111C33, 0xFF1E293B, 0xFFE2E8F0, 0xFF94A3B8, 0x800F172A,
                0x2E94A3B8, 0xFFCBD5E1, 0xFFE2E8F0, 0xFF0F172A,
                0x38F59E0B, 0xFFFBBF24,
                // 命中 / 炫彩 / 异色 / 污染 / 稀有 / 普通
                new int[] { 0xFF052E1A, 0xFF3B0A22, 0xFF3B1A06, 0xFF2A1B4D, 0xFF3B2A08, 0xFF16233B },
                new int[] { 0xFFA7F3D0, 0xFFF9A8D4, 0xFFFDBA74, 0xFFDDD6FE, 0xFFFDE68A, 0xFFE2E8F0 },
                0x1FFFFFFF);
        }

        static PanelTheme light() {
            return new PanelTheme(
                0xFFFFFFFF, 0xFFE2E8F0, 0xFF0F172A, 0xFF64748B, 0xFFF8FAFC,
                0xFFF1F5F9, 0xFF475569, 0xFF1E293B, 0xFFFFFFFF,
                0xFFFEF3C7, 0xFFB45309,
                new int[] { 0xFFDCFCE7, 0xFFFCE7F3, 0xFFFFEDD5, 0xFFEDE9FE, 0xFFFEF3C7, 0xFFFFFFFF },
                new int[] { 0xFF14532D, 0xFF831843, 0xFF7C2D12, 0xFF4C1D95, 0xFF78350F, 0xFF0F172A },
                0x0F0F172A);
        }
    }

    /**
     * 列表滚动容器（1.3.9）：内容不满一屏时不吃触摸，把事件交回外层面板拖动。
     *
     * <p>内置 ScrollView 会一直消费 ACTION_DOWN 并进入「准备滚动」状态，用户按在列表空白处
     * 就拖不动面板；这里只在真正能滚动的时候才拦截 / 消费。</p>
     */
    private static final class PanelScrollView extends ScrollView {

        PanelScrollView(Context context) {
            super(context);
        }

        private boolean scrollable() {
            return canScrollVertically(1) || canScrollVertically(-1);
        }

        @Override
        public boolean onInterceptTouchEvent(MotionEvent event) {
            return scrollable() && super.onInterceptTouchEvent(event);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            return scrollable() && super.onTouchEvent(event);
        }
    }

    /**
     * 圆角标签背景：与 PC 小窗的 chip 一致，垂直方向按字体基线对称扩展。
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
