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
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.ReplacementSpan;
import android.text.style.StyleSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

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
    private final Set<Integer> mapScenes;
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
    private LinearLayout listBox;
    private TextView footView;
    private boolean hasOrbRect;
    private int lastOrbX;
    private int lastOrbY;
    private int lastOrbSize;
    private int lastScreenWidth;
    private int lastScreenHeight;
    /** 本次展开是否已经定过落点；用户拖过之后不再按默认规则重算 */
    private boolean positioned;
    private float downRawX;
    private float downRawY;
    private int dragStartX;
    private int dragStartY;
    private boolean dragging;

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
        this.mapScenes = NearbyOverlayModel.parseMapScenes(catalog);
    }

    /** 网页推来的附近 payload（含 panels 配置）；返回给网页的结果固定是 ok。 */
    public String updateNearby(JSONObject payload) {
        nearbyPayload = payload;
        if (nearbyPayload == null || !nearbyPayload.optBoolean("visible", false)) {
            collapse();
            return "ok";
        }
        if (expanded) render();
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
     * 记录球当前的位置与屏幕尺寸，供**首次展开**时算「从另一侧展开」的默认落点。
     * 球拖动时只更新记录，不移动已经展开的面板。
     */
    public void setOrbRect(int orbX, int orbY, int orbSize, int screenWidth, int screenHeight) {
        hasOrbRect = true;
        lastOrbX = orbX;
        lastOrbY = orbY;
        lastOrbSize = orbSize;
        lastScreenWidth = screenWidth;
        lastScreenHeight = screenHeight;
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
     * 面板落点：
     * <ul>
     *   <li>用户拖过（有存档）→ 沿用存档位置，只夹回屏幕内；</li>
     *   <li>没拖过 → 按球当前所在侧，从另一侧展开，默认不压住球。</li>
     * </ul>
     */
    private void placePanel() {
        if (panel == null || panelParams == null) return;
        int edge = dp(NearbyOverlayModel.EDGE);
        if (!positioned) {
            int savedX = prefs.getInt(KEY_PANEL_X, Integer.MIN_VALUE);
            int savedY = prefs.getInt(KEY_PANEL_Y, Integer.MIN_VALUE);
            int[] spot;
            if (savedX != Integer.MIN_VALUE && savedY != Integer.MIN_VALUE) {
                spot = OverlayGeometry.clamp(savedX, savedY,
                    panelParams.width, panelParams.height,
                    lastScreenWidth, lastScreenHeight, edge);
            } else if (hasOrbRect) {
                spot = OverlayGeometry.oppositeOfBall(
                    panelParams.width, panelParams.height,
                    lastOrbX, lastOrbY, lastOrbSize, lastOrbSize,
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
        listBox = null;
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
        footView = text("", 9, theme.muted);
        footView.setGravity(Gravity.CENTER_VERTICAL);
        footView.setSingleLine(true);
        footView.setEllipsize(TextUtils.TruncateAt.END);

        root.addView(hitBox, frame(0, 0, NearbyOverlayModel.PANEL_WIDTH, NearbyOverlayModel.HIT_HEIGHT));
        root.addView(titleRow, frame(8, 0, NearbyOverlayModel.PANEL_WIDTH - 16, TITLE_HEIGHT_DP));
        root.addView(mapBox, frame(8, 0, NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.MAP_SIZE));
        root.addView(listBox, frame(8, 0, NearbyOverlayModel.PANEL_WIDTH - 16, NearbyOverlayModel.EMPTY_BODY_HEIGHT));
        root.addView(footView, frame(8, 0, NearbyOverlayModel.PANEL_WIDTH - 16, NearbyOverlayModel.FOOT_TEXT_HEIGHT));

        try {
            windowManager.addView(root, panelParams);
        } catch (Exception error) {
            panel = null;
            panelParams = null;
            expanded = false;
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
        box.addView(hitRow1, chipRowParams(3));
        box.addView(hitRow2, chipRowParams(3));

        hitEmpty = text(NearbyOverlayModel.HIT_EMPTY_TEXT, 9.5f, theme.muted);
        hitEmpty.setLineSpacing(dpF(1), 1f);
        box.addView(hitEmpty, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return box;
    }

    private TextView chipRow(PanelTheme theme) {
        TextView view = new TextView(activity);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
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
            view.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView webView, String url) {
                    return true;
                }
                @Override public void onPageFinished(WebView webView, String url) {
                    mapReady = true;
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

    private void render() {
        if (panel == null || panelParams == null) return;
        NearbyOverlayModel model = NearbyOverlayModel.parse(nearbyPayload);
        if (model == null) {
            collapse();
            return;
        }
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
        listBox.setVisibility(showNearby ? View.VISIBLE : View.GONE);
        if (showNearby) {
            int bodyTop = hitHeight + NearbyOverlayModel.BODY_TOP_GAP;
            int listHeight = NearbyOverlayModel.listHeight(rows);
            if (hasMap) {
                setFrame(mapBox, 8, bodyTop, NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.MAP_SIZE);
                setFrame(listBox,
                    8 + NearbyOverlayModel.MAP_SIZE + NearbyOverlayModel.LIST_GAP,
                    bodyTop, NearbyOverlayModel.LIST_WIDTH, listHeight);
            } else {
                setFrame(listBox, 8, bodyTop, NearbyOverlayModel.PANEL_WIDTH - 16, listHeight);
            }
            fillList(theme, model, rows);
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
     * 列表：1.3.6 方案 2，**同顺序两行**——第一行「名称 · 距离 · 箭头 · xx级」，
     * 第二行「高 · 重 · 声音」；底色按 {@link NearbyOverlayModel#toneOf} 取六种之一，
     * 「可提醒」只在左侧留一条 3dp 红条。
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
            lines.setPadding(dp(6), dp(4), dp(6), dp(5));

            TextView line1 = text("", 9, withAlpha(theme.rowText[tone], 0.82f));
            line1.setSingleLine(true);
            line1.setEllipsize(TextUtils.TruncateAt.END);
            line1.setIncludeFontPadding(false);
            line1.setText(rowHeadText(pet, theme.rowText[tone]));

            TextView line2 = text(NearbyOverlayModel.metaTextLine2(pet), 9,
                withAlpha(theme.rowText[tone], 0.72f));
            line2.setSingleLine(true);
            line2.setEllipsize(TextUtils.TruncateAt.END);
            line2.setIncludeFontPadding(false);

            lines.addView(line1, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            lines.addView(line2, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

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

    /** 第一行：名称 11sp 粗体 + 其余 9sp（同一个 TextView 里用 span 拉开字号与颜色）。 */
    private CharSequence rowHeadText(NearbyOverlayModel.Pet pet, int nameColor) {
        SpannableStringBuilder builder = new SpannableStringBuilder(pet.name);
        builder.setSpan(new RelativeSizeSpan(11f / 9f), 0, builder.length(),
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        builder.setSpan(new StyleSpan(Typeface.BOLD), 0, builder.length(),
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        builder.setSpan(new ForegroundColorSpan(nameColor), 0, builder.length(),
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        String meta = NearbyOverlayModel.metaTextLine1(pet);
        if (!meta.isEmpty()) builder.append(' ').append(meta);
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
        builder.setSpan(new ChipSpan(background, foreground, dpF(4), dp(4), dp(1)),
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

    private boolean hasMap(NearbyOverlayModel model) {
        return mapView != null
            && model.scene != null
            && mapScenes.contains(model.scene)
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
            JSONArray pets = new JSONArray();
            for (NearbyOverlayModel.Pet pet : model.pets) {
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
        } catch (Exception ignored) {
            // 地图数据坏掉时保留上一帧，不影响列表
        }
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
