import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CHANGELOG } from '../data/changelog';
import { ChangelogModal } from './ChangelogModal';

/**
 * 变更弹窗的粗体（2026-10-07）。
 *
 * 背景：弹窗以前是纯文本渲染，文案里写 `**重点**` 会把星号原样显示出来，所以老约定是
 * "别写粗体"。现在支持了，这几条用例守住它，免得以后又退回字面星号。
 */
describe('ChangelogModal 粗体', () => {
  test('**重点** 渲染成 <strong>，不显示字面星号', () => {
    render(
      <ChangelogModal
        entries={[{ id: 't', title: '标题', items: ['这里是**重点**内容'] }]}
        onClose={() => {}}
      />,
    );

    const strong = screen.getByText('重点');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  test('没有标记的条目原样显示', () => {
    render(
      <ChangelogModal entries={[{ id: 't', title: '标题', items: ['普通一条'] }]} onClose={() => {}} />,
    );
    expect(screen.getByText('普通一条')).toBeInTheDocument();
  });

  test('内置公告里的星号都是成对的（单星号会被原样显示出来）', () => {
    for (const entry of CHANGELOG) {
      for (const item of entry.items) {
        expect((item.match(/\*/g) ?? []).length % 2, item).toBe(0);
      }
    }
  });
});
