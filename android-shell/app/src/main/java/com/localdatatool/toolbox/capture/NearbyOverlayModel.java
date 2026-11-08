package com.localdatatool.toolbox.capture;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 手机悬浮面板的纯数据与几何计算（2026-11-08）。
 *
 * <p>数值口径见 {@code docs/手机悬浮窗-面板规格.md}，本类不持有 Android 依赖，便于单测。</p>
 */
public final class NearbyOverlayModel {

    /** 列表最多渲染 8 条，其余只报数。 */
    public static final int MAX_ROWS = 8;
    /** 面板宽度（与屏宽无关，规格 1.1）。 */
    public static final int PANEL_WIDTH = 268;
    /** 球与屏边 / 面板与球 / 面板与屏边的间距。 */
    public static final int EDGE = 8;
    /** 命中区有数据时的高度。 */
    public static final int HIT_HEIGHT = 64;
    /** 命中区无数据时的高度（实测 200 = 44 + 28 + 120 + 8）。 */
    public static final int HIT_EMPTY_HEIGHT = 44;
    /** 标题行相对命中区底部的偏移。 */
    public static final int TITLE_TOP_GAP = 4;
    /** 地图 / 列表相对命中区底部的偏移。 */
    public static final int BODY_TOP_GAP = 28;
    /** 小地图边长。 */
    public static final int MAP_SIZE = 120;
    /** 列表行高与行间距。 */
    public static final int ROW_HEIGHT = 30;
    public static final int ROW_GAP = 2;
    /** 列表没有内容时的占位高度。 */
    public static final int EMPTY_BODY_HEIGHT = 44;
    /** 底部「还有 N 只」文案行的高度。 */
    public static final int FOOT_TEXT_HEIGHT = 14;
    /** 没有「还有 N 只」时留白。 */
    public static final int FOOT_GAP = 8;
    /** 有「还有 N 只」时留白。 */
    public static final int FOOT_ROW_GAP = 20;

    public static final String ESTIMATED_BADGE = "中心为估算";
    public static final String EMPTY_NEARBY_TITLE = "附近暂时没有精灵";
    public static final String EMPTY_NEARBY_HINT = "进入野外后自动出现";
    public static final String WAITING_LOGIN = "登录后显示附近精灵";
    public static final String HIT_TITLE = "战斗采集 · 赛季奇遇";
    public static final String HIT_EMPTY_TEXT = "进入赛季奇遇战后，这里会显示守卫的个体数据。";

    public final boolean battle;
    public final boolean nearby;
    public final boolean capturing;
    public final boolean hasKey;
    public final Integer scene;
    public final Double selfX;
    public final Double selfY;
    public final boolean selfEstimated;
    public final List<Pet> pets;
    public final int total;
    public final int rareTotal;
    public final int alertTotal;
    public final long updatedAt;

    private NearbyOverlayModel(JSONObject payload) {
        boolean[] panels = parsePanels(payload);
        battle = panels[0];
        nearby = panels[1];
        capturing = payload.optBoolean("capturing", payload.optBoolean("visible", false));
        hasKey = payload.optBoolean("hasKey", true);
        scene = intOrNull(payload, "scene");

        JSONObject self = payload.optJSONObject("self");
        selfX = self == null ? null : numberOrNull(self, "x");
        selfY = self == null ? null : numberOrNull(self, "y");
        selfEstimated = payload.optBoolean("selfEstimated", false);

        List<Pet> parsed = new ArrayList<>();
        JSONArray array = payload.optJSONArray("pets");
        if (array != null) {
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.optJSONObject(index);
                if (item != null) parsed.add(new Pet(item));
            }
        }
        if (parsed.size() > MAX_ROWS) {
            parsed = new ArrayList<>(parsed.subList(0, MAX_ROWS));
        }
        pets = Collections.unmodifiableList(parsed);

        int declaredTotal = payload.has("total") ? payload.optInt("total", pets.size()) : pets.size();
        total = Math.max(declaredTotal, pets.size());
        rareTotal = payload.has("rareTotal") ? payload.optInt("rareTotal", countRare()) : countRare();
        alertTotal = payload.has("alertTotal") ? payload.optInt("alertTotal", countAlert()) : countAlert();
        updatedAt = payload.optLong("updatedAt", 0L);
    }

    public static NearbyOverlayModel parse(JSONObject payload) {
        return payload == null ? null : new NearbyOverlayModel(payload);
    }

    /**
     * 面板显隐兜底：缺失或非布尔按开；两项都关时回到两者都开。
     */
    public static boolean[] parsePanels(JSONObject payload) {
        boolean battle = true;
        boolean nearby = true;
        JSONObject panels = payload == null ? null : payload.optJSONObject("panels");
        if (panels != null) {
            battle = booleanOrTrue(panels, "battle");
            nearby = booleanOrTrue(panels, "nearby");
        }
        if (!battle && !nearby) {
            battle = true;
            nearby = true;
        }
        return new boolean[] { battle, nearby };
    }

    private static boolean booleanOrTrue(JSONObject object, String key) {
        Object value = object.opt(key);
        return value instanceof Boolean ? (Boolean) value : true;
    }

    private static Integer intOrNull(JSONObject object, String key) {
        if (!object.has(key) || object.isNull(key)) return null;
        int value = object.optInt(key, Integer.MIN_VALUE);
        return value == Integer.MIN_VALUE ? null : value;
    }

    private static Double numberOrNull(JSONObject object, String key) {
        if (!object.has(key) || object.isNull(key)) return null;
        double value = object.optDouble(key, Double.NaN);
        return Double.isNaN(value) ? null : value;
    }

    private int countRare() {
        int count = 0;
        for (Pet pet : pets) if (pet.rare) count++;
        return count;
    }

    private int countAlert() {
        int count = 0;
        for (Pet pet : pets) if (pet.alert) count++;
        return count;
    }

    public boolean waitingLogin() {
        return !hasKey && total == 0;
    }

    public int shownRows() {
        return Math.min(pets.size(), MAX_ROWS);
    }

    public int hiddenCount() {
        return Math.max(0, total - shownRows());
    }

    public String orbCountText() {
        return waitingLogin() ? "—" : String.valueOf(total);
    }

    public String titleText() {
        return "附近 " + total + " · 稀有 " + rareTotal;
    }

    public String footText() {
        return "还有 " + hiddenCount() + " 只未显示";
    }

    /** 列表内容高度：8 条封顶，空列表用占位高度。 */
    public static int listHeight(int rows) {
        int safe = Math.max(0, Math.min(rows, MAX_ROWS));
        return safe > 0 ? safe * ROW_HEIGHT + (safe - 1) * ROW_GAP : EMPTY_BODY_HEIGHT;
    }

    /**
     * 面板总高度。
     *
     * @param showBattle 是否显示顶部命中区
     * @param hasHit     命中区是否有数据
     * @param showNearby 是否显示附近面板
     * @param rows       实际渲染的列表行数（已截断）
     * @param hasMap     是否有可用的网页地图
     * @param hidden     未显示的条数
     */
    public static int panelHeight(boolean showBattle, boolean hasHit, boolean showNearby,
                                  int rows, boolean hasMap, int hidden) {
        int hitHeight = 0;
        if (showBattle) hitHeight = hasHit ? HIT_HEIGHT : HIT_EMPTY_HEIGHT;
        if (!showNearby) return hitHeight;
        int bodyHeight = hasMap
            ? Math.max(MAP_SIZE, listHeight(rows))
            : Math.max(EMPTY_BODY_HEIGHT, listHeight(rows));
        int footGap = hidden > 0 ? FOOT_ROW_GAP : FOOT_GAP;
        return hitHeight + BODY_TOP_GAP + bodyHeight + footGap;
    }

    /**
     * 面板左上角坐标：从球所在那一侧的角朝屏幕内侧展开，四边留 {@code edge}。
     *
     * <p>球的取向口径复用 {@link OverlayGeometry#cornerOf}（悬浮球那条线正在收口的那套），
     * 夹边界复用 {@link OverlayGeometry#clamp}，这里不再自建第二套坐标换算。
     * 所有参数单位一致（调用方统一传 px）。</p>
     *
     * @return {left, top}
     */
    public static int[] panelPosition(int orbX, int orbY, int orbSize, int screenWidth, int screenHeight,
                                      int panelWidth, int panelHeight, int edge) {
        int corner = OverlayGeometry.cornerOf(orbX, orbY, orbSize, orbSize, screenWidth, screenHeight);
        boolean right = corner == 1 || corner == 3;
        boolean bottom = corner >= 2;
        int left = right ? orbX + orbSize - panelWidth : orbX;
        int top = bottom ? orbY - edge - panelHeight : orbY + orbSize + edge;
        return OverlayGeometry.clamp(
            left, top, panelWidth, panelHeight, screenWidth, screenHeight, edge);
    }

    /** 读取与网页同一份标定表，只关心有哪些场景有地图。 */
    public static Set<Integer> parseMapScenes(String json) {
        Set<Integer> scenes = new HashSet<>();
        if (json == null || json.isEmpty()) return scenes;
        try {
            JSONObject maps = new JSONObject(json).optJSONObject("maps");
            if (maps == null) return scenes;
            java.util.Iterator<String> keys = maps.keys();
            while (keys.hasNext()) {
                try {
                    scenes.add(Integer.parseInt(keys.next()));
                } catch (NumberFormatException ignored) {
                    // 非场景键直接跳过
                }
            }
        } catch (Exception ignored) {
            return new HashSet<>();
        }
        return scenes;
    }

    public static final class Pet {
        public final String key;
        public final String name;
        public final int level;
        public final List<String> kinds;
        public final boolean rare;
        public final boolean alert;
        public final String nature;
        public final String gender;
        public final Double distanceM;
        public final String bearingLabel;
        public final Double x;
        public final Double y;

        Pet(JSONObject item) {
            key = item.optString("key", "");
            name = item.optString("name", "");
            level = item.optInt("level", 0);
            List<String> parsedKinds = new ArrayList<>();
            JSONArray array = item.optJSONArray("kinds");
            if (array != null) {
                for (int index = 0; index < array.length(); index++) {
                    String kind = array.optString(index, "");
                    if (!kind.isEmpty()) parsedKinds.add(kind);
                }
            }
            kinds = Collections.unmodifiableList(parsedKinds);
            rare = item.optBoolean("rare", false);
            alert = item.optBoolean("alert", false);
            nature = item.optString("nature", "");
            gender = item.optString("gender", "");
            distanceM = numberOrNull(item, "distanceM");
            bearingLabel = item.optString("bearingLabel", "");
            x = numberOrNull(item, "x");
            y = numberOrNull(item, "y");
        }
    }
}
