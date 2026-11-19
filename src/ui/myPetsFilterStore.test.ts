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
    localStorage.setItem(KEY, JSON.stringify({ selected: ['nature:开朗', 7, null] }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['nature:开朗']);
  });

  test('整体不是对象（如数组）也不抛错', async () => {
    localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual([]);
  });

  test('正常持久化能完整读回', async () => {
    localStorage.setItem(KEY, JSON.stringify({ selected: ['nature:开朗'] }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['nature:开朗']);
  });

  test('保留性别、体型、声音标签，并读取身高范围', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        selected: [
          'gender:母',
          'body:大块头',
          'body:满身高',
          'voice:满声',
          'nature:开朗',
          'eggGroup:2',
          'shiny:异色',
        ],
        heightRange: { min: 0, max: 0 },
      }),
    );

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual([
      'gender:母',
      'body:大块头',
      'body:满身高',
      'voice:+100',
      'voice:-100',
      'nature:开朗',
      'eggGroup:2',
      'shiny:异色',
    ]);
    expect(store.getMyPetsHeightRange()).toEqual({ min: 0, max: 0 });
  });

  test('奖牌 + 满身高并集标签重启后保留，不退化回身高范围', async () => {
    // 点已收集母本卡会同时写「奖牌 + 满身高」两个 body 标签（并集）；无身高范围字段。
    localStorage.setItem(
      KEY,
      JSON.stringify({ selected: ['body:大块头', 'body:满身高', 'voice:+100'] }),
    );

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['body:大块头', 'body:满身高', 'voice:+100']);
    // 并集口径下不再迁移成身高范围：默认全区间，筛选仍由两个标签的并集承担
    expect(store.getMyPetsHeightRange()).toEqual({ min: 0, max: 100 });
  });

  test('奖牌 + 零身高并集标签重启后保留', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ selected: ['body:小不点', 'body:零身高'] }),
    );

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['body:小不点', 'body:零身高']);
    expect(store.getMyPetsHeightRange()).toEqual({ min: 0, max: 100 });
  });

  test('迁移旧版极限聚合筛选为对应的独立奖牌', async () => {
    localStorage.setItem(KEY, JSON.stringify({ selected: ['body:极限', 'voice:极限'] }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual([
      'body:满体重',
      'body:零体重',
      'voice:+100',
      'voice:-100',
    ]);
  });

  test('把旧版满身高标签迁移为 100% 身高范围', async () => {
    localStorage.setItem(KEY, JSON.stringify({ selected: ['body:满身高'] }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual([]);
    expect(store.getMyPetsHeightRange()).toEqual({ min: 100, max: 100 });
  });

  test('更新并持久化身高范围', async () => {
    const store = await import('./myPetsFilterStore');
    store.setMyPetsHeightRange({ min: 25, max: 75 });

    expect(store.getMyPetsHeightRange()).toEqual({ min: 25, max: 75 });
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').heightRange).toEqual({ min: 25, max: 75 });
  });

  test('蛋组双组模式可持久化并能重置为多选', async () => {
    localStorage.setItem(KEY, JSON.stringify({ eggGroupMatchMode: 'dual' }));
    const store = await import('./myPetsFilterStore');

    expect(store.getMyPetsEggGroupMatchMode()).toBe('dual');
    store.setMyPetsEggGroupMatchMode('multi');
    expect(store.getMyPetsEggGroupMatchMode()).toBe('multi');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).not.toHaveProperty('eggGroupMatchMode');
    store.setMyPetsEggGroupMatchMode('dual');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').eggGroupMatchMode).toBe('dual');
    store.clearInventoryFilters();
    expect(store.getMyPetsEggGroupMatchMode()).toBe('multi');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ selected: [] });
  });

  test('存了已下线的账号标签：读取时丢弃，不再静默过滤列表', async () => {
    // 2026-10-05 起账号维度移到页面顶部，筛选面板里不再有账号标签；
    // 旧版本存下的 account:* 会变成「看不见、也点不掉」的条件（R2-4-M02）。
    localStorage.setItem(KEY, JSON.stringify({ selected: ['account:小号', 'nature:开朗'] }));

    const store = await import('./myPetsFilterStore');

    expect([...store.getMyPetsSelected()]).toEqual(['nature:开朗']);
  });

  test('身高和体重共用一个显示开关，并持久化', async () => {
    const store = await import('./myPetsFilterStore');
    expect(store.getMyPetsSizeUnit()).toBe('percent');

    store.setMyPetsSizeUnit('value');
    expect(store.getMyPetsSizeUnit()).toBe('value');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').sizeUnit).toBe('value');

    store.setMyPetsSizeUnit('percent');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).not.toHaveProperty('sizeUnit');
  });

  test('旧版身高 / 体重各自开关迁移成一个开关：任一边选过数值就保持数值', async () => {
    localStorage.setItem(KEY, JSON.stringify({ heightUnit: 'value', weightUnit: 'percent' }));

    const store = await import('./myPetsFilterStore');

    expect(store.getMyPetsSizeUnit()).toBe('value');
  });

  test('两边都是百分比时迁移后仍是百分比', async () => {
    localStorage.setItem(KEY, JSON.stringify({ heightUnit: 'percent', weightUnit: 'percent' }));

    const store = await import('./myPetsFilterStore');

    expect(store.getMyPetsSizeUnit()).toBe('percent');
  });

  test('重置筛选不动显示开关（百分比 / 数值只属于卡片显示）', async () => {
    const store = await import('./myPetsFilterStore');
    store.setMyPetsSizeUnit('value');

    store.clearInventoryFilters();

    expect(store.getMyPetsSizeUnit()).toBe('value');
  });
});

describe('重置只清精灵背包的标签', () => {
  test('重置后标签清空，且写回 localStorage', async () => {
    localStorage.clear();
    const s = await import('./myPetsFilterStore');
    s.setMyPetsSelected(new Set(['nature:开朗']));
    s.setMyPetsHeightRange({ min: 25, max: 75 });
    s.clearInventoryFilters();
    expect([...s.getMyPetsSelected()]).toEqual([]);
    expect(s.getMyPetsHeightRange()).toEqual({ min: 0, max: 100 });
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ selected: [] }));
  });
});
