import { beforeEach, describe, expect, test } from 'vitest';
import {
  CAPTURE_FOCUS_KEY,
  DEFAULT_CAPTURE_FOCUS,
  normalizeCaptureFocus,
  readCaptureFocus,
  resetCaptureFocusForTest,
  setCaptureFocus,
} from './captureFocusStore';

/**
 * 战斗 / 跑图只是「看哪一类」（2026-11-28 口径修正）：
 * 只存一个本机偏好，默认跑图，切错再点回来零成本。
 */
describe('captureFocusStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCaptureFocusForTest();
  });

  test('默认跑图；切换只写本机偏好', () => {
    expect(DEFAULT_CAPTURE_FOCUS).toBe('nearby');
    expect(readCaptureFocus()).toBe('nearby');

    setCaptureFocus('battle');
    expect(readCaptureFocus()).toBe('battle');
    expect(JSON.parse(window.localStorage.getItem(CAPTURE_FOCUS_KEY) ?? 'null')).toBe('battle');

    setCaptureFocus('nearby');
    expect(readCaptureFocus()).toBe('nearby');
  });

  test('坏值一律按跑图处理', () => {
    expect(normalizeCaptureFocus('battle')).toBe('battle');
    expect(normalizeCaptureFocus('nope')).toBe('nearby');
    expect(normalizeCaptureFocus(null)).toBe('nearby');
  });
});
