import { expect, type Page } from '@playwright/test';

/**
 * 读看板进度卡上的「分子 / 分母」。
 *
 * 为什么不在用例里写死数字：分母来自图鉴（有多少颗蛋 / 多少个蛋组），图鉴一刷新数字就变，
 * 写死的断言会变成「假失败」——而这些用例真正想测的是「卡片渲染出来了、并且归零了」。
 */
export async function progressOf(
  page: Page,
  testId: string,
): Promise<{ numerator: number; denominator: number }> {
  const text = await page.getByTestId(testId).innerText();
  const matched = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!matched) throw new Error(`进度卡 ${testId} 上没读到「分子 / 分母」：${text}`);
  return { numerator: Number(matched[1]), denominator: Number(matched[2]) };
}

/** 两块进度卡都归零（分母只要求是正数，具体多少由图鉴决定）。 */
export async function expectProgressZero(page: Page): Promise<void> {
  for (const testId of ['progress-card-action-stud', 'progress-card-action-mother']) {
    const { numerator, denominator } = await progressOf(page, testId);
    expect(numerator, `${testId} 的分子应为 0`).toBe(0);
    expect(denominator, `${testId} 的分母应大于 0`).toBeGreaterThan(0);
  }
}
