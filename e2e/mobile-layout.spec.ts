import { expect, test } from '@playwright/test';

/**
 * 移动端布局守卫：真机上最容易出问题的是「横向溢出」和「主按钮被压扁/半截可见」。
 * 这里用最窄的常见安卓宽度 + 系统大字号各验一遍。
 */
const MOBILE_VIEWPORTS = [
  { width: 360, height: 640, label: '360x640' },
  { width: 412, height: 915, label: '412x915' },
];

for (const viewport of MOBILE_VIEWPORTS) {
  test(`${viewport.label}：四个页签都不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.getByTestId('import-input').setInputFiles('src/domain/__fixtures__/backup-sample.json');
    await expect(page.getByText('还没有数据')).toHaveCount(0);

    for (const tab of ['看板', '我的精灵', '覆盖度', '换什么']) {
      await page.getByRole('button', { name: tab }).click();
      const overflow = await page.evaluate(() => {
        const doc = document.scrollingElement as HTMLElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow, `${tab} 页横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test(`${viewport.label}：导入按钮完整可见且点击区不小于 44px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.addStyleTag({ content: 'html{font-size:20px}' }); // 模拟系统大字号

    const button = page.getByTestId('import-button');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('导入游戏数据');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    // 完整落在视口内（左右不越界），且高度足够
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
}
