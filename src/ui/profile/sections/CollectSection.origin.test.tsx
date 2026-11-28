import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CollectSection } from './CollectSection';
import { makeCtx } from '../testContext';
import { resetCaptureFocusForTest } from '../../../collector/captureFocusStore';
import { resetCaptureOriginForTest } from '../../../collector/captureOriginStore';

/**
 * 失败测试钉住 origin（2026-11-28 UX1）：
 * 「开始采集」= 只看，必须是 nearby 归属 + battle 裁剪；
 * 否则这路采集会被当成导入导向，走满自动导进看板。
 */
const startCollectorCapture = vi.fn(async (_mode?: 'battle' | 'full') => {});
vi.mock('../../../collector/nativeCollector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../collector/nativeCollector')>();
  return {
    ...actual,
    startCollectorCapture: (mode?: 'battle' | 'full') => startCollectorCapture(mode),
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
  resetCaptureFocusForTest();
  resetCaptureOriginForTest();
  startCollectorCapture.mockClear();
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

describe('采集卡的 origin 语义', () => {
  test('「开始采集」走 nearby + battle，不按导入导向启动', async () => {
    render(<CollectSection ctx={makeCtx()} />);

    const peek = await screen.findByTestId('profile-collect-peek');
    expect(peek).toHaveTextContent('开始采集');
    fireEvent.click(peek);

    await waitFor(() => expect(startCollectorCapture).toHaveBeenCalledWith('battle'));
    expect(screen.getByTestId('profile-collect-import')).toHaveTextContent('采集并导入');
  });

  test('两个按钮标签只有四个字，第二行说明在 ? 里', async () => {
    render(<CollectSection ctx={makeCtx()} />);

    expect(await screen.findByTestId('profile-collect-peek')).toHaveTextContent('开始采集');
    expect(screen.getByTestId('profile-collect-import')).toHaveTextContent('采集并导入');
    fireEvent.click(screen.getByTestId('native-collector-help'));
    expect(screen.getByTestId('native-collector-actions-help')).toHaveTextContent('不自动停止、不自动导入');
  });
});
