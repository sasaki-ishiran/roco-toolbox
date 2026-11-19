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

describe('云同步面板（用户名 + 密码）', () => {
  const calls: Array<{ path: string; method: string }> = [];

  const respond = (path: string): unknown => {
    if (path.startsWith('/api/auth/signup')) {
      return { ok: true, accountId: 'acc-1', token: 'token-1', username: '训练家小明' };
    }
    if (path.startsWith('/api/auth/login')) {
      return { ok: true, accountId: 'acc-2', token: 'token-2', username: '训练家小明' };
    }
    if (path.startsWith('/api/auth/setup')) return { ok: true, username: '训练家小明' };
    if (path.startsWith('/api/me')) {
      return {
        ok: true,
        accountId: 'acc-1',
        createdAt: 1,
        username: '训练家小明',
        snapshot: { version: 1, updatedAt: 2, bytes: 10 },
      };
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

  test('没登录时给两条路：注册 / 登录', () => {
    render(<AccountPanel />);
    expect(screen.getByTestId('account-register')).toHaveTextContent('注册并开启云同步');
    expect(screen.getByTestId('account-mode-login')).toBeInTheDocument();
    expect(screen.getByTestId('account-username-input')).toBeInTheDocument();
    expect(screen.getByTestId('account-password-input')).toBeInTheDocument();
  });

  test('注册：建号后把本机数据传上去', async () => {
    render(<AccountPanel />);
    fireEvent.change(screen.getByTestId('account-username-input'), { target: { value: '训练家小明' } });
    fireEvent.change(screen.getByTestId('account-password-input'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByTestId('account-confirm-input'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByTestId('account-register'));
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/auth/signup')).toBe(true);
    });
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/sync' && call.method === 'PUT')).toBe(true);
    });
    // 开号后进入已登录态
    await waitFor(() => {
      expect(screen.getByTestId('account-sync')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('roco.deviceToken')).toBe('token-1');
  });

  test('注册：两次密码不一致时不发请求', async () => {
    render(<AccountPanel />);
    fireEvent.change(screen.getByTestId('account-username-input'), { target: { value: '训练家小明' } });
    fireEvent.change(screen.getByTestId('account-password-input'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByTestId('account-confirm-input'), { target: { value: '87654321' } });
    fireEvent.click(screen.getByTestId('account-register'));
    await waitFor(() => {
      expect(screen.getByTestId('account-error')).toHaveTextContent('两次输入的密码不一致');
    });
    expect(calls.some((call) => call.path === '/api/auth/signup')).toBe(false);
  });

  test('换设备：用用户名密码登录（令牌落本地）', async () => {
    render(<AccountPanel />);
    fireEvent.click(screen.getByTestId('account-mode-login'));
    fireEvent.change(screen.getByTestId('account-username-input'), { target: { value: '训练家小明' } });
    fireEvent.change(screen.getByTestId('account-password-input'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByTestId('account-login'));
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/auth/login')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId('account-sync')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('roco.deviceToken')).toBe('token-2');
  });

  test('老账号（没有用户名）登录后可以补设用户名密码', async () => {
    window.localStorage.setItem('roco.deviceToken', 'token-old');
    window.localStorage.setItem('roco.accountId', 'acc-old');
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      calls.push({ path, method: String(init?.method ?? 'GET') });
      const body = path.startsWith('/api/me')
        ? { ok: true, accountId: 'acc-old', createdAt: 1, username: null, snapshot: null }
        : respond(path);
      return Promise.resolve(json(body));
    });

    render(<AccountPanel />);
    const setup = await screen.findByTestId('account-open-setup');
    fireEvent.click(setup);
    fireEvent.change(screen.getByTestId('account-setup-username'), { target: { value: '训练家小明' } });
    fireEvent.change(screen.getByTestId('account-setup-password'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByTestId('account-setup-confirm'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByTestId('account-setup-submit'));
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/auth/setup')).toBe(true);
    });
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

    // 选「用本机（覆盖云端）」：先确认（整份替换），认下云端版本后重传 → 成功 → 通知上层
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByTestId('account-conflict-keep-local'));
    await waitFor(() => {
      expect(onHandled).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
  });

  test.each(['account-conflict-keep-local', 'account-force-push'])('覆盖云端取消时不发写请求：%s', async (buttonId) => {
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');
    window.localStorage.setItem('roco.syncVersion', '3');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onHandled = vi.fn();
    render(<AccountPanel autoConflict={{ version: 8, updatedAt: 1_700_000_000_000, bytes: 20 }} onAutoConflictHandled={onHandled} />);

    fireEvent.click(await screen.findByTestId(buttonId));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.path === '/api/sync' && call.method === 'PUT')).toBe(false);
    expect(window.localStorage.getItem('roco.syncVersion')).toBe('3');
    expect(screen.getByTestId('account-conflict')).toBeVisible();
    expect(onHandled).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
