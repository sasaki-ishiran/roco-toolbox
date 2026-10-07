import type { TargetMode } from './petFilters';
import { accountKeyOf, type AccountSnapshot } from './parseBackup';
import type { OwnedPet } from './types';

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

const normalizeGender = (value: string): OwnedPet['gender'] =>
  value === '公' || value === '母' || value === '未知' ? value : '未知';

/**
 * 单只宠物条目清洗（2026-10-06 修复 m3）：备份 JSON 是外部输入，单条损坏
 * （null / 数字 / 缺 name）不能整组 pets 全部跟着失效，也不能把坏对象
 * 原样塞进领域层。字段口径与 parseBackup 完全一致；无 name 的条目丢弃
 * （name 是精灵的唯一可读标识，没有它领域逻辑全部失明）。
 */
const sanitizePet = (value: unknown, accountName: string): OwnedPet | undefined => {
  const item = asRecord(value);
  if (!item) return undefined;
  const name = asString(item.name);
  if (!name) return undefined;
  return {
    gameId: asNumber(item.gameId),
    name,
    captureId: asOptionalString(item.captureId),
    gender: normalizeGender(asString(item.gender)),
    nature: asString(item.nature),
    voiceDb: asNumber(item.voiceDb),
    medalBody: asString(item.medalBody),
    weightPercent: asOptionalNumber(item.weightPercent),
    isShiny: asBoolean(item.isShiny),
    isColorful: item.isColorful === true,
    account: accountName,
    boxGroup: asOptionalString(item.boxGroup),
    boxNumber: asOptionalNumber(item.boxNumber),
    slotOrder: asOptionalNumber(item.slotOrder),
  };
};

/** 备份文件类型标记，用来和抓包文件区分 */
export const BACKUP_TYPE = 'roco-toolbox-backup';
/** 旧版本的标记：仍接受，避免早期导出的备份文件打不开 */
const LEGACY_BACKUP_TYPES = ['locke-toolbox-backup'];
export const BACKUP_VERSION = 1;

export interface ToolboxBackup {
  type: typeof BACKUP_TYPE;
  version: number;
  exportedAt: string;
  catalogVersion: string;
  accounts: AccountSnapshot[];
  /** 目标模式（可选）：导入时本地优先，本机从没选过才采用备份里的值 */
  targetMode?: TargetMode;
  /** 「计划收集」的链 key（可选）：多设备合并取并集 */
  motherPlan?: string[];
}

export function buildBackup(
  snapshots: AccountSnapshot[],
  options: {
    exportedAt: string;
    catalogVersion: string;
    targetMode?: TargetMode;
    motherPlan?: readonly string[];
  },
): ToolboxBackup {
  return {
    type: BACKUP_TYPE,
    version: BACKUP_VERSION,
    exportedAt: options.exportedAt,
    catalogVersion: options.catalogVersion,
    accounts: snapshots,
    ...(options.targetMode ? { targetMode: options.targetMode } : {}),
    ...(options.motherPlan && options.motherPlan.length > 0
      ? { motherPlan: [...options.motherPlan] }
      : {}),
  };
}

/** 备份文件名，例如 洛克工具箱备份-2026-09-26.json */
export function backupFileName(exportedAt: string): string {
  return `洛克工具箱备份-${exportedAt.slice(0, 10)}.json`;
}

export function isToolboxBackup(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const type = (raw as { type?: unknown }).type;
  return type === BACKUP_TYPE || LEGACY_BACKUP_TYPES.includes(String(type));
}

/**
 * 解析备份文件。不是备份文件、或里面没有账号数据时抛出可读错误。
 */
export function parseToolboxBackup(raw: unknown): ToolboxBackup {
  if (!isToolboxBackup(raw)) {
    throw new Error('这不是洛克工具箱的备份文件（缺少 type 标记）');
  }
  const backup = raw as Partial<ToolboxBackup>;
  if (!Array.isArray(backup.accounts)) {
    throw new Error('备份文件里没有账号数据（accounts）');
  }
  // 2026-10-06 修复（m3）：pets 数组里的单条坏数据（null / 类型不对 / 缺 name）
  // 逐只清洗，坏条目丢弃，而不是让整份备份失效或把坏对象带进领域层。
  // 账号级字段也要**显式归一化**（不能 `...account` 原样带过去）：外部备份可能缺 / 写错
  // gameId，脏值会让 mergeSnapshots 把同一账号误判成「重名不同账号」，静默丢掉较新的备份。
  const accounts = backup.accounts
    .filter(
      (account): account is AccountSnapshot =>
        typeof account === 'object' &&
        account !== null &&
        typeof (account as AccountSnapshot).accountName === 'string' &&
        Array.isArray((account as AccountSnapshot).pets),
    )
    .map((account) => {
      const raw = account as unknown as Record<string, unknown>;
      const gameId = asNumber(raw.gameId);
      return {
        accountName: account.accountName,
        gameId,
        accountKey: accountKeyOf({ accountName: account.accountName, gameId }),
        exportedAt: asString(raw.exportedAt),
        importedAt: asString(raw.importedAt),
        pets: account.pets
          .map((pet) => sanitizePet(pet, account.accountName))
          .filter((pet): pet is OwnedPet => pet !== undefined),
        eggs: Array.isArray(raw.eggs) ? (raw.eggs as AccountSnapshot['eggs']) : [],
      };
    });
  if (accounts.length === 0) {
    throw new Error('备份文件里没有可用的账号数据');
  }
  return {
    type: BACKUP_TYPE,
    version: typeof backup.version === 'number' ? backup.version : BACKUP_VERSION,
    exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : '',
    catalogVersion: typeof backup.catalogVersion === 'string' ? backup.catalogVersion : '',
    accounts,
    targetMode:
      backup.targetMode === 'perfect' || backup.targetMode === 'medal'
        ? backup.targetMode
        : undefined,
    motherPlan: Array.isArray(backup.motherPlan)
      ? backup.motherPlan.filter((key): key is string => typeof key === 'string')
      : undefined,
  };
}

export interface MergeResult {
  /** 合并后的完整快照列表：按账号身份（游戏 UID）唯一 */
  snapshots: AccountSnapshot[];
  /** 本地没有、备份里有的账号 */
  added: string[];
  /** 两边都有、备份里的更新 → 已用备份替换 */
  updated: string[];
  /** 两边都有、本地的更新或时间无法比较 → 保留本地 */
  kept: string[];
}

export interface MergeOptions {
  /**
   * 两边「数据时刻」**完全相同**（平局）时用哪一份：
   * - `'local'`（默认）：保留本机。备份 / 抓包导入沿用——反复导入同一份不会变成「更新」，
   *   也不用来路不明的文件覆盖本机。
   * - `'incoming'`：用对方那份。**云同步专用**（2026-10-07 修）：云端是两台设备共享的同一份源，
   *   拉云端那台必须采用云端那份；否则两边各留各的、永远合不到一起。
   *   注意「平局」不等于「数据相同」——同一账号在两边各采一份时，采集器很可能给出完全相同的时间戳，
   *   但内容不同，这正是跨设备出现「精灵不一样」的那种情况。
   */
  tieBreak?: 'local' | 'incoming';
}

/** 解析时间戳；空值或非法值返回 null（表示不可比较） */
const parseTime = (value: string | undefined): number | null => {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : null;
};

/**
 * 一份快照的「数据时刻」：优先取抓包自己的导出时间（`meta.exportedAt`，
 * 数据是什么时候采的），取不到才退回本机导入时间。
 *
 * 不能直接用 `importedAt`：它是**本机导入那一刻**，今天重新导入一份很旧的抓包
 * 也会拿到最新时间，从而顶掉另一台设备更完整的数据（跨设备最容易踩的坑）。
 */
const freshness = (snapshot: AccountSnapshot): number | null =>
  parseTime(snapshot.exportedAt) ?? parseTime(snapshot.importedAt);

/**
 * 把另一台设备的备份合并进本地数据（多设备用）。
 *
 * 规则：
 * - **账号身份 = 游戏 UID**（`accountKeyOf`），不是账号名：两个重名但不同 UID 的
 *   真实账号是两个账号，两边都保留（2026-10-06 改；此前按账号名比，第二份会被丢弃）。
 *   游戏内改过名、UID 不变 → 仍算同一个账号，按下面的时间规则取较新的那份。
 * - 备份里独有的账号 → 并入；
 * - **本地独有的账号 → 保留**（这是与旧「导入备份」最大的差别：旧实现是清空后覆盖，
 *   在平板上导入手机的备份会把平板自己的数据清掉）；
 * - 两边都有 → 比「数据时刻」（抓包的 `exportedAt`，见 freshness）较新的那份生效。
 *   一份快照就是「该账号在那一刻的全量」，所以取较新的与现有语义一致；
 *   求并集会让已经放生掉的精灵「复活」；
 * - 时间不可比较（缺失 / 不合法）→ 保留本地，不用来路不明的数据覆盖本地；
 * - 时间相同（平局）→ 默认保留本地（导入用）；云同步传 `tieBreak: 'incoming'` 取云端那份
 *   （见 `MergeOptions`，2026-10-07 修跨设备不收敛）。
 */
export function mergeSnapshots(
  local: AccountSnapshot[],
  incoming: AccountSnapshot[],
  options: MergeOptions = {},
): MergeResult {
  const preferIncomingOnTie = options.tieBreak === 'incoming';
  const byKey = new Map<string, AccountSnapshot>();
  for (const snapshot of local) byKey.set(accountKeyOf(snapshot), snapshot);

  /**
   * 找本地对应的账号。主键（UID）对不上时，**只在任一方缺 UID 时**按账号名兜底——
   * 两方都有 UID 且不同，就是两个重名的真实账号，不能并（那正是要修掉的旧行为）。
   */
  const findLocal = (
    snapshot: AccountSnapshot,
  ): { key: string; snapshot: AccountSnapshot } | undefined => {
    const key = accountKeyOf(snapshot);
    const direct = byKey.get(key);
    if (direct) return { key, snapshot: direct };
    for (const [localKey, candidate] of byKey) {
      if (candidate.accountName !== snapshot.accountName) continue;
      if (snapshot.gameId <= 0 || candidate.gameId <= 0) return { key: localKey, snapshot: candidate };
    }
    return undefined;
  };

  const added: string[] = [];
  const updated: string[] = [];
  const kept: string[] = [];

  for (const snapshot of incoming) {
    const key = accountKeyOf(snapshot);
    const found = findLocal(snapshot);
    if (!found) {
      byKey.set(key, snapshot);
      added.push(snapshot.accountName);
      continue;
    }
    const localTime = freshness(found.snapshot);
    const incomingTime = freshness(snapshot);
    // 平局（时间相同）默认算「保留本机」；云同步路径要求取云端那份（否则两边各留各的）
    const keepLocal =
      localTime === null ||
      incomingTime === null ||
      incomingTime < localTime ||
      (incomingTime === localTime && !preferIncomingOnTie);
    if (keepLocal) {
      kept.push(snapshot.accountName);
      continue;
    }
    // 老数据（无 UID）被带 UID 的新数据顶掉时，主键会从 name: 变成 uid: → 把旧键删掉，别留两份
    if (found.key !== key) byKey.delete(found.key);
    byKey.set(key, snapshot);
    updated.push(snapshot.accountName);
  }

  return { snapshots: [...byKey.values()], added, updated, kept };
}
