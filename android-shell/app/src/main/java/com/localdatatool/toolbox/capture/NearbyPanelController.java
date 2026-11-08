package com.localdatatool.toolbox.capture;

import android.app.Activity;
import android.content.Context;
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
import android.text.style.ReplacementSpan;
import android.util.TypedValue;
import android.view.Gravity;
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
 * 球的图标 / 不透明度 / 拖动 / 夹取 / 信息框避让仍由 {@link BattleOverlayController}
 * 负责，本类只通过 {@link #followOrb(int, int, int, int, int)} 拿球当前的屏幕坐标，
 * 按 {@link NearbyOverlayModel#panelPosition} 贴球展开，不另建一套坐标换算。</p>
 *
 * <p>面板是纯展示窗口（{@code FLAG_NOT_TOUCHABLE}）：不抢焦点、不拦游戏操作、
 * 不会和球的拖动抢事件。展开 / 收起由球点击触发。</p>
 */
public final class NearbyPanelController {

    private static final int CARD_RADIUS_DP = 12;
    private static final int TITLE_HEIGHT_DP = 14;
    private static final int MAP_RADIUS_DP = 8;
    private static final int ROW_RADIUS_DP = 6;
    private static final int TAG_RADIUS_DP = 3;

    /** 与网页 rareRules 的 kind 键一致（列表标签与地图点同源）。 */
    private static final String[] KIND_PRIORITY =
        { "pollution", "shiny", "colorful", "big", "small", "high", "low" };
    private static final java.util.Map<String, String> KIND_LABEL = new java.util.HashMap<>();
    private static final java.util.Map<String, String> KIND_COLOR = new java.util.HashMap<>();

    static {
        KIND_LABEL.put("pollution", "污染");
        KIND_LABEL.put("shiny", "异色");
        KIND_LABEL.put("colorful", "炫彩");
        KIND_LABEL.put("big", "大块头");
        KIND_LABEL.put("small", "小不点");
        KIND_LABEL.put("high", "婉转声");
        KIND_LABEL.put("low", "粗嗓门");
        KIND_COLOR.put("pollution", "#7c3aed");
        KIND_COLOR.put("shiny", "#f59e0b");
        KIND_COLOR.put("colorful", "#ec4899");
        KIND_COLOR.put("big", "#0ea5e9");
        KIND_COLOR.put("small", "#0ea5e9");
        KIND_COLOR.put("high", "#059669");
        KIND_COLOR.put("low", "#059669");
    }

    private final Activity activity;
    private final WindowManager windowManager;
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

    public NearbyPanelController(Activity activity, WindowManager windowManager) {
        this.activity = activity;
        this.windowManager = windowManager;
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

    /** 球拖动 / 屏幕旋转时实时跟随；球自己的坐标口径不在这里改。 */
    public void followOrb(int orbX, int orbY, int orbSize, int screenWidth, int screenHeight) {
        hasOrbRect = true;
        lastOrbX = orbX;
        lastOrbY = orbY;
        lastOrbSize = orbSize;
        lastScreenWidth = screenWidth;
        lastScreenHeight = screenHeight;
        place();
    }

    /** 权限回来 / 屏幕变化后把已展开的面板重新挂回去。 */
    public void reapply() {
        if (!nearbyVisible() || !expanded) return;
        if (panel == null) addPanel();
        render();
    }

    private void place() {
        if (panel == null || panelParams == null) return;
        if (hasOrbRect) {
            int edge = dp(NearbyOverlayModel.EDGE);
            int[] position = NearbyOverlayModel.panelPosition(
                lastOrbX, lastOrbY, lastOrbSize, lastScreenWidth, lastScreenHeight,
                panelParams.width, panelParams.height, edge);
            panelParams.x = position[0];
            panelParams.y = position[1];
        }
        safeUpdate();
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
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT);
        panelParams.gravity = Gravity.TOP | Gravity.START;
        panel = root;

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
        TextView chevron = text("⌄", 13, theme.muted);
        chevron.setGravity(Gravity.CENTER);
        chevron.setPadding(dp(2), 0, dp(2), 0);
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        header.addView(chevron, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));
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
                setFrame(listBox, 136, bodyTop, 124, listHeight);
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
        place();
    }

    private void fillList(PanelTheme theme, NearbyOverlayModel model, int rows) {
        listBox.removeAllViews();
        if (rows == 0) {
            listBox.addView(emptyState(theme, model.waitingLogin()));
            return;
        }
        for (int index = 0; index < rows; index++) {
            NearbyOverlayModel.Pet pet = model.pets.get(index);
            LinearLayout row = new LinearLayout(activity);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(6), dp(2), dp(6), dp(2));
            row.setBackground(rowBackground(theme, pet));

            LinearLayout line1 = new LinearLayout(activity);
            line1.setOrientation(LinearLayout.HORIZONTAL);
            line1.setGravity(Gravity.CENTER_VERTICAL);
            TextView name = text(pet.name, 11, theme.text);
            name.setTypeface(Typeface.DEFAULT_BOLD);
            name.setSingleLine(true);
            name.setEllipsize(TextUtils.TruncateAt.END);
            TextView level = text("Lv" + pet.level, 8.5f, theme.muted);
            level.setSingleLine(true);
            line1.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            line1.addView(level, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            LinearLayout line2 = new LinearLayout(activity);
            line2.setOrientation(LinearLayout.HORIZONTAL);
            line2.setGravity(Gravity.CENTER_VERTICAL);
            TextView meta = text(distanceText(pet), 9, theme.muted);
            meta.setSingleLine(true);
            meta.setEllipsize(TextUtils.TruncateAt.END);
            line2.addView(meta, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            TextView tag = buildTag(theme, pet);
            if (tag != null) line2.addView(tag);

            LinearLayout.LayoutParams line1Params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            LinearLayout.LayoutParams line2Params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            line2Params.topMargin = dp(1);
            row.addView(line1, line1Params);
            row.addView(line2, line2Params);

            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(NearbyOverlayModel.ROW_HEIGHT));
            if (index > 0) rowParams.topMargin = dp(NearbyOverlayModel.ROW_GAP);
            listBox.addView(row, rowParams);
        }
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

    private TextView buildTag(PanelTheme theme, NearbyOverlayModel.Pet pet) {
        String label;
        String color;
        if (pet.alert) {
            label = "需求";
            color = "#f43f5e";
        } else if (!pet.kinds.isEmpty()) {
            List<String> labels = new ArrayList<>();
            for (String kind : pet.kinds) {
                String text = KIND_LABEL.get(kind);
                labels.add(text == null ? kind : text);
            }
            label = TextUtils.join("·", labels);
            color = kindColor(pet.kinds);
        } else {
            return null;
        }
        TextView tag = text(label, 8, Color.parseColor(color));
        tag.setSingleLine(true);
        tag.setGravity(Gravity.CENTER);
        tag.setPadding(dp(3), 0, dp(3), 0);
        tag.setBackground(tagBackground(Color.parseColor(color)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(11));
        params.leftMargin = dp(3);
        tag.setLayoutParams(params);
        return tag;
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

    private static String distanceText(NearbyOverlayModel.Pet pet) {
        if (pet.distanceM == null) return "—";
        String distance = Math.round(pet.distanceM) + "m";
        if (pet.bearingLabel == null || pet.bearingLabel.isEmpty()) return distance;
        return distance + " " + pet.bearingLabel;
    }

    private static String kindColor(List<String> kinds) {
        for (String kind : KIND_PRIORITY) {
            if (kinds.contains(kind)) {
                String color = KIND_COLOR.get(kind);
                if (color != null) return color;
            }
        }
        return "#475569";
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

    private GradientDrawable rowBackground(PanelTheme theme, NearbyOverlayModel.Pet pet) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dpF(ROW_RADIUS_DP));
        drawable.setColor(pet.alert ? theme.alertBg : theme.row);
        drawable.setStroke(dp(1), pet.alert ? theme.alertLine : pet.rare ? theme.rareLine : theme.line);
        return drawable;
    }

    private GradientDrawable tagBackground(int color) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setCornerRadius(dpF(TAG_RADIUS_DP));
        drawable.setColor(withAlpha(color, 0.18f));
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
        final int row;
        final int alertBg;
        final int alertLine;
        final int rareLine;
        final int hitBg;
        final int chipBg;
        final int chipText;
        final int chipPrimaryBg;
        final int chipPrimaryText;
        final int chipHotBg;
        final int chipHotText;

        private PanelTheme(int panelBg, int line, int text, int muted, int row,
                           int alertBg, int alertLine, int rareLine, int hitBg,
                           int chipBg, int chipText, int chipPrimaryBg,
                           int chipPrimaryText, int chipHotBg, int chipHotText) {
            this.panelBg = panelBg;
            this.line = line;
            this.text = text;
            this.muted = muted;
            this.row = row;
            this.alertBg = alertBg;
            this.alertLine = alertLine;
            this.rareLine = rareLine;
            this.hitBg = hitBg;
            this.chipBg = chipBg;
            this.chipText = chipText;
            this.chipPrimaryBg = chipPrimaryBg;
            this.chipPrimaryText = chipPrimaryText;
            this.chipHotBg = chipHotBg;
            this.chipHotText = chipHotText;
        }

        static PanelTheme dark() {
            return new PanelTheme(
                0xF0111C33, 0xFF1E293B, 0xFFE2E8F0, 0xFF94A3B8, 0xFF111C33,
                0xFF2A1220, 0xFFBE123C, 0xFFB45309, 0x800F172A,
                0x2E94A3B8, 0xFFCBD5E1, 0xFFE2E8F0, 0xFF0F172A,
                0x38F59E0B, 0xFFFBBF24);
        }

        static PanelTheme light() {
            return new PanelTheme(
                0xF5FFFFFF, 0xFFE2E8F0, 0xFF0F172A, 0xFF64748B, 0xFFF8FAFC,
                0xFFFEF2F2, 0xFFFECDD3, 0xFFFCD34D, 0xFFF8FAFC,
                0xFFF1F5F9, 0xFF475569, 0xFF1E293B, 0xFFFFFFFF,
                0xFFFEF3C7, 0xFFB45309);
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
