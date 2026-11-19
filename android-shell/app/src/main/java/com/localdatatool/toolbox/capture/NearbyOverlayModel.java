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

    /** 列表最多渲染 24 条（高度封顶在小地图高度，超出的在框内上下滑动）。 */
    public static final int MAX_ROWS = 24;
    /** 地图 / 雷达最多画 24 个点（网页已按距离截断，这里再兜一层）。 */
    public static final int MAX_MAP_POINTS = 24;
    /** 面板宽度（2026-11-12 档位二：地图 90 + 列表 102 + 两侧 8 + 间距 6 = 214）。 */
    public static final int PANEL_WIDTH = 214;
    /** 球与屏边 / 面板与球 / 面板与屏边的间距。 */
    public static final int EDGE = 8;
    /** 命中区有数据时的高度。 */
    public static final int HIT_HEIGHT = 64;
    /** 命中区无数据时的高度（实测 170 = 44 + 28 + 90 + 8）。 */
    public static final int HIT_EMPTY_HEIGHT = 44;
    /** 标题行相对命中区底部的偏移。 */
    public static final int TITLE_TOP_GAP = 4;
    /** 地图 / 列表相对命中区底部的偏移。 */
    public static final int BODY_TOP_GAP = 28;
    /** 小地图边长（也是列表可视区高度：3 行 28 + 2 个 3 = 90）。 */
    public static final int MAP_SIZE = 90;
    /** 地图与列表之间的横向间距。 */
    public static final int LIST_GAP = 6;
    /** 列表宽度：面板宽度扣掉两侧留白、地图与间距（214 - 8 - 90 - 6 - 8 = 102）。 */
    public static final int LIST_WIDTH = PANEL_WIDTH - EDGE * 2 - MAP_SIZE - LIST_GAP;
    /** 列表行高与行间距（两行紧凑：第一行 16 + 第二行 12 = 28）。 */
    public static final int ROW_HEIGHT = 28;
    public static final int ROW_GAP = 3;
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
    /** 自身坐标来源（packet / odometry / stale / none）；旧网页没有该字段时为 null。 */
    public final String selfSource;
    /** 自身坐标解出时间（epoch ms）；没有为 null。 */
    public final Long selfAt;
    /** 自身朝向（0 = 正北、顺时针，度）；没有朝向数据为 null，地图画圆点而不是箭头。 */
    public final Double selfHeading;
    /** 地图精灵里最近的距离（米）；用于 RocoPerf 判断地图是否跟随。 */
    public final Double nearestM;
    /** 列表：只放命中筛选口径的精灵（最多 {@link #MAX_ROWS} 条）。 */
    public final List<Pet> pets;
    /** 地图：附近所有带坐标的精灵（含未命中筛选的普通精灵，最多 {@link #MAX_MAP_POINTS} 条）。 */
    public final List<Pet> mapPets;
    public final int total;
    public final int rareTotal;
    public final int alertTotal;
    public final long updatedAt;
    /**
     * 网页侧解码轮询实测（2026-11-10）：随 payload 带上来，由壳端 RocoPerf 打印。
     * 旧网页没有 perf 字段时全部为 -1（表示「没有数据」，不是 0ms）。
     */
    public final int perfReadAvg;
    public final int perfReadMax;
    public final int perfDecodeAvg;
    public final int perfDecodeMax;
    public final int perfBytes;
    public final int perfGapAvg;
    public final int perfRounds;

    private NearbyOverlayModel(JSONObject payload) {
        boolean[] panels = parsePanels(payload);
        battle = panels[0];
        nearby = panels[1];
        JSONObject perf = payload.optJSONObject("perf");
        perfReadAvg = perf == null ? -1 : perf.optInt("readAvg", -1);
        perfReadMax = perf == null ? -1 : perf.optInt("readMax", -1);
        perfDecodeAvg = perf == null ? -1 : perf.optInt("decodeAvg", -1);
        perfDecodeMax = perf == null ? -1 : perf.optInt("decodeMax", -1);
        perfBytes = perf == null ? -1 : perf.optInt("bytes", -1);
        perfGapAvg = perf == null ? -1 : perf.optInt("gapAvg", -1);
        perfRounds = perf == null ? -1 : perf.optInt("rounds", -1);
        capturing = payload.optBoolean("capturing", payload.optBoolean("visible", false));
        hasKey = payload.optBoolean("hasKey", true);
        scene = intOrNull(payload, "scene");

        JSONObject self = payload.optJSONObject("self");
        selfX = self == null ? null : numberOrNull(self, "x");
        selfY = self == null ? null : numberOrNull(self, "y");
        selfEstimated = payload.optBoolean("selfEstimated", false);
        selfSource = textOrNull(payload, "selfSource");
        selfAt = longOrNull(payload, "selfAt");
        selfHeading = numberOrNull(payload, "selfHeading");

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

        // 地图用 mapPets（附近所有带坐标的精灵）；旧网页只给 pets 时退回 pets
        List<Pet> mapped = new ArrayList<>();
        JSONArray mapArray = payload.optJSONArray("mapPets");
        if (mapArray == null) mapArray = array;
        if (mapArray != null) {
            for (int index = 0; index < mapArray.length(); index++) {
                JSONObject item = mapArray.optJSONObject(index);
                if (item != null) mapped.add(new Pet(item));
            }
        }
        if (mapped.size() > MAX_MAP_POINTS) {
            mapped = new ArrayList<>(mapped.subList(0, MAX_MAP_POINTS));
        }
        mapPets = Collections.unmodifiableList(mapped);

        Double closest = null;
        for (Pet pet : mapPets) {
            if (pet.distanceM == null) continue;
            if (closest == null || pet.distanceM < closest) closest = pet.distanceM;
        }
        nearestM = closest;

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

    private static Long longOrNull(JSONObject object, String key) {
        if (!object.has(key) || object.isNull(key)) return null;
        long value = object.optLong(key, Long.MIN_VALUE);
        return value == Long.MIN_VALUE ? null : value;
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

    /** 列表内容高度：行数 × 行高，空列表用占位高度。 */
    public static int listHeight(int rows) {
        int safe = Math.max(0, Math.min(rows, MAX_ROWS));
        return safe > 0 ? safe * ROW_HEIGHT + (safe - 1) * ROW_GAP : EMPTY_BODY_HEIGHT;
    }

    /** 列表可视区域高度：不超过小地图，超出的在框内上下滑动。 */
    public static int bodyHeight(int rows, boolean hasMap) {
        if (hasMap) return MAP_SIZE;
        return Math.min(listHeight(rows), MAP_SIZE);
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
        int bodyHeight = bodyHeight(rows, hasMap);
        int footGap = hidden > 0 ? FOOT_ROW_GAP : FOOT_GAP;
        return hitHeight + BODY_TOP_GAP + bodyHeight + footGap;
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
        /** 8 方位箭头（↗ / ← …）；距离太近时为空。 */
        public final String bearingArrow;
        /** 高 / 重百分位（0-100），壳端按一位小数截断显示。 */
        public final Double heightPct;
        public final Double weightPct;
        /** 命中原因：demand / alert / rare / colorful / shiny / pollution；没有为 null。 */
        public final String reason;
        /** 原始声音分贝；payload 里没有该字段时为 null。 */
        public final Double voiceDb;
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
            bearingArrow = item.optString("bearingArrow", "");
            heightPct = numberOrNull(item, "heightPct");
            weightPct = numberOrNull(item, "weightPct");
            // JSON 里的显式 null 不能用 optString：Android 会返回字面量 "null"（2026-11-10 真机反馈）
            reason = textOrNull(item, "reason");
            voiceDb = numberOrNull(item, "voiceDb");
            x = numberOrNull(item, "x");
            y = numberOrNull(item, "y");
        }
    }

    /**
     * 列表卡片底色档位（1.3.6 六种，优先级从高到低）：
     * 命中需求 &gt; 炫彩 &gt; 异色 &gt; 污染 &gt; 稀有 &gt; 普通。
     */
    public enum RowTone { DEMAND, COLORFUL, SHINY, POLLUTION, RARE, NORMAL }

    public static RowTone toneOf(Pet pet) {
        if ("demand".equals(pet.reason)) return RowTone.DEMAND;
        if (pet.kinds.contains("colorful")) return RowTone.COLORFUL;
        if (pet.kinds.contains("shiny")) return RowTone.SHINY;
        if (pet.kinds.contains("pollution")) return RowTone.POLLUTION;
        if (pet.rare) return RowTone.RARE;
        return RowTone.NORMAL;
    }

    /**
     * 百分位文案：只截断不四舍五入（12.38 → 12.3，0.29 → 0.2），保留一位小数。
     */
    public static String pctText(Double value) {
        if (value == null || !Double.isFinite(value)) return "—";
        // 安卓没有 Math.trunc（Java 9），负数也要向零截断
        double scaled = value * 10;
        double truncated = (scaled < 0 ? Math.ceil(scaled) : Math.floor(scaled)) / 10.0d;
        return String.format(java.util.Locale.US, "%.1f%%", truncated);
    }

    /** 距离文案：整数米，没有距离时给占位。 */
    public static String distanceText(Pet pet) {
        if (pet.distanceM == null) return "—";
        return Math.round(pet.distanceM) + "m";
    }

    /**
     * 旧口径的第一行（名称之后）：距离 · 方位箭头 · xx级。
     * 两行卡片第一行改用它拆开的 {@link #levelText} / {@link #distanceArrowText}，本方法只为兼容保留。
     */
    public static String metaTextLine1(Pet pet) {
        StringBuilder builder = new StringBuilder(distanceText(pet));
        append(builder, pet.bearingArrow);
        append(builder, pet.level > 0 ? pet.level + "级" : "");
        return builder.toString();
    }

    /** 两行卡片第一行左侧的等级（「Lv38」）；没有等级时为空。 */
    public static String levelText(Pet pet) {
        return pet.level > 0 ? "Lv" + pet.level : "";
    }

    /** 两行卡片第一行右侧的方位与距离（「↗ 72m」）；没有方向时只给距离。 */
    public static String distanceArrowText(Pet pet) {
        StringBuilder builder = new StringBuilder();
        append(builder, pet.bearingArrow);
        append(builder, distanceText(pet));
        return builder.toString();
    }

    /**
     * 卡片第二行：高:xx.x% · 重:xx.x% · 声音（直接给分贝值，不写「婉转声 / 粗嗓门」）。
     */
    public static String metaTextLine2(Pet pet) {
        StringBuilder builder = new StringBuilder();
        append(builder, pet.heightPct == null ? "" : "高:" + pctText(pet.heightPct));
        append(builder, pet.weightPct == null ? "" : "重:" + pctText(pet.weightPct));
        append(builder, voiceText(pet));
        return builder.toString();
    }

    /** 声音只显示具体分贝（用户要求）；没有数据整段省略，不输出 null。 */
    private static String voiceText(Pet pet) {
        if (pet.voiceDb == null) return "";
        long db = Math.round(pet.voiceDb);
        return (db > 0 ? "+" : "") + db + "dB";
    }

    private static String textOrNull(JSONObject item, String key) {
        if (!item.has(key) || item.isNull(key)) return null;
        String value = item.optString(key, "");
        return value.isEmpty() ? null : value;
    }

    private static void append(StringBuilder builder, String part) {
        if (part == null || part.isEmpty()) return;
        if (builder.length() > 0) builder.append(' ');
        builder.append(part);
    }
}
