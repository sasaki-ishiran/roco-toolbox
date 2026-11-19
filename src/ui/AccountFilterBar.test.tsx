import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clearAccountFilter } from './accountFilterStore';
import { AccountFilterBar } from './AccountFilterBar';

beforeEach(() => clearAccountFilter());
afterEach(() => {
  cleanup();
  clearAccountFilter();
});

describe('AccountFilterBar', () => {
  test('matches the dashboard account selector and keeps one account selected', () => {
    render(<AccountFilterBar accounts={['账号甲', '账号乙']} />);

    const summary = screen.getByTestId('account-filter-summary');
    expect(summary).toHaveTextContent('账号甲');
    expect(summary).toHaveTextContent('账号乙');
    expect(summary).toHaveTextContent('(2/2)');
    expect(screen.queryByTestId('account-filter-selector')).toBeNull();

    fireEvent.click(summary);
    fireEvent.click(screen.getByTestId('account-filter-账号乙'));

    expect(screen.getByTestId('account-filter-summary')).toHaveTextContent('(1/2)');
    expect(screen.getByTestId('account-filter-账号甲')).toBeDisabled();
  });

  test('compact mode keeps the selector collapsed and exposes its choices on demand', () => {
    render(<AccountFilterBar accounts={['账号甲', '账号乙']}
                             compact/> as React.ReactElement<any, string | React.JSXElementConstructor<any>> | string | number | Iterable<React.ReactNode> | React.ReactPortal | boolean | undefined | null);

    const summary = screen.getByTestId('account-filter-summary');
    expect(summary).toHaveAttribute('aria-label', '账号筛选 2/2');
    expect(summary).toHaveTextContent('账号甲');
    expect(summary).toHaveTextContent('2/2');
    expect(screen.queryByTestId('account-filter-options')).toBeNull();

    fireEvent.click(summary);
    expect(screen.getByTestId('account-filter-selector')).toBeInTheDocument();
    expect(screen.getByTestId('account-filter-账号甲')).toBeInTheDocument();
  });
});
