import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Profile } from './Profile';
import { beginImport, resetImportOutcomeForTest, updateImportOutcome } from './importOutcomeStore';
import { clearSyncFeedback } from './syncNoticeStore';

afterEach(() => {
  cleanup();
  resetImportOutcomeForTest();
  clearSyncFeedback();
  window.localStorage.clear();
  delete window.RocoServer;
});

const renderProfile = (section: 'identity' | 'data' | 'sync' = 'data') =>
  render(
    <Profile
      section={section}
      returnToGroups={false}
      onNavigate={vi.fn()}
    />,
  );

describe('Profile（我的）', () => {
  test('三个分区可切换，并带上明确的分区意图', () => {
    const onNavigate = vi.fn();
    render(
      <Profile section="data" returnToGroups={false} onNavigate={onNavigate} />,
    );
    fireEvent.click(screen.getByTestId('profile-section-identity'));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'identity' });
  });

  test('游戏数据分区：导入入口与三阶段反馈都在', () => {
    const id = beginImport();
    updateImportOutcome(id, { local: 'saved', cloud: 'failed', message: '新增 1 个账号' });
    renderProfile('data');

    expect(screen.getByTestId('import-input')).toBeTruthy();
    expect(screen.getByTestId('import-outcome')).toHaveTextContent('已保存到本机');
    expect(screen.getByTestId('import-outcome')).toHaveTextContent('私有云同步失败（本机数据已保存）');
    expect(screen.getByTestId('import-outcome-group')).toHaveTextContent('小组资源未自动更新');
    // 身份面板在数据分区不卸载，只是隐藏
    expect(screen.getByTestId('profile-account-slot').className).toContain('hidden');
  });

  test('身份与同步分区的标题与说明写清主语', () => {
    const { rerender } = renderProfile('identity');
    expect(screen.getByTestId('profile-identity-intro')).toHaveTextContent('工具箱身份');
    expect(screen.getByTestId('account-panel')).toHaveTextContent('工具箱身份');

    rerender(
      <Profile section="sync" returnToGroups onNavigate={vi.fn()} />,
    );
    expect(screen.getByTestId('profile-sync-intro')).toHaveTextContent('不会更新小组资源');
    expect(screen.getByTestId('account-panel')).toHaveTextContent('私有同步');
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

  test('连点版本号 5 次才出现「服务器地址」，浏览器里永远不出现', () => {
    renderProfile('identity');
    const version = screen.getByTestId('app-version');

    for (let tap = 0; tap < 5; tap += 1) fireEvent.click(version);
    expect(screen.queryByTestId('server-address-panel')).toBeNull();

    window.RocoServer = {
      read: () =>
        JSON.stringify({
          current: 'https://roco-toolbox.pages.dev',
          defaultUrl: 'https://roco-toolbox.pages.dev',
        }),
      apply: () => '{}',
      reset: () => '{}',
    };
    for (let tap = 0; tap < 4; tap += 1) fireEvent.click(version);
    expect(screen.queryByTestId('server-address-panel')).toBeNull();

    fireEvent.click(version);
    expect(screen.getByTestId('server-address-panel')).toBeTruthy();
  });
});
