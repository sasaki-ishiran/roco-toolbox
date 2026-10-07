import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { PlannerSettings } from '../domain/types';
import {
  clearAllSnapshots,
  loadSettings,
  listSnapshots,
  removeSnapshot,
  saveSettings,
  saveSnapshot,
  writeSnapshots,
} from './snapshots';

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
    nature: '开朗',
    voiceDb: 100,
    medalBody: '',
    isShiny: false,
    account: accountName,
  })),
  eggs: [],
});

const settings: PlannerSettings = {
  targetGroupIds: [2, 3],
  targetNaturesByGroup: { 2: [2, 28, 23] },
  naturesPerGroup: 3,
  selectedAccounts: ['账号A'],
};

describe('storage snapshots', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('locke-toolbox'); // 与 db.ts 的 DB_NAME 保持一致
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  test('保存后能读回', async () => {
    await saveSnapshot(makeSnapshot('账号A', 3));
    const list = await listSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0].accountName).toBe('账号A');
    expect(list[0].pets).toHaveLength(3);
  });

  test('同账号再保存一次只保留一份且精灵数取最新', async () => {
    await saveSnapshot(makeSnapshot('账号A', 3));
    await saveSnapshot(makeSnapshot('账号A', 5));
    const list = await listSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0].pets).toHaveLength(5);
  });

  test('删除后 listSnapshots 为空', async () => {
    await saveSnapshot(makeSnapshot('账号A', 3));
    await removeSnapshot(`uid:${gameIdOf('账号A')}`);
    expect(await listSnapshots()).toHaveLength(0);
  });

  test('同名但 UID 不同的两个账号可以并存（主键是 UID，不是账号名）', async () => {
    await saveSnapshot({ ...makeSnapshot('测试甲', 2), gameId: 111 });
    await saveSnapshot({ ...makeSnapshot('测试甲', 5), gameId: 222 });

    const list = await listSnapshots();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.gameId).sort()).toEqual([111, 222]);
  });

  test('v1 → v2 迁移：旧库（主键 = 账号名）的数据搬到新主键，一条不丢', async () => {
    // 手工建一个 v1 库（keyPath = accountName），模拟升级前用户本机的数据
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('locke-toolbox', 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore('snapshots', { keyPath: 'accountName' })
          .put({
            accountName: '测试甲',
            gameId: 1000001,
            exportedAt: '2026-09-25T00:00:00.000Z',
            importedAt: '2026-09-26T00:00:00.000Z',
            pets: [
              {
                gameId: 1,
                name: '精灵',
                gender: '母',
                nature: '开朗',
                voiceDb: 100,
                medalBody: '',
                isShiny: false,
                account: '测试甲',
              },
            ],
            eggs: [],
          });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    // 打开（自动升到 v2）后旧数据仍在，并带上新的主键字段
    const list = await listSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0].accountName).toBe('测试甲');
    expect(list[0].accountKey).toBe('uid:1000001');
    expect(list[0].pets).toHaveLength(1);
  });

  test('设置可保存并读回', async () => {
    expect(await loadSettings()).toBeNull();
    await saveSettings(settings);
    const loaded = await loadSettings();
    expect(loaded?.targetGroupIds).toEqual([2, 3]);
    expect(loaded?.naturesPerGroup).toBe(3);
  });

  test('一键重置清空所有账号快照，但保留规划设置', async () => {
    await saveSnapshot(makeSnapshot('账号A', 3));
    await saveSnapshot(makeSnapshot('账号B', 5));
    await saveSettings(settings);

    await clearAllSnapshots();

    expect(await listSnapshots()).toHaveLength(0);
    expect(await loadSettings()).not.toBeNull();
  });

  test('合并导入：逐条写入，同账号覆盖、别的账号保留', async () => {
    await saveSnapshot(makeSnapshot('平板的号', 1));
    await writeSnapshots([makeSnapshot('平板的号', 3), makeSnapshot('手机的号', 2)]);

    const list = await listSnapshots();
    expect(list.map((s) => s.accountName).sort()).toEqual(['平板的号', '手机的号']);
    expect(list.find((s) => s.accountName === '平板的号')?.pets).toHaveLength(3);
  });
});
