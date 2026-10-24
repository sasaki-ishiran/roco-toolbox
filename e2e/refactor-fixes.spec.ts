import { expect, test, type Page } from '@playwright/test';
import { enterGroup, groupDetail, groupSummary, loginAs, mockMotherGroups } from './helpers/motherGroupsMock';

async function editSelection(page: Page) {
  await page.getByRole('button', { name: '小组', exact: true }).click();
  await page.getByTestId('group-edit-resources').click();
  await page.getByTestId('mother-account-uid:1001').click();
  await expect(page.getByTestId('mother-draft-dirty')).toBeVisible();
}

test('小组草稿离开主导航可取消、Esc 继续编辑、确认后才离开', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page);
  await page.goto('/');
  await editSelection(page);
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('有未发布的选号修改');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByTestId('mother-draft-dirty')).toBeVisible();
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('mother-account-uid:1001')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await page.getByRole('button', { name: '放弃并离开', exact: true }).click();
  await expect(page.getByTestId('target-mode')).toBeVisible();
});

test('切组取消保留原组草稿，确认后才切到另一组', async ({ page }) => {
  await loginAs(page);
  await enterGroup(page);
  await mockMotherGroups(page);
  await page.route('**/api/collection-groups', (route) => route.fulfill({ json: {
    ok: true, groups: [groupSummary, { ...groupSummary, id: 'g2', name: '另一组' }],
  } }));
  await page.route('**/api/collection-groups/g2', (route) => route.fulfill({ json: {
    ok: true, ...groupDetail, group: { ...groupDetail.group, id: 'g2', name: '另一组' },
  } }));
  await page.goto('/');
  await editSelection(page);
  await page.getByTestId('group-chip-g2').click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByTestId('group-card')).toContainText('周末互换');
  await expect(page.getByTestId('mother-draft-dirty')).toBeVisible();
  await page.getByTestId('group-chip-g2').click();
  await page.getByRole('button', { name: '放弃并离开', exact: true }).click();
  await expect(page.getByTestId('group-card')).toContainText('另一组');
  await expect(page.getByTestId('mother-draft-dirty')).toHaveCount(0);
});

test('导入页不再显示旧的外部文件导入指引', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('import-guide')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /下载安卓采集器/ })).toHaveCount(0);
});

test('主导航键盘顺序、弹层焦点循环与 Esc 返焦', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('app-refresh').focus();
  for (const control of [page.getByTestId('guide-open'), ...['看板', '收集', '小组', '我的'].map((name) => page.getByRole('button', { name, exact: true }))]) {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
  }
  await page.getByRole('button', { name: '看板', exact: true }).click();
  const trigger = page.getByRole('button', { name: '调整', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '调整目标' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('缩短视口后目标弹层正文可滚动，完成按钮留在视口内', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await page.getByRole('button', { name: '调整', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 360 });
  const dialog = page.getByRole('dialog', { name: '调整目标' });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
  expect(await dialog.evaluate((element) => {
    const body = element.children[1];
    return body.scrollHeight > body.clientHeight;
  })).toBe(true);
  const done = dialog.getByRole('button', { name: '完成', exact: true });
  await expect(done).toBeInViewport();
  await done.click();
  await expect(dialog).toHaveCount(0);
});

for (const width of [320, 375, 390, 1280]) {
  test(`${width}px 覆盖度筛选控件符合紧凑尺寸，所有主页面无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/');
    await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
    for (const name of ['看板', '收集', '小组', '我的']) {
      await page.getByRole('button', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    }
    await page.getByRole('button', { name: '收集', exact: true }).click();
    await page.getByTestId('collection-kind-studs').click();
    await page.getByTestId('coverage-groups-toggle').click();
    await page.getByTestId('nature-mode-custom').click();
    const controls = page.locator('[data-testid="nature-mode"] button, [data-testid="coverage-filter"] button');
    // 2026-10-25 用户拍板：芯片 / 分段 / 文字动作统一 28px，不再一律 44px
    const tooSmall = await controls.evaluateAll((buttons) => buttons.filter((b) => b.getBoundingClientRect().height < 28).map((b) => b.getAttribute('data-testid')));
    expect(tooSmall).toEqual([]);
    expect(errors).toEqual([]);
  });
}
