import { expect, test } from '@playwright/test';

/**
 * 「我的」页与导入三阶段反馈（2026-10-24 重构任务 6）。
 * 这里只放真实页面行为；云同步 409 / 网络失败在既有单测与 mother-groups live 里覆盖。
 */

test('我的：身份 / 游戏数据 / 私有同步三个分区各自可达', async ({ page }) => {
  await page.goto('/');

  // 首启（空存储）默认落在「游戏数据」
  await expect(page.getByTestId('import-button')).toBeVisible();

  await page.getByTestId('profile-section-identity').click();
  await expect(page.getByTestId('profile-identity-intro')).toContainText('工具箱身份');
  await expect(page.getByTestId('account-register')).toBeVisible();

  await page.getByTestId('profile-section-sync').click();
  await expect(page.getByTestId('profile-sync-intro')).toContainText('不会更新小组资源');
  // 还没有身份：明确告诉用户去哪里，而不是给一个不能点的同步按钮
  await expect(page.getByTestId('account-sync-needs-identity')).toBeVisible();
  await expect(page.getByTestId('account-sync')).toHaveCount(0);
});

test('导入成功：本机 / 私有云 / 小组三个阶段分别反馈，且不声称小组已更新', async ({ page }) => {
  await page.goto('/');
  await page
    .getByTestId('import-input')
    .setInputFiles('src/domain/__fixtures__/backup-sample.json');

  // 2026-10-25：导入完成后不再自动跳看板，用户留在导入页看结果
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await expect(page.getByTestId('import-button')).toBeVisible();

  const outcome = page.getByTestId('import-outcome');
  await expect(outcome).toContainText('已保存到本机');
  await expect(outcome).toContainText('私有同步未开启');
  await expect(page.getByTestId('import-outcome-group')).toContainText('小组资源未自动更新');
  await expect(page.getByTestId('import-outcome-open-groups')).toBeVisible();
});

test('坏文件失败：提示切到别的分区再回来仍在（不是一次性 local state）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('this is not json'),
  });

  await expect(page.getByTestId('import-outcome')).toContainText('导入失败');

  await page.getByTestId('profile-section-identity').click();
  await page.getByTestId('profile-section-data').click();
  await expect(page.getByTestId('import-outcome')).toContainText('导入失败');
});
