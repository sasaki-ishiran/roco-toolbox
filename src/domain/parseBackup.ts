import type { HomeEgg, HomeNest, HomePair, HomePosition, HomeResident, HomeSnapshot, OwnedPet } from './types';
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
  // 两位小数：95% 是「够不够格当亲本」的硬边界，一位小数会把 94.96% 舍成 95%。
  return Math.round(Math.min(100, Math.max(0, percent)) * 100) / 100;
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
  /** 家园场景快照（抓包里带出来的住户/小窝/配对/地上的蛋）；没有采集过家园时为空。 */
  home?: HomeSnapshot;
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

const asPosition = (value: unknown): HomePosition | undefined => {
  const item = asRecord(value);
  if (!item) return undefined;
  const x = asOptionalNumber(item.x);
  const y = asOptionalNumber(item.y);
  const z = asOptionalNumber(item.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
};

const asNestType = (value: unknown): HomeNest['nestType'] =>
  value === 'ordinary' || value === 'academy' ? value : null;

/**
 * 家园快照清洗：只接受「有住户或有小窝」的对象。
 * 外部备份 / 云端旧快照都走这里，坏条目逐条丢弃，不让整份导入失败。
 */
export function parseHomeSnapshot(value: unknown): HomeSnapshot | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const residentsRaw = Array.isArray(raw.residents) ? raw.residents : [];
  const nestsRaw = Array.isArray(raw.nests) ? raw.nests : [];
  if (residentsRaw.length === 0 && nestsRaw.length === 0) return undefined;

  const nests: HomeNest[] = nestsRaw
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => item != null)
    .map((item) => ({
      furnitureGuid: asString(item.furnitureGuid),
      configId: asNumber(item.configId),
      nestType: asNestType(item.nestType),
      nestName: asString(item.nestName),
      residentIds: Array.isArray(item.residentIds)
        ? item.residentIds.map((id) => String(id)).filter(Boolean)
        : [],
      roomId: asOptionalNumber(item.roomId),
      roomName: asOptionalString(item.roomName),
      position: asPosition(item.position),
    }))
    .filter((item) => item.furnitureGuid);

  const residents: HomeResident[] = residentsRaw
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => item != null)
    .map((item) => {
      const nestRaw = asRecord(item.nest);
      return {
        instanceId: asString(item.instanceId) || asString(item.gid),
        baseId: asString(item.baseId),
        confId: asOptionalNumber(item.confId),
        furnitureGuid: asString(item.furnitureGuid),
        actorId: asString(item.actorId),
        name: asString(item.name) || asString(item.petName),
        nature: asOptionalString(item.nature),
        gender: asString(item.gender) === '公' || asString(item.gender) === '母'
          ? (asString(item.gender) as '公' | '母')
          : undefined,
        position: asPosition(item.position),
        nest: nestRaw
          ? {
              furnitureGuid: asString(nestRaw.furnitureGuid),
              configId: asNumber(nestRaw.configId),
              nestType: asNestType(nestRaw.nestType),
              nestName: asString(nestRaw.nestName),
              roomId: asOptionalNumber(nestRaw.roomId),
              roomName: asOptionalString(nestRaw.roomName),
              position: asPosition(nestRaw.position),
            }
          : null,
      };
    })
    .filter((item) => item.instanceId);

  const layEggCouples: HomePair[] = (Array.isArray(raw.layEggCouples) ? raw.layEggCouples : [])
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => item != null)
    .map((item) => ({
      femaleActorId: asString(item.femaleActorId),
      maleActorIds: Array.isArray(item.maleActorIds)
        ? item.maleActorIds.map((id) => String(id)).filter(Boolean)
        : [],
    }))
    .filter((item) => item.femaleActorId && item.maleActorIds.length > 0);

  const sceneEggs: HomeEgg[] = (Array.isArray(raw.sceneEggs) ? raw.sceneEggs : [])
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => item != null)
    .map((item) => ({
      actorId: asString(item.actorId),
      furnitureGuid: asString(item.furnitureGuid),
      npcConfigId: asOptionalNumber(item.npcConfigId) ?? null,
    }))
    .filter((item) => item.actorId);

  return {
    schemaVersion: 1,
    gameId: asString(raw.gameId),
    capturedAt: asString(raw.capturedAt),
    homeLevel: asOptionalNumber(raw.homeLevel) ?? null,
    roomLevel: asOptionalNumber(raw.roomLevel) ?? null,
    residents,
    nests,
    layEggCouples,
    sceneEggs,
    couplesStale: asBoolean(raw.couplesStale),
    snapshotKind:
      raw.snapshotKind === 'delta' ? 'delta' : raw.snapshotKind === 'full' ? 'full' : undefined,
  };
}

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

  const home = parseHomeSnapshot(meta.captureHome ?? meta.home);
  return {
    accountName,
    gameId,
    accountKey: accountKeyOf({ accountName, gameId }),
    exportedAt: asString(meta.exportedAt),
    importedAt,
    pets,
    eggs,
    ...(home ? { home } : {}),
  };
}

function normalizeGender(value: string): OwnedPet['gender'] {
  if (value === '公' || value === '母' || value === '未知') return value;
  return '未知';
}
