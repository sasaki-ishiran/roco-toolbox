import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CollectSection } from './CollectSection';
import { makeCtx } from '../testContext';
import { resetCaptureFocusForTest } from '../../../collector/captureFocusStore';
import { readCaptureOrigin, resetCaptureOriginForTest } from '../../../collector/captureOriginStore';

/**
 * 失败测试钉住两条 origin（2026-11-28 UX1）：
 * 「开始采集」= nearby + battle（只看，不能走自动导入）；
 * 「采集并导入」= profile + 普通 startCapture（入库）。
 */
const native = vi.hoisted(() => ({
  start: vi.fn(async (_mode?: 'battle' | 'full') => {}),
  action: vi.fn(async (_name: string, _id?: string) => {}),
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
  resetCaptureFocusForTest();
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

describe('采集卡的 origin 语义', () => {
  test('「开始采集」走 nearby + battle，不调用 collectorAction', async () => {
    render(<CollectSection ctx={makeCtx()} />);

    const peek = await screen.findByTestId('profile-collect-peek');
    await waitFor(() => expect(screen.getByTestId('profile-collect-state')).toHaveTextContent('已停止'));
    expect(peek).toHaveTextContent('开始采集');
    expect(peek).toHaveTextContent('只看附近，不导入');
    fireEvent.click(peek);

    await waitFor(() => expect(native.start).toHaveBeenCalledWith('battle'));
    expect(native.action).not.toHaveBeenCalled();
    expect(readCaptureOrigin().origin).toBe('nearby');
  });

  test('「采集并导入」走 collectorAction + profile origin', async () => {
    render(<CollectSection ctx={makeCtx()} />);

    const download = await screen.findByTestId('profile-collect-import');
    // 等采集状态读完（action 需要 state），再点
    await waitFor(() => expect(screen.getByTestId('profile-collect-state')).toHaveTextContent('已停止'));
    expect(download).toHaveTextContent('采集并导入');
    expect(download).toHaveTextContent('走满自动停止并导入');
    fireEvent.click(download);

    await waitFor(() => expect(native.action).toHaveBeenCalledWith('startCapture'));
    expect(native.start).not.toHaveBeenCalled();
    expect(readCaptureOrigin().origin).toBe('profile');
  });
});
