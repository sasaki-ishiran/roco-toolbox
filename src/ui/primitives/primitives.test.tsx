import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Button } from './Button';
import { Field } from './Field';
import { FilterPanel } from './FilterPanel';
import { InlineSelect } from './InlineSelect';
import { ScopeSummary } from './ScopeSummary';
import { SearchField } from './SearchField';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'a', label: '选项甲' },
  { value: 'b', label: '选项乙' },
  { value: 'c', label: '禁用项', disabled: true },
];

describe('SearchField', () => {
  test('搜索始终有名称且能清空', () => {
    const onValueChange = vi.fn();
    render(<SearchField label="搜索我的母本" value="布灵" onValueChange={onValueChange} />);
    expect(screen.getByRole('searchbox', { name: '搜索我的母本' })).toHaveValue('布灵');
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(onValueChange).toHaveBeenCalledWith('');
  });

  test('没有内容时不显示清除按钮（不会误清别的条件）', () => {
    render(<SearchField label="搜索" value="" onValueChange={() => {}} />);
    expect(screen.queryByRole('button', { name: '清除搜索' })).toBeNull();
  });
});

describe('InlineSelect', () => {
  const renderSelect = (onValueChange = vi.fn()) => {
    render(
      <InlineSelect
        label="选择成员"
        value="a"
        options={OPTIONS}
        onValueChange={onValueChange}
        testId="member-select"
        menuTestId="member-options"
        optionTestId={(value) => `member-option-${value}`}
      />,
    );
    return onValueChange;
  };

  test('展开后焦点在当前项；选择后收起并返回焦点', () => {
    const onValueChange = renderSelect();
    const trigger = screen.getByTestId('member-select');
    fireEvent.click(trigger);

    const group = screen.getByRole('radiogroup', { name: '选择成员' });
    const current = screen.getByRole('radio', { name: '选项甲' });
    expect(current).toBeChecked();
    expect(document.activeElement).toBe(current);

    fireEvent.click(screen.getByRole('radio', { name: '选项乙' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(group.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  test('Esc 关闭并返回焦点', () => {
    renderSelect();
    const trigger = screen.getByTestId('member-select');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Escape' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('点外部关闭', () => {
    renderSelect();
    fireEvent.click(screen.getByTestId('member-select'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  test('方向键移到下一项，且不关闭面板', () => {
    const onValueChange = renderSelect();
    fireEvent.click(screen.getByTestId('member-select'));
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' });
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('radiogroup')).toBeTruthy();
  });

  test('禁用项不能被选中', () => {
    const onValueChange = renderSelect();
    fireEvent.click(screen.getByTestId('member-select'));
    fireEvent.click(screen.getByRole('radio', { name: '禁用项' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  test('用 aria-pressed 表达互斥视角，禁用项不可点', () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        label="视图"
        value="a"
        options={OPTIONS}
        onValueChange={onValueChange}
        optionTestId={(value) => `view-${value}`}
      />,
    );
    expect(screen.getByRole('group', { name: '视图' })).toBeTruthy();
    expect(screen.getByTestId('view-a')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('view-b'));
    expect(onValueChange).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByTestId('view-c'));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });
});

describe('FilterPanel', () => {
  test('折叠与清除只作用于本面板', () => {
    const onOpenChange = vi.fn();
    const onClear = vi.fn();
    const { rerender } = render(
      <FilterPanel
        title="筛选"
        summary="已选：大块头"
        open
        onOpenChange={onOpenChange}
        onClear={onClear}
        testId="filters"
        toggleTestId="filters-toggle"
        clearTestId="filters-clear"
      >
        <p>面板内容</p>
      </FilterPanel>,
    );
    expect(screen.getByTestId('filters')).toHaveTextContent('已选：大块头');
    expect(screen.getByText('面板内容')).toBeTruthy();
    fireEvent.click(screen.getByTestId('filters-toggle'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId('filters-clear'));
    expect(onClear).toHaveBeenCalled();

    rerender(
      <FilterPanel title="筛选" open={false} onOpenChange={onOpenChange}>
        <p>面板内容</p>
      </FilterPanel>,
    );
    expect(screen.queryByText('面板内容')).toBeNull();
  });
});

describe('Field 与 Button', () => {
  test('错误用 aria-invalid / aria-describedby 关联', () => {
    render(<Field label="恢复码" error="恢复码不对" defaultValue="abc" />);
    const input = screen.getByRole('textbox', { name: '恢复码' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('恢复码不对');
  });

  test('忙碌态实际禁用并播报', () => {
    render(<Button busy>提交</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('处理中…');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ScopeSummary', () => {
  test('主语、条件、来源时间与编辑动作都在', () => {
    const onEdit = vi.fn();
    render(
      <ScopeSummary
        scope="我的母本达标条件"
        criteria="大块头 / 小不点 · ±100dB"
        sourceTime="10/24 12:00"
        onEdit={onEdit}
      />,
    );
    const root = screen.getByText('我的母本达标条件').parentElement!;
    expect(root).toHaveTextContent('大块头 / 小不点');
    expect(root).toHaveTextContent('数据：10/24 12:00');
    fireEvent.click(screen.getByRole('button', { name: '调整' }));
    expect(onEdit).toHaveBeenCalled();
  });
});
