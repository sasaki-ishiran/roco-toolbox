import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  readSwapMainView,
  saveSwapMainView,
  setSwapFilters,
  setSwapSelected,
  useSwapView,
} from './swapViewStore';

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
    window.localStorage.setItem('roco.swapView', 'invalid');
    expect(readSwapMainView()).toBe('eggs');
  });
});

describe('求蛋页的临时条件', () => {
  test('清搜索不清复制勾选（勾选是用户的工作成果）', () => {
    const hook = renderHook(() => useSwapView());
    act(() => {
      setSwapSelected(new Set(['r1']));
      setSwapFilters({ query: '火' });
    });
    expect(hook.result.current.selected.has('r1')).toBe(true);
    act(() => setSwapFilters({ query: '' }));
    expect(hook.result.current.selected.has('r1')).toBe(true);
    expect(hook.result.current.query).toBe('');
  });
});
