import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('我的精灵页：卡片展示与标签叠加筛选', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  await page.getByRole('button', { name: '我的精灵' }).click();

  // 卡片展示：名称、盒子位置（2026-10-05 卡内不再显示账号与图鉴编号，账号由账号筛选条承担）
  await expect(page.getByText('机械方方')).toBeVisible();
  await expect(page.getByText(/盒子01/).first()).toBeVisible();
  await expect(page.getByTestId('pet-card-note')).toHaveCount(0);

  // 带形态的精灵用**官方名**显示（游戏自己的写法，下划线分隔），不是自己拼的空格写法
  await expect(page.getByText('鸭吉吉_等一等鸭')).toBeVisible();
  await expect(page.getByText('鸭吉吉 等一等鸭')).toHaveCount(0);

  // 筛选区默认展开（2026-10-05 拍板）：维度是手风琴瓦片（第一行 性别/体型/声音）
  await expect(page.getByTestId('pet-filters-toggle')).toHaveText(/筛选/);
  await expect(page.getByTestId('filter-tile-gender')).toBeVisible();

  // 手风琴：展开「体型」→ 点「大块头」→ 只剩大块头精灵（点选项不自动收起，可连点多选）
  await page.getByTestId('filter-tile-body').click();
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

test('种公视角：只列真正覆盖了目标的种公，支持四档筛选', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();

  // 种公视角：fixture 里只有「火花」是 大块头 + 100dB + 公 + 固执 → 覆盖魔力组/巨灵组的固执
  await page.getByRole('button', { name: '种公', exact: true }).click();
  await expect(page.getByTestId('stud-view-hint')).toContainText('档位达标');
  await expect(page.getByText('火花')).toBeVisible();
  await expect(page.getByText('机械方方')).toHaveCount(0);
  // 种公按账号聚拢：出现账号分组标题（2026-10-05）
  await expect(page.getByTestId('account-section').first()).toBeVisible();
  // 卡片上不再标「命中了哪些组×性格」
  await expect(page.getByTestId('pet-card-note')).toHaveCount(0);

  // 档位筛选（手风琴，与全部页一致）：火花是满分大婉；只看「小婉」→ 名单为空，取消后回来
  await page.getByTestId('filter-tile-studGrade').click();
  await page.getByTestId('filter-opt-studGrade-小婉').click();
  await expect(page.getByTestId('stud-empty')).toBeVisible();
  await page.getByTestId('filter-opt-studGrade-小婉').click();
  await expect(page.getByText('火花')).toBeVisible();

  // 种公视角下不再出现标签筛选区
  await expect(page.getByTestId('pet-filters')).toHaveCount(0);
});

test('种公视角：非目标性格的合格公默认也在名单里，性格可筛', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-offtarget-stud.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();
  await page.getByRole('button', { name: '种公', exact: true }).click();

  // 「满分小婉 · 懒散」的公：懒散不在任何目标性格池里，但必须出现（此前会凭空消失）
  await expect(page.getByText('梦游_穿旧睡衣的样子')).toBeVisible();
  await expect(page.getByTestId('stud-view-hint')).toContainText('档位达标');
  // 种公按账号聚拢：出现账号分组标题
  await expect(page.getByTestId('account-section').first()).toBeVisible();

  // 性格筛选（手风琴）：展开「性格」→ 点「固执」→ 被筛掉；取消 → 回来
  await page.getByTestId('filter-tile-studNature').click();
  await page.getByTestId('filter-opt-studNature-固执').click();
  await expect(page.getByText('梦游_穿旧睡衣的样子')).toHaveCount(0);
  await page.getByTestId('filter-opt-studNature-固执').click();
  await expect(page.getByText('梦游_穿旧睡衣的样子')).toBeVisible();

  // 档位筛选（手风琴）：只看「满分大婉」→ 小婉的它被筛掉
  await page.getByTestId('filter-tile-studGrade').click();
  await page.getByTestId('filter-opt-studGrade-大婉').click();
  await expect(page.getByText('梦游_穿旧睡衣的样子')).toHaveCount(0);
});

test('母本页：链清单一链一行（按蛋组分区），搜索即答已收集/未收集，计划不误判已达成', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();
  await page.getByRole('button', { name: '母本', exact: true }).click();

  // 链清单：一链一行（按蛋组分区），顶部给整体进度；默认停在「未收集」
  await expect(page.getByTestId('mother-chain-summary')).toContainText('共');
  const rows = page.getByTestId('mother-chain-row');
  expect(await rows.count()).toBeGreaterThan(10);
  await expect(page.getByTestId('mother-chain-filter-uncollected')).toHaveAttribute('aria-pressed', 'true');

  // 开关切到「已收集」：机械方方（大块头 + 100dB 母）默认达标 = 已收集
  await page.getByTestId('mother-chain-filter-collected').click();
  await expect(page.getByTestId('mother-chain-filter-collected')).toHaveAttribute('aria-pressed', 'true');
  const search = page.getByTestId('mother-search');
  await search.fill('机械方方');
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText('机械方方');
  // 两行式：状态灯（绿）+ 精灵名 + 已收集 N 只；第二行是推荐性格 + 蛋组标签
  await expect(row.getByTestId('mother-chain-status')).toHaveAttribute('data-status', 'collected');
  await expect(row.getByTestId('mother-chain-detail')).toContainText('已收集');
  await expect(row.getByTestId('mother-egg-group').first()).toBeVisible();
  // 展开 → 显示实际母本及其信息（性格/分贝/体型/账号/盒子）
  await row.getByTestId('mother-chain-expand').click();
  const motherRow = row.getByTestId('mother-chain-mother');
  await expect(motherRow).toContainText('机械方方');
  await expect(motherRow).toContainText('100dB');
  // 性格按是否命中推荐上色：推荐=翠绿(text-emerald-600)、非推荐=浅灰(text-slate-400)
  await expect(motherRow.getByText('大胆', { exact: true })).toHaveClass(/text-(emerald-600|slate-400)/);
  await row.getByTestId('mother-chain-expand').click();
  await expect(row.getByTestId('mother-chain-mother')).toHaveCount(0);

  // 收窄达标条件（只留「小不点」）→ 同一颗蛋立刻变未收集：已从「已收集」里消失，切回「未收集」才看得到（灰灯）
  await page.getByTestId('filter-tile-body').click();
  await page.getByTestId('filter-opt-body-大块头').click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId('mother-chain-filter-uncollected').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByTestId('mother-chain-status')).toHaveAttribute('data-status', 'uncollected');

  // 点「计划」→ 进入计划收集；未达标不应显示「已达成」（噼啪鸟 bug 回归：旧实现用档位口径判定达成）
  await rows.first().getByTestId('mother-plan-toggle').click();
  const plan = page.getByTestId('mother-plan');
  await expect(plan.getByTestId('mother-plan-row')).toHaveCount(1);
  await expect(plan.getByTestId('mother-plan-done')).toHaveCount(0);
  await plan.getByTestId('mother-plan-remove').click();
  await expect(page.getByTestId('mother-plan')).toHaveCount(0);

  // 搜索不存在的名字 → 空态
  await search.fill('不存在的名字XYZ');
  await expect(page.getByTestId('mother-chain-empty')).toBeVisible();
});

test('母本页：搜索支持进化链全员命中（搜同链其它形态名也能定位到该链）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();
  await page.getByRole('button', { name: '母本', exact: true }).click();

  // 火花链里有 火神/焰火/烈火战神 等形态名；搜「火神」应命中「火花」那条链
  const search = page.getByTestId('mother-search');
  await search.fill('火神');
  const rows = page.getByTestId('mother-chain-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('火花');
  // 推荐性格取「该蛋物种进化链的推荐」：排除首领形态后，火花链取火神 → 固执/开朗
  await expect(rows.first().getByTestId('mother-rec-nature').first()).toBeVisible();
  await expect(rows.first()).toContainText('固执');
  await expect(rows.first()).toContainText('开朗');
});

test('分页：每页 20 只，不再整页渲染', async ({ page }) => {
  const items = Array.from({ length: 500 }, (_, i) => ({
    name: `测试精灵${i}`,
    speciesPetId: 3001 + (i % 20),
    gender: i % 2 === 0 ? '母' : '公',
    nature: '固执',
    voiceDb: 100,
    medalBody: '大块头',
    isShiny: false,
    group: `盒子${String((i % 9) + 1).padStart(2, '0')}`,
    boxNumber: (i % 9) + 1,
    slotOrder: (i % 30) + 1,
  }));
  const fixture = {
    meta: { type: 'hatch-backup', playerName: '压测账号', gameId: 1, exportedAt: '2026-09-26T00:00:00.000Z' },
    collections: { petBackpack: { items }, eggInventory: { eggs: [] } },
  };
  mkdirSync('test-results', { recursive: true });
  const fixturePath = 'test-results/perf-fixture.json';
  writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');

  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles(fixturePath);
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();

  // 500 只 → 25 页，每页 20 张卡
  await expect(page.getByTestId('page-indicator')).toHaveText('共 500 只 · 第 1 / 25 页（每页 20 只）');
  await expect(page.locator('article')).toHaveCount(20);
  const firstPageFirstCard = await page.locator('article').first().textContent();

  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('共 500 只 · 第 2 / 25 页（每页 20 只）');
  await expect(page.locator('article')).toHaveCount(20);
  const secondPageFirstCard = await page.locator('article').first().textContent();
  expect(secondPageFirstCard).not.toBe(firstPageFirstCard);

  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('共 500 只 · 第 1 / 25 页（每页 20 只）');

  // 每页档位可切换：50 → 10 页
  await page.getByRole('button', { name: '50', exact: true }).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('共 500 只 · 第 1 / 10 页（每页 50 只）');
  await expect(page.locator('article')).toHaveCount(50);

  // 100 → 5 页
  await page.getByRole('button', { name: '100', exact: true }).click();
  await expect(page.getByTestId('page-indicator')).toHaveText('共 500 只 · 第 1 / 5 页（每页 100 只）');
});

test('搜索按进化链全员命中：搜同链的其它形态名也能搜到（火花 ← 焰火/火神）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();

  const search = page.getByTestId('pet-name-search');
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
});

test('种公视角：搜索按进化链全员命中', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();
  await page.getByRole('button', { name: '种公', exact: true }).click();

  // 火花是 fixture 里唯一的合格种公；搜它同链的进化形态名「烈火战神」也要命中
  const search = page.getByTestId('stud-search');
  await search.fill('火神');
  await expect(page.getByText('火花')).toBeVisible();

  await search.fill('不存在的名字XYZ');
  await expect(page.getByTestId('stud-empty')).toBeVisible();
  await expect(page.getByText('火花')).toHaveCount(0);
});

test('账号同类取并集；标签数量随选择动态更新且为 0 时置灰', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles([
    'src/domain/__fixtures__/backup-sample.json',
    'src/domain/__fixtures__/backup-sample-2.json',
  ]);
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await page.getByRole('button', { name: '我的精灵' }).click();

  // 账号筛选在页面顶部 AccountFilterBar（2026-10-05 起默认展开，排除制：点 chip = 取消该账号）；
  // 下方筛选面板不再有账号标签。
  // 初始全选 6 只；排除「测试乙」→ 只剩测试甲 4 只
  await page.getByTestId('account-chip-测试乙').click();
  await expect(page.locator('article')).toHaveCount(4);

  // 点回「测试乙」→ 并集 6 只（旧实现取交集会变成 0 只）
  await page.getByTestId('account-chip-测试乙').click();
  await expect(page.locator('article')).toHaveCount(6);

  // 取消两个账号（全排除）→ 0 只；再点「全选」回来，改选「大块头」
  await page.getByTestId('account-filter-toggle-all').click(); // 全不选
  await expect(page.locator('article')).toHaveCount(0);
  await page.getByTestId('account-filter-toggle-all').click(); // 全选
  await page.getByTestId('filter-tile-body').click();
  await page.getByTestId('filter-opt-body-body:大块头').click();
  await expect(page.locator('article')).toHaveCount(3);

  // 性别选项带动态计数：点「体型」同时展开一个维度（手风琴互斥），开「性别」看公/母计数
  await page.getByTestId('filter-tile-gender').click();
  await expect(page.getByTestId('filter-opt-gender-gender:公')).toContainText('公 (2)');
  await expect(page.getByTestId('filter-opt-gender-gender:母')).toContainText('母 (1)');

  // 粗嗓门 0 计数置灰（在这个 fixture 里没有负分贝 = 不是粗嗓门）
  await page.getByTestId('filter-tile-voice').click();
  await expect(page.getByTestId('filter-opt-voice-voice:粗嗓门')).toBeDisabled();
});
