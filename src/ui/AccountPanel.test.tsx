import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { encodeSnapshot } from '../api/sync';
import { clearSession } from '../api/session';
import { getLastImportHistory, getLastImportResult, resetLastImportForTest } from '../storage/lastImportStore';
import { resetSnapshotCacheForTest } from '../storage/snapshotStore';
import { clearAllSnapshots } from '../storage/snapshots';
import { AccountPanel } from './AccountPanel';

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('云同步面板（免密恢复码）', () => {
  const calls: Array<{ path: string; method: string }> = [];

  const respond = (path: string): unknown => {
    if (path.startsWith('/api/auth/register')) {
      return { ok: true, accountId: 'acc-1', token: 'token-1', recoveryCode: 'ABCD-EFGH-JKLM' };
    }
    if (path.startsWith('/api/auth/recover')) return { ok: true, accountId: 'acc-2', token: 'token-2' };
    if (path.startsWith('/api/me')) {
      return { ok: true, accountId: 'acc-1', createdAt: 1, snapshot: { version: 1, updatedAt: 2, bytes: 10 } };
    }
    if (path.startsWith('/api/sync')) {
      return path.includes('full=1') ? { ok: true, snapshot: null } : { ok: true, version: 1 };
    }
    return { ok: true };
  };

  beforeEach(async () => {
    window.localStorage.clear();
    clearSession();
    await clearAllSnapshots();
    resetSnapshotCacheForTest();
    resetLastImportForTest();
    calls.length = 0;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      calls.push({ path, method: String(init?.method ?? 'GET') });
      return Promise.resolve(
        new Response(JSON.stringify(respond(path)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('没登录时给两条路：开启云同步 / 用恢复码登录', () => {
    render(<AccountPanel />);
    expect(screen.getByTestId('account-register')).toHaveTextContent('开启云同步');
    expect(screen.getByTestId('account-recover-input')).toBeInTheDocument();
  });

  test('开启云同步：显示一次性恢复码，并把本机数据传上去', async () => {
    render(<AccountPanel />);
    fireEvent.click(screen.getByTestId('account-register'));
    await waitFor(() => {
      expect(screen.getByTestId('account-recovery-code')).toHaveTextContent('ABCD-EFGH-JKLM');
    });
    expect(screen.getByTestId('account-recovery-block')).toHaveTextContent('只显示这一次');
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/sync' && call.method === 'PUT')).toBe(true);
    });
    // 开号后进入已登录态
    await waitFor(() => {
      expect(screen.getByTestId('account-sync')).toBeInTheDocument();
    });
  });

  test('换设备：输入恢复码即登录（令牌落本地）', async () => {
    render(<AccountPanel />);
    fireEvent.change(screen.getByTestId('account-recover-input'), { target: { value: 'ZPXE-JJ76-AEVT' } });
    fireEvent.click(screen.getByTestId('account-recover-submit'));
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/auth/recover')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId('account-sync')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('roco.deviceToken')).toBe('token-2');
  });

  test('立即同步：一条动作里拉云端再推回（云端还没有数据时把本机当第一份）', async () => {
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');
    render(<AccountPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('account-sync')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('account-sync'));

    await waitFor(() => {
      expect(screen.getByTestId('account-message')).toHaveTextContent('已同步');
    });
    // 先拉（full=1）再推，用户不用自己判断方向
    expect(calls.some((call) => call.path === '/api/sync?full=1')).toBe(true);
    expect(calls.some((call) => call.path === '/api/sync' && call.method === 'PUT')).toBe(true);
  });

  test('立即同步把云端数据合并进来后，看板「本次新增」能看到同步进来的精灵', async () => {
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');

    const payload = encodeSnapshot({
      type: 'roco-toolbox-cloud',
      version: 3,
      savedAt: '',
      catalogVersion: 's4',
      accounts: [
        {
          accountName: '云端甲',
          gameId: 9001,
          exportedAt: '2026-10-07T00:00:00.000Z',
          importedAt: '2026-10-07T00:00:00.000Z',
          pets: [
            {
              gameId: 999999,
              name: '云端母本',
              gender: '母',
              nature: '开朗',
              voiceDb: 100,
              medalBody: '大块头',
              isShiny: false,
              account: '云端甲',
              boxGroup: '盒子01',
              boxNumber: 1,
              slotOrder: 3,
            },
          ],
          eggs: [],
        },
      ],
      prefs: {},
    });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      if (init?.method === 'PUT') return Promise.resolve(json({ ok: true, version: 4 }));
      if (path.startsWith('/api/me')) {
        return Promise.resolve(
          json({ ok: true, accountId: 'acc-1', createdAt: 1, snapshot: { version: 4, updatedAt: 2, bytes: 10 } }),
        );
      }
      return Promise.resolve(
        json({ ok: true, snapshot: { version: 3, updatedAt: 1, bytes: 10, payload } }),
      );
    });

    render(<AccountPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('account-sync')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('account-sync'));

    await waitFor(() => {
      expect(screen.getByTestId('account-message')).toHaveTextContent('已同步');
    });
    // 同步进来的合格精灵进「本次新增」卡（用户要求：不知道同步了什么）
    await waitFor(() => {
      expect(getLastImportResult()?.[0].mothers[0].pets[0].label).toBe('云端母本');
    });
    // 同步不是导入 → 不写「导入历史」
    expect(getLastImportHistory()).toEqual([]);
  });

  test('导入后的自动上传冲突：显示二选一，处理完通知上层清除提示', async () => {
    const onHandled = vi.fn();
    render(
      <AccountPanel
        autoConflict={{ version: 7, updatedAt: 1_700_000_000_000, bytes: 20 }}
        onAutoConflictHandled={onHandled}
      />,
    );

    // 冲突块出现（此前这种情况被 `.catch(() => {})` 静默吞掉）
    await waitFor(() => {
      expect(screen.getByTestId('account-conflict')).toBeInTheDocument();
    });
    expect(screen.getByTestId('account-conflict')).toHaveTextContent('版本 7');

    // 选「用本机（覆盖云端）」：认下云端版本后重传 → 成功 → 通知上层
    fireEvent.click(screen.getByTestId('account-conflict-keep-local'));
    await waitFor(() => {
      expect(onHandled).toHaveBeenCalled();
    });
  });
});
