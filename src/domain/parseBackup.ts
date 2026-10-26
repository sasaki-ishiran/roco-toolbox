import type { OwnedPet } from './types';
import { species } from '../data/catalog';
import { bodyMedalOf, heightPercentOf } from '../shared/bodySize.js';

const bodySizeByGameId = new Map(species.map((entry) => [entry.gameId, entry.bodySize]));
const heightSizeByGameId = new Map(species.map((entry) => [entry.gameId, entry.heightSize]));

/**
 * 体重百分位（与抓包解析器同一口径）：大块头阈值对应 98%，小不点阈值对应 2%。
 *
 * 采集器的图鉴没有收录的新物种（例如刚补进来的云梦豚）给不出百分位，
 * 这里用我们自己的图鉴补算，否则「差一点到 98%」的放宽判定无从判断。
 */
function weightPercentOf(size: { small: number; big: number } | undefined, weightKg: number | undefined): number | undefined {
  if (!size || typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0) return undefined;
  const span = (size.big - size.small) / 0.96;
  if (!(span > 0)) return undefined;
  const percent = ((weightKg - (size.small - span * 0.02)) / span) * 100;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

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
    const gameId = asNumber(item.speciesPetId);
    const weightKg = typeof item.weightGrams === 'number' && Number.isFinite(item.weightGrams) && item.weightGrams > 0
      ? item.weightGrams / 1000
      : asOptionalNumber(item.weightKg);
    const size = bodySizeByGameId.get(gameId);
    pets.push({
      gameId,
      name,
      captureId: asOptionalString(item.id),
      gender,
      nature: asString(item.nature),
      voiceDb: asNumber(item.voiceDb),
      medalBody: asString(item.medalBody) || bodyMedalOf(size, weightKg),
      weightPercent: asOptionalNumber(item.weightPercent) ?? weightPercentOf(size, weightKg),
      // 身高百分位（2026-10-26）：抓包条目自带 heightCm（厘米），按我们图鉴的身高区间换算。
      // 老抓包没有该字段 → 留空，合格判定自动退回「只看体重奖牌」的原口径。
      heightPercent:
        asOptionalNumber(item.heightPercent) ??
        heightPercentOf(heightSizeByGameId.get(gameId), asOptionalNumber(item.heightCm)) ??
        undefined,
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
