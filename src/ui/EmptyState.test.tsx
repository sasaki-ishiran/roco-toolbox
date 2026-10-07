import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  test('指向「导入数据」页，而不是没有入口的「看板」', () => {
    render(<EmptyState onGoImport={() => {}} />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent('导入数据');
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent('看板');
  });

  test('点「去导入数据」触发跳转回调', () => {
    const onGoImport = vi.fn();
    render(<EmptyState onGoImport={onGoImport} />);
    fireEvent.click(screen.getByTestId('empty-go-import'));
    expect(onGoImport).toHaveBeenCalledTimes(1);
  });

  test('不给回调时不渲染跳转按钮（无法导航的场景只显示文案）', () => {
    render(<EmptyState />);
    expect(screen.queryByTestId('empty-go-import')).toBeNull();
    expect(screen.getByTestId('empty-state')).toHaveTextContent('还没有数据');
  });
});
