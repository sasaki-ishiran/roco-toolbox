import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountSnapshot } from '../domain/parseBackup';
import { getCachedSnapshots, refreshSnapshots, resetSnapshotCacheForTest, subscribeSnapshots } from './snapshotStore';
import { saveSnapshot } from './snapshots';

// M5：只劫持 listSnapshots（saveSnapshot 等保持真实实现），默认委托给原实现
const listSnapshotsMock = vi.hoisted(() => vi.fn());
vi.mock('./snapshots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./snapshots')>();
  listSnapshotsMock.mockImplementation(
    (...args: Parameters<typeof actual.listSnapshots>) => actual.listSnapshots(...args),
  );
  return {
    ...actual,
    listSnapshots: (...args: Parameters<typeof actual.listSnapshots>) => listSnapshotsMock(...args),
  };
});

/** 账号名 → 稳定的假 UID（真实场景 UID 唯一；测试里按名字派生，保证不同账号不同主键） */
const gameIdOf = (name: string): number =>
  [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 7);

const makeSnapshot = (accountName: string, count: number): AccountSnapshot => ({
  accountName,
  gameId: gameIdOf(accountName),
  exportedAt: '2026-09-25T00:00:00.000Z',
  importedAt: '2026-09-26T00:00:00.000Z',
  pets: Array.from({ length: count }, (_, i) => ({
    gameId: i,
    name: `精灵${i}`,
    gender: '母' as const,
    nature: '固执',
    voiceDb: 100,
    medalBody: '大块头',
    isShiny: false,
    account: accountName,
  })),
  eggs: [],
});

describe('snapshotStore', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('locke-toolbox'); // 与 db.ts 的 DB_NAME 保持一致
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    resetSnapshotCacheForTest();
  });

  test('第一次加载后进入缓存，切页签可以直接取用', async () => {
    await saveSnapshot(makeSnapshot('账号A', 2));
    expect(getCachedSnapshots()).toBeNull();

    const loaded = await refreshSnapshots();

    expect(loaded).toHaveLength(1);
    expect(getCachedSnapshots()).toHaveLength(1);
  });

  test('刷新会通知订阅者（导入 / 重置后页面能同步）', async () => {
    await saveSnapshot(makeSnapshot('账号A', 3));
    const seen: number[] = [];
    const unsubscribe = subscribeSnapshots((list) => seen.push(list.length));

    await refreshSnapshots();
    unsubscribe();

    expect(seen).toEqual([1]);
  });

  test('刷新失败不污染缓存，重试能恢复（M5：inFlight 失败后被清空）', async () => {
    await saveSnapshot(makeSnapshot('账号A', 1));
    expect(getCachedSnapshots()).toBeNull();

    listSnapshotsMock.mockRejectedValueOnce(new Error('db 打不开'));
    await expect(refreshSnapshots()).rejects.toThrow('db 打不开');
    expect(getCachedSnapshots()).toBeNull(); // 失败的那次不写缓存

    const retried = await refreshSnapshots(); // inFlight 已清空 → 真正重读
    expect(retried).toHaveLength(1);
    expect(getCachedSnapshots()).toHaveLength(1);
  });

  test('读到一半又发生写入：第二次 refresh 必须读到写之后的数据（不复用旧读）', async () => {
    await saveSnapshot(makeSnapshot('账号A', 1));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 第一次读挂起，并固定返回「写入之前」那一刻的库内容
    listSnapshotsMock.mockImplementationOnce(async () => {
      await gate;
      return [makeSnapshot('账号A', 1)];
    });

    const first = refreshSnapshots();
    await saveSnapshot(makeSnapshot('账号B', 1)); // 写入正好发生在第一次读途中
    const second = refreshSnapshots(); // 这次调用必须能读到 账号B
    release();

    expect((await first).map((s) => s.accountName)).toEqual(['账号A']);
    expect(
      (await second)
        .map((s) => s.accountName)
        .sort(),
    ).toEqual(['账号A', '账号B']);
  });
});
