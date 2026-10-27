﻿﻿﻿﻿﻿﻿import { expect, test } from '@playwright/test';
import { enterGroup, loginAs, mockMotherGroups } from './helpers/motherGroupsMock';

const openGroups = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: '小组', exact: true }).click();
  await expect(page.getByTestId('collection-groups')).toBeVisible();
};

test('没有本地账号也能进入个人求蛋；未登录可去登录，待加入码保留', async ({ page }) => {
  await page.goto('/');
  await openGroups(page);

  await expect(page.getByTestId('personal-eggs')).toBeVisible();
  await page.getByTestId('group-pending-invite').fill('abcd2345');
  const pending = await page.evaluate(() =>
    window.localStorage.getItem('roco.collectionGroups.pendingInvite'),
  );
  expect(pending).toBe('ABCD2345');

  await page.getByTestId('group-login').click();
  // 新结构：去登录直达「我的 · 工具箱身份」（游戏数据与身份分开）
  await expect(page.getByTestId('profile-identity-intro')).toBeVisible();
  await expect(page.getByTestId('account-recover-input')).toBeVisible();
});

test('已登录且本机无数据：能浏览小组资源，不能发布自己的摘要', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page);
  await page.goto('/');
  await openGroups(page);

  await expect(page.getByTestId('group-card')).toContainText('周末互换');
  await expect(page.getByTestId('group-card')).toContainText('3 人');
  await expect(page.getByTestId('group-type-label')).toContainText('收集小组');
  await expect(page.getByTestId('group-target-summary')).toContainText('母 · 大块头 · +100');
  await expect(page.getByTestId('mother-resource-editor')).toHaveCount(0);
  await page.getByTestId('group-edit-resources').click();
  await expect(page.getByTestId('mother-resource-editor')).toBeVisible();
  await expect(page.getByTestId('mother-no-local-data')).toBeVisible();
  await expect(page.getByTestId('mother-missing-accounts')).toContainText('uid:1001');
  await expect(page.getByTestId('mother-publish')).toBeDisabled();

  // 有人还没发布：组内没人有的行只能标「数据不全」，不能判死
  const cat = page.getByTestId('mother-resource-row').filter({ hasText: '喵喵' });
  await expect(cat).toHaveAttribute('data-incomplete', 'true');
  await expect(page.getByTestId('mother-incomplete-section')).toContainText('数据不全');
});

test('小组资源：卡片只显示头像 / 名称 / 性格；可切换视图与按血脉搜索', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page);
  await page.goto('/');
  await openGroups(page);

  // 搜索 / 筛选 / 发需求同一行：搜索框仍保留可输入宽度
  const searchBox = await page.getByTestId('mother-search').boundingBox();
  expect(searchBox?.width ?? 0).toBeGreaterThan(170);
  const water = page.getByTestId('mother-resource-row').filter({ hasText: '水蓝蓝' });
  // 2026-10-27：卡里不再写「谁有」，只留头像 + 名称 + 性格
  await expect(water.locator('[data-testid="pet-avatar"], [data-testid="pet-avatar-fallback"]')).toBeVisible();
  await expect(water.getByTestId('mother-resource-holders')).toHaveCount(0);

  await page.getByTestId('mother-search').fill('水蓝');
  await expect(page.getByTestId('mother-resource-row')).toHaveCount(1);
  await expect(page.getByTestId('mother-resource-row')).toContainText('水蓝蓝');

  // 需求中心：mock 下没有需求时给出空态
  await page.getByTestId('mother-search').fill('');
  await page.getByTestId('mother-view-mine').click();
  await expect(page.getByTestId('mother-intake-empty')).toContainText('当前没有组员发布需求');
});

test('共同寻找：确认后可以认领与释放，状态来自服务器', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page);
  await page.goto('/');
  await openGroups(page);

  await page.getByTestId('mother-view-seeking').click();
  const claim = page.getByTestId('mother-task-claim').first();
  await expect(claim).toBeVisible();
  await claim.click();
  await expect(page.getByTestId('mother-task-release').first()).toBeVisible();
  await expect(page.getByText('我认领了').first()).toBeVisible();

  await page.getByTestId('mother-task-release').first().click();
  await expect(page.getByTestId('mother-task-claim').first()).toBeVisible();
});

test('组列表接口失败时不说「还没有加入任何小组」，并给出重试', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page);
  // 冷启动（关后台再回来）网络没恢复：列表与详情都失败
  await page.route('**/api/collection-groups**', (route) => route.abort('failed'));

  await page.goto('/');
  await openGroups(page);

  await expect(page.getByTestId('group-error')).toContainText('网络连接失败');
  await expect(page.getByTestId('group-error-retry')).toBeVisible();
  await expect(page.getByText('还没有加入任何小组')).toHaveCount(0);
});

test('375 / 390 宽度下小组页不横向溢出', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page);
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await openGroups(page);
    await page.getByTestId('mother-view-mine').click();
    const overflow = await page.evaluate(() => {
      const doc = document.scrollingElement as HTMLElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow, `${width}px 横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
  }
});
