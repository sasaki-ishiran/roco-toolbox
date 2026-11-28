import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { beginImport, resetImportOutcomeForTest, updateImportOutcome } from '../../importOutcomeStore';
import { resetCaptureOriginForTest } from '../../../collector/captureOriginStore';
import { CollectSection } from './CollectSection';
import { makeCtx } from '../testContext';

/**
 * 采集卡一次性完成态（2026-11-28 AV2，两卡版基线）。
 *
 * 口径：自动导入结束后出现一次（chip「已导入」+ role=status 成功条），
 * × / 再次开始采集 / 离开「我的」后都不再出现；失败只给琥珀条 + 重试；
 * 手动停止（没有 completion）不显示完成条。
 */
const auto = vi.hoisted(() => ({
  completion: { session: 'cap-s1' } as { session: string } | null,
  error: null as string | null,
  stage: 'done' as 'idle' | 'done' | 'failed',
  clear: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('../../../collector/autoImportFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../collector/autoImportFlow')>();
  return {
    ...actual,
    useAutoImport: () => ({
      session: auto.completion?.session ?? null,
      stage: auto.stage,
      completion: auto.completion,
      completionError: auto.error,
      error: null,
    }),
    clearAutoImportCompletion: () => {
      auto.clear();
      auto.completion = null;
      auto.stage = 'idle';
      auto.error = null;
    },
    requestAutoImport: (session: string | null | undefined) => {
      auto.retry(session);
      return true;
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

function savedOutcome(message: string) {
  const operationId = beginImport();
  updateImportOutcome(operationId, { local: 'saved', cloud: 'not-enabled', message });
}

beforeEach(() => {
  window.localStorage.clear();
  resetCaptureOriginForTest();
  resetImportOutcomeForTest();
  auto.completion = { session: 'cap-s1' };
  auto.error = null;
  auto.stage = 'done';
  auto.clear.mockClear();
  auto.retry.mockClear();
  savedOutcome('新增 2 个角色');
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

describe('采集卡一次性完成态（两卡版）', () => {
  test('成功：卡头绿色 chip「已导入」+ 一条 role=status；离开后再回来不再出现', async () => {
    const ctx = makeCtx();
    const view = render(<CollectSection ctx={ctx} />);

    const bar = await screen.findByTestId('profile-collect-complete');
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveTextContent('✓ 已采集并导入');
    expect(bar).toHaveTextContent(/· \d{2}:\d{2} · 新增 2 个角色/);
    expect(screen.getByTestId('profile-collect-state')).toHaveTextContent('已导入');
    expect(screen.getByTestId('profile-collect-complete-dashboard')).toHaveTextContent('看看板');
    expect(screen.getByTestId('profile-collect-complete-dismiss')).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-collect-complete-dashboard'));
    expect(ctx.onGoDashboard).toHaveBeenCalledTimes(1);

    // 离开「我的」= 组件卸载：本机按 session 记已读，回来不再出现
    view.unmount();
    render(<CollectSection ctx={makeCtx()} />);
    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
    expect(screen.queryByTestId('profile-collect-state')).toBeNull();
  });

  test('点 × 后消失，并清掉这次 completion', async () => {
    render(<CollectSection ctx={makeCtx()} />);
    await screen.findByTestId('profile-collect-complete');

    fireEvent.click(screen.getByTestId('profile-collect-complete-dismiss'));

    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
    expect(auto.clear).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('roco.profileImportDone')).toBe('cap-s1');
  });

  test('再次开始采集后消失', async () => {
    render(<CollectSection ctx={makeCtx()} />);
    await screen.findByTestId('profile-collect-complete');

    fireEvent.click(screen.getByTestId('native-collector-start'));

    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
    expect(auto.clear).toHaveBeenCalled();
  });

  test('失败：琥珀 role=status「已停止，但导入失败 · 原因」+ 重试，绝不显示成功态', async () => {
    auto.completion = { session: 'cap-s1' };
    auto.stage = 'failed';
    auto.error = '导入没有完成';

    render(<CollectSection ctx={makeCtx()} />);

    const failed = await screen.findByTestId('profile-collect-import-failed');
    expect(failed).toHaveAttribute('role', 'status');
    expect(failed).toHaveTextContent('已停止，但导入失败 · 导入没有完成');
    expect(screen.getByTestId('profile-collect-state')).toHaveTextContent('导入失败');
    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();

    fireEvent.click(screen.getByTestId('profile-collect-retry'));
    expect(auto.retry).toHaveBeenCalledWith('cap-s1');
  });

  test('手动停止（没有 completion）：不显示任何完成条', async () => {
    auto.completion = null;
    auto.stage = 'idle';
    auto.error = null;

    render(<CollectSection ctx={makeCtx()} />);

    expect(await screen.findByTestId('native-collector')).toBeTruthy();
    expect(screen.queryByTestId('profile-collect-complete')).toBeNull();
    expect(screen.queryByTestId('profile-collect-import-failed')).toBeNull();
    expect(screen.queryByTestId('profile-collect-state')).toBeNull();
  });
});
