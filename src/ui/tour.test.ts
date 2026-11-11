import { describe, expect, test } from 'vitest';
import { tourSuppressed } from './tour';

describe('测试版不自动弹新手引导', () => {
  test('test / internal 子域一律不弹', () => {
    expect(tourSuppressed('test.roco-toolbox.pages.dev')).toBe(true);
    expect(tourSuppressed('internal.roco-toolbox.pages.dev')).toBe(true);
  });

  test('正式域名与本地开发照常弹', () => {
    expect(tourSuppressed('roco-toolbox.pages.dev')).toBe(false);
    expect(tourSuppressed('localhost')).toBe(false);
  });
});
