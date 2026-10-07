import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * 「数据管理」（导出全部数据 / 合并导入 / 重置）在「导入数据」页底部、**默认收起**（2026-10-06 重排）：
 * 用到里面的按钮或输入框之前先展开（幂等，已展开就不重复点）。
 */
const openMoreData = async (page: Page) => {
  const toggle = page.getByTestId('import-more-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
};

test('看板首页展示两块进度卡与署名', async ({ page }) => {
  await page.goto('/');
  // 无数据时默认落在「导入数据」页，这里切到看板看进度卡
  await page.getByRole('button', { name: '看板' }).click();

  await expect(page.getByRole('heading', { name: '洛克工具箱' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  // 母本卡与下方筛选标题前缀相同，必须限定在各自的容器里（避免 strict mode 撞上）
  await expect(
    page.getByTestId('progress-card-action-mother').getByRole('heading', { name: '母本全收集' }),
  ).toBeVisible();

  await expect(page.getByText('0 / 14', { exact: true })).toBeVisible();
  await expect(page.getByText('0 / 199', { exact: true }).first()).toBeVisible();

  const source = page.getByText('CC BY-SA 4.0');
  await expect(source).toBeVisible();
  await expect(page.getByRole('link', { name: '洛克王国：世界 Wiki' })).toBeVisible();
});

test('导入抓包数据后看板给出进度与建议', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('还没有数据')).toBeVisible();

  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');

  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await expect(
    page.getByTestId('progress-card-action-mother').getByRole('heading', { name: '母本全收集' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '优质种公推荐' })).toBeVisible();
  await expect(page.getByTestId('recommend-item').first()).toBeVisible();
});

test('母本进度：看板卡与点进去的母本页是同一口径（数字一致）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await page.getByRole('button', { name: '看板' }).click();

  const card = page.getByTestId('progress-card-action-mother');
  await expect(card).toBeVisible();
  // 卡上的分子（此前按单一档位「满分大婉」算，点进去却按达标条件算 → 数字对不上）
  const cardText = await card.innerText();
  const cardNum = Number(cardText.match(/(\d+)\s*\/\s*\d+/)?.[1]);
  expect(Number.isFinite(cardNum)).toBe(true);

  await card.click();
  await expect(page.getByTestId('mother-chain-summary')).toContainText(`已收集 ${cardNum}`);
});

test('优质种公推荐：勾选移入已换到折叠区，可展开还原', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  // 勾选第一条：条目收进「已换到」折叠区（默认收起），主列表数量截断不受影响
  await expect(page.getByTestId('recommend-done-toggle')).toHaveCount(0);
  await page.getByTestId('recommend-item').first().getByTestId('recommend-item-check').click();
  await expect(page.getByTestId('recommend-done-toggle')).toContainText('已换到 1 条');
  // 展开折叠区：能看到已勾选条目（删除线）
  await page.getByTestId('recommend-done-toggle').click();
  const doneItems = page.getByTestId('recommend-done').getByTestId('recommend-item');
  await expect(doneItems).toHaveCount(1);
  await expect(doneItems.first()).toHaveClass(/line-through/);
  // 取消勾选 → 还原回主列表
  await doneItems.first().getByTestId('recommend-item-check').click();
  await expect(page.getByTestId('recommend-done-toggle')).toHaveCount(0);
  // 数量按钮仍是 5/15/全部
  await expect(page.getByTestId('recommend-quantity-5')).toBeVisible();
  await expect(page.getByTestId('recommend-quantity-15')).toBeVisible();
  await expect(page.getByTestId('recommend-quantity-all')).toBeVisible();
});

test('重置按钮一键清空已导入的数据', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('0 / 199')).toHaveCount(0);

  // 导入后默认落看板，重置按钮在「导入数据」页，先切过去
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await openMoreData(page);
  await page.getByRole('button', { name: '重置导入数据' }).click();

  await expect(page.getByText('还没有数据')).toBeVisible();
  // 清空后回到看板：两块进度归零、署名仍在
  await page.getByRole('button', { name: '看板' }).click();
  await expect(page.getByText('0 / 14', { exact: true })).toBeVisible();
  await expect(page.getByText('0 / 199', { exact: true }).first()).toBeVisible();
});

test('切页签不再闪"正在读取本地数据"', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  // 四个页签来回切，加载文案都不应再出现（数据已在内存缓存里）
  for (const tab of ['覆盖度', '换什么', '我的精灵', '看板', '覆盖度', '换什么']) {
    await page.getByRole('button', { name: tab }).click();
    await expect(page.getByText('正在读取本地数据')).toHaveCount(0);
  }
});

test('导出全部数据 → 清空 → 导入备份，数据完整恢复（"共用一份"的手动做法）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  // 有数据时导入后会回看板，等确认到看板再切去导入页（避免首跳未完成又被弹回）
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();

  await openMoreData(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-button').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/洛克工具箱备份-\d{4}-\d{2}-\d{2}\.json/);
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();

  // 清空本机数据（清空后仍停在导入页，空状态可见）
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重置导入数据' }).click();
  await expect(page.getByText('还没有数据')).toBeVisible();

  // 用备份恢复（清空后合并 = 全部新增）
  await page.getByTestId('backup-input').setInputFiles(backupPath as string);
  await expect(page.getByTestId('data-message')).toContainText('已合并导入');
  await expect(page.getByTestId('data-message')).toContainText('新增 1 个账号');

  // 恢复后回到看板：进度不再是 0
  await page.getByRole('button', { name: '看板' }).click();
  await expect(page.getByText('还没有数据')).toHaveCount(0);
  await expect(page.getByText('0 / 255', { exact: true })).toHaveCount(0);
});

test('合并导入：两台设备的数据合到一起，谁的账号都不会被清掉', async ({ browser }) => {
  const BASE = 'http://localhost:4173/';

  // 设备 A（平板）：导入自己的抓包 → 导出成备份；两个上下文互不共享存储，就是两台设备
  const deviceA = await browser.newContext();
  const pageA = await deviceA.newPage();
  await pageA.goto(BASE);
  await pageA.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  // 导入后默认落看板，「N 个账号」与导出按钮都在「导入数据」页
  await expect(pageA.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await pageA.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(pageA.getByText('1 个账号')).toBeVisible();
  await openMoreData(pageA);
  const [downloadA] = await Promise.all([
    pageA.waitForEvent('download'),
    pageA.getByTestId('export-button').click(),
  ]);
  // 必须先另存：download.path() 指向该上下文的临时产物目录，关掉上下文就没了
  mkdirSync('test-results', { recursive: true });
  const backupA = 'test-results/device-a-backup.json';
  await downloadA.saveAs(backupA);
  await deviceA.close();

  // 设备 B（手机）：自己的账号是另一个，然后把平板那份备份合并进来
  const deviceB = await browser.newContext();
  const pageB = await deviceB.newPage();
  await pageB.goto(BASE);
  await pageB.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample-2.json');
  await expect(pageB.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await pageB.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(pageB.getByText('1 个账号')).toBeVisible();

  pageB.on('dialog', (dialog) => dialog.accept());
  await openMoreData(pageB);
  await pageB.getByTestId('backup-input').setInputFiles(backupA);
  await expect(pageB.getByTestId('data-message')).toContainText('已合并导入');
  await expect(pageB.getByTestId('data-message')).toContainText('新增 1 个账号');

  // 两边账号都在 —— 旧实现（清空后覆盖）这里会只剩平板的那个
  await expect(pageB.getByText('2 个账号')).toBeVisible();
  await deviceB.close();
});

test('合并导入：同账号取较新的一份，旧备份顶不回本地', async ({ page }) => {
  // 造一份「同账号但导入时间很早」的备份
  mkdirSync('test-results', { recursive: true });
  const olderPath = 'test-results/older-backup.json';
  writeFileSync(
    olderPath,
    JSON.stringify({
      type: 'roco-toolbox-backup',
      version: 1,
      exportedAt: '2020-01-01T00:00:00.000Z',
      catalogVersion: 'x',
      accounts: [
        {
          accountName: '测试甲',
          // 与 fixture（src/domain/__fixtures__/backup-sample.json）是同一个游戏 UID →
          // 认作同一账号，走「取较新的一份」这条规则（2026-10-06 起账号身份是 UID，不是名字）
          gameId: 1000001,
          exportedAt: '2020-01-01T00:00:00.000Z',
          importedAt: '2020-01-01T00:00:00.000Z',
          pets: [],
          eggs: [],
        },
      ],
    }),
    'utf8',
  );

  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  // 导入后默认落看板，「N 个账号」「合并导入」等都在「导入数据」页
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(page.getByText('1 个账号')).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await openMoreData(page);
  await page.getByTestId('backup-input').setInputFiles(olderPath);
  const message = page.getByTestId('data-message');
  await expect(message).toContainText('新增 0 个账号');
  await expect(message).toContainText('更新 0 个');
  await expect(message).toContainText('保留本地较新的 1 个');

  // 本地那份没被空数据顶掉：精灵还在（我的精灵里能看到 fixture 里的机械方方）
  await page.getByRole('button', { name: '我的精灵' }).click();
  await expect(page.getByText('机械方方')).toBeVisible();
});

test('把备份文件从「导入抓包数据」入口塞进去，也能按合并导入处理', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  // 有数据时导入后会回看板，导出/导入入口都在「导入数据」页
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();

  // 导出一份真备份，模拟「微信收到备份 → 分享给洛克工具箱」：走的就是这条入口。
  // 以前这里会被当成抓包解析而报错，现在按合并导入处理。
  await openMoreData(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-button').click(),
  ]);
  const backupPath = await download.path();
  await page.getByTestId('import-input').setInputFiles(backupPath as string);

  await expect(page.getByTestId('data-message')).toContainText('已合并导入');
  // 同一份数据 → 本地时间不比它旧 → 保留本地，不报错、也不清数据
  await expect(page.getByTestId('data-message')).toContainText('保留本地较新的 1 个');
  await expect(page.getByText('1 个账号')).toBeVisible();
});

test('用「合并导入」选抓包文件时给出可读错误', async ({ page }) => {
  await page.goto('/');
  await openMoreData(page);
  await page.getByTestId('backup-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText(/不是洛克工具箱的备份文件/)).toBeVisible();
});

test('母本全收集：四档分开计数，默认满分大婉，切换档位换列表', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  // 档位是页内下拉栏（2026-10-05：不弹系统窗）：默认显示满分大婉（带计数）
  const gradeSelect = page.getByTestId('mother-grade-select');
  await expect(gradeSelect).toContainText(/满分大婉 \(\d+\)/);

  // 默认选中满分大婉；下拉button 直接嵌在标题行里（「母本全收集 <下拉>」）
  await expect(page.getByTestId('mother-filter-title')).toContainText('母本全收集');
  // 点开下拉栏：4 个档位都在
  await gradeSelect.click();
  const gradeOptions = page.getByTestId('mother-grade-options');
  await expect(gradeOptions).toBeVisible();
  await expect(gradeOptions.getByRole('button')).toHaveCount(4);

  // 母本列表默认收起，先展开再断言内容（2026-10-04 优化）
  await page.getByTestId('mother-list-toggle').click();

  // fixture 里「机械方方」是母本 · 大块头 · 100dB → 属于满分大婉，列表里能看到它的账号与盒子
  const rows = page.getByTestId('mother-filter-row');
  await expect(rows.first()).toContainText('机械方方');
  await expect(rows.first()).toContainText('（');
  await expect(rows.first()).toContainText('盒子');
  // 母本列表按账号聚拢：账号作为分组标题
  await expect(page.getByTestId('account-section').first()).toBeVisible();

  // 切到满分小婉（fixture 里没有）→ 列表为空、下拉选中项跟着换（选择档位会自动展开列表）。
  // 下拉栏在前面已打开且没人关它，这里直接点选项（不要再点触发按钮，点了反而收起）
  await page.getByTestId('mother-grade-option-小婉').click();
  await expect(gradeSelect).toContainText(/满分小婉/);
  await expect(page.getByTestId('mother-filter-result')).toContainText('这个档位暂时没有合格的母本');
  await expect(page.getByTestId('mother-filter-result')).toBeVisible();
});

test('当前模式：看板开关切到追双牌，全程序跟着换', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  // 默认追满分
  await expect(page.getByTestId('target-mode-perfect')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('target-mode-medal').click();
  await expect(page.getByTestId('target-mode-medal')).toHaveAttribute('aria-pressed', 'true');
  // 下拉里的档位选项不再带「满分」前缀（点开下拉栏后直接断言选项文字）
  await page.getByTestId('mother-grade-select').click();
  await expect(page.getByTestId('mother-grade-option-大婉')).toHaveText(/^大婉 \(\d+\)$/);

  // 覆盖度页显示当前模式
  await page.getByRole('button', { name: '覆盖度' }).click();
  await expect(page.getByTestId('coverage-mode')).toContainText('追双牌');

  // 刷新后模式还在（持久化在本机）
  await page.reload();
  await expect(page.getByTestId('target-mode-medal')).toHaveAttribute('aria-pressed', 'true');
});

test('导入报告：性格不在目标池的合格公也会被列出', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-offtarget-stud.json');
  // 导入后默认落看板，「本次新增」卡片直接在看板（2026-10-05 移至看板）
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();

  const card = page.getByTestId('import-result');
  await expect(card).toBeVisible();
  // 「满分小婉 · 懒散」的公：懒散不在任何目标性格池里，但必须出现在「新增种公」
  const stud = card.getByTestId('import-result-stud').first();
  await expect(stud).toContainText('梦游');
  await expect(stud).toContainText('懒散');
  await expect(stud).toContainText('100dB');
});

test('账号筛选：三页共用一份，取消账号后看板进度跟着变', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles([
    'src/domain/__fixtures__/backup-sample.json',
    'src/domain/__fixtures__/backup-sample-2.json',
  ]);
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  await expect(page.getByTestId('account-filter')).toContainText('账号（2/2）');

  // 覆盖度页是同一个 store：那边取消一个账号，看板这边也是 1/2
  await page.getByRole('button', { name: '覆盖度' }).click();
  await expect(page.getByTestId('account-filter')).toContainText('账号（2/2）');
  await page.getByTestId('account-chip-测试乙').click();
  await page.getByRole('button', { name: '看板' }).click();
  await expect(page.getByTestId('account-filter')).toContainText('账号（1/2）');

  // 全不选 → 没有精灵可算，进度归零
  // 注意按钮语义：当前有排除项时它是「全选」，再点一次才是「全不选」
  await page.getByTestId('account-filter-toggle-all').click();
  await expect(page.getByTestId('account-filter')).toContainText('账号（2/2）');
  await page.getByTestId('account-filter-toggle-all').click();
  await expect(page.getByTestId('account-filter')).toContainText('账号（0/2）');
  await expect(page.getByText('0 / 14', { exact: true })).toBeVisible();
});

test('种公全收集卡可点：跳「我的精灵 · 种公视角」', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByText('还没有数据')).toHaveCount(0);

  await page.getByTestId('progress-card-action-stud').click();
  await expect(page.getByRole('button', { name: '种公', exact: true })).toBeVisible();
  // 种公视角下只剩合格种公（fixture 里是火花）
  await expect(page.getByText('火花')).toBeVisible();
  await expect(page.getByText('机械方方')).toHaveCount(0);
});

test('跳转后落在目标页顶部：切页签会重置滚动位置', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();

  // 把看板滚到底：页面够长，滚动偏移一定 > 0
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // 切到覆盖度（目标页比视口高：不重置的话会沿用看板的旧偏移，跳转位置不准）
  await page.getByRole('button', { name: '覆盖度' }).click();
  await expect(page.getByTestId('coverage-mode')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('一次导入两个文件后账号数显示为 2', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles([
    'src/domain/__fixtures__/backup-sample.json',
    'src/domain/__fixtures__/backup-sample-2.json',
  ]);
  // 导入后默认落看板，「N 个账号」在「导入数据」页
  await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(page.getByText('2 个账号')).toBeVisible();
});

test.describe('本次导入新增', () => {
  test('按账号分组，只列合要求的精灵并标明盒子位置（卡片在看板）', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('import-input').setInputFiles([
      'src/domain/__fixtures__/backup-sample.json',
      'src/domain/__fixtures__/backup-sample-2.json',
    ]);
    // 导入后默认落看板，卡片直接在看板上（2026-10-05 移至看板）
    await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();

    const card = page.getByTestId('import-result');
    await expect(card).toBeVisible();

    // 按账号分组：测试甲有货、测试乙没有
    const accounts = card.getByTestId('import-result-account');
    await expect(accounts).toHaveCount(2);
    await expect(accounts.first()).toContainText('测试甲');
    await expect(accounts.nth(1)).toContainText('测试乙');
    await expect(accounts.nth(1)).toContainText('没有新增符合要求的精灵');

    // 火花：大块头 + 100dB + 公 + 固执 → 满分大婉种公；标出蛋组与盒子位置
    const stud = card.getByTestId('import-result-stud').first();
    await expect(stud).toContainText('火花');
    await expect(stud).toContainText('巨灵组');
    await expect(stud).toContainText('盒子01 第3位');

    // 机械方方：大块头 + 100dB 母本 → 分到「满分大婉」档，并标出盒子位置
    await expect(accounts.first()).toContainText('新增满分大婉种公 1');
    await expect(accounts.first()).toContainText('新增满分大婉母本 1');
    await expect(card.getByTestId('import-result-mother').first()).toContainText('机械方方');
    await expect(card.getByTestId('import-result-mother').first()).toContainText('盒子01');
  });

  test('同一份数据再导入一次 → 没有新增（不会把老精灵当成新抓的）', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
    // 导入后默认落看板，「本次新增」卡片在看板
    await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
    await expect(page.getByTestId('import-result-stud').first()).toBeVisible();

    // 第二次导入的入口在「导入数据」页，导入完再回看板看结果
    await page.getByRole('button', { name: '导入数据', exact: true }).click();
    await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
    await page.getByRole('button', { name: '看板', exact: true }).click();
    await expect(page.getByTestId('import-result-empty')).toBeVisible();
    await expect(page.getByTestId('import-result-stud')).toHaveCount(0);
  });

  test('卡片可以收起再展开（收起态跨页签保持；刷新后历史仍在）', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
    // 导入后默认落看板，卡片在看板
    await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
    await expect(page.getByTestId('import-result')).toBeVisible();

    // 收起：只隐藏正文
    await page.getByTestId('import-result-dismiss').click();
    await expect(page.getByTestId('import-result-dismiss')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('import-result-stud')).toHaveCount(0);

    // 切到别的页签再回看板：仍保持收起（以前展开态在组件里，回来会自己弹开）
    await page.getByRole('button', { name: '覆盖度' }).click();
    await page.getByRole('button', { name: '看板', exact: true }).click();
    await expect(page.getByTestId('import-result-dismiss')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('import-result-stud')).toHaveCount(0);

    // 再展开：内容回来
    await page.getByTestId('import-result-dismiss').click();
    await expect(page.getByTestId('import-result-stud').first()).toBeVisible();
  });

  test('历史在看板不出现，只留在「导入数据」页；可点开看某次导入明细', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
    // 导入后默认落看板，卡片在看板
    await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
    await expect(page.getByTestId('import-result-stud').first()).toBeVisible();

    // 刷新 = 重开应用：内存里的最新结果没了 → 看板不再显示「本次新增」卡片
    await page.reload();
    await expect(page.getByRole('heading', { name: '种公全收集' })).toBeVisible();
    await expect(page.getByTestId('import-result')).toHaveCount(0);

    // 历史入口在看「导入数据」页：卡片渲染，只提供历史，不重新展示最新内容
    await page.getByRole('button', { name: '导入数据', exact: true }).click();
    const card = page.getByTestId('import-result');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: /导入历史/ })).toBeVisible();
    await expect(card.getByTestId('import-result-stud')).toHaveCount(0);

    // 点历史条目 → 明细展开（能看到账号与精灵）
    await card.getByTestId('import-result-entry').first().click();
    const detail = card.getByTestId('import-result-history-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('import-result-stud').first()).toContainText('火花');

    // 再点收起
    await card.getByTestId('import-result-entry').first().click();
    await expect(card.getByTestId('import-result-history-detail')).toHaveCount(0);
  });
});
