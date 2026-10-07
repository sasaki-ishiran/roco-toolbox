import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GUIDE_VERSION, guidePending, markGuideSeen } from './guide';
import { GUIDE_STEPS, GuideModal } from './GuideModal';

describe('使用教程', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('首启待弹；标记已读后不再弹（按版本号记）', () => {
    expect(guidePending()).toBe(true);
    markGuideSeen();
    expect(guidePending()).toBe(false);
    // 版本升级（内容大改）后会再弹一次
    window.localStorage.setItem('roco.guideSeen', '0');
    expect(guidePending()).toBe(true);
    expect(GUIDE_VERSION).not.toBe('0');
  });

  test('教程覆盖用户主线：功能简介 / 导入数据 / 看板 / 云同步', () => {
    const titles = GUIDE_STEPS.map((step) => step.title).join('|');
    // 前两页先讲"能干什么、值在哪"（功能简介）
    expect(titles).toContain('帮你做什么');
    expect(titles).toContain('档位和性格');
    expect(titles).toContain('导进来');
    expect(titles).toContain('看板');
    expect(titles).toContain('云同步');
    // 推荐种公 / 配窝建议只在第 1 页简介里说明，不再单独开页（避免重复）
    expect(titles).not.toContain('推荐种公：');
    expect(titles).not.toContain('配窝建议：');
  });

  test('翻页与关闭：下一步到最后一页变「开始用」，跳过直接关', () => {
    const onClose = vi.fn();
    render(<GuideModal onClose={onClose} />);
    expect(screen.getByTestId('guide-progress')).toHaveTextContent(`1 / ${GUIDE_STEPS.length}`);

    fireEvent.click(screen.getByTestId('guide-next'));
    expect(screen.getByTestId('guide-progress')).toHaveTextContent('2 /');
    fireEvent.click(screen.getByTestId('guide-prev'));
    expect(screen.getByTestId('guide-progress')).toHaveTextContent('1 /');

    for (let guard = 0; guard < GUIDE_STEPS.length && !screen.queryByTestId('guide-done'); guard += 1) {
      fireEvent.click(screen.getByTestId('guide-next'));
    }
    fireEvent.click(screen.getByTestId('guide-done'));
    expect(onClose).toHaveBeenCalledTimes(1);

    render(<GuideModal onClose={onClose} />);
    fireEvent.click(screen.getAllByTestId('guide-skip')[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
