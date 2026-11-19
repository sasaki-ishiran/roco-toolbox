import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TOUR_SEGMENT_ORDER, TOUR_VERSION } from '../src/ui/tour';
import { GROUP_ID, loginAs, mockMotherGroups } from './helpers/motherGroupsMock';

// 覆盖 config 里「引导已读」的预置，才能看到首启自动弹出的引导
test.use({ storageState: { cookies: [], origins: [] } });

const { entries: changelogEntries } = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'data', 'changelog.json'), 'utf8'),
) as { entries: Array<{ id: string }> };

/** 预置「已读」：默认全部已看，`except` 里的分段留空以便观察自动弹出 */
const presetSeen = async (page: Page, except: string[] = []) => {
  const entries = TOUR_SEGMENT_ORDER.filter((segment) => !except.includes(segment)).map(
    (segment) => ({ name: `roco.tourSeen.${segment}`, value: TOUR_VERSION }),
  );
  entries.push({ name: 'roco.changelogSeen', value: changelogEntries[0]?.id ?? '' });
  await page.addInitScript((items) => {
    for (const item of items) window.localStorage.setItem(item.name, item.value);
  }, entries);
};

/** 第 5 个用例要框到「接单上窝」的真实控件，必须本机有数据、并且有一条我接的单。 */
const CLAIMED_DEMAND = {
  groupId: GROUP_ID,
  demanderAccountId: 'B',
  eggGameId: 3003,
  nature: '',
  gender: '母',
  body: '',
  voice: '',
  status: 'claimed',
  claimerAccountId: 'A',
  version: 1,
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
};

test('首启只讲「先采集一次」：数据没到位不能下一步，数据到齐后自动走到教程提示', async ({ page }) => {
  await page.goto('/');

  const root = page.getByTestId('tour-root');
  await expect(root).toBeVisible();
  await expect(page.getByTestId('tour-progress')).toHaveText('第 1 / 3 步');
  await expect(page.getByTestId('tour-title')).toHaveText('先采集一次游戏数据');
  // 第 1 步框住顶部「我的」页签
  await expect(page.getByTestId('tour-spotlight')).toBeVisible();

  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-title')).toHaveText('点「开始采集」');
  await expect(page.getByTestId('tour-next')).toBeDisabled();
  await expect(page.getByTestId('tour-wait')).toBeVisible();

  // preview 没有安卓采集桥，这里用一份可配对的数据模拟「采集完成、数据到位」→ 自动进入收尾步
  await page
    .getByTestId('import-input')
    .setInputFiles('src/domain/__fixtures__/backup-breed-pair.json');
  await expect(page.getByTestId('tour-title')).toHaveText('随时能重看引导', { timeout: 10_000 });
  await expect(page.getByTestId('tour-spotlight')).toBeVisible();

  await page.getByTestId('tour-done').click();
  await expect(root).toHaveCount(0);

  // 刷新：首启已看过 → 不再自动弹
  await page.reload();
  await expect(page.getByTestId('tour-root')).toHaveCount(0);
});

test('首次进入看板自动弹一次；跳过后再进不再自动弹', async ({ page }) => {
  await presetSeen(page, ['dashboard']);
  await page.goto('/');

  await expect(page.getByTestId('tour-root')).toHaveCount(0);
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await expect(page.getByTestId('tour-root')).toBeVisible();
  await expect(page.getByTestId('tour-title')).toHaveText('先定种公目标');
  await expect(page.getByTestId('tour-progress')).toHaveText('第 1 / 4 步');
  await expect(page.getByTestId('tour-spotlight')).toBeVisible();

  // 跳过 → 先给出「教程」入口提示，再点一次才关闭
  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tour-title')).toHaveText('随时能重看引导');
  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tour-root')).toHaveCount(0);

  // 切走再回来：本页已看过，不再自动弹
  await page.getByRole('button', { name: '收集', exact: true }).click();
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await expect(page.getByTestId('tour-root')).toHaveCount(0);
});

test('顶部「教程」直接重播当前页那一段', async ({ page }) => {
  await presetSeen(page);
  await page.goto('/');

  await page.getByRole('button', { name: '收集', exact: true }).click();
  await page.getByTestId('guide-open').click();

  await expect(page.getByTestId('tour-root')).toBeVisible();
  await expect(page.getByTestId('tour-title')).toHaveText('收集页三个视图');
  await expect(page.getByRole('button', { name: '收集', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('引导进行中点「教程」：结束当前段并重播当前页，不叠出两层', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tour-root')).toBeVisible();
  await expect(page.getByTestId('tour-title')).toHaveText('先采集一次游戏数据');

  await page.getByTestId('guide-open').click();
  await expect(page.getByTestId('tour-root')).toHaveCount(1);
  // 落在「我的」页 → 重播「我的」那一段
  await expect(page.getByTestId('tour-title')).toHaveText('先导入一次数据');
});

test('家园段会真的切到「接单上窝」并框到接单内容', async ({ page }) => {
  await loginAs(page);
  await mockMotherGroups(page, { demands: [CLAIMED_DEMAND] });
  await presetSeen(page, ['home']);
  await page.goto('/');

  await page
    .getByTestId('import-input')
    .setInputFiles('src/domain/__fixtures__/backup-breed-pair.json');
  await expect(page.getByTestId('import-outcome')).toContainText('已保存到本机');

  await page.getByRole('button', { name: '家园', exact: true }).click();
  await expect(page.getByTestId('tour-title')).toHaveText('家园分两页');
  await page.getByTestId('tour-next').click();

  await expect(page.getByTestId('tour-title')).toHaveText('接单上窝');
  await expect(page.getByTestId('home-title')).toHaveText('接单上窝');
  await expect(page.getByTestId('home-view-nests')).toBeVisible();
  await expect(page.getByTestId('home-demand-placements')).toBeVisible();
  await expect(
    page.getByTestId('home-demand-row').or(page.getByTestId('home-demand-skip')).first(),
  ).toBeVisible();
});
