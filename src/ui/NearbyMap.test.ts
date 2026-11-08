import { afterEach, describe, expect, test } from 'vitest';
import { readSavedZoom } from './NearbyMap';

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
