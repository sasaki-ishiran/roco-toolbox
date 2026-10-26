import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { RecommendedNatureEditor } from './RecommendedNatureEditor';
import { resetNatureOverridesForTest } from './natureOverrideStore';

beforeEach(() => {
  resetNatureOverridesForTest();
});

describe('推荐性格编辑器', () => {
  test('名字带形态，搜索能按形态命中', () => {
    render(<RecommendedNatureEditor open onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('nature-editor-search'), {
      target: { value: '雪绒鸟' },
    });
    const rows = screen.getAllByTestId('nature-editor-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.textContent?.includes('春天的样子'))).toBe(true);
  });

  test('卡片紧凑：窄屏三列、宽屏四列，长名字完整显示不截断', () => {
    render(<RecommendedNatureEditor open onClose={() => {}} />);
    const grid = screen.getByTestId('nature-editor-grid');
    expect(grid.className).toContain('grid-cols-3');
    expect(grid.className).toContain('sm:grid-cols-4');

    const longName = screen
      .getAllByTestId('nature-editor-row')
      .find((row) => row.textContent?.includes('小星光_月光能量的样子'));
    expect(longName).toBeTruthy();
    expect(longName?.querySelector('.truncate')).toBeNull();
  });

  test('改一颗蛋的性格会写入覆盖并标「已改」，恢复默认清掉', () => {
    render(<RecommendedNatureEditor open onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId(/nature-editor-toggle-\d+/)[0]);
    fireEvent.click(screen.getAllByTestId(/nature-option-\d+-胆小/)[0]);
    const row = screen.getAllByTestId('nature-editor-row').find((item) =>
      item.textContent?.includes('已改'),
    );
    expect(row).toBeTruthy();
    expect(row).toHaveTextContent('胆小');

    fireEvent.click(screen.getAllByTestId(/nature-editor-reset-\d+/)[0]);
    expect(
      screen.queryAllByTestId('nature-editor-row').some((item) => item.textContent?.includes('已改')),
    ).toBe(false);
  });
});
