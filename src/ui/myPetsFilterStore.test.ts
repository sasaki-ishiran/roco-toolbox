import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * 筛选状态存在 localStorage 的 `roco.myPetsFilter`，用户手改 / 旧版本数据都可能
 * 把字段写成非数组。模块顶层会用 `new Set(...)` 读它——脏值会让模块求值直接抛错，
 * 应用白屏且无法自愈。这里验证各种脏值都退回空筛选。
 */
const KEY = 'roco.myPetsFilter';

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('myPetsFilterStore 持久化读取', () => {
  test('字段被污染成非数组时不抛错，退回空筛选', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ selected: 5, studGrades: {}, studNatures: 'x', studGroups: null }),
    );

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual([]);
    expect([...store.getStudGrades()]).toEqual([]);
    expect([...store.getStudNatures()]).toEqual([]);
    expect([...store.getStudGroups()]).toEqual([]);
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
    localStorage.setItem(
      KEY,
      JSON.stringify({ selected: ['body:大块头'], studGrades: ['大婉'], studNatures: ['固执'] }),
    );

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['body:大块头']);
    expect([...store.getStudGrades()]).toEqual(['大婉']);
    expect([...store.getStudNatures()]).toEqual(['固执']);
  });
});
