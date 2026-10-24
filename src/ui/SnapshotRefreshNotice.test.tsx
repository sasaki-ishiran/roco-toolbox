import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { refreshSnapshots, resetSnapshotCacheForTest } from '../storage/snapshotStore';
import { SnapshotRefreshNotice } from './SnapshotRefreshNotice';
import { useSnapshots } from './useSnapshots';
import type { AccountSnapshot } from '../domain/parseBackup';

const list = vi.hoisted(() => vi.fn());
vi.mock('../storage/snapshots', () => ({ listSnapshots: list }));
const saved = { accountName: '已有账号', pets: [] } as unknown as AccountSnapshot;

function Probe() {
  const { snapshots, refreshError, refreshedAt } = useSnapshots();
  return <>
    <p data-testid="cached-accounts">{snapshots.map((s) => s.accountName).join(',')}</p>
    <SnapshotRefreshNotice error={refreshError} refreshedAt={refreshedAt} />
  </>;
}

beforeEach(() => {
  resetSnapshotCacheForTest();
  list.mockReset();
});

test('缓存失败保留账号，显示上次成功时间，重试恢复后撤掉错误', async () => {
  list.mockResolvedValueOnce([saved]);
  await refreshSnapshots();
  list.mockRejectedValueOnce(new Error('磁盘暂不可用'));
  await expect(refreshSnapshots()).rejects.toThrow('磁盘暂不可用');
  render(<Probe />);
  expect(screen.getByTestId('cached-accounts')).toHaveTextContent('已有账号');
  expect(screen.getByRole('alert')).toHaveTextContent('仍显示上次成功读取的内容');
  expect(screen.getByRole('alert')).toHaveTextContent('上次成功读取');

  list.mockResolvedValueOnce([{ ...saved, accountName: '重试后的账号' }]);
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByTestId('cached-accounts')).toHaveTextContent('重试后的账号');
});

test('首次读取失败明确报错，不声称存在旧缓存', async () => {
  list.mockRejectedValue(new Error('本机存储被禁用'));
  render(<Probe />);
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取本机数据');
  expect(screen.getByRole('alert')).not.toHaveTextContent('仍显示');
});
