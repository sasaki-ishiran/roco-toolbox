import { beforeEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_NEARBY_OVERLAY_PANELS,
  NEARBY_OVERLAY_PANELS_KEY,
  isLastEnabledNearbyOverlayPanel,
  normalizeNearbyOverlayPanels,
  readNearbyOverlayPanels,
  resetNearbyOverlayPanelsForTest,
  setNearbyOverlayPanel,
  setNearbyOverlayPanels,
} from './overlayPanels';

beforeEach(() => {
  resetNearbyOverlayPanelsForTest();
  window.localStorage.clear();
});

describe('悬浮球展开内容配置', () => {
  test('没有设置时默认两个都开', () => {
    expect(readNearbyOverlayPanels()).toEqual(DEFAULT_NEARBY_OVERLAY_PANELS);
    expect(readNearbyOverlayPanels()).toEqual({ battle: true, nearby: true });
  });

  test('缺字段或非布尔值按开启处理（旧数据 / 旧壳兜底）', () => {
    expect(normalizeNearbyOverlayPanels({ nearby: false })).toEqual({ battle: true, nearby: false });
    expect(normalizeNearbyOverlayPanels({ battle: false })).toEqual({ battle: false, nearby: true });
    expect(normalizeNearbyOverlayPanels({ battle: 'nope', nearby: 0 })).toEqual({ battle: true, nearby: true });
    expect(normalizeNearbyOverlayPanels(null)).toEqual({ battle: true, nearby: true });
    expect(normalizeNearbyOverlayPanels('')).toEqual({ battle: true, nearby: true });
  });

  test('两项都关时回到默认，保证至少留一项', () => {
    expect(normalizeNearbyOverlayPanels({ battle: false, nearby: false })).toEqual({ battle: true, nearby: true });
  });

  test('修改后写本机记忆 roco.nearbyOverlayPanels，重启沿用', () => {
    setNearbyOverlayPanels({ battle: true, nearby: false });
    expect(JSON.parse(window.localStorage.getItem(NEARBY_OVERLAY_PANELS_KEY) ?? 'null')).toEqual({
      battle: true,
      nearby: false,
    });
    expect(readNearbyOverlayPanels()).toEqual({ battle: true, nearby: false });
  });

  test('可以只关一项；关最后一项不生效', () => {
    expect(setNearbyOverlayPanel('battle', false)).toEqual({ battle: false, nearby: true });
    expect(setNearbyOverlayPanel('nearby', false)).toEqual({ battle: false, nearby: true });
    expect(readNearbyOverlayPanels()).toEqual({ battle: false, nearby: true });

    setNearbyOverlayPanels({ battle: true, nearby: false });
    expect(setNearbyOverlayPanel('battle', false)).toEqual({ battle: true, nearby: false });
    expect(setNearbyOverlayPanel('nearby', true)).toEqual({ battle: true, nearby: true });
  });

  test('只剩一项时标记最后一个开关，供界面置灰', () => {
    const both = { battle: true, nearby: true };
    expect(isLastEnabledNearbyOverlayPanel(both, 'battle')).toBe(false);
    expect(isLastEnabledNearbyOverlayPanel(both, 'nearby')).toBe(false);

    const onlyBattle = { battle: true, nearby: false };
    expect(isLastEnabledNearbyOverlayPanel(onlyBattle, 'battle')).toBe(true);
    expect(isLastEnabledNearbyOverlayPanel(onlyBattle, 'nearby')).toBe(false);
  });
});
