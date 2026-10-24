import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import { CHANGELOG } from './data/changelog';
import type { AccountSnapshot } from './domain/parseBackup';
import { resetSnapshotCacheForTest } from './storage/snapshotStore';
import { saveSnapshot } from './storage/snapshots';
import { GUIDE_VERSION } from './ui/guide';

const snapshot = (accountName: string): AccountSnapshot => ({
  accountName,
  gameId: 1,
  exportedAt: '',
  importedAt: new Date().toISOString(),
  pets: [],
  eggs: [],
});

/** 把两个首启弹窗标为已读，避免它们挡在页面中间 */
const presetFirstRunSeen = () => {
  window.localStorage.setItem('roco.guideSeen', GUIDE_VERSION);
  if (CHANGELOG[0]) window.localStorage.setItem('roco.changelogSeen', CHANGELOG[0].id);
};

afterEach(() => {
  window.localStorage.clear();
});

describe('App', () => {
  test('首页显示看板标题', () => {
    presetFirstRunSeen();
    render(<App />);
    expect(screen.getByRole('heading', { name: '洛克工具箱' })).toBeDefined();
  });

  test('顶部有手动刷新按钮（卡在旧缓存时的兜底）', () => {
    presetFirstRunSeen();
    render(<App />);
    expect(screen.getByTestId('app-refresh')).toHaveTextContent('刷新');
  });

  test('重开应用回到上次停留的页签（关后台不会掉回导入页）', () => {
    presetFirstRunSeen();
    window.localStorage.setItem('roco.lastTab', 'swap');
    render(<App />);
    expect(screen.getByTestId('personal-type-stud')).toHaveAttribute('aria-pressed', 'true');
  });

  test('壳把分享内容注入时自动切到「导入数据」页（否则分享会被静默搁置）', async () => {
    presetFirstRunSeen();
    // 有数据时应用会自动落到看板，而接收分享的监听在「导入数据」页里（只挂载当前页）
    await saveSnapshot(snapshot('账号甲'));
    resetSnapshotCacheForTest();

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('import-input')).toBeNull());

    fireEvent(window, new Event('roco-share'));

    await waitFor(() => expect(screen.getByTestId('import-input')).toBeDefined());
  });

  test('已在小组时从看板点求蛋，落到个人求种公而不是母本共享', async () => {
    presetFirstRunSeen();
    await saveSnapshot(snapshot('账号甲'));
    resetSnapshotCacheForTest();
    window.localStorage.setItem('roco.lastTab', 'swap');
    window.localStorage.setItem('roco.swapView', 'sharing');

    render(<App />);
    // 启动落回小组页；没有登录时先给个人求蛋
    expect(screen.getByTestId('personal-eggs')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '看板' }));
    fireEvent.click(screen.getByTestId('recommend-quantity-all'));

    await waitFor(() =>
      expect(screen.getByTestId('personal-type-stud')).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  test('打开教程不会把当前页面卸载重挂（页内选择保留）', () => {
    presetFirstRunSeen();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '收集' }));
    fireEvent.click(screen.getByTestId('collection-kind-studs'));
    expect(screen.getByTestId('collection-kind-studs')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('guide-open'));
    expect(screen.getByTestId('guide-modal')).toBeDefined();
    fireEvent.click(screen.getByTestId('guide-skip'));

    expect(screen.getByTestId('collection-kind-studs')).toHaveAttribute('aria-pressed', 'true');
  });

  test('受限存储（读页签键抛错）不白屏', () => {
    const realGetItem = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === 'roco.lastTab' || key === 'roco.swapView') throw new Error('storage disabled');
      return realGetItem.call(this, key);
    });
    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: '洛克工具箱' })).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
