import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { PageErrorBoundary } from './PageErrorBoundary';

/** 正常渲染时透传 children */
function OkChild() {
  return <div data-testid="ok-child">正常内容</div>;
}

/** 渲染时抛错的组件 */
function BoomChild(): never {
  throw new Error('渲染爆炸');
}

describe('PageErrorBoundary', () => {
  test('正常时渲染子组件', () => {
    render(
      <PageErrorBoundary pageName="收集页">
        <OkChild />
      </PageErrorBoundary>,
    );
    expect(screen.getByTestId('ok-child')).toBeTruthy();
    expect(screen.queryByTestId('page-error-boundary')).toBeNull();
  });

  test('子组件抛错时显示兜底 UI，包含页面名和错误信息', () => {
    // React 会把错误打印到 console.error，测试里压掉噪声
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <PageErrorBoundary pageName="收集页">
          <BoomChild />
        </PageErrorBoundary>,
      );
      expect(screen.getByTestId('page-error-boundary')).toBeTruthy();
      expect(screen.getByText('收集页刚刚出错了')).toBeTruthy();
      expect(screen.getByText(/渲染爆炸/)).toBeTruthy();
      expect(screen.getByTestId('page-error-retry')).toHaveTextContent('重新载入收集页');
    } finally {
      spy.mockRestore();
    }
  });

  test('点「重新载入」后清除错误态（子组件恢复正常则显示正常内容）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function MaybeBoom() {
      if (shouldThrow) throw new Error('第一次炸');
      return <OkChild />;
    }
    try {
      render(
        <PageErrorBoundary pageName="家园页">
          <MaybeBoom />
        </PageErrorBoundary>,
      );
      expect(screen.getByTestId('page-error-boundary')).toBeTruthy();
      shouldThrow = false;
      fireEvent.click(screen.getByTestId('page-error-retry'));
      expect(screen.getByTestId('ok-child')).toBeTruthy();
      expect(screen.queryByTestId('page-error-boundary')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
