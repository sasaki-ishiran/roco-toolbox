import { expect, test } from '@playwright/test';

test('配窝：只给汇总 + 两个入口（怎么配在覆盖度、要去弄什么在换什么）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-breed-pair.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: '配窝' })).toBeVisible();
  await expect(page.getByTestId('nest-summary-line')).toContainText('还差');
  // 说法与覆盖度对齐（2026-10-07）：看板这边也改用「迭代」（覆盖度里叫「可迭代」）
  await expect(page.getByTestId('nest-summary-line')).toContainText('能自己迭代');
  await expect(page.getByTestId('nest-open-coverage')).toHaveText(/去看怎么迭代/);

  // 入口①：覆盖度页（那里每个目标都带「怎么迭代」的方案）
  await page.getByTestId('nest-open-coverage').click();
  await expect(page.getByTestId('coverage-group-row').first()).toBeVisible();

  // 入口②：换什么页（去弄哪颗蛋）
  await page.getByRole('button', { name: '看板' }).click();
  await page.getByTestId('nest-open-swap').click();
  await expect(page.getByRole('heading', { name: '换什么' })).toBeVisible();
});

test('「去看怎么迭代」跳过去：自动展开第一个可迭代的蛋组并滚到它，直接看到那对怎么放', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-breed-pair.json');
  await expect(page.getByTestId('nest-open-coverage')).toBeVisible();

  await page.getByTestId('nest-open-coverage').click();

  // 落在覆盖度页：可迭代那一组已展开，并且滚进了视野 —— 直接看到「学院小窝 / 配对」两只
  const academy = page.getByTestId('coverage-cell-academy');
  await expect(academy).toBeVisible();
  await expect(academy).toBeInViewport();
  await expect(academy).toContainText('学院小窝');
  await expect(academy).toContainText('火花');
});
