import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StudRecommendation } from '../domain/suggestions';
import { SwapWishCard } from './SwapWishCard';

const RECOMMENDATIONS: StudRecommendation[] = [
  {
    id: 'r1',
    natureName: '平和',
    displayName: '白发懒人',
    groupLabels: ['动物组'],
    grade: '大婉',
    gameId: 1,
  },
];

const writeText = vi.fn<(value: string) => Promise<void>>();

/** 点复制按钮并 flush doCopy 的 async 链（clipboard.writeText → setCopied） */
const clickCopy = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('swap-wish-copy'));
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('SwapWishCard 复制提示', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('roco.copyPreviewOff', '1');
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    writeText.mockClear();
  });

  test('连点复制：上一次的定时器不会把新提示提前清掉', async () => {
    render(<SwapWishCard recommendations={RECOMMENDATIONS} />);
    const button = screen.getByTestId('swap-wish-copy');

    await clickCopy();
    expect(button).toHaveTextContent('已复制');

    // 1 秒后（第一次的 1500ms 定时器还没到）再点一次
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await clickCopy();
    expect(button).toHaveTextContent('已复制');

    // 距第一次点击 2 秒：修复前旧定时器会在这里把提示清掉
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(button).toHaveTextContent('已复制');

    // 距第二次点击 1500ms：本次的定时器正常清掉提示
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(button).toHaveTextContent('复制全部 1');
  });

  test('卸载后残留定时器不引发异常', async () => {
    const { unmount } = render(<SwapWishCard recommendations={RECOMMENDATIONS} />);
    await clickCopy();
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    }).not.toThrow();
  });
});

/** 另一批推荐（同样 2 条，但个体不同），用来模拟「筛选后清单变了」 */
const OTHER_RECOMMENDATIONS: StudRecommendation[] = [
  { id: 'r2', natureName: '固执', displayName: '火花', groupLabels: ['天空组'], grade: '大婉', gameId: 2 },
  { id: 'r3', natureName: '开朗', displayName: '焰火', groupLabels: ['天空组'], grade: '大婉', gameId: 3 },
];

describe('SwapWishCard 全选状态', () => {
  test('清单被筛选替换后，「全选」按当前可见清单判断（不再误显示「取消选择」）', () => {
    const { rerender } = render(<SwapWishCard recommendations={RECOMMENDATIONS} />);
    const selectAll = screen.getByTestId('swap-wish-select-all');

    fireEvent.click(selectAll); // 选中当前这批（1 条）
    expect(selectAll).toHaveTextContent('取消选择');

    // 换成另一批同样 1 条的清单：选中集合与可见清单无交集，不该算「已全选」
    rerender(<SwapWishCard recommendations={OTHER_RECOMMENDATIONS.slice(0, 1)} />);
    expect(screen.getByTestId('swap-wish-select-all')).toHaveTextContent('全选');
  });
});
