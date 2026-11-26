import { describe, expect, test } from 'vitest';
import {
  estimateSectionHeight,
  shouldUseThreeColumns,
  shouldUseThreeColumnsEstimated,
  twoColumnContentHeight,
} from './motherColumnLayout';

describe('motherColumnLayout', () => {
  test('按两列逐行取较高的一节，加上行间距', () => {
    expect(twoColumnContentHeight([160, 140, 120, 180], 4, 8)).toBe(160 + 180 + 8);
  });

  test('两列一屏放得下就保持两列', () => {
    expect(
      shouldUseThreeColumns({
        sectionHeights: [160, 140, 120, 180],
        totalSections: 4,
        gap: 8,
        viewportHeight: 720,
      }),
    ).toBe(false);
  });

  test('两列超过一屏时改三列', () => {
    expect(
      shouldUseThreeColumns({
        sectionHeights: [160, 160, 160, 160, 160, 160],
        totalSections: 6,
        gap: 8,
        viewportHeight: 400,
      }),
    ).toBe(true);
  });

  test('没量到高度时用已量到的平均值补齐，空列表不报错', () => {
    expect(twoColumnContentHeight([], 0, 8)).toBe(0);
    expect(twoColumnContentHeight([200], 4, 8)).toBe(200 + 200 + 8);
  });

  test('估算高度：header 30px + ceil(链数/4) × 108px', () => {
    expect(estimateSectionHeight(0)).toBe(0);
    expect(estimateSectionHeight(4)).toBe(30 + 108);
    expect(estimateSectionHeight(5)).toBe(30 + 2 * 108);
    expect(estimateSectionHeight(8)).toBe(30 + 2 * 108);
  });

  test('估算判定：两列放不下（视口 400px，6 个分区各 4 条链）改三列', () => {
    // 每个分区估算高度 = 30 + 108 = 138，两列 3 行 = 3*138 + 2*8 = 430 > 400-60=340
    expect(
      shouldUseThreeColumnsEstimated({
        sectionGroupCounts: [4, 4, 4, 4, 4, 4],
        viewportHeight: 400,
        listTopRatio: 0.15,
      }),
    ).toBe(true);
  });

  test('估算判定：两列一屏放得下（视口 800px，4 个分区各 4 条链）保持两列', () => {
    // 每个分区 138，两列 2 行 = 2*138 + 8 = 284 < 800-120=680
    expect(
      shouldUseThreeColumnsEstimated({
        sectionGroupCounts: [4, 4, 4, 4],
        viewportHeight: 800,
        listTopRatio: 0.15,
      }),
    ).toBe(false);
  });
});
