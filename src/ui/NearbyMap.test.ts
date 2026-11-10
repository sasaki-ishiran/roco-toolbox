import { afterEach, describe, expect, test } from 'vitest';
import { panForSelfMove, readSavedZoom, zoomView } from './NearbyMap';
import { WORLD_MAPS, WORLD_UNITS_PER_METER } from '../pcap/worldMap';

afterEach(() => {
  window.localStorage.clear();
});

describe('附近地图缩放记忆', () => {
  test('没有记录时默认 1（150m 视野）', () => {
    expect(readSavedZoom()).toBe(1);
  });

  test('合法缩放会沿用', () => {
    window.localStorage.setItem('roco.nearbyMapZoom', '2.5');
    expect(readSavedZoom()).toBe(2.5);
  });

  test('非法值回落到默认，不把地图缩到看不见', () => {
    window.localStorage.setItem('roco.nearbyMapZoom', '0');
    expect(readSavedZoom()).toBe(1);
    window.localStorage.setItem('roco.nearbyMapZoom', 'abc');
    expect(readSavedZoom()).toBe(1);
  });
});

describe('自身移动时地图跟随（2026-11-10）', () => {
  const map = WORLD_MAPS[10003];

  test('自身向东走 1 米 → 视图反方向平移 1 米的像素数', () => {
    const view = { scale: 2, tx: 10, ty: 20 };
    const perMeter = map.width / (map.sideUnits / WORLD_UNITS_PER_METER);
    const next = panForSelfMove(
      map,
      { x: map.originX + 1000, y: map.originY + 1000 },
      { x: map.originX + 1000 + WORLD_UNITS_PER_METER, y: map.originY + 1000 },
      view,
    );
    expect(next.tx).toBeCloseTo(view.tx - perMeter * view.scale);
    expect(next.ty).toBeCloseTo(view.ty);
  });

  test('自身没动时原样返回，不触发多余重绘', () => {
    const view = { scale: 2, tx: 10, ty: 20 };
    expect(panForSelfMove(map, { x: 1, y: 2 }, { x: 1, y: 2 }, view)).toBe(view);
  });

  test('跟随不重置用户缩放', () => {
    const view = { scale: 3.5, tx: 0, ty: 0 };
    const next = panForSelfMove(
      map,
      { x: map.originX, y: map.originY },
      { x: map.originX + 40800, y: map.originY },
      view,
    );
    expect(next.scale).toBe(3.5);
    expect(next.tx).toBeLessThan(0);
  });
});

describe('地图缩放兜底（2026-11-10 真机「缩放弹错误」）', () => {
  test('正常缩放以锚点为中心，倍率被限制在上下限内', () => {
    const view = { scale: 1, tx: 0, ty: 0 };
    expect(zoomView(view, 2, 50, 50)).toEqual({ scale: 2, tx: -50, ty: -50 });
    expect(zoomView(view, 1e9, 0, 0).scale).toBe(6);
    expect(zoomView(view, 1e-9, 0, 0).scale).toBe(0.04);
  });

  test('NaN / Infinity 输入原样返回旧视图，不把地图算没', () => {
    const view = { scale: 1.5, tx: 10, ty: 20 };
    // 上一帧 scale 被污染成 NaN 时也能恢复：退回 1 再缩放
    expect(zoomView({ scale: Number.NaN, tx: 0, ty: 0 }, 1.2, 10, 10).scale).toBeCloseTo(1.2);
    expect(zoomView(view, Number.NaN, 10, 10)).toBe(view);
    expect(zoomView(view, Number.POSITIVE_INFINITY, 10, 10)).toBe(view);
    expect(zoomView(view, 1.2, Number.NaN, Number.NaN).tx).toBe(10);
    expect(Number.isFinite(zoomView(view, 1.2, Number.NaN, Number.NaN).ty)).toBe(true);
  });

  test('缩放倍数没变化时返回同一对象，不触发多余重绘', () => {
    const view = { scale: 6, tx: 10, ty: 20 };
    // 已经到上限：Math.max/min 之后 scale 仍是 6，但锚点不变 → 数值相同、引用可不同
    const next = zoomView(view, 2, 0, 0);
    expect(next.scale).toBe(6);
    expect(next.tx).toBe(view.tx);
  });
});
