import { expect, test } from '@playwright/test';

test('我的精灵页：卡片展示与标签叠加筛选', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  await page.getByRole('button', { name: '收集', exact: true }).click();
  await page.getByTestId('collection-kind-inventory').click();

  // 卡片展示：名称、盒子位置（2026-10-05 卡内不再显示账号与图鉴编号，账号由账号筛选条承担）
  await expect(page.getByText('机械方方')).toBeVisible();
  await expect(page.getByText(/盒子01/).first()).toBeVisible();
  await expect(page.getByTestId('pet-card-note')).toHaveCount(0);

  // 带形态的精灵用**官方名**显示（游戏自己的写法，下划线分隔），不是自己拼的空格写法
  await expect(page.getByText('鸭吉吉_等一等鸭')).toBeVisible();
  await expect(page.getByText('鸭吉吉 等一等鸭')).toHaveCount(0);

  // 筛选区默认展开（2026-10-05 拍板）：性别 / 体型 / 声音是常显行（2026-11-18 起不再是手风琴瓦片）
  await expect(page.getByTestId('pet-filters-toggle')).toHaveText(/筛选/);
  await expect(page.getByTestId('filter-row-gender')).toBeVisible();
  await expect(page.getByTestId('filter-row-body')).toBeVisible();

  // 点「大块头」→ 只剩大块头精灵（点选项不自动收起，可连点多选）
  await page.getByTestId('filter-opt-body-body:大块头').click();
  await expect(page.getByText('机械方方')).toBeVisible();
  await expect(page.getByText('鸭吉吉')).toHaveCount(0);
  await expect(page.getByText('喵喵')).toHaveCount(0);

  // 取消「大块头」→ 全部精灵回来
  await page.getByTestId('filter-opt-body-body:大块头').click();
  await expect(page.getByText('机械方方')).toBeVisible();
  await expect(page.getByText('鸭吉吉')).toBeVisible();
  // 账号筛选已移到页面顶部 AccountFilterBar，下方筛选面板不再重复账号标签（2026-10-05）
  await expect(page.getByTestId('pet-filters')).not.toContainText('账号（');
  // 收起筛选后已选条件仍有摘要
  await page.getByTestId('pet-filters-toggle').click();
  await expect(page.getByTestId('pet-filters-selected')).toHaveCount(0);
});

test('种公入口落到种公阵列：只列覆盖目标的种公，档位跟全局目标', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '收集', exact: true }).click();

  // 2026-10-29「合格种公」视图已删：种公统一在「收集 · 种公」的种公阵列里看
  await page.getByTestId('collection-kind-studs').click();
  await expect(page.getByTestId('collection-kind-studs')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stud-matrix')).toBeVisible();

  // 档位是全局目标（默认满分 → 大婉），阵列顶部 tab 必须是选中态
  await expect(page.getByTestId('stud-matrix-grade-大婉')).toHaveAttribute('aria-pressed', 'true');

  // 只列真正覆盖了目标的种公：代表格是带「共 N 只」的可点按钮（fixture 里只有火花达标）
  const repCell = page.getByRole('button', { name: /种公 .*共 \d+ 只/ }).first();
  await expect(repCell).toBeVisible();
  await expect(repCell).toContainText('火花');
});

test('种公阵列：性格筛选决定阵列的列，清空后回到未选提示', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '收集', exact: true }).click();

  await page.getByTestId('collection-kind-studs').click();
  await expect(page.getByTestId('collection-kind-studs')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stud-matrix')).toBeVisible();

  // 2026-11-19：筛选常显、性格默认八大 → 阵列直接出「固执」列
  await expect(page.getByTestId('nature-mode-eight')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('columnheader', { name: '固执' })).toBeVisible();

  // 切自选（预选八大，下拉默认收起）→ 点开 → 全部取消 → 回到未选提示；勾回「固执」列再出现
  await page.getByTestId('nature-mode-custom').click();
  await page.getByTestId('custom-nature-toggle').click();
  await page.getByTestId('custom-nature-select-all').click();
  await expect(page.getByTestId('stud-matrix-empty')).toBeVisible();

  await page.getByTestId('custom-nature-固执').click();
  await expect(page.getByRole('columnheader', { name: '固执' })).toBeVisible();
});

test('母本页：四列卡片；已收集点卡跳背包筛选，未收集点卡看怎么补，无计划入口', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '收集', exact: true }).click();
  // 2026-11-01：页签是「收集 · 母本」的卡片按钮，不再是页内的「母本」文字按钮
  await page.getByTestId('collection-kind-mothers').click();
  await expect(page.getByTestId('collection-kind-mothers')).toHaveAttribute('aria-pressed', 'true');

  // 链清单四列卡片，顶部给整体进度；默认停在「未收集」
  await expect(page.getByTestId('mother-chain-summary')).toContainText('共');
  await expect(page.getByTestId('mother-chain-filter-uncollected')).toHaveAttribute('aria-pressed', 'true');

  // 「计划收集」整段与卡底「计划 / 已计划」按钮已移除（2026-11-20）
  await expect(page.getByTestId('mother-plan')).toHaveCount(0);
  await expect(page.getByTestId('mother-plan-toggle')).toHaveCount(0);

  // 切「已收集」：机械方方（大块头 + 100dB 母）默认达标 = 已收集
  await page.getByTestId('mother-chain-filter-collected').click();
  await expect(page.getByTestId('mother-chain-filter-collected')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('mother-search').fill('机械方方');
  const rows = page.getByTestId('mother-chain-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('机械方方');

  // 已收集卡没有「查看」按钮：点整卡跳精灵背包并带筛选
  await expect(rows.first().getByTestId('mother-chain-open')).toHaveCount(0);
  await rows.first().getByRole('button').click();
  await expect(page.getByTestId('collection-kind-inventory')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('pet-name-search')).toHaveValue('机械方方');

  // 回到母本切「未收集」，点未收集卡 → 看「怎么补」悬浮窗
  await page.getByTestId('collection-kind-mothers').click();
  await expect(page.getByTestId('mother-chain-filter-uncollected')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('mother-search').fill('');
  await page.getByTestId('mother-chain-row').first().getByRole('button').click();
  await expect(page.getByRole('dialog', { name: '怎么补' })).toBeVisible();
  await page.getByTestId('gap-fill-close').click();
  await expect(page.getByTestId('gap-fill-dialog')).toHaveCount(0);

  // 搜索不存在的名字 → 空态
  await page.getByTestId('mother-search').fill('不存在的名字XYZ');
  await expect(page.getByTestId('mother-chain-empty')).toBeVisible();
});

test('母本页：搜索支持进化链全员命中（搜同链其它形态名也能定位到该链）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '收集', exact: true }).click();
  await page.getByTestId('collection-kind-inventory').click();
  // 2026-11-01：同上，入口是「收集 · 母本」页签
  await page.getByTestId('collection-kind-mothers').click();
  await expect(page.getByTestId('collection-kind-mothers')).toHaveAttribute('aria-pressed', 'true');

  // 火花链里有 火神/焰火/烈火战神 等形态名；搜「火神」应命中「火花」那条链
  const search = page.getByTestId('mother-search');
  await search.fill('火神');
  const rows = page.getByTestId('mother-chain-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('火花');
  // 推荐性格取「该蛋物种进化链的推荐」：排除首领形态后，火花链取火神 → 固执/开朗
  await expect(rows.first().getByTestId('mother-card-natures')).toBeVisible();
  await expect(rows.first().getByTestId('mother-card-natures')).toContainText('固执');
  await expect(rows.first().getByTestId('mother-card-natures')).toContainText('开朗');
});

test('精灵背包搜索：按进化链全员命中，搜不到给空态', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '收集', exact: true }).click();
  await page.getByTestId('collection-kind-inventory').click();
  await expect(page.getByTestId('collection-kind-inventory')).toHaveAttribute('aria-pressed', 'true');

  // 种公名单连同它的搜索框一起下线；搜索能力仍在精灵背包（R2-6-L05：两条用例合并成一条）
  const search = page.getByTestId('pet-name-search');
  await expect(search).toBeVisible();
  // fixture 里只有 stage1 的火花（3003），搜它同链的进化形态名也要命中
  await search.fill('火神');
  await expect(page.getByText('火花')).toBeVisible();
  await expect(page.getByText('机械方方')).toHaveCount(0);

  await search.fill('焰火');
  await expect(page.getByText('火花')).toBeVisible();

  // 搜自己也在
  await search.fill('火花');
  await expect(page.getByText('火花')).toBeVisible();

  // 清空恢复全部
  await search.fill('');
  await expect(page.getByText('机械方方')).toBeVisible();

  // 搜不到：给空态文案，而不是留一片空白
  await search.fill('不存在的名字XYZ');
  await expect(page.getByText('没有符合条件的精灵，试试取消部分标签。')).toBeVisible();
  await expect(page.getByText('火花')).toHaveCount(0);
});

test('账号同类取并集；大块头筛选与零命中档位置灰', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles([
    'src/domain/__fixtures__/backup-sample.json',
    'src/domain/__fixtures__/backup-sample-2.json',
  ]);
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '收集', exact: true }).click();
  await page.getByTestId('collection-kind-inventory').click();

  // 账号筛选在页面顶部 AccountFilterBar，点开面板后排除 / 选回账号（同类取并集，非交集）
  await page.getByTestId('account-filter-summary').click();
  await page.getByTestId('account-filter-测试乙').click();
  await expect(page.locator('article')).toHaveCount(4);

  await page.getByTestId('account-filter-测试乙').click();
  await expect(page.locator('article')).toHaveCount(6);

  // 改选「大块头」→ 6 只里 3 只大块头
  await page.getByTestId('filter-opt-body-body:大块头').click();
  await expect(page.locator('article')).toHaveCount(3);

  // 粗嗓门零命中 → 档位置灰（这个 fixture 里没有负分贝）
  await expect(page.getByTestId('filter-opt-voice-voice:粗嗓门')).toBeDisabled();
});
