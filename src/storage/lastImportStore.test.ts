import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * 历史从 localStorage 读回。localStorage 被污染 / 版本升级改形状时，
 * readHistory 必须把形状不对的条目过滤掉——否则 ImportResultCard 对
 * `entry.results.map(...)`、`account.studs.reduce(...)` 的直接调用会让整个导入页崩掉。
 *
 * `history` 在模块加载时初始化，所以每个用例用 vi.resetModules + 动态 import
 * 触发 readHistory 重新执行。
 */
const KEY = 'roco.lastImportResults';

const validEntry = {
  at: '2026-10-06T08:00:00.000Z',
  results: [
    {
      accountName: '甲',
      accountKey: 'uid:1000001',
      isFirstImport: false,
      studs: [{ studClass: '大婉', pets: [] }],
      mothers: [],
    },
  ],
};

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('lastImportStore 历史读取', () => {
  test('JSON 损坏 → 空历史', async () => {
    localStorage.setItem(KEY, 'not-json');
    const store = await import('./lastImportStore');
    expect(store.getLastImportHistory()).toEqual([]);
  });

  test('整体不是数组 → 空历史', async () => {
    localStorage.setItem(KEY, JSON.stringify({ at: 1 }));
    const store = await import('./lastImportStore');
    expect(store.getLastImportHistory()).toEqual([]);
  });

  test('形状不对的条目被丢弃，正常条目保留', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { at: 123, results: [] }, // at 不是字符串
        { at: 'ok', results: 'nope' }, // results 不是数组
        'junk', // 根本不是对象
        // 条目内 studs 不是数组（ImportResultCard 会对它 reduce）
        { at: 'ok', results: [{ accountName: '乙', isFirstImport: true, studs: 'bad', mothers: [] }] },
        // 分组里没有 pets 数组（ImportResultCard 会 map 它取条数）
        {
          at: 'ok',
          results: [{ accountName: '丙', isFirstImport: true, studs: [{ studClass: '大婉' }], mothers: [] }],
        },
        validEntry,
      ]),
    );
    const store = await import('./lastImportStore');
    expect(store.getLastImportHistory()).toEqual([validEntry]);
  });

  test('正常历史能完整读回', async () => {
    localStorage.setItem(KEY, JSON.stringify([validEntry]));
    const store = await import('./lastImportStore');
    expect(store.getLastImportHistory()).toEqual([validEntry]);
  });

  test('clearLastImportHistory 清空历史并写回存储（重置导入数据时用）', async () => {
    localStorage.setItem(KEY, JSON.stringify([validEntry]));
    const store = await import('./lastImportStore');
    expect(store.getLastImportHistory()).toHaveLength(1);

    store.clearLastImportHistory();

    expect(store.getLastImportHistory()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();

    // 重新加载仍是空历史（存储里确实清掉了）
    vi.resetModules();
    const reloaded = await import('./lastImportStore');
    expect(reloaded.getLastImportHistory()).toEqual([]);
  });

  test('history: false 只更新最新结果，不写导入历史（云同步合并进来的新增用）', async () => {
    localStorage.setItem(KEY, JSON.stringify([validEntry]));
    const store = await import('./lastImportStore');
    expect(store.getLastImportHistory()).toEqual([validEntry]);

    const synced = [
      { accountName: '云端甲', accountKey: 'uid:1000001', isFirstImport: false, studs: [], mothers: [] },
    ];
    store.setLastImportResult(synced, { history: false });

    // 看板「本次新增」拿到同步结果……
    expect(store.getLastImportResult()).toEqual(synced);
    // ……但「导入历史」不动（同步不是导入）
    expect(store.getLastImportHistory()).toEqual([validEntry]);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify([validEntry]));
  });
});
