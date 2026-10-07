import { expect, test } from '@playwright/test';

// 覆盖 config 里「更新内容/教程已读」的预置，才能看到首启弹窗
test.use({ storageState: { cookies: [], origins: [] } });

test('首次打开：看完更新内容后弹使用教程，可跳过且不再打扰', async ({ page }) => {
  await page.goto('/');

  // 先关掉更新内容（两个弹窗不会同时出现）
  await expect(page.getByTestId('changelog-modal')).toBeVisible();
  await page.getByTestId('changelog-ok').click();

  const guide = page.getByTestId('guide-modal');
  await expect(guide).toBeVisible();
  // 第 1 页是功能简介（先讲"能干什么"，再讲操作）
  await expect(guide.getByTestId('guide-body')).toContainText('这个工具能帮你做什么');
  await expect(guide.getByTestId('guide-body')).toContainText('推荐种公');
  await expect(guide.getByTestId('guide-progress')).toHaveText('1 / 5');

  // 翻页：下一步 → 2/5；上一步 → 回 1/5
  await page.getByTestId('guide-next').click();
  await expect(page.getByTestId('guide-progress')).toHaveText('2 / 5');
  await page.getByTestId('guide-prev').click();
  await expect(page.getByTestId('guide-progress')).toHaveText('1 / 5');

  // 跳过 → 消失，页面可用
  await page.getByTestId('guide-skip').click();
  await expect(guide).toHaveCount(0);
  await page.getByRole('button', { name: '看板' }).click();
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();

  // 刷新：本机已记住 → 不再自动弹
  await page.reload();
  await expect(page.getByTestId('guide-modal')).toHaveCount(0);
});

test('顶部「教程」入口随时能回看，走到最后一步是「开始用」', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('changelog-ok').click();
  await page.getByTestId('guide-skip').click();

  await page.getByTestId('guide-open').click();
  const guide = page.getByTestId('guide-modal');
  await expect(guide).toBeVisible();

  // 5 页：最后一步是「开始用」（GUIDE_STEPS 长度变了要同步改这里）
  for (let index = 0; index < 4; index += 1) await page.getByTestId('guide-next').click();
  await expect(page.getByTestId('guide-progress')).toHaveText('5 / 5');
  await expect(page.getByTestId('guide-body')).toContainText('云同步');
  await page.getByTestId('guide-done').click();
  await expect(guide).toHaveCount(0);
});
