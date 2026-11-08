import { expect, test } from '@playwright/test';
import { enterGroup, loginAs, mockMotherGroups } from './helpers/motherGroupsMock';

/**
 * 收集计划主路径（2026-11-08）：我的收集 / 组内广场两页。
 *
 * 计划进度由 mock 按 shared/collectionPlans 的口径推导，需求行决定卡面五步：
 * 火花 3003 已上窝（待我确认）、水蓝蓝 3002 已认领、喵喵 3001 待接单、焰火 3032 还没发需求。
 */
const plans = [
  { id: 'pA1', memberAccountId: 'A', eggGameId: 3003, status: 'active' as const },
  { id: 'pA2', memberAccountId: 'A', eggGameId: 3002, status: 'active' as const },
  { id: 'pA3', memberAccountId: 'A', eggGameId: 3001, status: 'active' as const },
  { id: 'pA4', memberAccountId: 'A', eggGameId: 3032, status: 'active' as const },
  { id: 'pA5', memberAccountId: 'A', eggGameId: 3006, status: 'backlog' as const },
  { id: 'pB1', memberAccountId: 'B', eggGameId: 3001, status: 'active' as const },
];

const demands = [
  {
    eggGameId: 3003,
    nature: '固执',
    demanderAccountId: 'A',
    claimerAccountId: 'B',
    status: 'claimed',
    placedAt: 1_760_000_100_000,
  },
  { eggGameId: 3002, nature: '保守', demanderAccountId: 'A', claimerAccountId: 'B', status: 'claimed' },
  { eggGameId: 3001, nature: '勇敢', demanderAccountId: 'A', status: 'open' },
  { eggGameId: 3001, nature: '固执', demanderAccountId: 'B', status: 'open' },
];

const openGroups = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: '小组', exact: true }).click();
  await expect(page.getByTestId('collection-groups')).toBeVisible();
};

const setup = async (page: import('@playwright/test').Page) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page, { plans, demands });
  await page.goto('/');
  await openGroups(page);
};

test('我的收集：按待我确认优先排序，点卡进二级页，全部缺口是次要入口', async ({ page }) => {
  await setup(page);

  await expect(page.getByTestId('plan-hub-tab-mine')).toHaveAttribute('aria-pressed', 'true');
  const cards = page.getByTestId('plan-card');
  await expect(cards).toHaveCount(4);
  // 待我确认（火花 3003）排第一
  await expect(cards.first()).toContainText('火花');
  await expect(cards.first().getByTestId('plan-card-progress')).toContainText('已上窝 · 等你确认');
  // 卡面用 5 段细进度条代替五步点阵，与详情页五步一一对应
  await expect(cards.first().getByTestId('plan-card-bar').locator('span')).toHaveCount(5);
  // 性格竖排：本次需求对应的「固执」高亮
  await expect(
    cards.first().getByTestId('plan-card-natures').locator('[data-active="true"]'),
  ).toContainText('固执');

  // 想收默认折叠；批量导入降级进「添加想收」弹层，列表里不再有常驻按钮
  await expect(page.getByTestId('my-collection-bulk-import')).toHaveCount(0);
  await page.getByTestId('my-collection-wish').getByRole('button').first().click();
  await expect(page.getByTestId('my-collection-wish')).toContainText('火神');

  // 「添加想收」开的是选蛋弹层（不跳页面），快捷按钮按口径算全部缺口
  await page.getByTestId('my-collection-add').click();
  await expect(page.getByTestId('demand-publish')).toContainText('添加想收');
  await expect(page.getByTestId('wish-only-gaps')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('wish-fill-gaps')).toContainText('按你的口径算的全部缺口');
  await page.getByTestId('demand-publish-close').click();
  await expect(page.getByTestId('demand-publish')).toHaveCount(0);

  // 旧需求中心只留一行入口：整屏进入，不再和两列卡同屏
  await expect(page.getByTestId('mother-resources')).toHaveCount(0);
  await page.getByTestId('my-collection-all-gaps').click();
  await expect(page.getByTestId('plan-hub-legacy')).toBeVisible();
  await expect(page.getByTestId('mother-resources')).toBeVisible();
  await expect(page.getByTestId('my-collection')).toHaveCount(0);
  await expect(page.getByTestId('mother-view-mine')).toHaveCount(0);
  await page.getByTestId('plan-hub-legacy-back').click();
  await expect(page.getByTestId('my-collection')).toBeVisible();

  // 卡片 → 二级页（sheet）
  await cards.first().click();
  await expect(page.getByTestId('plan-detail-sheet')).toBeVisible();
  await expect(page.getByTestId('plan-detail-sheet')).toContainText('本次需求');
  // 详情页保留完整五步
  await expect(page.getByTestId('plan-detail-steps')).toContainText('五步进度');
  await page.getByTestId('plan-detail-close').click();
  await expect(page.getByTestId('plan-detail-sheet')).toHaveCount(0);
});

test('组内广场：三个分区 + 一键接单 + 卡面撤回', async ({ page }) => {
  await setup(page);
  await page.getByTestId('plan-hub-tab-square').click();

  const canTake = page.getByTestId('group-square-can-take');
  await expect(canTake).toContainText('你能接的');
  await expect(canTake).toContainText('喵喵');
  // 卡面第二行给出理由：我号里有这颗蛋
  await expect(canTake.getByTestId('plan-card-progress').first()).toContainText('我号里有这颗蛋');

  // 一键接单，不弹确认
  const target = canTake.getByTestId('plan-card').first();
  await expect(target.getByTestId('plan-card-action')).toContainText('接单');
  await target.getByTestId('plan-card-action').click();

  // 接完进入「需要你处理」，卡面变成「已接单 · 撤回」
  const needsYou = page.getByTestId('group-square-needs-you');
  await expect(needsYou).toContainText('需要你处理');
  await expect(needsYou.getByTestId('plan-card-action').first()).toContainText('已接单 · 撤回');

  // 点撤回回到「你能接的」
  await needsYou.getByTestId('plan-card-action').first().click();
  await expect(page.getByTestId('group-square-can-take')).toContainText('喵喵');

  // 想收（还没发需求）单独一区：自己的给「开始」，别人的才给「我可提供」
  const wish = page.getByTestId('group-square-wish');
  await expect(wish).toContainText('组员在收');
  await expect(wish).toContainText('火神');
  await expect(wish.getByTestId('plan-card-progress').first()).toContainText('想收 · 还没发需求');
  await expect(wish.getByTestId('plan-card-action').first()).toContainText('开始');
  await expect(canTake).not.toContainText('火神');
});

test('添加想收：弹层多选落想收，条件行不空白，已有计划幂等跳过', async ({ page }) => {
  await setup(page);

  await page.getByTestId('my-collection-add').click();
  await expect(page.getByTestId('demand-publish')).toContainText('添加想收');
  // 只看缺口默认开；关掉能看全图鉴（含我已有的蛋）
  await expect(page.getByTestId('wish-only-gaps')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('wish-only-gaps').click();
  // 关掉筛选后全图鉴可搜，包括我已经发过资源的蛋（火花）
  await expect(page.getByTestId('wish-egg-3003')).toBeVisible();

  // 挑三颗当前没有计划的蛋（草头鸭 / 恶魔叮 / 恶魔狼）
  const pick = async (name: string, eggGameId: number) => {
    await page.getByTestId('wish-search').fill(name);
    await page.getByTestId(`wish-egg-${eggGameId}`).click();
  };
  await pick('草头鸭', 3008);
  await pick('恶魔叮', 3010);
  await pick('恶魔狼', 3011);
  await expect(page.getByTestId('demand-publish-confirm')).toContainText('添加 3 条想收');
  await page.getByTestId('demand-publish-confirm').click();

  await expect(page.getByTestId('plan-hub-notice')).toContainText('已添加 3 条想收');
  // 想收折叠区：种子里的火神 + 刚加的 3 条
  await page.getByTestId('my-collection-wish').getByRole('button').first().click();
  const wishCards = page.getByTestId('my-collection-wish').getByTestId('plan-card');
  await expect(wishCards).toHaveCount(4);
  // 想收没有需求时条件行用口径默认值，不空白
  await expect(
    page.getByTestId('my-collection-wish').getByTestId('plan-card-progress').filter({
      hasText: '♀ · 大块头 · +100',
    }),
  ).toHaveCount(4);

  // 幂等：再选一颗已有计划的蛋，只跳过不重复建行
  await page.getByTestId('my-collection-add').click();
  await page.getByTestId('wish-only-gaps').click();
  await page.getByTestId('wish-search').fill('喵喵');
  await page.getByTestId('wish-egg-3001').click();
  await expect(page.getByTestId('demand-publish-confirm')).toContainText('添加 1 条想收');
  await page.getByTestId('demand-publish-confirm').click();
  await expect(page.getByTestId('plan-hub-notice')).toContainText('已添加 0 条想收，跳过 1 条已有计划');
  await expect(wishCards).toHaveCount(4);
});

test('截图：计划详情各状态 375 与 390', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page, {
    plans,
    demands,
    offers: [{ planId: 'pA1', offerAccountId: 'B', note: '这窝今晚出壳，明早给你' }],
  });

  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await openGroups(page);

    // 1) 我的进行中：五步走到「待我确认」，能看到认领人阿乙 + 他的备注
    await page.getByTestId('plan-card').filter({ hasText: '火花' }).first().click();
    await expect(page.getByTestId('plan-detail-sheet')).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/计划详情-我的进行中-${width}.png`,
    });
    await page.getByTestId('plan-detail-close').click();

    // 2) 想收态
    await page.getByTestId('my-collection-wish').getByRole('button').first().click();
    await page.getByTestId('plan-card').filter({ hasText: '火神' }).click();
    await expect(page.getByTestId('plan-detail-sheet')).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/计划详情-想收-${width}.png`,
    });
    await page.getByTestId('plan-detail-close').click();

    // 3) 组内广场看别人的计划
    await page.getByTestId('plan-hub-tab-square').click();
    await page
      .getByTestId('group-square-can-take')
      .getByTestId('plan-card')
      .first()
      .click();
    await expect(page.getByTestId('plan-detail-sheet')).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/计划详情-组内广场他人-${width}.png`,
    });

    // 4) 「我能提供」备注输入态
    await page.getByTestId('plan-detail-note').fill('我有一窝，今晚能上窝');
    await page.screenshot({
      path: `docs/screenshots/计划详情-我能提供输入态-${width}.png`,
    });
    await page.getByTestId('plan-detail-close').click();
  }
});

test('截图：我的收集 / 组内广场 / 红点入口 375 与 390', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page, {
    plans: [
      ...plans,
      // 阿乙的两条，用来在截图中同时展示「需要你处理」和「其他人在收」
      { id: 'pB2', memberAccountId: 'B', eggGameId: 3002, status: 'active' as const },
      { id: 'pB3', memberAccountId: 'B', eggGameId: 3006, status: 'active' as const },
      // 阿乙的想收：截图里展示「组员在收」+ 别人的「我可提供」
      { id: 'pB4', memberAccountId: 'B', eggGameId: 3008, status: 'backlog' as const },
    ],
    demands: [
      ...demands,
      { eggGameId: 3002, nature: '保守', demanderAccountId: 'B', claimerAccountId: 'A', status: 'claimed' },
      { eggGameId: 3006, nature: '固执', demanderAccountId: 'B', claimerAccountId: 'B', status: 'claimed' },
    ],
    offers: [{ planId: 'pA1', offerAccountId: 'B', note: '这窝今晚出壳，明早给你' }],
  });
  // 先把「水蓝蓝」直接完成（两个宽度下都能看到「已完成」折叠区）
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/');
  await openGroups(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('plan-card').filter({ hasText: '水蓝蓝' }).first().click();
  await page.getByTestId('plan-detail-more').click();
  await page.getByTestId('plan-detail-complete').click();
  await page.getByTestId('plan-detail-close').click();
  await expect(page.getByTestId('my-collection-done')).toBeVisible();

  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await openGroups(page);
    // 入口态：小组页签上的红点数字（待我确认 1 + 新提供 1）
    await expect(page.getByTestId('tab-badge-groups')).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/收集计划-入口红点-${width}.png`,
    });
    await page.screenshot({
      path: `docs/screenshots/收集计划-我的收集-${width}.png`,
      fullPage: true,
    });
    // 想收卡条件行：没有需求时用「口径默认值 + 目标性格」，不留空白
    await page.getByTestId('my-collection-wish').getByRole('button').first().click();
    await expect(
      page.getByTestId('my-collection-wish').getByTestId('plan-card-progress').first(),
    ).toContainText('♀ · 大块头 · +100');
    await page.screenshot({
      path: `docs/screenshots/收集计划-想收卡条件行-${width}.png`,
      fullPage: true,
    });
    // 添加想收：选蛋弹层 + 降级后的「按你的口径算的全部缺口」快捷按钮
    await page.getByTestId('my-collection-add').click();
    await expect(page.getByTestId('demand-publish')).toContainText('添加想收');
    await page.getByTestId('wish-only-gaps').click();
    await expect(page.getByTestId('wish-grid')).toBeVisible();
    await page.getByTestId('wish-egg-3008').click();
    await page.getByTestId('wish-egg-3010').click();
    await page.getByTestId('wish-egg-3011').click();
    await expect(page.getByTestId('demand-publish-confirm')).toContainText('添加 3 条想收');
    await page.screenshot({
      path: `docs/screenshots/收集计划-添加想收弹层-${width}.png`,
      fullPage: true,
    });
    await page.getByTestId('demand-publish-close').click();
    // 已完成回看：默认收起，展开后能看到结单的计划
    await page.getByTestId('my-collection-done').getByRole('button').first().click();
    await expect(page.getByTestId('my-collection-done')).toContainText('水蓝蓝');
    await page.screenshot({
      path: `docs/screenshots/收集计划-我的收集-已完成-${width}.png`,
      fullPage: true,
    });
    await page.getByTestId('plan-hub-tab-square').click();
    await page.screenshot({
      path: `docs/screenshots/收集计划-组内广场-${width}.png`,
      fullPage: true,
    });
    // 「组员在收」：自己的想收给「开始」，别人的想收给「我可提供」
    const wishSection = page.getByTestId('group-square-wish');
    await expect(wishSection).toContainText('组员在收');
    await expect(wishSection).toContainText('草头鸭');
    await expect(
      wishSection.getByTestId('plan-card-action').filter({ hasText: '我可提供' }),
    ).toHaveCount(1);
    await page.screenshot({
      path: `docs/screenshots/收集计划-组内广场-组员在收-${width}.png`,
      fullPage: true,
    });
  }
});
