import { expect, test } from '@playwright/test';

const openSwap = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '换什么' }).click();
};

test('换什么页：清单按「一只顶两组」优先排列，并给出建议物种', async ({ page }) => {
  await openSwap(page);

  await expect(page.getByRole('heading', { name: '换什么' })).toBeVisible();
  await expect(page.getByTestId('swap-total')).toHaveText(/共 \d+ 条 · 其中 \d+ 条一只顶两组/);

  const items = page.getByTestId('swap-wish-item');
  await expect(items.first()).toBeVisible();

  // 首条是「补 2 组」的：排序把能一次补两个组的放最前
  await expect(items.first()).toContainText('补 2 组');
  // 列表项是「性格 + 精灵名」（默认追满分，档位行带「满分」前缀），不再用「的蛋」
  await expect(items.first()).toContainText('满分大婉 · ');
  await expect(items.first()).not.toContainText('的蛋');
  await expect(items.first()).toContainText(' · ');
  // 「可选 N 种」这类没有行动含义的信息不再展示
  await expect(page.getByText(/可选 \d+ 种/)).toHaveCount(0);
});

test('换什么页：切到追双牌后，档位行不再带「满分」前缀', async ({ page }) => {
  await openSwap(page);

  // 回看板切换模式，再回「换什么」——全局模式对所有页面生效
  await page.getByRole('button', { name: '看板' }).click();
  await page.getByTestId('target-mode-medal').click();
  await page.getByRole('button', { name: '换什么' }).click();

  await expect(page.getByTestId('swap-mode')).toContainText('追双牌');
  const first = page.getByTestId('swap-wish-item').first();
  await expect(first).toContainText('大婉 · ');
  await expect(first).not.toContainText('满分大婉');
});

test('换什么页：多选复制与窝类型切换', async ({ page }) => {
  await openSwap(page);

  // 默认绿窝；切到普通窝
  await expect(page.getByTestId('swap-nest-green')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('swap-nest-plain').click();
  await expect(page.getByTestId('swap-nest-plain')).toHaveAttribute('aria-pressed', 'true');

  // 不选任何一条时按钮是「复制全部」，选中后变「复制选中 N」
  const copyButton = page.getByTestId('swap-wish-copy');
  await expect(copyButton).toContainText('复制全部');

  await page.getByTestId('swap-wish-select').nth(0).check();
  await page.getByTestId('swap-wish-select').nth(1).check();
  await expect(copyButton).toContainText('复制选中 2');

  // 全选后再点一次取消
  await page.getByTestId('swap-wish-select-all').click();
  await expect(page.getByTestId('swap-wish-select-all')).toHaveText('取消选择');
  await page.getByTestId('swap-wish-select-all').click();
  await expect(page.getByTestId('swap-wish-select-all')).toHaveText('全选');
  await expect(copyButton).toContainText('复制全部');
});

test('换什么页：筛选与搜索只过滤展示，不改清单，清空后不消失', async ({ page }) => {
  await openSwap(page);

  const heading = page.getByTestId('swap-wish-list').getByRole('heading');
  const before = await heading.textContent();

  // 筛选在清单卡外面：性格走手风琴，选中后清单里每条都带这个性格
  await page.getByTestId('filter-tile-swapNature').click();
  const option = page.locator('[data-testid^="filter-opt-swapNature-"]').first();
  const nature = ((await option.textContent()) ?? '').replace(/\s*\(\d+\)$/, '').trim();
  await option.click();
  const items = page.getByTestId('swap-wish-item');
  expect(await items.count()).toBeGreaterThan(0);
  for (const item of await items.all()) {
    await expect(item).toContainText(nature);
  }

  // 清除本组后标题计数恢复
  await page.getByTestId('filter-clear-swapNature').click();
  await expect(heading).toHaveText(before ?? '');

  // 搜索不存在的关键词 → 空状态；但搜索框和筛选还在（不会跟着一起消失）
  await page.getByTestId('swap-search').fill('绝无此物zzz');
  await expect(page.getByTestId('swap-wish-empty')).toBeVisible();
  await expect(page.getByTestId('swap-search')).toBeVisible();
  await expect(page.getByTestId('swap-filters')).toBeVisible();
});

test('换什么页：没有数据时给可读空状态', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '换什么' }).click();

  await expect(page.getByText('还没有数据')).toBeVisible();
  await expect(page.getByText('NaN')).toHaveCount(0);
});

test('换什么页：署名保留（CC BY-SA 4.0）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '换什么' }).click();

  await expect(page.getByText('CC BY-SA 4.0')).toBeVisible();
});
