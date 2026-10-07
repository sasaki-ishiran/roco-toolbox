import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useSnapshots } from './useSnapshots';

/** 模拟「第一次读 IndexedDB 就失败」：缓存空、订阅不触发、refresh 直接 reject */
vi.mock('../storage/snapshotStore', () => ({
  getCachedSnapshots: () => null,
  refreshSnapshots: () => Promise.reject(new Error('db 打不开')),
  subscribeSnapshots: () => () => {},
}));

function Probe() {
  const { loaded, snapshots } = useSnapshots();
  return <p data-testid="probe">{loaded ? `loaded:${snapshots.length}` : 'loading'}</p>;
}

describe('useSnapshots', () => {
  test('首次读取失败也要结束加载态（不能永远停在「正在读取本地数据…」）', async () => {
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('loaded:0'));
  });
});
