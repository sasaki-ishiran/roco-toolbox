import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_MOTHER_CRITERIA } from '../domain/motherCriteria';
import { ALL_EGG_GROUP_IDS, DEFAULT_GRADES } from '../domain/coverageTargets';

/**
 * 两个 store 的 migrate 行为（2026-10-07 修）：
 * - 母本达标标准：**空数组是合法状态**（该维度不限，母本页「清除本组」会产生它），
 *   只有字段缺失才补默认——否则用户清空的选择会在重启后被偷偷还原。
 * - 覆盖筛选：这个键会被云同步的云端值整键覆盖，脏值（`{"grades":5}`）会让覆盖度/看板
 *   在渲染期 `includes`/`map` 抛错白屏 → 逐字段校验类型，非法就回默认。
 *
 * store 在模块加载时读一次 localStorage，所以每个用例先写存储再 resetModules + 动态 import。
 */
afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('store migrate', () => {
  test('母本达标标准：字段缺失 → 补默认', async () => {
    localStorage.setItem('roco.motherCriteria', JSON.stringify({}));
    const store = await import('./motherCriteriaStore');
    expect(store.getMotherCriteria()).toEqual(DEFAULT_MOTHER_CRITERIA);
  });

  test('母本达标标准：用户主动清空（空数组）必须原样保留', async () => {
    localStorage.setItem('roco.motherCriteria', JSON.stringify({ voices: [], bodies: [] }));
    const store = await import('./motherCriteriaStore');
    expect(store.getMotherCriteria()).toEqual({ voices: [], bodies: [] });
  });

  test('母本达标标准：非法选项被过滤，合法项保留', async () => {
    localStorage.setItem(
      'roco.motherCriteria',
      JSON.stringify({ voices: ['+100', '不存在的档'], bodies: ['大块头', 7] }),
    );
    const store = await import('./motherCriteriaStore');
    expect(store.getMotherCriteria()).toEqual({ voices: ['+100'], bodies: ['大块头'] });
  });

  test('覆盖筛选：脏值逐字段回默认，不会让渲染期抛错', async () => {
    localStorage.setItem(
      'roco.coverageFilter',
      JSON.stringify({ grades: 5, groupIds: '2', customNatures: [1, '急躁'], natureMode: 'weird' }),
    );
    const store = await import('./coverageFilterStore');
    const filter = store.getCoverageFilter();
    expect(filter.grades).toEqual(DEFAULT_GRADES);
    expect(filter.groupIds).toEqual(ALL_EGG_GROUP_IDS);
    expect(filter.customNatures).toEqual(['急躁']);
    expect(filter.natureMode).toBe('recommended');
  });

  test('覆盖筛选：用户主动清空的蛋组与档位保留（不是「缺字段」）', async () => {
    localStorage.setItem('roco.coverageFilter', JSON.stringify({ groupIds: [], grades: [] }));
    const store = await import('./coverageFilterStore');
    const filter = store.getCoverageFilter();
    expect(filter.groupIds).toEqual([]);
    expect(filter.grades).toEqual([]);
  });
});
