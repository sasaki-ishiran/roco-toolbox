import { expect, test, type Page } from '@playwright/test';
import { progressOf } from './progress';

const importSample = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
};

test('旧共享记忆不影响看板求蛋：点「全部」直达换蛋清单', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('roco.lastTab', 'swap');
    window.localStorage.setItem('roco.swapView', 'sharing');
  });
  await page.goto('/');

  // 启动落回小组（旧子视图保留）
  await expect(page.getByTestId('swap-view-sharing')).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: '看板' }).click();
  await page.getByTestId('recommend-quantity-all').click();

  await expect(page.getByTestId('swap-view-eggs')).toHaveAttribute('aria-selected', 'true');
  // 没有本地数据时给可读空态（不再被上次的共享视图带偏）
  await expect(page.getByTestId('empty-state')).toBeVisible();
});

test('看板两类进度一步直达目标，种公三工具同级可达', async ({ page }) => {
  await importSample(page);

  // 种公进度卡 → 精灵库 · 合格种公
  await page.getByTestId('progress-card-action-stud').click();
  await expect(page.getByTestId('inventory-view-stud')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('火花')).toBeVisible();

  // 母本进度卡 → 收集 · 母本 · 未收集
  await page.getByRole('button', { name: '看板' }).click();
  await page.getByTestId('progress-card-action-mother').click();
  await expect(page.getByTestId('mother-status-missing')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mother-search')).toBeVisible();

  // 种公三种工具并列
  await page.getByTestId('collection-kind-studs').click();
  await expect(page.getByTestId('stud-tool-coverage')).toBeVisible();
  await expect(page.getByTestId('stud-tool-breed')).toBeVisible();
  await expect(page.getByTestId('stud-tool-eggs')).toBeVisible();
});

test('改本页筛选不改收集进度（看板数字保持）', async ({ page }) => {
  await importSample(page);
  const before = await progressOf(page, 'progress-card-action-mother');

  await page.getByRole('button', { name: '我的精灵' }).click();
  await page.getByTestId('filter-tile-body').click();
  await page.getByTestId('filter-opt-body-body:大块头').click();

  await page.getByRole('button', { name: '看板' }).click();
  const after = await progressOf(page, 'progress-card-action-mother');
  expect(after.numerator).toBe(before.numerator);
  expect(after.denominator).toBe(before.denominator);
});
