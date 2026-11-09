import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ServerAddressPanel } from './ServerAddressPanel';

const DEFAULT_URL = 'https://roco-toolbox.pages.dev';
const INTERNAL_URL = 'https://internal.roco-toolbox.pages.dev';

type Bridge = NonNullable<Window['RocoServer']>;

const makeBridge = (overrides: Partial<Bridge> = {}): Bridge => ({
  read: () => JSON.stringify({ current: DEFAULT_URL, defaultUrl: DEFAULT_URL }),
  apply: () => JSON.stringify({ ok: true, message: `已切换到 ${INTERNAL_URL}，正在重新加载。`, baseUrl: INTERNAL_URL }),
  reset: () => JSON.stringify({ ok: true, message: `已切换到 ${DEFAULT_URL}，正在重新加载。`, baseUrl: DEFAULT_URL }),
  ...overrides,
});

const flushProbe = () => {
  act(() => {
    vi.advanceTimersByTime(60);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.RocoServer;
});

describe('服务器地址（内测）', () => {
  test('壳里才渲染：浏览器环境没有 RocoServer 时什么都不出现', () => {
    const { container } = render(<ServerAddressPanel onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('server-address-panel')).toBeNull();
  });

  test('当前生效地址与默认地址分开显示，并带风险提示', () => {
    window.RocoServer = makeBridge({
      read: () => JSON.stringify({ current: INTERNAL_URL, defaultUrl: DEFAULT_URL }),
    });
    render(<ServerAddressPanel onClose={vi.fn()} />);

    expect(screen.getByTestId('server-address-risk')).toHaveTextContent('仅限自用');
    const current = screen.getByTestId('server-address-current');
    expect(current).toHaveTextContent('当前：内测');
    expect(current).toHaveTextContent(INTERNAL_URL);
    expect(current).toHaveTextContent('默认：生产');
    expect(current).toHaveTextContent(DEFAULT_URL);
  });

  test('当前就是生产时显示「当前：生产」', () => {
    window.RocoServer = makeBridge();
    render(<ServerAddressPanel onClose={vi.fn()} />);
    expect(screen.getByTestId('server-address-current')).toHaveTextContent('当前：生产');
  });

  test('http 地址直接拒绝，不调用壳去探活', () => {
    const apply = vi.fn();
    window.RocoServer = makeBridge({ apply });
    render(<ServerAddressPanel onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('server-address-input'), {
      target: { value: 'http://internal.roco-toolbox.pages.dev' },
    });
    fireEvent.click(screen.getByTestId('server-address-save'));

    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByTestId('server-address-notice')).toHaveTextContent('只支持 https');
  });

  test('探活失败时原样显示壳给的原因，当前地址不变', () => {
    const message = '探活失败：https://bad.example.com/api/health 返回的不是 {"ok":true}（收到：<html>），地址没有保存。';
    window.RocoServer = makeBridge({
      apply: () => JSON.stringify({ ok: false, message, baseUrl: '' }),
    });
    render(<ServerAddressPanel onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('server-address-input'), {
      target: { value: 'https://bad.example.com' },
    });
    fireEvent.click(screen.getByTestId('server-address-save'));
    flushProbe();

    expect(screen.getByTestId('server-address-notice')).toHaveTextContent('地址没有保存');
    expect(screen.getByTestId('server-address-current')).toHaveTextContent('当前：生产');
  });

  test('探活通过后显示壳的成功文案，并更新当前地址', () => {
    window.RocoServer = makeBridge();
    render(<ServerAddressPanel onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('server-address-input'), {
      target: { value: INTERNAL_URL },
    });
    fireEvent.click(screen.getByTestId('server-address-save'));
    flushProbe();

    expect(screen.getByTestId('server-address-notice')).toHaveTextContent('已切换到');
    expect(screen.getByTestId('server-address-current')).toHaveTextContent('当前：内测');
  });

  test('恢复默认调用壳的 reset', () => {
    const reset = vi.fn(() => JSON.stringify({ ok: true, message: '已切换到生产', baseUrl: DEFAULT_URL }));
    window.RocoServer = makeBridge({ reset });
    render(<ServerAddressPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('server-address-reset'));
    flushProbe();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
