import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import type { PlannerSettings } from '../domain/types';
import { STORE_SNAPSHOTS, STORE_SETTINGS, clear, readAll, remove, write, writeMany } from './db';

/**
 * 写库前补齐主键字段 `accountKey`（索引库 keyPath）。
 *
 * 云端旧快照 / 老备份没有这个派生字段，缺了 `put()` 会直接抛 DataError；
 * 这里统一补，调用方不用关心。
 */
export const withAccountKey = (snapshot: AccountSnapshot): AccountSnapshot =>
  snapshot.accountKey ? snapshot : { ...snapshot, accountKey: accountKeyOf(snapshot) };

export async function saveSnapshot(snapshot: AccountSnapshot): Promise<void> {
  await write(STORE_SNAPSHOTS, withAccountKey(snapshot));
}

export async function listSnapshots(): Promise<AccountSnapshot[]> {
  return (await readAll<AccountSnapshot>(STORE_SNAPSHOTS)).map(withAccountKey);
}

/** 按账号身份删除（accountKey = 游戏 UID，见 `domain/parseBackup.ts`）。 */
export async function removeSnapshot(accountKey: string): Promise<void> {
  await remove(STORE_SNAPSHOTS, accountKey);
}

/** 一键重置：清空所有账号快照，规划设置保留。 */
export async function clearAllSnapshots(): Promise<void> {
  await clear(STORE_SNAPSHOTS);
}

/**
 * 批量写入快照（主键是账号身份，同账号天然覆盖；一次事务，原子生效）。
 * 合并导入用：把合并后的完整列表写进去，本地独有与并入的账号都在里面。
 */
export async function writeSnapshots(snapshots: AccountSnapshot[]): Promise<void> {
  await writeMany(STORE_SNAPSHOTS, snapshots.map(withAccountKey));
}

export async function saveSettings(settings: PlannerSettings): Promise<void> {
  await write(STORE_SETTINGS, settings, 'planner');
}

export async function loadSettings(): Promise<PlannerSettings | null> {
  const all = await readAll<PlannerSettings>(STORE_SETTINGS);
  return all.length > 0 ? all[0] : null;
}
