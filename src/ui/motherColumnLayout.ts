/**
 * 母本蛋组三列判定（2026-11-21 用户口径）。
 *
 * 收起筛选栏、屏幕够宽（≥1250px 横屏）时：
 * - 两列一屏就能展示完全部蛋组 → 保持两列大卡；
 * - 两列放不下 → 改三列，多塞一组。
 *
 * 这里只做纯计算，不读 DOM 真实高度（2026-11-27 P4：原来在 useLayoutEffect 里
 * 临时改两列再逐个 getBoundingClientRect 量高度，≥1200px 宽横屏一次收起筛选
 * 要 149.5ms；改用估算高度后不再强制整页重排）。
 */

/** 分区 header 高度估算（标题行 + 内边距） */
const SECTION_HEADER_PX = 30;
/** 每张母本卡高度（PetCardLayout 固定 104px）+ 行间距 4px */
const CARD_ROW_PX = 108;
/** 每个分区内部网格列数（grid-cols-4） */
const SECTION_GRID_COLUMNS = 4;

/** 估算一个分区的高度：header + 按 4 列网格排布的卡片行数 × 行高 */
export function estimateSectionHeight(groupCount: number): number {
  if (groupCount <= 0) return 0;
  const rows = Math.ceil(groupCount / SECTION_GRID_COLUMNS);
  return SECTION_HEADER_PX + rows * CARD_ROW_PX;
}

export function twoColumnContentHeight(
  sectionHeights: readonly number[],
  totalSections: number,
  gap: number,
): number {
  if (totalSections <= 0) return 0;
  const measured = sectionHeights.filter((height) => height > 0);
  const fallback = measured.length
    ? measured.reduce((sum, height) => sum + height, 0) / measured.length
    : 0;
  let height = 0;
  const rows = Math.ceil(totalSections / 2);
  for (let row = 0; row < rows; row += 1) {
    const left = sectionHeights[row * 2] || fallback;
    const right = sectionHeights[row * 2 + 1] || fallback;
    height += Math.max(left, right);
  }
  return height + Math.max(0, rows - 1) * gap;
}

export function shouldUseThreeColumns(input: {
  sectionHeights: readonly number[];
  totalSections: number;
  gap: number;
  viewportHeight: number;
}): boolean {
  return (
    twoColumnContentHeight(input.sectionHeights, input.totalSections, input.gap) >
    input.viewportHeight
  );
}

/**
 * P4（2026-11-27）：用估算高度判定三列，不读 DOM。
 * `sectionGroupCounts` 是每个分区的链数，`gap` 用固定值（Tailwind space-y-2 = 8px），
 * `listTopRatio` 是列表在视口中的顶部占比（0~1），用于估算可用高度。
 */
export function shouldUseThreeColumnsEstimated(input: {
  sectionGroupCounts: readonly number[];
  gap?: number;
  viewportHeight: number;
  listTopRatio?: number;
}): boolean {
  const gap = input.gap ?? 8;
  const heights = input.sectionGroupCounts.map(estimateSectionHeight);
  const listTop = (input.listTopRatio ?? 0.15) * input.viewportHeight;
  const availableHeight = input.viewportHeight - Math.max(0, listTop);
  return (
    twoColumnContentHeight(heights, input.sectionGroupCounts.length, gap) > availableHeight
  );
}
