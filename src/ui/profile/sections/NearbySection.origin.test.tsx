import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NearbySection } from './NearbySection';
import { NativeCollectorPanel } from '../../NativeCollectorPanel';
import { makeCtx } from '../testContext';
import { readCaptureOrigin, resetCaptureOriginForTest } from '../../../collector/captureOriginStore';

/**
 * 两卡版的 origin 断言（2026-11-28 UX1）：
 * - 附近精灵卡「开始采集」= nearby + battle（只看，不能走自动导入）；
 * - 本机采集卡「采集并导入」= profile + collectorAction('startCapture')（入库）。
 */
const native = vi.hoisted(() => ({
  start: vi.fn(async (_mode?: 'battle' | 'full') => {}),
  action: vi.fn(async (_name: string) => {}),
}));
vi.mock('../../../collector/nativeCollector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../collector/nativeCollector')>();
  return {
    ...actual,
    startCollectorCapture: (mode?: 'battle' | 'full') => native.start(mode),
    collectorAction: (name: string) => native.action(name),
  };
});

const bridgeState = JSON.stringify({
  version: 1,
  supported: true,
  phase: 'idle',
  message: '已停止',
  packets: 0,
  bytes: 0,
  files: [],
});

beforeEach(() => {
  window.localStorage.clear();
  resetCaptureOriginForTest();
  native.start.mockClear();
  native.action.mockClear();
  (window as unknown as { RocoCapture?: unknown }).RocoCapture = {
    getState: async () => bridgeState,
    startCapture: async () => '',
    stopCapture: async () => '',
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { RocoCapture?: unknown }).RocoCapture;
});

describe('两卡版 origin 语义', () => {
  test('附近精灵卡「开始采集」走 nearby + battle，不调 collectorAction', async () => {
    render(<NearbySection ctx={makeCtx()} />);

    fireEvent.click(screen.getByTestId('profile-nearby-start'));

    await waitFor(() => expect(native.start).toHaveBeenCalledWith('battle'));
    expect(native.action).not.toHaveBeenCalled();
    expect(readCaptureOrigin().origin).toBe('nearby');
  });

  test('本机采集卡「采集并导入」走 collectorAction + profile', async () => {
    render(<NativeCollectorPanel compact />);

    const start = await screen.findByTestId('native-collector-start');
    fireEvent.click(start);

    await waitFor(() => expect(native.action).toHaveBeenCalledWith('startCapture'));
    expect(native.start).not.toHaveBeenCalled();
    expect(readCaptureOrigin().origin).toBe('profile');
  });
});
