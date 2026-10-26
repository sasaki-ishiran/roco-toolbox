import { defineConfig } from 'vitest/config';

/**
 * 数据管线单测专用配置。
 *
 * 主 `vite.config.ts` 只收 `src/**`，这里单独把 `tools/data-pipeline/tests`
 * 纳入，避免管线算法（蛋归属兜底、推荐性格聚合）改了却没有任何命令会跑到。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tools/data-pipeline/tests/**/*.test.mjs'],
  },
});
