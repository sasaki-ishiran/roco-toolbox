import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CopySheet } from './CopySheet';

const noop = () => {};

describe('CopySheet「不再提示」勾选', () => {
  test('取消关闭后再打开：勾选被复位（避免上次取消的意图被误存成偏好）', () => {
    const { rerender } = render(
      <CopySheet open text="内容" onConfirm={noop} onCancel={noop} />,
    );

    fireEvent.click(screen.getByTestId('copy-sheet-no-more'));
    expect(screen.getByTestId('copy-sheet-no-more')).toBeChecked();

    // 关闭（组件常驻挂载，只是 return null）→ 再打开
    rerender(<CopySheet open={false} text="内容" onConfirm={noop} onCancel={noop} />);
    rerender(<CopySheet open text="内容" onConfirm={noop} onCancel={noop} />);

    expect(screen.getByTestId('copy-sheet-no-more')).not.toBeChecked();
  });
});
