import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ServerAddressPanel, toggleServer } from './ServerAddressPanel';

const TEST_URL = 'https://test.roco-toolbox.pages.dev';
const PROD_URL = 'https://roco-toolbox.pages.dev';
const CUSTOM_URL = 'https://internal.roco-toolbox.pages.dev';

type Bridge = NonNullable<Window['RocoServer']>;

const makeBridge = (overrides: Partial<Bridge> = {}): Bridge => ({
  read: () => JSON.stringify({ current: TEST_URL, defaultUrl: TEST_URL, productionUrl: PROD_URL }),
  apply: () => JSON.stringify({ ok: true, message: `已切换到 ${CUSTOM_URL}，正在重新加载。`, baseUrl: CUSTOM_URL }),
  reset: () => JSON.stringify({ ok: true, message: `已切换到 ${TEST_URL}，正在重新加载。`, baseUrl: TEST_URL }),
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

  test('当前 / 默认（测试服）/ 正式服分开显示，并带风险提示', () => {
    window.RocoServer = makeBridge({
      read: () => JSON.stringify({ current: CUSTOM_URL, defaultUrl: TEST_URL, productionUrl: PROD_URL }),
    });
    render(<ServerAddressPanel onClose={vi.fn()} />);

    expect(screen.getByTestId('server-address-risk')).toHaveTextContent('仅限自用');
    const current = screen.getByTestId('server-address-current');
    expect(current).toHaveTextContent('当前：自定义');
    expect(current).toHaveTextContent(CUSTOM_URL);
    expect(current).toHaveTextContent('默认：测试服');
    expect(current).toHaveTextContent(TEST_URL);
    expect(current).toHaveTextContent('正式：正式服');
    expect(current).toHaveTextContent(PROD_URL);
  });

  test('当前就是默认测试站时显示「当前：测试服（默认）」', () => {
    window.RocoServer = makeBridge();
    render(<ServerAddressPanel onClose={vi.fn()} />);
    expect(screen.getByTestId('server-address-current')).toHaveTextContent('当前：测试服（默认）');
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
    expect(screen.getByTestId('server-address-current')).toHaveTextContent('当前：测试服（默认）');
  });

  test('探活通过后显示壳的成功文案，并更新当前地址', () => {
    window.RocoServer = makeBridge();
    render(<ServerAddressPanel onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('server-address-input'), {
      target: { value: CUSTOM_URL },
    });
    fireEvent.click(screen.getByTestId('server-address-save'));
    flushProbe();

    expect(screen.getByTestId('server-address-notice')).toHaveTextContent('已切换到');
    expect(screen.getByTestId('server-address-current')).toHaveTextContent('当前：自定义');
  });

  test('恢复默认调用壳的 reset', () => {
    const reset = vi.fn(() => JSON.stringify({ ok: true, message: '已切换到测试服', baseUrl: TEST_URL }));
    window.RocoServer = makeBridge({ reset });
    render(<ServerAddressPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('server-address-reset'));
    flushProbe();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('连点快切（toggleServer）', () => {
  test('壳支持 toggle 时直接互切，不探活、不经过 apply', () => {
    const apply = vi.fn();
    const toggle = vi.fn(() => JSON.stringify({ ok: true, message: '已切换到正式服', baseUrl: PROD_URL }));
    const bridge = makeBridge({ apply, toggle });
    expect(toggleServer(bridge).ok).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  test('当前是默认测试站 → 切正式服', () => {
    const apply = vi.fn(() => JSON.stringify({ ok: true, message: 'ok', baseUrl: PROD_URL }));
    const bridge = makeBridge({ apply });
    expect(toggleServer(bridge).ok).toBe(true);
    expect(apply).toHaveBeenCalledWith(PROD_URL);
  });

  test('当前是正式站 → 切回测试服', () => {
    const apply = vi.fn(() => JSON.stringify({ ok: true, message: 'ok', baseUrl: TEST_URL }));
    const bridge = makeBridge({
      read: () => JSON.stringify({ current: PROD_URL, defaultUrl: TEST_URL, productionUrl: PROD_URL }),
      apply,
    });
    expect(toggleServer(bridge).ok).toBe(true);
    expect(apply).toHaveBeenCalledWith(TEST_URL);
  });

  test('当前是自定义地址 → 切回默认测试站', () => {
    const apply = vi.fn(() => JSON.stringify({ ok: true, message: 'ok', baseUrl: TEST_URL }));
    const bridge = makeBridge({
      read: () => JSON.stringify({ current: CUSTOM_URL, defaultUrl: TEST_URL, productionUrl: PROD_URL }),
      apply,
    });
    expect(toggleServer(bridge).ok).toBe(true);
    expect(apply).toHaveBeenCalledWith(TEST_URL);
  });

  test('探活失败时把原因交给调用方', () => {
    const bridge = makeBridge({
      apply: () => JSON.stringify({ ok: false, message: '探活失败：超时', baseUrl: '' }),
    });
    const result = toggleServer(bridge);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('探活失败');
  });
});
