import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AccountSnapshot } from '../domain/parseBackup';
import { getLastImportHistory, getLastImportResult, resetLastImportForTest } from '../storage/lastImportStore';
import { resetSnapshotCacheForTest } from '../storage/snapshotStore';
import { clearAllSnapshots, listSnapshots, writeSnapshots } from '../storage/snapshots';
import { recordSyncedPets } from './syncAdditions';

/**
 * 云同步（含分享导入后的自动同步）带进来的精灵要进看板「本次新增」卡（2026-10-07 用户要求）：
 * 不然点完「立即同步」只看到「已同步」，不知道到底同步进来了什么。
 *
 * 这里验的是「同步前后比一遍」这一步（`syncNow` 本身在 api/sync.test.ts 里验）。
 */
const snapshotWith = (petName: string, voiceDb = 100): AccountSnapshot => ({
  accountName: '云端甲',
  gameId: 9001,
  exportedAt: '2026-10-07T00:00:00.000Z',
  importedAt: '2026-10-07T00:00:00.000Z',
  pets: [
    {
      gameId: 1,
      name: petName,
      gender: '母',
      nature: '开朗',
      voiceDb,
      medalBody: '大块头',
      isShiny: false,
      account: '云端甲',
      boxGroup: '盒子01',
      boxNumber: 1,
      slotOrder: 3,
    },
  ],
  eggs: [],
});

describe('recordSyncedPets', () => {
  beforeEach(async () => {
    await clearAllSnapshots();
    resetSnapshotCacheForTest();
    resetLastImportForTest();
    window.localStorage.clear();
  });

  test('同步合并进来的合格母本进「本次新增」，且不写导入历史', async () => {
    const before = await listSnapshots(); // 同步前：本机为空
    await writeSnapshots([snapshotWith('云端母本')]);

    await recordSyncedPets(before);

    const result = getLastImportResult();
    expect(result?.[0].accountName).toBe('云端甲');
    expect(result?.[0].mothers[0].motherClass).toBe('大婉');
    expect(result?.[0].mothers[0].pets[0].label).toBe('云端母本');
    // 同步不是导入 → 不写「导入历史（N 次）」
    expect(getLastImportHistory()).toEqual([]);
  });

  test('同步没带来合格新增 → 不动卡片（别用空卡盖掉上一次的导入结果）', async () => {
    const before = await listSnapshots();
    await writeSnapshots([snapshotWith('普通精灵', 10)]);

    await recordSyncedPets(before);

    expect(getLastImportResult()).toBeNull();
  });

  test('本机本来就有的精灵不算新增（同一份快照前后比 → 无变化）', async () => {
    await writeSnapshots([snapshotWith('云端母本')]);
    const before = await listSnapshots();

    await recordSyncedPets(before);

    expect(getLastImportResult()).toBeNull();
  });
});
