import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import { CHANGELOG } from './data/changelog';
import type { AccountSnapshot } from './domain/parseBackup';
import { resetSnapshotCacheForTest } from './storage/snapshotStore';
import { saveSnapshot } from './storage/snapshots';
import { TOUR_SEGMENT_ORDER, TOUR_VERSION } from './ui/tour';

const snapshot = (accountName: string): AccountSnapshot => ({
  accountName,
  gameId: 1,
  exportedAt: '',
  importedAt: new Date().toISOString(),
  pets: [],
  eggs: [],
});

/** 把首启弹窗 / 各页引导标为已读，避免它们挡在页面中间 */
const presetFirstRunSeen = () => {
  for (const segment of TOUR_SEGMENT_ORDER) {
    window.localStorage.setItem(`roco.tourSeen.${segment}`, TOUR_VERSION);
  }
  if (CHANGELOG[0]) window.localStorage.setItem('roco.changelogSeen', CHANGELOG[0].id);
};

afterEach(() => {
  window.localStorage.clear();
});

describe('App', () => {
  test('首页显示看板标题', () => {
    presetFirstRunSeen();
    render(<App />);
    expect(screen.getByRole('heading', { name: '小布助手' })).toBeDefined();
  });

  test('顶部有手动刷新按钮（卡在旧缓存时的兜底）', () => {
    presetFirstRunSeen();
    render(<App />);
    expect(screen.getByTestId('app-refresh')).toHaveTextContent('刷新');
  });

  test('重开应用回到上次停留的页签（关后台不会掉回导入页）', async () => {
    presetFirstRunSeen();
    window.localStorage.setItem('roco.lastTab', 'swap');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('collection-groups')).toBeTruthy());
  });

  test('壳把分享内容注入时自动切到「导入数据」页（否则分享会被静默搁置）', async () => {
    presetFirstRunSeen();
    await saveSnapshot(snapshot('账号甲'));
    resetSnapshotCacheForTest();

    render(<App />);
    // 2026-10-25：导入后不再自动跳看板，首次打开也停在「导入数据」页
    await waitFor(() => expect(screen.getByTestId('import-input')).toBeDefined());

    fireEvent(window, new Event('roco-share'));

    await waitFor(() => expect(screen.getByTestId('import-input')).toBeDefined());
    expect(screen.getByText('导入游戏数据')).toBeTruthy();
  });

  test('没有登录时小组页指向「我的 · 小组」（个人求蛋已删除）', async () => {
    presetFirstRunSeen();
    await saveSnapshot(snapshot('账号甲'));
    resetSnapshotCacheForTest();
    window.localStorage.setItem('roco.lastTab', 'swap');
    window.localStorage.setItem('roco.swapView', 'sharing');

    render(<App />);
    // 2026-11-21：登录与管理入口搬到「我的 · 小组」，小组页签只剩广场的空态引导
    await waitFor(() => expect(screen.getByTestId('group-feed-hint')).toBeTruthy());
    expect(screen.queryByTestId('group-login-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('group-go-profile'));
    await waitFor(() => expect(screen.getByTestId('group-login-hint')).toBeTruthy());
    expect(screen.queryByTestId('personal-eggs')).toBeNull();
    expect(screen.queryByTestId('group-personal')).toBeNull();
  });

  test('顶部「教程」重播当前页引导，关闭后仍停在原页面', async () => {
    presetFirstRunSeen();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '收集' }));
    await waitFor(() => expect(screen.getByTestId('collection-kind-studs')).toBeTruthy());
    fireEvent.click(screen.getByTestId('collection-kind-studs'));
    expect(screen.getByTestId('collection-kind-studs')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('guide-open'));
    expect(screen.getByTestId('tour-root')).toBeDefined();
    // 分页教程没有首启收尾步，一次跳过即关闭。
    fireEvent.click(screen.getByTestId('tour-skip'));

    expect(screen.queryByTestId('tour-root')).toBeNull();
    // 页面没有被卸载重挂：仍是收集页（引导首步会把子视图切回母本）
    expect(screen.getByTestId('collection-kinds')).toBeTruthy();
  });

  test('受限存储（读页签键抛错）不白屏', () => {
    const realGetItem = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === 'roco.lastTab' || key === 'roco.swapView') throw new Error('storage disabled');
      return realGetItem.call(this, key);
    });
    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: '小布助手' })).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
