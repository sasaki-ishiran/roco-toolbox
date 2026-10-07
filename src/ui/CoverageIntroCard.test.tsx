import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { COVERAGE_INTRO_VERSION, CoverageIntroCard } from './CoverageIntroCard';

/** 「覆盖度怎么看」极简说明卡（2026-10-07）：新用户第一次进来给一次，关掉后不再打扰。 */
const KEY = 'roco.coverageIntroSeen';

describe('CoverageIntroCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('没看过 → 显示 3 条说明', () => {
    render(<CoverageIntroCard />);

    const card = screen.getByTestId('coverage-intro');
    expect(card).toHaveTextContent('怎么看这页');
    expect(card).toHaveTextContent('可迭代');
    expect(card.querySelectorAll('li')).toHaveLength(3);
  });

  test('点「知道了」→ 关掉并记住版本，重新挂载也不再出现', () => {
    const { unmount } = render(<CoverageIntroCard />);
    fireEvent.click(screen.getByTestId('coverage-intro-dismiss'));

    expect(screen.queryByTestId('coverage-intro')).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe(COVERAGE_INTRO_VERSION);

    unmount();
    render(<CoverageIntroCard />);
    expect(screen.queryByTestId('coverage-intro')).toBeNull();
  });

  test('教程式版本号：版本变了会再显示一次', () => {
    window.localStorage.setItem(KEY, '过期的版本');
    render(<CoverageIntroCard />);
    expect(screen.getByTestId('coverage-intro')).toBeInTheDocument();
  });
});
