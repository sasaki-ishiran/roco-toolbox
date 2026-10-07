import { expect, test } from '@playwright/test';

// 覆盖 config 里「已读」的预置，才能看到首启弹窗。
// 但教程引导（roco.guideSeen）仍预置为已读：本文件只验证更新弹窗，
// 教程由 guide.spec.ts 单独验证；否则关掉更新弹窗后教程会立刻盖上、挡住后续点击。
// 注意：值要跟 src/ui/guide.ts 的 GUIDE_VERSION 保持一致，否则教程会重新弹出并挡住用例。
test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:4173',
        localStorage: [{ name: 'roco.guideSeen', value: '3' }],
      },
    ],
  },
});

test('首次打开弹出更新内容，点「知道了」后不再打扰', async ({ page }) => {
  await page.goto('/');

  const modal = page.getByTestId('changelog-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('更新内容');
  await expect(modal.getByTestId('changelog-body').locator('li').first()).toBeVisible();

  // 关闭 → 消失，且不挡后续操作
  await page.getByTestId('changelog-ok').click();
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: '看板' }).click();
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();

  // 刷新：本机已记住 → 不再弹
  await page.reload();
  await expect(page.getByTestId('changelog-modal')).toHaveCount(0);
});

test('右上角 × 也能关闭弹窗', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('changelog-modal')).toBeVisible();
  await page.getByTestId('changelog-close').click();
  await expect(page.getByTestId('changelog-modal')).toHaveCount(0);
});
