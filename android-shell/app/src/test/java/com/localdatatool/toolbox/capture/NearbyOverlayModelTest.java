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

    @Test public void listKeepsEightRowsAndReportsHiddenTotal() throws Exception {
        JSONObject json = payload("{\"battle\":true,\"nearby\":true}");
        json.put("pets", pets(12));
        json.put("total", 12);
        NearbyOverlayModel model = NearbyOverlayModel.parse(json);
        assertEquals(NearbyOverlayModel.MAX_ROWS, model.pets.size());
        assertEquals(8, model.shownRows());
        assertEquals(4, model.hiddenCount());
        assertEquals("还有 4 只未显示", model.footText());
        assertEquals("附近 12 · 稀有 2", model.titleText());
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
        // 命中 + 附近，5 条
        assertEquals(258, NearbyOverlayModel.panelHeight(true, true, true, 5, true, 0));
        // 命中 + 附近，8 条截断
        assertEquals(366, NearbyOverlayModel.panelHeight(true, true, true, 8, true, 4));
        // 仅命中
        assertEquals(64, NearbyOverlayModel.panelHeight(true, true, false, 0, false, 0));
        // 命中区无数据 + 附近无精灵（实测 200）
        assertEquals(200, NearbyOverlayModel.panelHeight(true, false, true, 0, true, 0));
        // 仅附近，5 条
        assertEquals(194, NearbyOverlayModel.panelHeight(false, false, true, 5, true, 0));
        // 仅附近，8 条截断
        assertEquals(302, NearbyOverlayModel.panelHeight(false, false, true, 8, true, 4));
        // 只有列表（无地图）：短列表不压缩到 44 以下
        assertEquals(64 + 28 + 62 + 8, NearbyOverlayModel.panelHeight(true, true, true, 2, false, 0));
        // 空列表 + 无地图
        assertEquals(64 + 28 + 44 + 8, NearbyOverlayModel.panelHeight(true, true, true, 0, false, 0));
    }

    @Test public void panelAnchorsToAllFourCornersOn375() {
        int width = 268;
        int height = 258;
        int orb = 48;
        assertArrayEquals(new int[] { 8, 64 },
            NearbyOverlayModel.panelPosition(8, 8, orb, 375, 812, width, height, 8));
        assertArrayEquals(new int[] { 99, 64 },
            NearbyOverlayModel.panelPosition(319, 8, orb, 375, 812, width, height, 8));
        assertArrayEquals(new int[] { 8, 490 },
            NearbyOverlayModel.panelPosition(8, 756, orb, 375, 812, width, height, 8));
        assertArrayEquals(new int[] { 99, 490 },
            NearbyOverlayModel.panelPosition(319, 756, orb, 375, 812, width, height, 8));
    }

    @Test public void panelAnchorsToAllFourCornersOn390() {
        int width = 268;
        int height = 258;
        int orb = 48;
        assertArrayEquals(new int[] { 8, 64 },
            NearbyOverlayModel.panelPosition(8, 8, orb, 390, 844, width, height, 8));
        assertArrayEquals(new int[] { 114, 64 },
            NearbyOverlayModel.panelPosition(334, 8, orb, 390, 844, width, height, 8));
        assertArrayEquals(new int[] { 8, 522 },
            NearbyOverlayModel.panelPosition(8, 788, orb, 390, 844, width, height, 8));
        assertArrayEquals(new int[] { 114, 522 },
            NearbyOverlayModel.panelPosition(334, 788, orb, 390, 844, width, height, 8));
    }

    /** 球的真实尺寸由球自己决定（另一条线在改），锚点只用传进来的实际宽度，不写死 48。 */
    @Test public void panelUsesTheOrbSizeItIsGiven() {
        assertArrayEquals(new int[] { 99, 490 },
            NearbyOverlayModel.panelPosition(315, 756, 52, 375, 812, 268, 258, 8));
        assertArrayEquals(new int[] { 8, 68 },
            NearbyOverlayModel.panelPosition(8, 8, 52, 375, 812, 268, 258, 8));
    }

    @Test public void panelNeverLeavesTheEightPixelEdge() {
        // 球在左上：面板挂在球下方，左边贴到 8
        int[] corner = NearbyOverlayModel.panelPosition(0, 0, 48, 375, 812, 268, 366, 8);
        assertEquals(8, corner[0]);
        assertEquals(48 + 8, corner[1]);

        // 球在右下：面板挂在球上方，右边贴到 8
        int[] bottom = NearbyOverlayModel.panelPosition(367, 804, 48, 375, 812, 268, 366, 8);
        assertEquals(375 - 268 - 8, bottom[0]);
        assertEquals(804 - 8 - 366, bottom[1]);
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

    @Test public void mapCatalogComesFromSharedCalibrationJson() {
        String json = "{\"maps\":{\"10003\":{\"name\":\"卡洛西亚大陆\"},\"10007\":{}}}";
        assertEquals(new HashSet<>(Arrays.asList(10003, 10007)),
            NearbyOverlayModel.parseMapScenes(json));
        assertEquals(new HashSet<Integer>(), NearbyOverlayModel.parseMapScenes("not json"));
    }

    private static void assertArrayEquals(int[] expected, int[] actual) {
        assertEquals(Arrays.toString(expected), Arrays.toString(actual));
    }
}

