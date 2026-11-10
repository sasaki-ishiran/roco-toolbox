import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { NearbyOverlayPayload } from './overlayPayload';
import {
  NEARBY_OVERLAY_BRIDGE_VERSION,
  hasNearbyOverlayShell,
  installNearbyOverlayBridge,
  pushNearbyOverlayToShell,
  readNearbyOverlayState,
  resetNearbyOverlayBridgeForTest,
} from './overlayBridge';
import { resetNearbyOverlayPanelsForTest, setNearbyOverlayPanels } from './overlayPanels';

const payload = (overrides: Partial<NearbyOverlayPayload> = {}): NearbyOverlayPayload => ({
  visible: true,
  capturing: true,
  hasKey: true,
  scene: 10003,
  self: { x: 0, y: 0 },
  pets: [{
    key: 'a', name: '雪豆丁', level: 45, kinds: ['shiny'], rare: true, alert: true,
    nature: '保守', gender: '母', distanceM: 8.8, bearingLabel: '西南', bearingArrow: '↙',
    heightPct: 12.3, weightPct: 8.1, voiceDb: 12,
    x: 100, y: -100,
  }],
  total: 1,
  matched: 1,
  mapPets: [{
    key: 'a', kinds: ['shiny'], rare: true, alert: true, reason: 'shiny', x: 100, y: -100, distanceM: 8.8,
  }],
  rareTotal: 1,
  alertTotal: 1,
  selfEstimated: false,
  selfSource: 'packet' as const,
  selfAt: 1234,
  selfHeading: 90,
  perf: { readAvg: 4, readMax: 9, decodeAvg: 30, decodeMax: 70, bytes: 8192, gapAvg: 260, rounds: 40 },
  updatedAt: 1234,
  ...overrides,
});

const shellWith = (updateNearbyOverlay: (json: string) => string | Promise<string>) => {
  // 新壳才有的桥方法，测试里按结构断言，不改共享的 Window 类型（别的任务在改它）
  window.RocoCapture = { getState: () => '{}', updateNearbyOverlay } as unknown as Window['RocoCapture'];
};

beforeEach(() => {
  resetNearbyOverlayPanelsForTest();
  resetNearbyOverlayBridgeForTest();
  window.localStorage.clear();
  delete window.RocoCapture;
  delete window.RocoNearbyOverlay;
  installNearbyOverlayBridge();
});

describe('网页侧读取接口 window.RocoNearbyOverlay', () => {
  test('安装后壳能读到完整状态：版本 + 面板配置 + 当前 payload', () => {
    const bridge = window.RocoNearbyOverlay;
    expect(bridge?.version).toBe(NEARBY_OVERLAY_BRIDGE_VERSION);
    const state = JSON.parse(bridge!.read());
    expect(state).toEqual({
      version: NEARBY_OVERLAY_BRIDGE_VERSION,
      panels: { battle: true, nearby: true },
      payload: null,
    });
    expect(JSON.parse(bridge!.getPanels())).toEqual({ battle: true, nearby: true });
    expect(bridge!.getPayload()).toBe('null');
  });

  test('重复安装不报错，读到的是最新配置', () => {
    expect(() => installNearbyOverlayBridge()).not.toThrow();
    setNearbyOverlayPanels({ battle: false, nearby: true });
    expect(JSON.parse(window.RocoNearbyOverlay!.getPanels())).toEqual({ battle: false, nearby: true });
    expect(JSON.parse(window.RocoNearbyOverlay!.read()).panels).toEqual({ battle: false, nearby: true });
  });

  test('网页侧桥未安装 / 壳侧桥不存在时读取也不报错', () => {
    delete window.RocoNearbyOverlay;
    expect(() => readNearbyOverlayState()).not.toThrow();
    expect(readNearbyOverlayState()).toEqual({
      version: NEARBY_OVERLAY_BRIDGE_VERSION,
      panels: { battle: true, nearby: true },
      payload: null,
    });
  });

  test('推送后读取接口能拿到带面板配置的 payload', async () => {
    setNearbyOverlayPanels({ battle: true, nearby: false });
    const sent = await pushNearbyOverlayToShell(payload());
    expect(sent).toBe(false);
    const state = JSON.parse(window.RocoNearbyOverlay!.read());
    expect(state.payload).toMatchObject({
      visible: true,
      scene: 10003,
      panels: { battle: true, nearby: false },
    });
    expect(state.payload.pets[0]).toMatchObject({ name: '雪豆丁', distanceM: 8.8, bearingLabel: '西南' });
  });
});

describe('推送给安卓壳 updateNearbyOverlay', () => {
  test('旧壳 / 网页没有该方法时静默跳过', async () => {
    expect(hasNearbyOverlayShell()).toBe(false);
    await expect(pushNearbyOverlayToShell(payload())).resolves.toBe(false);
  });

  test('有桥时把同一份字段（含 panels）JSON 推给原生', async () => {
    const update = vi.fn((_json: string) => 'ok');
    shellWith(update);
    expect(hasNearbyOverlayShell()).toBe(true);
    await expect(pushNearbyOverlayToShell(payload())).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(update.mock.calls[0][0]));
    expect(sent).toMatchObject({
      visible: true,
      capturing: true,
      hasKey: true,
      scene: 10003,
      selfEstimated: false,
      panels: { battle: true, nearby: true },
    });
    expect(sent.pets).toHaveLength(1);
    expect(sent.total).toBe(1);
    expect(sent.updatedAt).toBe(1234);
  });

  test('壳桥抛错 / 拒绝时网页不受影响', async () => {
    shellWith(() => { throw new Error('bridge boom'); });
    await expect(pushNearbyOverlayToShell(payload())).resolves.toBe(false);
    shellWith(() => Promise.reject(new Error('bridge reject')));
    await expect(pushNearbyOverlayToShell(payload())).resolves.toBe(false);
  });

  test('停止采集时推送 visible=false，壳侧据此收起并隐藏', async () => {
    const update = vi.fn((_json: string) => 'ok');
    shellWith(update);
    await pushNearbyOverlayToShell(payload({ visible: false, capturing: false }));
    const sent = JSON.parse(String(update.mock.calls[0][0]));
    expect(sent.visible).toBe(false);
    expect(sent.capturing).toBe(false);
  });
});
