import { expect, test } from '@playwright/test';

const importSample = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '覆盖度' }).click();
};

test('覆盖度页：14 个蛋组行 + 四态图例 + 主数字是「已通 N / 14 组」', async ({ page }) => {
  await importSample(page);

  await expect(page.getByRole('heading', { name: '覆盖度' })).toBeVisible();
  await expect(page.getByTestId('coverage-total')).toHaveText(/已通 \d+ \/ 14 组/);

  // 14 个蛋组行
  await expect(page.getByTestId('coverage-group-row')).toHaveCount(14);

  // 四态图例
  const legend = page.getByTestId('coverage-legend');
  await expect(legend.getByText('已通', { exact: true })).toBeVisible();
  await expect(legend.getByText('可迭代', { exact: true })).toBeVisible();
  await expect(legend.getByText('未收集', { exact: true })).toBeVisible();

  // 默认不展开；点击蛋组行后展开该组的性格明细（默认每组推荐前 3 个性格）
  await expect(page.getByTestId('coverage-nature-cell')).toHaveCount(0);
  await page.getByTestId('coverage-group-toggle').first().click();
  await expect(page.getByTestId('coverage-nature-cell')).toHaveCount(3);

  // 明细要有状态词；精灵行是「名字 ♀/♂（账号 · 位置）」，不再有解释机制的前缀
  await expect(page.getByTestId('coverage-nature-cell').first()).toContainText(
    /已通|可迭代|有母本|未收集/,
  );
  await expect(page.getByText('学院小窝放：')).toHaveCount(0);
  await expect(page.getByText('普通小窝配：')).toHaveCount(0);
  await expect(page.getByText('该组有')).toHaveCount(0);

  // 再点一次收起
  await page.getByTestId('coverage-group-toggle').first().click();
  await expect(page.getByTestId('coverage-nature-cell')).toHaveCount(0);
});

test('覆盖度页：第一次进来给极简说明，点「知道了」后不再出现', async ({ page }) => {
  await importSample(page);

  // 新用户不清楚这页有什么（一进来就是 14 行 + 一堆筛选）→ 页内给 3 条极简说明
  const intro = page.getByTestId('coverage-intro');
  await expect(intro).toBeVisible();
  await expect(intro).toContainText('怎么看这页');
  await expect(intro).toContainText('可迭代');
  await expect(intro.locator('li')).toHaveCount(3);

  await page.getByTestId('coverage-intro-dismiss').click();
  await expect(intro).toHaveCount(0);

  // 切走再回来：不再出现（看过的记住）
  await page.getByRole('button', { name: '看板' }).click();
  await page.getByRole('button', { name: '覆盖度' }).click();
  await expect(page.getByTestId('coverage-intro')).toHaveCount(0);
});

test('覆盖度页：蛋组行按状态色档从差到好排（未收集多的在前），展开态切页签不丢', async ({ page }) => {
  await importSample(page);

  // 2026-10-07 用户要求：蛋组行按行首圆点的状态色档排（灰 → 橙 → 蓝 → 绿），未收集多的先展示。
  // 不断言具体哪一组在第一个（取决于账号数据），只断言整列色档是从差到好、单调不回头。
  const tones = await page
    .getByTestId('coverage-group-row')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-tone')));
  const rank: Record<string, number> = { gray: 0, amber: 1, sky: 2, emerald: 3 };
  const ranks = tones.map((tone) => rank[tone ?? ''] ?? -1);
  expect(ranks).toHaveLength(14);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

  // 展开第一行 → 切到看板 → 切回来，仍然是展开状态
  await page.getByTestId('coverage-group-toggle').first().click();
  await expect(page.getByTestId('coverage-nature-cell')).toHaveCount(3);
  await page.getByRole('button', { name: '看板' }).click();
  await expect(page.getByRole('heading', { name: '洛克工具箱' })).toBeVisible();
  await page.getByRole('button', { name: '覆盖度' }).click();
  await expect(page.getByTestId('coverage-nature-cell')).toHaveCount(3);
});

test('覆盖度页：分母只随蛋组变化（14 → 13），档位不再改分母，可恢复默认', async ({ page }) => {
  await importSample(page);
  await expect(page.getByTestId('coverage-total')).toHaveText(/\/ 14 组/);

  // 蛋组筛选默认收起，展开后取消一个 → 少一行、分母变 13
  await page.getByTestId('coverage-groups-toggle').click();
  await page.getByTestId('coverage-group-2').click();
  await expect(page.getByTestId('coverage-group-row')).toHaveCount(13);
  await expect(page.getByTestId('coverage-total')).toHaveText(/\/ 13 组/);

  // 档位是**全局口径**（2026-10-06 起入口只在看板的「当前模式」）：去看板加一个档位
  await page.getByRole('button', { name: '看板' }).click();
  await page.getByTestId('target-grade-小婉').click();
  await page.getByRole('button', { name: '覆盖度' }).click();
  // 覆盖度页只显示当前档位（只读、不再自己控制）
  await expect(page.getByTestId('coverage-grade-readonly')).toContainText('满分小婉');
  await expect(page.getByTestId('coverage-total')).toHaveText(/\/ 13 组/);
  // 展开的那一行槽位翻倍（3 → 6）
  await page.getByTestId('coverage-group-toggle').first().click();
  await expect(page.getByTestId('coverage-nature-cell')).toHaveCount(6);

  // 恢复默认
  await page.getByTestId('coverage-filter-reset').click();
  await expect(page.getByTestId('coverage-total')).toHaveText(/\/ 14 组/);
  await expect(page.getByTestId('coverage-group-row')).toHaveCount(14);
});

test('覆盖度页：署名保留（CC BY-SA 4.0）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '覆盖度' }).click();

  await expect(page.getByText('CC BY-SA 4.0')).toBeVisible();
  await expect(page.getByRole('link', { name: '洛克王国：世界 Wiki' })).toBeVisible();
});

test('覆盖度页：空数据给出可读空状态且不出现 NaN', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '覆盖度' }).click();

  await expect(page.getByText('还没有数据')).toBeVisible();
  await expect(page.getByText('NaN')).toHaveCount(0);
});

test('覆盖度页：自选性格模式 + 性别比例特殊物种区块', async ({ page }) => {
  await importSample(page);

  // 推荐模式默认选中；切到自选 → 全局性格面板出现，未勾选时矩阵为空并给提示
  await expect(page.getByTestId('nature-mode-recommended')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('nature-mode-custom').click();
  await expect(page.getByTestId('custom-natures')).toBeVisible();
  await expect(page.getByTestId('custom-natures-empty')).toBeVisible();
  await expect(page.getByTestId('coverage-group-row')).toHaveCount(0);

  // 勾一个性格应用到全部蛋组：出现蛋组行，且展开后看不到组内性格开关
  await page.getByTestId('custom-nature-固执').click();
  await expect(page.getByTestId('custom-natures-empty')).toHaveCount(0);
  await page.getByTestId('coverage-group-toggle').first().click();
  await expect(page.getByTestId('coverage-group-nature-2-固执')).toHaveCount(0);

  // 展开行里出现该性格的格子
  await expect(
    page.getByTestId('coverage-nature-cell').filter({ hasText: '固执' }).first(),
  ).toBeVisible();

  // 全选/全部取消：勾了 1 个时按钮是「全选」；全选后变「全部取消」
  await expect(page.getByTestId('custom-nature-select-all')).toHaveText('全选');
  await page.getByTestId('custom-nature-select-all').click();
  await expect(page.getByTestId('custom-nature-固执')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('custom-nature-select-all')).toHaveText('全部取消');

  // 性别比例特殊精灵（2026-10-05 改名）：手风琴 声音×体型×性格 + 名称搜索 + 卡片
  const section = page.getByTestId('gender-ratio-section');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: '性别比例特殊精灵' })).toBeVisible();
  // 默认：声音/体型 各已选 2（±100 × 大块头+小不点），瓦片显示数字徽章；档位默认大婉
  await expect(section.getByTestId('filter-tile-voice')).toContainText('2');
  await expect(section.getByTestId('filter-tile-body')).toContainText('2');
  await expect(section.getByTestId('gr-grade-大婉')).toHaveAttribute('aria-pressed', 'true');
  await section.getByTestId('gr-grade-小婉').click();
  await expect(section.getByTestId('gr-grade-小婉')).toHaveAttribute('aria-pressed', 'true');
  // 展开体型：大块头/小不点 默认勾选
  await section.getByTestId('filter-tile-body').click();
  await expect(section.getByTestId('filter-opt-body-大块头')).toHaveAttribute('aria-pressed', 'true');
  // 性格瓦片：只列出背包里已有的性格（如固执）
  await section.getByTestId('filter-tile-nature').click();
  await expect(section.getByTestId('filter-panel-nature')).toContainText('固执');
  // 有符合条件的精灵卡片
  await expect(section.locator('article').first()).toBeVisible();

  // 名称搜索：搜不存在的名字 → 空；清空恢复
  await section.getByTestId('gr-name-search').fill('不存在的精灵');
  await expect(section.getByTestId('gender-ratio-empty')).toBeVisible();
  await section.getByTestId('gr-name-search').fill('');
  await expect(section.locator('article').first()).toBeVisible();
});
