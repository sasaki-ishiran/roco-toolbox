import type { OwnedPet } from './types';

export interface BackupEgg {
  petName: string;
  weightGrams: number;
  obtainedAt: string;
}

export interface AccountSnapshot {
  accountName: string;
  gameId: number;
  /**
   * 账号身份（存储主键）。**派生字段**：由 `accountKeyOf()` 从 `gameId`（游戏 UID）算出来，
   * 写库前统一补齐（见 `storage/snapshots.ts` 的 `withAccountKey`）。
   * 老备份 / 云端旧快照可能没有这个字段，逻辑里一律用 `accountKeyOf()` 现算，不要直接读它。
   */
  accountKey?: string;
  exportedAt: string;
  importedAt: string;
  pets: OwnedPet[];
  eggs: BackupEgg[];
}

/**
 * 账号身份键：**游戏 UID 是唯一的**，所以优先用它。
 *
 * 2026-10-06 改：此前账号身份就是账号名，两个重名但不同 UID 的真实账号会互相顶掉
 * （导入第二份时被判成「重名冲突」而丢弃，且重新导入也救不回来）。改成 UID 之后
 * 两个账号可以并存；没有 UID 的老数据才退回账号名。
 */
export const accountKeyOf = (snapshot: { accountName: string; gameId: number }): string =>
  snapshot.gameId > 0 ? `uid:${snapshot.gameId}` : `name:${snapshot.accountName}`;

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown): boolean => value === true;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function parseBackup(raw: unknown, importedAt: string): AccountSnapshot {
  const root = asRecord(raw);
  if (!root) throw new Error('不是有效的抓包备份文件（缺少顶层对象）');

  const meta = asRecord(root.meta);
  if (!meta || meta.type !== 'hatch-backup') {
    throw new Error('不是有效的抓包备份文件（meta.type 不是 hatch-backup）');
  }

  const collections = asRecord(root.collections);
  const petBackpack = collections ? asRecord(collections.petBackpack) : undefined;
  const items = petBackpack ? petBackpack.items : undefined;
  if (!Array.isArray(items)) {
    throw new Error('不是有效的抓包备份文件（缺少 collections.petBackpack.items）');
  }

  const accountName = asString(meta.playerName, asString(meta.gameId, '未知账号'));
  const gameId = asNumber(meta.gameId);

  const pets: OwnedPet[] = [];
  for (const rawItem of items) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const gender = normalizeGender(asString(item.gender));
    // 没有 name 就没有可读标识（显示名、搜索、清单全靠它）→ 丢弃该条，
    // 与 backup.ts 的 sanitizePet 保持同一清洗口径，避免「幽灵精灵」进库
    const name = asString(item.name);
    if (!name) continue;
    pets.push({
      gameId: asNumber(item.speciesPetId),
      name,
      captureId: asOptionalString(item.id),
      gender,
      nature: asString(item.nature),
      voiceDb: asNumber(item.voiceDb),
      medalBody: asString(item.medalBody),
      weightPercent: asOptionalNumber(item.weightPercent),
      isShiny: asBoolean(item.isShiny),
      // 炫彩：直接从导入内容读（备份 JSON 里是平铺的 isColorful 字段）——用户拍板不依赖采集器新字段
      isColorful: item.isColorful === true,
      account: accountName,
      boxGroup: asOptionalString(item.group),
      boxNumber: asOptionalNumber(item.boxNumber),
      slotOrder: asOptionalNumber(item.slotOrder),
    });
  }

  const eggInventory = collections ? asRecord(collections.eggInventory) : undefined;
  const eggsRaw = eggInventory ? eggInventory.eggs : undefined;
  const eggs: BackupEgg[] = Array.isArray(eggsRaw)
    ? eggsRaw
        .map((rawEgg) => asRecord(rawEgg))
        .filter((egg): egg is UnknownRecord => egg != null)
        .map((egg) => ({
          petName: asString(egg.petName),
          weightGrams: asNumber(egg.weightGrams),
          obtainedAt: asString(egg.obtainedAt),
        }))
    : [];

  return {
    accountName,
    gameId,
    accountKey: accountKeyOf({ accountName, gameId }),
    exportedAt: asString(meta.exportedAt),
    importedAt,
    pets,
    eggs,
  };
}

function normalizeGender(value: string): OwnedPet['gender'] {
  if (value === '公' || value === '母' || value === '未知') return value;
  return '未知';
}
