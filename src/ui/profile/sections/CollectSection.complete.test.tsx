import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CollectSection } from './CollectSection';
import { makeCtx } from '../testContext';

/**
 * 「采集并导入」走完自动停止 + 自动导入后，卡片要出现一次性的「已采集并导入」，
 * 不能直接变回「已停止」（用户看不到那个停止按钮，需要一个已入库信号）。
 */
const { clearAutoImportCompletion } = vi.hoisted(() => ({ clearAutoImportCompletion: vi.fn() }));
vi.mock('../../../collector/autoImportFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../collector/autoImportFlow')>();
  return {
    ...actual,
    useAutoImport: () => ({ stage: null, completion: { mock: true }, completionError: null }),
    clearAutoImportCompletion,
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
  clearAutoImportCompletion.mockClear();
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

describe('采集卡的完成态', () => {
  test('导入完成后显示「已采集并导入」，点「知道了」消费掉', async () => {
    render(<CollectSection ctx={makeCtx()} />);

    const done = await screen.findByTestId('profile-collect-complete');
    expect(done).toHaveTextContent('已采集并导入');
    expect(screen.getByTestId('profile-collect-state')).toHaveTextContent('已完成');
    // 完成态下不再给两个启动入口
    expect(screen.queryByTestId('profile-collect-actions')).toBeNull();

    screen.getByTestId('profile-collect-complete-dismiss').click();
    expect(clearAutoImportCompletion).toHaveBeenCalledTimes(1);
  });
});
