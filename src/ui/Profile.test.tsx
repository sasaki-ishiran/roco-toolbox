import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Profile } from './Profile';
import type { ProfileSection } from './navigation';
import { beginImport, resetImportOutcomeForTest, updateImportOutcome } from './importOutcomeStore';
import { clearSyncFeedback } from './syncNoticeStore';

afterEach(() => {
  cleanup();
  resetImportOutcomeForTest();
  clearSyncFeedback();
  window.localStorage.clear();
  delete window.RocoServer;
  delete window.RocoUpdate;
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
  test('三个分区（小组/身份/数据）可切换，并带上明确的分区意图', () => {
    const onNavigate = vi.fn();
    render(
      <Profile section="data" returnToGroups={false} onNavigate={onNavigate} />,
    );
    expect(screen.getByTestId('profile-section-groups')).toHaveTextContent('小组');
    fireEvent.click(screen.getByTestId('profile-section-identity'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'identity' });
    fireEvent.click(screen.getByTestId('profile-section-groups'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'groups' });
  });

  test('小组分区：未登录时给登录入口，身份面板保持隐藏', () => {
    renderProfile('groups');
    expect(screen.getByTestId('collection-groups')).toHaveAttribute('data-variant', 'admin');
    expect(screen.getByTestId('group-login-hint')).toBeTruthy();
    expect(screen.queryByTestId('account-panel')).toBeNull();
  });

  test('游戏数据里的「附近」子视图：切换发导航意图，打开时渲染附近页', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <Profile section="data" returnToGroups={false} onNavigate={onNavigate} />,
    );
    fireEvent.click(screen.getByTestId('data-view-nearby'));
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
    expect(screen.queryByTestId('import-input')).toBeNull();
  });

  test('游戏数据分区：导入入口与三阶段反馈都在', () => {
    const id = beginImport();
    updateImportOutcome(id, { local: 'saved', cloud: 'failed', message: '新增 1 个账号' });
    renderProfile('data');

    expect(screen.getByTestId('import-input')).toBeTruthy();
    expect(screen.getByTestId('import-outcome')).toHaveTextContent('已保存到本机');
    expect(screen.getByTestId('import-outcome')).toHaveTextContent('私有云同步失败（本机数据已保存）');
    expect(screen.getByTestId('import-outcome-group')).toHaveTextContent('小组资源未自动更新');
    // 私有同步已经挪到游戏数据页：本机采集 / 导入之后紧接着就是同步
    expect(screen.getByTestId('profile-sync-intro')).toHaveTextContent('不会更新小组资源');
    expect(screen.getByTestId('account-panel')).toHaveTextContent('私有同步');
  });

  test('身份分区的标题与说明写清主语', () => {
    const { rerender } = renderProfile('identity');
    expect(screen.getByTestId('profile-identity-intro')).toHaveTextContent('我的身份');
    expect(screen.getByTestId('account-panel')).toHaveTextContent('我的身份');

    rerender(<Profile section="identity" returnToGroups onNavigate={vi.fn()} />);
    expect(screen.getByTestId('profile-return-groups')).toBeTruthy();
  });

  test('「去小组查看」通过导航意图进入小组', () => {
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
});

describe('Profile 横屏（2026-11-22 三栏）', () => {
  const original = window.matchMedia;
  const setOrientation = (landscape: boolean) => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('landscape') ? landscape : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    if (original) window.matchMedia = original;
    else delete (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia;
  });

  test('分区与游戏数据子视图移进右侧纵向标题栏，正文不再占顶部一排', () => {
    setOrientation(true);
    const onNavigate = vi.fn();
    render(<Profile section="data" returnToGroups={false} onNavigate={onNavigate} />);

    const rail = screen.getByTestId('profile-rail');
    // 页名由左侧页签表达，右侧栏不再重复（2026-11-22 用户口径）
    expect(within(rail).queryByTestId('profile-rail-title')).toBeNull();
    expect(rail).toHaveAttribute('aria-label', '我的标题栏');
    // 三个分区在标题栏里都是一行两个字
    expect(within(rail).getByTestId('profile-section-groups')).toHaveTextContent('小组');
    expect(within(rail).getByTestId('profile-section-identity')).toHaveTextContent('身份');
    expect(within(rail).getByTestId('profile-section-data')).toHaveTextContent('数据');
    expect(within(rail).getByTestId('profile-section-data')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(rail).getByTestId('profile-section-identity'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'identity' });

    // 游戏数据下的「导入 / 附近」也在标题栏，正文不再出现顶部切换
    expect(within(rail).getByTestId('data-view-import')).toHaveTextContent('导入');
    fireEvent.click(within(rail).getByTestId('data-view-nearby'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'tab', page: 'nearby' });
    expect(screen.getByTestId('import-input')).toBeTruthy();
  });

  test('从小组返回「我的」时，返回动作并入标题栏', () => {
    setOrientation(true);
    const onNavigate = vi.fn();
    render(<Profile section="identity" returnToGroups onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('profile-rail-back'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-groups' });
    expect(screen.queryByTestId('profile-return-groups')).toBeNull();
  });

  test('竖屏不出现标题栏，分区仍在页面顶部', () => {
    setOrientation(false);
    render(<Profile section="data" returnToGroups={false} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('profile-rail')).toBeNull();
    expect(screen.getByTestId('profile-section-groups')).toHaveTextContent('小组');
    expect(screen.getByTestId('data-view-import')).toHaveTextContent('导入');
  });
});
