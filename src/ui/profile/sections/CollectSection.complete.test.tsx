import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CollectSection } from './CollectSection';
import { makeCtx } from '../testContext';

/**
 * 一次性完成态（2026-11-28 UX1）：
 * 出现一次 / × 后消失 / 再开始采集后消失 / 失败绝不显示成功态 / 手动停止不显示。
 */
const auto = vi.hoisted(() => ({
  completion: { session: 'cap-s1' } as { session: string } | null,
  error: null as string | null,
  clear: vi.fn(),
}));
vi.mock('../../../collector/autoImportFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../collector/autoImportFlow')>();
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

describe('采集卡的一次性完成态', () => {
  test('导入完成：chip 变「已导入」+ 一条 role=status 的成功条', async () => {
    render(<CollectSection ctx={makeCtx()} />);

    const bar = await screen.findByTestId('profile-collect-complete');
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveTextContent('已采集并导入');
    expect(screen.getByTestId('profile-collect-state')).toHaveTextContent('已导入');
    expect(screen.getByTestId('profile-collect-complete-dashboard')).toHaveTextContent('看看板');
    // 成功态下不再给两个启动入口
    expect(screen.queryByTestId('profile-collect-actions')).toBeNull();
  });

  test('点 × 后消失（一次性，不再回来）', async () => {
    render(<CollectSection ctx={makeCtx()} />);
    await screen.findByTestId('profile-collect-complete');

    fireEvent.click(screen.getByTestId('profile-collect-complete-dismiss'));

    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
    expect(auto.clear).toHaveBeenCalledTimes(1);
  });

  test('再次开始采集后消失', async () => {
    render(<CollectSection ctx={makeCtx()} />);
    await screen.findByTestId('profile-collect-complete');

    fireEvent.click(screen.getByTestId('profile-collect-complete-dismiss'));
    // 关闭后两个入口回来
    expect(screen.getByTestId('profile-collect-import')).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-collect-import'));

    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
  });

  test('导入失败：琥珀条「已停止，但导入失败」，绝不显示成功态', async () => {
    auto.error = '导入没有完成';
    render(<CollectSection ctx={makeCtx()} />);

    const failed = await screen.findByTestId('profile-collect-import-failed');
    expect(failed).toHaveAttribute('role', 'status');
    expect(failed).toHaveTextContent('已停止，但导入失败');
    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
    expect(screen.getByTestId('profile-collect-state')).toHaveTextContent('导入失败');
    expect(screen.getByTestId('profile-collect-retry')).toHaveTextContent('重试');
  });

  test('手动停止（没有 completion）：不显示完成条，两个入口照常', async () => {
    auto.completion = null;
    render(<CollectSection ctx={makeCtx()} />);

    expect(await screen.findByTestId('profile-collect-import')).toBeTruthy();
    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
    expect(screen.queryByTestId('profile-collect-import-failed')).toBeNull();
  });
});
