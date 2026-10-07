/**
 * 云同步（跨设备一键同步，2026-10-06）
 *
 * 一份「全量快照」= 导入的账号数据（IndexedDB）+ 一部分偏好设置（localStorage 精选键），
 * gzip 后 base64 传给 `PUT /api/sync`；服务端做乐观锁（`baseVersion` 对不上 → 409）。
 * 日常用 `syncNow()` 一键对齐（拉云端 → 合并 → 推回），409 只会在两台"同时"写时出现。
 *
 * 刻意**不同步**：令牌 / 设备 id / 统计开关 / 更新弹窗已读（都是「这台设备自己的事」）。
 */
import pako from 'pako';
import { CATALOG_VERSION } from '../data/catalog';
import { mergeSnapshots } from '../domain/backup';
import type { AccountSnapshot } from '../domain/parseBackup';
import { listSnapshots, writeSnapshots } from '../storage/snapshots';
import { refreshSnapshots } from '../storage/snapshotStore';
import { API_BASE } from './analytics';
import { type CloudMeta, authFetch, markSynced, readSyncedVersion } from './session';

/** 跟着云端走的偏好键（其余 localStorage 键不动） */
export const SYNCED_PREF_KEYS = [
  'roco.targetMode',
  'roco.motherCriteria',
  'roco.motherPlan',
  'roco.myPetsFilter',
  'roco.coverageFilter',
  'roco.excludedAccounts',
  'roco.nestPins',
  'roco.petPageSize',
  'roco.copyPreviewOff',
] as const;

/**
 * 合并模式下**以云端为准**（直接覆盖本机同名键）的口径类偏好（2026-10-07）。
 *
 * 这几项决定"同一批账号数据算出来的数字"，两台不一致时会表现为"精灵/看板不一样"：
 * - `roco.targetMode`（追满分 / 追双牌）→ 母本声音口径（`effectiveMotherVoices`）
 * - `roco.motherCriteria`（母本达标标准：体型 / 声音）
 * - `roco.excludedAccounts`（账号筛选）→ 同时影响精灵列表与看板各卡的数字
 * - `roco.coverageFilter`（覆盖度筛选）：里面的**目标档位**是全局口径，**蛋组筛选**又决定
 *   种公全收集的分母 —— 两者存在同一个键里，只能整键跟随云端（用户 2026-10-07 拍板选这个）。
 *   代价是某台临时勾的蛋组/性格筛选，同步后会被云端那份顶掉。
 *
 * 其余 `SYNCED_PREF_KEYS`（分页、复制提示、我的精灵筛选、小窝钉选等）属于
 * "每台设备自己的显示习惯"，仍只补本机没有的键，不互相覆盖。
 */
export const CLOUD_WINS_PREF_KEYS: ReadonlySet<string> = new Set([
  'roco.targetMode',
  'roco.motherCriteria',
  'roco.excludedAccounts',
  'roco.coverageFilter',
]);

const SNAPSHOT_TYPE = 'roco-toolbox-cloud';

export interface CloudSnapshot {
  type: typeof SNAPSHOT_TYPE;
  version: number;
  savedAt: string;
  catalogVersion: string;
  accounts: AccountSnapshot[];
  prefs: Record<string, string>;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** 本地数据 → 云端快照 */
export async function buildSnapshot(): Promise<CloudSnapshot> {
  const accounts = await listSnapshots();
  const prefs: Record<string, string> = {};
  for (const key of SYNCED_PREF_KEYS) {
    const value = window.localStorage.getItem(key);
    if (value !== null) prefs[key] = value;
  }
  return {
    type: SNAPSHOT_TYPE,
    version: 1,
    savedAt: new Date().toISOString(),
    catalogVersion: CATALOG_VERSION,
    accounts,
    prefs,
  };
}

export function encodeSnapshot(snapshot: CloudSnapshot): string {
  return toBase64(pako.gzip(JSON.stringify(snapshot)));
}

export function decodeSnapshot(payload: string): CloudSnapshot {
  const parsed = JSON.parse(pako.ungzip(fromBase64(payload), { to: 'string' })) as CloudSnapshot;
  if (parsed?.type !== SNAPSHOT_TYPE) throw new Error('云端数据格式不对（可能是别的版本写的）');
  if (!Array.isArray(parsed.accounts)) throw new Error('云端数据里没有账号数据');
  return parsed;
}

/** 上传结果：成功给新版本号；冲突把云端元信息带回来（页面拿来展示并让用户选） */
export type UploadResult = { ok: true; version: number } | { ok: false; conflict: CloudMeta | null };

/** 把本机数据传到云端（以本机记录的云端版本为基准，冲突交给调用方处理） */
export async function uploadSnapshot(): Promise<UploadResult> {
  const snapshot = await buildSnapshot();
  const response = await authFetch('/api/sync', {
    method: 'PUT',
    body: JSON.stringify({
      baseVersion: readSyncedVersion(),
      payload: encodeSnapshot(snapshot),
      appVersion: typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '',
    }),
  });
  const data = (await response.json()) as {
    version?: number;
    error?: string;
    cloud?: CloudMeta | null;
  };
  if (response.status === 409) return { ok: false, conflict: data.cloud ?? null };
  if (!response.ok || typeof data.version !== 'number') {
    throw new Error(data.error ?? `上传失败（${response.status}）`);
  }
  markSynced(data.version);
  return { ok: true, version: data.version };
}

/** 从云端取回整份快照（没有则返回 null） */
export async function downloadSnapshot(): Promise<{ snapshot: CloudSnapshot; meta: CloudMeta } | null> {
  const response = await authFetch('/api/sync?full=1');
  const data = (await response.json()) as {
    snapshot?: (CloudMeta & { payload?: string }) | null;
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? '读取云端数据失败');
  if (!data.snapshot?.payload) return null;
  const snapshot = decodeSnapshot(data.snapshot.payload);
  return {
    snapshot,
    meta: { version: data.snapshot.version, updatedAt: data.snapshot.updatedAt, bytes: data.snapshot.bytes },
  };
}

export interface ApplyOptions {
  /**
   * 合并模式（默认开）：账号数据按 `mergeSnapshots` 合并——云端独有的并入、两边都有的取
   * 「数据时刻」较新的那份，**本机独有的账号保留**；偏好里，`CLOUD_WINS_PREF_KEYS`
   * 那几项口径类键以云端为准，其余只补本机没有的键。
   * 关掉才是「整份覆盖本机」（危险，只在用户明确选「用云端覆盖本机」时用）。
   */
  merge?: boolean;
}

/**
 * 把云端快照写到本机（账号数据 + 偏好）。
 * 偏好是模块级 store 在初始化时读进内存的，所以**恢复后需要刷新页面**才能真正生效
 * —— 调用方负责提示并刷新（见 AccountPanel）。
 */
export async function applySnapshot(
  snapshot: CloudSnapshot,
  meta?: CloudMeta,
  options: ApplyOptions = {},
): Promise<{ added: string[]; updated: string[]; prefsAdopted: string[] }> {
  const merge = options.merge !== false;
  let added: string[] = [];
  let updated: string[] = [];
  const prefsAdopted: string[] = [];
  if (merge) {
    // tieBreak: 'incoming' —— 平局（两边数据时刻相同、内容却不同）时采用**云端那份**。
    // 云端是两台设备共享的同一份源，拉云端这台必须跟着云端走；否则两台各留各的，
    // 表现为「精灵不一样」（2026-10-07 修）。
    const result = mergeSnapshots(await listSnapshots(), snapshot.accounts, { tieBreak: 'incoming' });
    added = result.added;
    updated = result.updated;
    await writeSnapshots(result.snapshots);
  } else {
    await writeSnapshots(snapshot.accounts);
  }
  await refreshSnapshots();
  for (const key of SYNCED_PREF_KEYS) {
    const value = snapshot.prefs?.[key];
    if (typeof value !== 'string') continue;
    const current = window.localStorage.getItem(key);
    // 口径类键（目标模式 / 母本达标标准 / 账号筛选）以云端为准——两台算出来的数字才对得上；
    // 其余键只补本机没有的（每台设备的显示/筛选习惯不同，别互相覆盖）
    if (merge && !CLOUD_WINS_PREF_KEYS.has(key) && current !== null) continue;
    if (current === value) continue;
    window.localStorage.setItem(key, value);
    prefsAdopted.push(key);
  }
  if (meta) markSynced(meta.version);
  return { added, updated, prefsAdopted };
}

/**
 * 一键同步：**拉云端 → 与本机合并 → 推回云端**，一个动作让两台设备对齐。
 *
 * 之所以要有它（2026-10-07）：原来的「上传 / 从云端恢复 / 冲突二选一」把一件事拆成三步，
 * 用户还得理解版本号与 409。现在正常情况只需要点一次「同步」，两边都等于并集。
 *
 * 唯一可能失败的情况：合并与推送之间别的设备又写了（乐观锁 409）——把冲突带回去让用户再点一次。
 */
export type SyncNowResult =
  | {
      ok: true;
      version: number;
      /** 本次并入本机的账号（云端有、本机没有） */
      added: string[];
      /** 本次用云端那份替换了本机的账号 */
      updated: string[];
      /**
       * 本次从云端补上的**本机没有设置键**（模块级 store 启动时才读，需要刷新页面才生效，
       * 调用方据此提示并刷新）。
       */
      prefsAdopted: string[];
      /** 云端本来没有数据，这次是把本机当作第一份传上去 */
      seeded: boolean;
    }
  | { ok: false; conflict: CloudMeta | null };

export async function syncNow(): Promise<SyncNowResult> {
  const cloud = await downloadSnapshot();
  if (!cloud) {
    const seeded = await uploadSnapshot();
    if (!seeded.ok) return { ok: false, conflict: seeded.conflict };
    return { ok: true, version: seeded.version, added: [], updated: [], prefsAdopted: [], seeded: true };
  }
  const { added, updated, prefsAdopted } = await applySnapshot(cloud.snapshot, cloud.meta);
  // applySnapshot 已把基准版本记成刚读到的云端版本 → 这里推的是合并后的完整数据
  const pushed = await uploadSnapshot();
  if (!pushed.ok) return { ok: false, conflict: pushed.conflict };
  return { ok: true, version: pushed.version, added, updated, prefsAdopted, seeded: false };
}

/** 本机数据规模（用于展示「要传多少」） */
export async function localSizeHint(): Promise<{ accounts: number; bytes: number }> {
  const snapshot = await buildSnapshot();
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  return { accounts: snapshot.accounts.length, bytes };
}

export { API_BASE };
