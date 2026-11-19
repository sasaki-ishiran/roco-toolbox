import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useTabViewTracking } from './useTabViewTracking';

const track = vi.hoisted(() => vi.fn());

vi.mock('../api/analytics', () => ({ track }));

function Harness({ page, tab, tour = false }: { page: string; tab: string; tour?: boolean }) {
  useTabViewTracking(page, tab, tour);
  return null;
}

describe('tab_view 上报', () => {
  beforeEach(() => track.mockClear());
  afterEach(() => cleanup());

  test('同一个页签重渲染不重复上报，真换页才报', () => {
    const view = render(<Harness page="collection" tab="collection" />);
    expect(track).toHaveBeenCalledTimes(1);

    // 父组件因其它 state 变化重渲染（旧实现会再报一次）
    view.rerender(<Harness page="collection" tab="collection" />);
    expect(track).toHaveBeenCalledTimes(1);

    view.rerender(<Harness page="nearby" tab="nearby" />);
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith('tab_view', { tab: 'nearby' });
  });

  test('引导期间不上报', () => {
    render(<Harness page="collection" tab="collection" tour />);
    expect(track).not.toHaveBeenCalled();
  });
});
