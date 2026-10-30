import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * 筛选状态存在 localStorage 的 `roco.myPetsFilter`，用户手改 / 旧版本数据都可能
 * 把字段写成非数组。模块顶层会用 `new Set(...)` 读它——脏值会让模块求值直接抛错，
 * 应用白屏且无法自愈。这里验证各种脏值都退回空筛选。
 *
 * 2026-10-29：种公视角取消后只剩「全部」页标签，旧版本残留的 stud* 字段一律忽略。
 */
const KEY = 'roco.myPetsFilter';

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('myPetsFilterStore 持久化读取', () => {
  test('字段被污染成非数组时不抛错，退回空筛选', async () => {
    localStorage.setItem(KEY, JSON.stringify({ selected: 5, studGrades: {}, studNatures: 'x' }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual([]);
  });

  test('数组里混入非字符串元素时只保留字符串', async () => {
    localStorage.setItem(KEY, JSON.stringify({ selected: ['body:大块头', 7, null] }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['body:大块头']);
  });

  test('整体不是对象（如数组）也不抛错', async () => {
    localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual([]);
  });

  test('正常持久化能完整读回', async () => {
    localStorage.setItem(KEY, JSON.stringify({ selected: ['body:大块头'] }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['body:大块头']);
  });
});

describe('重置只清精灵背包的标签', () => {
  test('重置后标签清空，且写回 localStorage', async () => {
    localStorage.clear();
    const s = await import('./myPetsFilterStore');
    s.setMyPetsSelected(new Set(['body:满身高']));
    s.clearInventoryFilters();
    expect([...s.getMyPetsSelected()]).toEqual([]);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ selected: [] }));
  });
});
