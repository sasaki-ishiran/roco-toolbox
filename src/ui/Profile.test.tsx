import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Profile } from './Profile';
import type { ProfileSection } from './navigation';
import { readProfileAvatar } from '../api/profileAvatar';
import { resetMeCacheForTest } from './accountMe';
import { beginImport, resetImportOutcomeForTest, updateImportOutcome } from './importOutcomeStore';
import { clearSyncFeedback } from './syncNoticeStore';
import { clearAllSnapshots, writeSnapshots } from '../storage/snapshots';
import { refreshSnapshots, resetSnapshotCacheForTest } from '../storage/snapshotStore';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** 只关心 /api/me 的桩：返回指定用户名，其余接口一律 ok（避免单测真的打线上）。 */
const stubMe = (username: string | null): string[] => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push(path);
    const body = path.startsWith('/api/me')
      ? { ok: true, accountId: 'acc-1', createdAt: 1, username, snapshot: null }
      : { ok: true };
    return Promise.resolve(json(body));
  });
  return calls;
};

/** 头像流程的桩：/api/me 给用户名，PUT /api/sync 可按用例成功或失败。 */
const stubAvatarSession = (sync: 'ok' | 'fail'): Array<{ path: string; method: string }> => {
  const calls: Array<{ path: string; method: string }> = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = String(init?.method ?? 'GET');
    calls.push({ path, method });
    if (path.startsWith('/api/me')) {
      return Promise.resolve(json({ ok: true, accountId: 'acc-1', createdAt: 1, username: '训练家小明', snapshot: null }));
    }
    if (path === '/api/sync' && method === 'PUT') {
      return Promise.resolve(
        sync === 'fail' ? json({ error: '云端暂时不可用' }, 500) : json({ ok: true, version: 2 }),
      );
    }
    return Promise.resolve(json({ ok: true }));
  });
  return calls;
};

/** 本机已导入两只精灵：换头像的候选只来自这里。 */
const seedImportedPets = async (): Promise<void> => {
  const pet = (gameId: number, name: string) => ({
    gameId,
    name,
    gender: '母' as const,
    nature: '开朗',
    voiceDb: 100,
    medalBody: '',
    isShiny: false,
    account: '测试甲',
  });
  await writeSnapshots([
    {
      accountName: '测试甲',
      gameId: 1,
      exportedAt: '2026-11-28T00:00:00.000Z',
      importedAt: '2026-11-28T00:00:00.000Z',
      pets: [pet(3007, '魔力猫'), pet(3001, '喵喵')],
      eggs: [],
    },
  ]);
  await refreshSnapshots();
};

beforeEach(() => {
  resetMeCacheForTest();
  stubMe(null);
});

afterEach(async () => {
  cleanup();
  resetImportOutcomeForTest();
  clearSyncFeedback();
  window.localStorage.clear();
  delete window.RocoServer;
  delete window.RocoUpdate;
  vi.unstubAllGlobals();
  resetMeCacheForTest();
  await clearAllSnapshots();
  resetSnapshotCacheForTest();
});

const renderProfile = (section: ProfileSection = 'data') =>
  render(
    <Profile
      section={section}
      returnToGroups={false}
      onNavigate={vi.fn()}
    />,
  );

describe('Profile（我的）', () => {
  test('设置行仍在：我的身份 / 新手引导；蛋仓与小组是两张小卡', async () => {
    await seedImportedPets();
    const onNavigate = vi.fn();
    render(
      <Profile section="data" returnToGroups={false} onNavigate={onNavigate} />,
    );
    expect(screen.queryByLabelText('我的分区')).toBeNull();
    expect(screen.getByTestId('profile-section-identity')).toHaveTextContent('我的身份');
    expect(screen.getByTestId('profile-guide')).toHaveTextContent('新手引导');

    fireEvent.click(screen.getByTestId('profile-section-identity'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'identity' });
    fireEvent.click(screen.getByTestId('profile-group-card'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'groups' });
    fireEvent.click(screen.getByTestId('profile-egg-card'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-egg-stock' });
  });

  test('附近卡：详情进附近页，战斗/跑图两个开关至少留一项', async () => {
    await seedImportedPets();
    const onNavigate = vi.fn();
    render(<Profile section="data" returnToGroups={false} onNavigate={onNavigate} />);

    expect(screen.getByTestId('profile-nearby-card')).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-nearby-detail'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'tab', page: 'nearby' });

    const battle = screen.getByTestId('profile-nearby-panel-battle');
    const nearby = screen.getByTestId('profile-nearby-panel-nearby');
    expect(battle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(nearby);
    expect(nearby).toHaveAttribute('aria-pressed', 'false');
    // 关掉跑图后，战斗就是最后一项：置灰，不能再关掉
    expect(battle).toBeDisabled();
    fireEvent.click(battle);
    expect(battle).toHaveAttribute('aria-pressed', 'true');
  });

  test('概览卡挂在我的首页；分区子视图有「返回我的」并带 profile-section-data', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <Profile section="data" returnToGroups={false} onNavigate={onNavigate} />,
    );
    expect(screen.getByTestId('profile-header')).toBeTruthy();

    rerender(<Profile section="identity" returnToGroups={false} onNavigate={onNavigate} />);
    expect(screen.queryByTestId('profile-header')).toBeNull();
    fireEvent.click(screen.getByTestId('profile-section-data'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'data' });
  });

  test('已登录：概览卡与「我的身份」行都写用户名，头像取用户名首字', async () => {
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');
    stubMe('训练家小明');
    await seedImportedPets();

    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('profile-header-name')).toHaveTextContent('训练家小明');
    });
    expect(screen.getByTestId('profile-header-avatar')).toHaveTextContent('训');
    // 设置列表里的账号行同样不能再写死「已登录」
    expect(screen.getByTestId('profile-section-identity')).toHaveTextContent('训练家小明');
  });

  test('老账号没有用户名：概览卡仍写「已登录」，头像写「已」，账号行也写「已登录」', async () => {
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');
    await seedImportedPets();

    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);

    expect(screen.getByTestId('profile-header-name')).toHaveTextContent('已登录');
    expect(screen.getByTestId('profile-header-avatar')).toHaveTextContent('已');
    expect(screen.getByTestId('profile-section-identity')).toHaveTextContent('已登录');
  });

  test('未登录：概览卡写「本机模式 · 未登录」，账号行写「未登录」', async () => {
    await seedImportedPets();
    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);

    expect(screen.getByTestId('profile-header-name')).toHaveTextContent('本机模式 · 未登录');
    expect(screen.getByTestId('profile-section-identity')).toHaveTextContent('未登录');
  });

  test('用户名只查一次 /api/me：概览卡与账号面板共用同一份缓存', async () => {
    await seedImportedPets();
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');
    const calls = stubMe('训练家小明');

    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('profile-header-name')).toHaveTextContent('训练家小明');
    });
    // 让账号面板的后台刷新也落定，再数请求
    await act(async () => {});
    expect(calls.filter((path) => path.startsWith('/api/me'))).toHaveLength(1);
  });

  test('小组分区：未登录时给登录入口，身份面板保持隐藏', () => {
    renderProfile('groups');
    expect(screen.getByTestId('collection-groups')).toHaveAttribute('data-variant', 'admin');
    expect(screen.getByTestId('group-login-hint')).toBeTruthy();
    expect(screen.queryByTestId('account-panel')).toBeNull();
  });

  test('游戏数据里的「附近」子视图：切换发导航意图，打开时渲染附近页', async () => {
    await seedImportedPets();
    const onNavigate = vi.fn();
    const { rerender } = render(
      <Profile section="data" returnToGroups={false} onNavigate={onNavigate} />,
    );
    fireEvent.click(screen.getByTestId('profile-nearby-detail'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'tab', page: 'nearby' });

    rerender(
      <Profile
        section="data"
        dataView="nearby"
        returnToGroups={false}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('nearby-page')).toBeTruthy();
    expect(screen.queryByTestId('profile-sync-block')).toBeNull();
    // 附近是数据视图的子视图：左上角仍能回到「我的」首页
    fireEvent.click(screen.getByTestId('profile-section-data'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'data' });
  });

  test('本机采集卡：三阶段反馈在，文件导入入口已删除', async () => {
    await seedImportedPets();
    const id = beginImport();
    updateImportOutcome(id, { local: 'saved', cloud: 'failed', message: '新增 1 个账号' });
    renderProfile('data');

    expect(screen.queryByTestId('import-input')).toBeNull();
    expect(screen.queryByTestId('import-button')).toBeNull();
    expect(screen.getByTestId('native-collector')).toHaveAttribute('data-compact');
    expect(screen.getByTestId('import-outcome')).toHaveTextContent('已保存到本机');
    expect(screen.getByTestId('import-outcome')).toHaveTextContent('私有云同步失败（本机数据已保存）');
    expect(screen.getByTestId('import-outcome-group')).toHaveTextContent('小组资源未自动更新');
  });

  test('清空本机数据后卡片仍在（采集卡是数据入口），不是白屏', async () => {
    await seedImportedPets();
    renderProfile('data');
    expect(screen.getByTestId('profile-collect')).toBeTruthy();
    expect(screen.getByTestId('profile-egg-card')).toBeTruthy();

    fireEvent.click(screen.getByTestId('profile-settings-clear'));
    fireEvent.click(screen.getByTestId('clear-local-confirm'));

    await waitFor(() => expect(screen.queryByTestId('profile-egg-card')).toBeNull());
    expect(screen.getByTestId('profile-collect')).toBeTruthy();
    expect(screen.getByTestId('profile-header')).toBeTruthy();
  });

  test('身份分区的标题与说明写清主语', () => {
    const { rerender } = renderProfile('identity');
    expect(screen.getByTestId('profile-identity-intro')).toHaveTextContent('我的身份');
    expect(screen.getByTestId('account-panel')).toHaveTextContent('我的身份');

    rerender(<Profile section="identity" returnToGroups onNavigate={vi.fn()} />);
    expect(screen.getByTestId('profile-return-groups')).toBeTruthy();
  });

  test('「去小组查看」通过导航意图进入小组', async () => {
    await seedImportedPets();
    const id = beginImport();
    updateImportOutcome(id, { local: 'saved' });
    const onNavigate = vi.fn();
    render(
      <Profile section="data" returnToGroups={false} onNavigate={onNavigate} />,
    );
    fireEvent.click(screen.getByTestId('import-outcome-open-groups'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-groups' });
  });

  test('环境角标跟在「检查更新」卡里，不再单独占右上角', () => {
    window.RocoUpdate = { check: vi.fn(), version: () => '1.3.6' };
    renderProfile('identity');

    const card = screen.getByTestId('app-update-card');
    expect(card.contains(screen.getByTestId('env-badge'))).toBe(true);
    expect(screen.queryByTestId('env-badge-row')).toBeNull();
  });

  test('没有更新壳（浏览器）时，环境角标挂在版本号行上', () => {
    renderProfile('identity');

    expect(screen.queryByTestId('app-update-card')).toBeNull();
    const version = screen.getByTestId('app-version');
    expect(version.contains(screen.getByTestId('env-badge'))).toBe(true);
  });

  test('连点版本号 5 次在测试站 / 正式站之间互切，浏览器里没有反应', () => {
    vi.useFakeTimers();
    try {
      const TEST_URL = 'https://test.roco-toolbox.pages.dev';
      const PROD_URL = 'https://roco-toolbox.pages.dev';
      renderProfile('identity');
      const version = screen.getByTestId('app-version');

      // 浏览器里没有 RocoServer：连点什么都不该发生
      for (let tap = 0; tap < 5; tap += 1) fireEvent.click(version);
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(screen.queryByTestId('server-address-panel')).toBeNull();
      expect(screen.queryByTestId('server-switch-notice')).toBeNull();

      const apply = vi.fn(() =>
        JSON.stringify({ ok: true, message: '已切换到正式服，正在重新加载。', baseUrl: PROD_URL }),
      );
      window.RocoServer = {
        read: () => JSON.stringify({ current: TEST_URL, defaultUrl: TEST_URL, productionUrl: PROD_URL }),
        apply,
        reset: () => '{}',
      };
      for (let tap = 0; tap < 4; tap += 1) fireEvent.click(version);
      expect(apply).not.toHaveBeenCalled();

      fireEvent.click(version);
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(PROD_URL);
      // 成功时壳会重载页面，不打开手动面板
      expect(screen.queryByTestId('server-address-panel')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('连点快切失败时打开服务器地址面板并显示原因', () => {
    vi.useFakeTimers();
    try {
      const message = '探活失败：https://roco-toolbox.pages.dev/api/health 超时，地址没有保存。';
      window.RocoServer = {
        read: () => JSON.stringify({
          current: 'https://test.roco-toolbox.pages.dev',
          defaultUrl: 'https://test.roco-toolbox.pages.dev',
          productionUrl: 'https://roco-toolbox.pages.dev',
        }),
        apply: () => JSON.stringify({ ok: false, message, baseUrl: '' }),
        reset: () => '{}',
      };
      renderProfile('identity');
      const version = screen.getByTestId('app-version');

      for (let tap = 0; tap < 5; tap += 1) fireEvent.click(version);
      act(() => {
        vi.advanceTimersByTime(60);
      });

      expect(screen.getByTestId('server-switch-notice')).toHaveTextContent('探活失败');
      expect(screen.getByTestId('server-address-panel')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  test('换头像：点页头头像开弹层，只列已导入的精灵，选一只立刻换并写云端', async () => {
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');
    const calls = stubAvatarSession('ok');
    await seedImportedPets();

    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-header-name')).toHaveTextContent('训练家小明');
    });

    fireEvent.click(screen.getByTestId('profile-header-avatar'));
    expect(screen.getByTestId('avatar-picker')).toBeTruthy();
    // 只列导入过的两只，不列全图鉴
    expect(screen.getByTestId('avatar-option-3007')).toHaveTextContent('魔力猫');
    expect(screen.queryByTestId('avatar-option-3003')).toBeNull();

    fireEvent.click(screen.getByTestId('avatar-option-3007'));

    // 选完立刻生效、弹层收起
    expect(screen.queryByTestId('avatar-picker')).toBeNull();
    const headerAvatar = screen.getByTestId('profile-header-avatar');
    const image = within(headerAvatar).getByRole('img');
    expect(image).toHaveAttribute('alt', '训练家小明');
    expect(image.getAttribute('src')).toContain('/jingling/3007/icon.png');

    // 本机先落盘，再异步写云端
    expect(readProfileAvatar('acc-1')).toEqual({ kind: 'pet', gameId: 3007 });
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/api/sync' && call.method === 'PUT')).toBe(true);
    });
    expect(screen.queryByTestId('profile-avatar-notice')).toBeNull();
  });

  test('换头像写云端失败：回滚成原来的头像并提示，不能显示换了其实没存', async () => {
    window.localStorage.setItem('roco.deviceToken', 'token-1');
    window.localStorage.setItem('roco.accountId', 'acc-1');
    stubAvatarSession('fail');
    await seedImportedPets();

    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-header-name')).toHaveTextContent('训练家小明');
    });

    fireEvent.click(screen.getByTestId('profile-header-avatar'));
    fireEvent.click(screen.getByTestId('avatar-option-3007'));

    await waitFor(() => {
      expect(screen.getByTestId('profile-avatar-notice')).toHaveTextContent('已恢复原样');
    });
    // 回滚到默认首字，本机也不留半截状态
    expect(screen.getByTestId('profile-header-avatar')).toHaveTextContent('训');
    expect(screen.queryByTestId('profile-header-avatar')?.querySelector('img')).toBeNull();
    expect(readProfileAvatar('acc-1')).toBeNull();
  });

  test('未登录：点头像不给设置入口，只提示登录后才能设置', () => {
    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByTestId('profile-header-avatar'));

    expect(screen.queryByTestId('avatar-picker')).toBeNull();
    expect(screen.getByTestId('profile-avatar-notice')).toHaveTextContent('登录后才能设置头像');
  });
});
