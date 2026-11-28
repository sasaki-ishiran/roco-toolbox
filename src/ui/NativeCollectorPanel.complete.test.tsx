import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NativeCollectorPanel } from './NativeCollectorPanel';

/**
 * 两卡版「本机采集卡」的一次性完成态（2026-11-28 UX1）：
 * 出现一次 / 知道了之后消失 / 再开始采集后消失 / 失败不出现成功态 / 手动停止不显示。
 */
const auto = vi.hoisted(() => ({
  completion: { session: 'cap-s1' } as { session: string } | null,
  error: null as string | null,
  clear: vi.fn(),
}));
vi.mock('../collector/autoImportFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../collector/autoImportFlow')>();
  return {
    ...actual,
    useAutoImport: () => ({
      session: 'cap-s1',
      stage: auto.error ? 'failed' : 'done',
      completion: auto.completion,
      completionError: auto.error,
      error: null,
    }),
    clearAutoImportCompletion: () => {
      auto.clear();
      auto.completion = null;
    },
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
  auto.completion = { session: 'cap-s1' };
  auto.error = null;
  auto.clear.mockClear();
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

describe('本机采集卡的一次性完成态', () => {
  test('导入完成：chip「已完成」+ role=status 成功条', async () => {
    render(<NativeCollectorPanel compact />);

    const bar = await screen.findByTestId('native-collector-complete');
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveTextContent('已采集并导入');
    expect(bar).toHaveTextContent('这次采集的数据已经保存到本机');
    expect(screen.getByTestId('native-collector-state')).toHaveTextContent('已完成');
    // 完成态下不再给「采集并导入」
    expect(screen.queryByTestId('native-collector-start')).toBeNull();
  });

  test('点「知道了」后消失（一次性，不再回来）', async () => {
    render(<NativeCollectorPanel compact />);
    await screen.findByTestId('native-collector-complete');

    fireEvent.click(screen.getByTestId('native-collector-complete-dismiss'));

    expect(screen.queryByTestId('native-collector-complete')).toBeNull();
    expect(auto.clear).toHaveBeenCalledTimes(1);
  });

  test('再次开始采集后消失', async () => {
    render(<NativeCollectorPanel compact />);
    await screen.findByTestId('native-collector-complete');

    fireEvent.click(screen.getByTestId('native-collector-complete-dismiss'));
    fireEvent.click(screen.getByTestId('native-collector-start'));

    expect(screen.queryByTestId('native-collector-complete')).toBeNull();
  });

  test('导入失败：琥珀条「已停止，但导入失败」，不显示成功态', async () => {
    auto.error = '导入没有完成';
    render(<NativeCollectorPanel compact />);

    const failed = await screen.findByTestId('native-collector-import-failed');
    expect(failed).toHaveAttribute('role', 'status');
    expect(failed).toHaveTextContent('已停止，但导入失败');
    expect(screen.queryByTestId('native-collector-complete')).toBeNull();
    expect(screen.queryByTestId('native-collector-state')).toBeNull();
    expect(screen.getByTestId('native-collector-retry')).toHaveTextContent('重试');
  });

  test('手动停止（没有 completion）：不显示完成态', async () => {
    auto.completion = null;
    render(<NativeCollectorPanel compact />);

    expect(await screen.findByTestId('native-collector-start')).toBeTruthy();
    expect(screen.queryByTestId('native-collector-complete')).toBeNull();
    expect(screen.queryByTestId('native-collector-import-failed')).toBeNull();
  });
});
