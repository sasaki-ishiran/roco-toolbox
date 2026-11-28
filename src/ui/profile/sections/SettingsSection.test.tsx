import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SettingsSection } from './SettingsSection';
import { makeCtx } from '../testContext';
import { clearLocalData } from '../../clearLocalData';

vi.mock('../../clearLocalData', () => ({
  clearLocalData: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  vi.mocked(clearLocalData).mockClear();
});

describe('更多与设置区块', () => {
  test('一行一个目的地：我的身份 / 新手引导（附近已上首屏卡，不在设置里重复）', () => {
    const onGoIdentity = vi.fn();
    const onStartTour = vi.fn();
    render(<SettingsSection ctx={makeCtx({ onGoIdentity, onStartTour })} />);

    fireEvent.click(screen.getByTestId('profile-section-identity'));
    fireEvent.click(screen.getByTestId('profile-guide'));

    expect(onGoIdentity).toHaveBeenCalledTimes(1);
    expect(onStartTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('data-view-nearby')).toBeNull();
    // 身份行沿用用户名口径（RUI P1-02）
    expect(screen.getByTestId('profile-section-identity')).toHaveTextContent('训练家小明');
  });

  test('断数据不炸：未登录时身份行写「未登录」', () => {
    render(<SettingsSection ctx={makeCtx({ accountId: null, accountName: null })} />);
    expect(screen.getByTestId('profile-section-identity')).toHaveTextContent('未登录');
  });

  test('使用统计在设置分组里可直接关闭（隐私开关不藏进弹层）', () => {
    window.localStorage.removeItem('roco.analyticsOff');
    render(<SettingsSection ctx={makeCtx()} />);

    const toggle = screen.getByTestId('analytics-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem('roco.analyticsOff')).toBe('1');
  });

  test('清空本机数据：二次确认写清「云端还在 / 不可撤销」，确认后关闭弹层', async () => {
    render(<SettingsSection ctx={makeCtx()} />);

    fireEvent.click(screen.getByTestId('profile-settings-clear'));
    expect(screen.getByTestId('clear-local-dialog')).toBeInTheDocument();
    const body = screen.getByTestId('clear-local-body');
    expect(body).toHaveTextContent('云端那份还在');
    expect(body).toHaveTextContent('此操作不可撤销');
    expect(body).toHaveTextContent('先同步一次');

    fireEvent.click(screen.getByTestId('clear-local-confirm'));
    await waitFor(() => expect(clearLocalData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('clear-local-dialog')).toBeNull());
  });
});
