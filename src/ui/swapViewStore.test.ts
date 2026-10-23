import { beforeEach, describe, expect, test } from 'vitest';
import { readSwapMainView, saveSwapMainView } from './swapViewStore';

beforeEach(() => {
  window.localStorage.clear();
});

describe('换什么的主视图', () => {
  test('默认是换蛋清单', () => {
    expect(readSwapMainView()).toBe('eggs');
  });

  test('记住母本共享，重开应用还停在这里', () => {
    saveSwapMainView('sharing');
    expect(readSwapMainView()).toBe('sharing');
    saveSwapMainView('eggs');
    expect(readSwapMainView()).toBe('eggs');
  });

  test('本地存了非法值时退回换蛋清单', () => {
    window.localStorage.setItem('roco.swapView', 'legacy');
    expect(readSwapMainView()).toBe('eggs');
  });
});
