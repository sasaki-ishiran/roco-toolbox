import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from './App';
import type { AccountSnapshot } from './domain/parseBackup';
import { resetSnapshotCacheForTest } from './storage/snapshotStore';
import { saveSnapshot } from './storage/snapshots';

const snapshot = (accountName: string): AccountSnapshot => ({
  accountName,
  gameId: 1,
  exportedAt: '',
  importedAt: new Date().toISOString(),
  pets: [],
  eggs: [],
});

describe('App', () => {
  test('首页显示看板标题', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '洛克工具箱' })).toBeDefined();
  });

  test('壳把分享内容注入时自动切到「导入数据」页（否则分享会被静默搁置）', async () => {
    // 有数据时应用会自动落到看板，而接收分享的监听在「导入数据」页里（只挂载当前页）
    await saveSnapshot(snapshot('账号甲'));
    resetSnapshotCacheForTest();

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('import-input')).toBeNull());

    window.dispatchEvent(new Event('roco-share'));

    await waitFor(() => expect(screen.getByTestId('import-input')).toBeDefined());
  });
});
