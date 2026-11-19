package com.localdatatool.toolbox.capture;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * 悬浮面板的纯逻辑（数值口径见 docs/手机悬浮窗-面板规格.md）。
 */
public class NearbyOverlayModelTest {

    private static JSONObject payload(String panels) throws Exception {
        JSONObject json = new JSONObject();
        json.put("visible", true);
        json.put("capturing", true);
        json.put("hasKey", true);
        json.put("scene", 10003);
        json.put("self", new JSONObject().put("x", 307500).put("y", 410000));
        json.put("total", 5);
        json.put("rareTotal", 2);
        json.put("pets", pets(5));
        if (panels != null) json.put("panels", new JSONObject(panels));
        return json;
    }

    private static JSONArray pets(int count) throws Exception {
        JSONArray pets = new JSONArray();
        for (int index = 0; index < count; index++) {
            pets.put(new JSONObject()
                .put("key", "p" + index)
                .put("name", "精灵" + index)
                .put("level", 30 + index)
                .put("kinds", new JSONArray())
                .put("rare", index < 2)
                .put("alert", index == 0)
                .put("distanceM", 10 + index)
                .put("bearingLabel", "东北")
                .put("x", 307500 + index * 100)
                .put("y", 410000));
        }
        return pets;
    }

    @Test public void missingPanelsFallsBackToBothOn() throws Exception {
        NearbyOverlayModel model = NearbyOverlayModel.parse(payload(null));
        assertNotNull(model);
        assertTrue(model.battle);
        assertTrue(model.nearby);
    }

    @Test public void nonBooleanPanelFallsBackToOn() throws Exception {
        NearbyOverlayModel model = NearbyOverlayModel.parse(
            payload("{\"battle\":\"no\",\"nearby\":0}"));
        assertTrue(model.battle);
        assertTrue(model.nearby);
    }

    @Test public void bothPanelsOffFallsBackToBothOn() throws Exception {
        NearbyOverlayModel model = NearbyOverlayModel.parse(
            payload("{\"battle\":false,\"nearby\":false}"));
        assertTrue(model.battle);
        assertTrue(model.nearby);
    }

    @Test public void singlePanelConfigurationIsKept() throws Exception {
        NearbyOverlayModel battleOnly = NearbyOverlayModel.parse(
            payload("{\"battle\":true,\"nearby\":false}"));
        assertTrue(battleOnly.battle);
        assertFalse(battleOnly.nearby);

        NearbyOverlayModel nearbyOnly = NearbyOverlayModel.parse(
            payload("{\"battle\":false,\"nearby\":true}"));
        assertFalse(nearbyOnly.battle);
        assertTrue(nearbyOnly.nearby);
    }

    @Test public void listKeepsMaxRowsAndReportsHiddenTotal() throws Exception {
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        json.put("pets", pets(NearbyOverlayModel.MAX_ROWS + 6));
        json.put("total", NearbyOverlayModel.MAX_ROWS + 6);
        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        assertEquals(NearbyOverlayModel.MAX_ROWS, model.pets.size());
        assertEquals(NearbyOverlayModel.MAX_ROWS, model.shownRows());
        assertEquals(6, model.hiddenCount());
        assertEquals("还有 6 只未显示", model.footText());
        assertEquals("附近 " + (NearbyOverlayModel.MAX_ROWS + 6) + " · 稀有 2", model.titleText());
    }

    @Test public void mapPetsCarryAllNearbyWhileListKeepsFiltered() throws Exception {
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        JSONArray list = new JSONArray();
        list.put(new JSONObject().put("key", "hit").put("name", "命中").put("x", 1).put("y", 2));
        JSONArray map = new JSONArray();
        map.put(new JSONObject().put("key", "hit").put("name", "命中").put("x", 1).put("y", 2));
        map.put(new JSONObject().put("key", "plain").put("name", "普通").put("x", 3).put("y", 4));
        json.put("pets", list);
        json.put("mapPets", map);
        json.put("total", 1);

        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        assertEquals(1, model.pets.size());
        assertEquals(2, model.mapPets.size());
        assertEquals("plain", model.mapPets.get(1).key);

        // 旧网页只给 pets：地图退回 pets，不空图
        json.remove("mapPets");
        NearbyOverlayModel legacy = NearbyOverlayModel.parse(json);
        assertEquals(1, legacy.mapPets.size());
        assertEquals("hit", legacy.mapPets.get(0).key);
    }

    @Test public void listBodyHeightClampsToMap() {
        // 有地图时列表可视区固定等于地图高度
        assertEquals(NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.bodyHeight(5, true));
        assertEquals(NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.bodyHeight(24, true));
        // 无地图时按行数算，超过地图高度就封顶（框内滑动）
        assertEquals(NearbyOverlayModel.listHeight(2), NearbyOverlayModel.bodyHeight(2, false));
        assertEquals(NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.bodyHeight(20, false));
        assertEquals(NearbyOverlayModel.EMPTY_BODY_HEIGHT, NearbyOverlayModel.bodyHeight(0, false));
    }

    @Test public void listShowsExactlyThreeRows() {
        // 行高 28 + 行距 3：3 行正好 90 = 地图高度，第 4 行要滑动
        assertEquals(NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.listHeight(3));
        assertEquals(NearbyOverlayModel.MAP_SIZE, NearbyOverlayModel.bodyHeight(3, true));
        assertTrue(NearbyOverlayModel.listHeight(4) > NearbyOverlayModel.MAP_SIZE);
    }

    @Test public void missingPetFieldsDoNotBreakParsing() throws Exception {
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        JSONArray pets = new JSONArray();
        pets.put(new JSONObject().put("key", "only-key"));
        pets.put(new JSONObject().put("key", "null-coords")
            .put("name", "雪豆丁")
            .put("rare", true)
            .put("alert", true)
            .put("x", JSONObject.NULL)
            .put("y", JSONObject.NULL)
            .put("distanceM", JSONObject.NULL)
            .put("bearingLabel", JSONObject.NULL));
        json.put("pets", pets);
        json.put("total", 2);
        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        assertEquals(2, model.pets.size());
        assertEquals("", model.pets.get(0).name);
        assertNull(model.pets.get(1).x);
        assertNull(model.pets.get(1).distanceM);
    }

    @Test public void nullPayloadIsIgnored() {
        assertNull(NearbyOverlayModel.parse(null));
    }

    @Test public void panelHeightMatchesSpecTable() {
        // 有地图：列表区固定等于地图高度（90 = 3 行 × 28 + 2 × 3），行数再多也不再拉长面板
        assertEquals(NearbyOverlayModel.HIT_HEIGHT + NearbyOverlayModel.BODY_TOP_GAP
                + NearbyOverlayModel.MAP_SIZE + NearbyOverlayModel.FOOT_GAP,
            NearbyOverlayModel.panelHeight(true, true, true, 3, true, 0));
        assertEquals(NearbyOverlayModel.HIT_HEIGHT + NearbyOverlayModel.BODY_TOP_GAP
                + NearbyOverlayModel.MAP_SIZE + NearbyOverlayModel.FOOT_ROW_GAP,
            NearbyOverlayModel.panelHeight(true, true, true, 3, true, 4));
        assertEquals(NearbyOverlayModel.HIT_HEIGHT + NearbyOverlayModel.BODY_TOP_GAP
                + NearbyOverlayModel.MAP_SIZE + NearbyOverlayModel.FOOT_ROW_GAP,
            NearbyOverlayModel.panelHeight(true, true, true, 24, true, 4));
        // 仅命中
        assertEquals(NearbyOverlayModel.HIT_HEIGHT,
            NearbyOverlayModel.panelHeight(true, true, false, 0, false, 0));
        // 命中区无数据 + 附近无精灵（实测 170 = 44 + 28 + 90 + 8）
        assertEquals(NearbyOverlayModel.HIT_EMPTY_HEIGHT + NearbyOverlayModel.BODY_TOP_GAP
                + NearbyOverlayModel.MAP_SIZE + NearbyOverlayModel.FOOT_GAP,
            NearbyOverlayModel.panelHeight(true, false, true, 0, true, 0));
        // 仅附近
        assertEquals(NearbyOverlayModel.BODY_TOP_GAP + NearbyOverlayModel.MAP_SIZE
                + NearbyOverlayModel.FOOT_GAP,
            NearbyOverlayModel.panelHeight(false, false, true, 5, true, 0));
        assertEquals(NearbyOverlayModel.BODY_TOP_GAP + NearbyOverlayModel.MAP_SIZE
                + NearbyOverlayModel.FOOT_ROW_GAP,
            NearbyOverlayModel.panelHeight(false, false, true, 8, true, 4));
        // 只有列表（无地图）：短列表按行数算，超过地图高度就封顶
        assertEquals(NearbyOverlayModel.HIT_HEIGHT + NearbyOverlayModel.BODY_TOP_GAP
                + NearbyOverlayModel.listHeight(2) + NearbyOverlayModel.FOOT_GAP,
            NearbyOverlayModel.panelHeight(true, true, true, 2, false, 0));
        assertEquals(NearbyOverlayModel.HIT_HEIGHT + NearbyOverlayModel.BODY_TOP_GAP
                + NearbyOverlayModel.MAP_SIZE + NearbyOverlayModel.FOOT_GAP,
            NearbyOverlayModel.panelHeight(true, true, true, 20, false, 0));
        // 空列表 + 无地图
        assertEquals(NearbyOverlayModel.HIT_HEIGHT + NearbyOverlayModel.BODY_TOP_GAP
                + NearbyOverlayModel.EMPTY_BODY_HEIGHT + NearbyOverlayModel.FOOT_GAP,
            NearbyOverlayModel.panelHeight(true, true, true, 0, false, 0));
    }

    @Test public void twoLineTextKeepsFieldOrder() throws Exception {
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        JSONArray list = new JSONArray();
        list.put(new JSONObject()
            .put("key", "k1").put("name", "雪豆丁").put("level", 37)
            .put("kinds", new JSONArray().put("high").put("colorful"))
            .put("rare", true).put("alert", true)
            .put("nature", "保守").put("gender", "母")
            .put("distanceM", 12.38).put("bearingArrow", "↗")
            .put("heightPct", 12.38).put("weightPct", 0.29)
            .put("voiceDb", 15).put("reason", "demand"));
        json.put("pets", list);
        json.put("total", 1);

        NearbyOverlayModel.Pet pet = NearbyOverlayModel.parse(json).pets.get(0);
        // 两行卡片：第一行 名称+Lv37（左）/ ↗ 12m（右）；第二行 高 · 重 · 声音（只写分贝）；只截断不四舍五入
        assertEquals("Lv37", NearbyOverlayModel.levelText(pet));
        assertEquals("↗ 12m", NearbyOverlayModel.distanceArrowText(pet));
        assertEquals("12m ↗ 37级", NearbyOverlayModel.metaTextLine1(pet));
        assertEquals("高:12.3% 重:0.2% +15dB", NearbyOverlayModel.metaTextLine2(pet));
        assertEquals(NearbyOverlayModel.RowTone.DEMAND, NearbyOverlayModel.toneOf(pet));
    }

    @Test public void missingFieldsKeepCardTextShort() throws Exception {
        JSONObject json = payload("{\"battle\":false,\"nearby\":true}");
        JSONArray list = new JSONArray();
        // 没有等级：第一行左侧只有名称
        list.put(new JSONObject().put("key", "k1").put("name", "蹦蹦种子"));
        // 没有方向时不画箭头，但距离照常显示
        list.put(new JSONObject().put("key", "k2").put("name", "雪豆丁")
            .put("distanceM", 7.6));
        json.put("pets", list);
        json.put("total", 2);

        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        assertEquals("", NearbyOverlayModel.levelText(model.pets.get(0)));
        assertEquals("8m", NearbyOverlayModel.distanceArrowText(model.pets.get(1)));
    }

    @Test public void voiceFallsBackToRawDbAndNeverPrintsNull() throws Exception {
        JSONObject json = payload("{\"battle\":false,\"nearby\":true}");
        JSONArray list = new JSONArray();
        list.put(new JSONObject()
            .put("key", "k1").put("name", "雪豆丁").put("level", 37)
            .put("kinds", new JSONArray()).put("rare", false).put("alert", false)
            .put("distanceM", 12.38)
            .put("voiceLabel", JSONObject.NULL).put("voiceDb", -99)
            .put("reason", JSONObject.NULL)
            .put("x", 1.0).put("y", 2.0));
        list.put(new JSONObject()
            .put("key", "k2").put("name", "蹦蹦种子").put("level", 3)
            .put("kinds", new JSONArray()).put("rare", false).put("alert", false)
            .put("distanceM", 4.0)
            .put("voiceLabel", JSONObject.NULL).put("reason", JSONObject.NULL));
        json.put("pets", list);
        json.put("total", 2);

        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        // 没有声音牌子时用原始分贝，不能把 JSON null 读成字面量 "null"
        assertEquals("-99dB", NearbyOverlayModel.metaTextLine2(model.pets.get(0)));
        // 原始数据也没有声音字段时整段省略，不输出 null / 占位符
        assertEquals("", NearbyOverlayModel.metaTextLine2(model.pets.get(1)));
        assertNull(model.pets.get(0).reason);
    }

    @Test public void rowToneFollowsPriority() throws Exception {
        assertEquals(NearbyOverlayModel.RowTone.COLORFUL, tone("colorful", "shiny", false, null));
        assertEquals(NearbyOverlayModel.RowTone.SHINY, tone("shiny", "pollution", false, null));
        assertEquals(NearbyOverlayModel.RowTone.POLLUTION, tone("pollution", null, true, null));
        assertEquals(NearbyOverlayModel.RowTone.RARE, tone(null, null, true, null));
        assertEquals(NearbyOverlayModel.RowTone.NORMAL, tone(null, null, false, null));
        assertEquals(NearbyOverlayModel.RowTone.DEMAND, tone("colorful", null, true, "demand"));
    }

    private static NearbyOverlayModel.RowTone tone(
        String first, String second, boolean rare, String reason) throws Exception {
        JSONArray kinds = new JSONArray();
        if (first != null) kinds.put(first);
        if (second != null) kinds.put(second);
        JSONObject pet = new JSONObject().put("key", "k").put("kinds", kinds).put("rare", rare);
        if (reason != null) pet.put("reason", reason);
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        json.put("pets", new JSONArray().put(pet));
        json.put("total", 1);
        return NearbyOverlayModel.toneOf(NearbyOverlayModel.parse(json).pets.get(0));
    }

    @Test public void percentTextTruncatesInsteadOfRounding() {
        assertEquals("12.3%", NearbyOverlayModel.pctText(12.38));
        assertEquals("0.2%", NearbyOverlayModel.pctText(0.29));
        assertEquals("100.0%", NearbyOverlayModel.pctText(100.0));
        assertEquals("—", NearbyOverlayModel.pctText(null));
    }

    @Test public void emptyAndWaitingStatesUseSpecWording() throws Exception {
        JSONObject empty = payload("{\"battle\":true,\"nearby\":true}");
        empty.put("pets", new JSONArray());
        empty.put("total", 0);
        NearbyOverlayModel emptyModel = NearbyOverlayModel.parse(empty);
        assertFalse(emptyModel.waitingLogin());
        assertEquals("0", emptyModel.orbCountText());

        JSONObject waiting = payload("{\"battle\":true,\"nearby\":true}");
        waiting.put("pets", new JSONArray());
        waiting.put("total", 0);
        waiting.put("hasKey", false);
        NearbyOverlayModel waitingModel = NearbyOverlayModel.parse(waiting);
        assertTrue(waitingModel.waitingLogin());
        assertEquals("—", waitingModel.orbCountText());
    }

    @Test public void estimatedCenterAndStaticTexts() throws Exception {
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        json.put("selfEstimated", true);
        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        assertTrue(model.selfEstimated);
        assertEquals("中心为估算", NearbyOverlayModel.ESTIMATED_BADGE);
        assertEquals("附近暂时没有精灵", NearbyOverlayModel.EMPTY_NEARBY_TITLE);
        assertEquals("进入野外后自动出现", NearbyOverlayModel.EMPTY_NEARBY_HINT);
        assertEquals("登录后显示附近精灵", NearbyOverlayModel.WAITING_LOGIN);
        assertEquals("进入赛季奇遇战后，这里会显示守卫的个体数据。", NearbyOverlayModel.HIT_EMPTY_TEXT);
    }

    @Test public void selfDebugFieldsDrivePerfLogging() throws Exception {
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        json.put("selfSource", "odometry");
        json.put("selfAt", 1731234567890L);
        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        assertEquals("odometry", model.selfSource);
        assertEquals(Long.valueOf(1731234567890L), model.selfAt);
        // 地图里最近的距离（pets 默认 10m 起）
        assertEquals(10.0, model.nearestM, 1e-9);

        // 旧网页没有这两个字段：不能因此报错
        JSONObject legacy = payload("{\"battle\":true,\"nearby\":true}");
        NearbyOverlayModel old = NearbyOverlayModel.parse(legacy);
        assertNull(old.selfSource);
        assertNull(old.selfAt);
    }

    @Test public void mapCatalogComesFromSharedCalibrationJson() {
        String json = "{\"maps\":{\"10003\":{\"name\":\"卡洛西亚大陆\"},\"10007\":{}}}";
        assertEquals(new HashSet<>(Arrays.asList(10003, 10007)),
            NearbyOverlayModel.parseMapScenes(json));
        assertEquals(new HashSet<Integer>(), NearbyOverlayModel.parseMapScenes("not json"));
    }
}

