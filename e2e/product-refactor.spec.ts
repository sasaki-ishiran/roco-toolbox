﻿﻿﻿﻿import { expect, test, type Page } from '@playwright/test';
import { progressOf } from './progress';

const importSample = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  // 导入后停在导入页（2026-10-25 起不再自动跳看板），等落盘后再切
  await expect(page.getByTestId('import-outcome')).toContainText('已保存到本机');
  await page.getByRole('button', { name: '看板', exact: true }).click();
};

test('旧共享记忆不影响看板求蛋：没有小组时落到新建 / 加入', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('roco.lastTab', 'swap');
    window.localStorage.setItem('roco.swapView', 'sharing');
  });
  await page.goto('/');

  // 启动落回小组页；个人求蛋已删除，未登录只给登录提示
  await expect(page.getByTestId('group-login-hint')).toBeVisible();
  await expect(page.getByTestId('personal-eggs')).toHaveCount(0);

  await page.getByRole('button', { name: '看板', exact: true }).click();
  await page.getByTestId('recommend-quantity-all').click();

  // 求蛋直达小组页：没有组时给新建 / 加入，不会被上次的共享视图带偏
  await expect(page.getByTestId('collection-groups')).toBeVisible();
  await expect(page.getByTestId('group-login-hint')).toBeVisible();
});

test('看板两类进度一步直达目标，种公求蛋已迁到小组', async ({ page }) => {
  await importSample(page);

  // 种公进度卡 → 收集 · 种公（种公阵列）；「合格种公」页已取消
  await page.getByTestId('progress-card-action-stud').click();
  await expect(page.getByTestId('collection-kind-studs')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stud-matrix')).toBeVisible();

  // 母本进度卡 → 收集 · 母本 · 未收集
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await page.getByTestId('progress-card-action-mother').click();
  await expect(page.getByTestId('mother-chain-filter-uncollected')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mother-search')).toBeVisible();

  // 收集 · 种公只剩种公阵列 + 覆盖度；求蛋入口在小组 · 个人求种公
  await page.getByTestId('collection-kind-studs').click();
  await expect(page.getByTestId('stud-matrix')).toBeVisible();
  await page.getByTestId('stud-matrix-filter-toggle').click();
  await expect(page.getByTestId('coverage-groups-toggle')).toBeVisible();
  await expect(page.getByTestId('stud-tool-eggs')).toHaveCount(0);
  await page.getByRole('button', { name: '小组', exact: true }).click();
  // 个人求蛋已删除：未登录取小组页只给登录 / 新建加入，不再有求种公清单
  await expect(page.getByTestId('collection-groups')).toBeVisible();
  await expect(page.getByTestId('personal-eggs')).toHaveCount(0);
});

test('改本页筛选不改收集进度（看板数字保持）', async ({ page }) => {
  await importSample(page);
  const before = await progressOf(page, 'progress-card-action-mother');

  await page.getByRole('button', { name: '收集', exact: true }).click();
  await page.getByTestId('collection-kind-inventory').click();
  await page.getByTestId('filter-tile-body').click();
  await page.getByTestId('filter-opt-body-body:大块头').click();

  await page.getByRole('button', { name: '看板', exact: true }).click();
  const after = await progressOf(page, 'progress-card-action-mother');
  expect(after.numerator).toBe(before.numerator);
  expect(after.denominator).toBe(before.denominator);
});
