import { trackPlacementMark } from '../api/analytics';
import {
  demandKeyOf,
  type DemandBody,
  type DemandGender,
  type DemandVoice,
} from '../shared/collectionGroups';

/**
 * 「已上窝」本机记忆（需求中心二期）。
 *
 * 只记本机：不改云端需求状态，结单仍然在小组的需求中心做。
 * 键带「接单时间」——服务端撤回是整行删除、重发后版本号从 0 重计，
 * 只有每次接单刷新的 claimedAt 能保证同款需求重发不继承旧的勾选。
 */
export interface PlacementRow {
  groupId: string;
  demanderAccountId: string;
  eggGameId: number;
  nature: string;
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
  /** 我接下这单的时间（即单上的 updatedAt）；持有期间不变，每次重接都刷新。 */
  claimedAt?: number;
}

export type PlacementMarks = Record<string, boolean>;

/** 手动挑的候选配对：记个体号，方案重算后仍认得出是哪一对（2026-11-01）。 */
export interface PlacementChoice {
  motherCaptureId: string;
  fatherCaptureId: string;
}

export type PlacementChoices = Record<string, PlacementChoice>;

const KEY_PREFIX = 'roco.demandPlacements:';
const CHOICE_KEY_PREFIX = 'roco.demandPlacementChoice:';
const COLLAPSED_KEY = 'roco.demandCollapsedAccounts';

export function placementRowKey(row: PlacementRow): string {
  const base = demandKeyOf({
    eggGameId: row.eggGameId,
    nature: row.nature,
    gender: row.gender,
    body: row.body,
    voice: row.voice,
  });
  return `${row.groupId}|${row.demanderAccountId}|${base}|${row.claimedAt ?? 0}`;
}

export function readPlacementMarks(accountId: string | null): PlacementMarks {
  if (!accountId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + accountId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as PlacementMarks) : {};
  } catch {
    return {};
  }
}

export function togglePlacementMark(
  accountId: string,
  rowKey: string,
  placed: boolean,
): PlacementMarks {
  const marks = readPlacementMarks(accountId);
  if (placed) marks[rowKey] = true;
  else delete marks[rowKey];
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY_PREFIX + accountId, JSON.stringify(marks));
    } catch {
      // 隐私模式 / 配额满：记不住不影响本次勾选（同 lastTab.ts / demandPickStore.ts）
    }
  }
  // 只有「勾上窝」算一次上窝动作；取消勾选不报（2026-11-08 埋点）
  if (placed) trackPlacementMark(Object.keys(marks).length);
  return { ...marks };
}

const isPlacementChoice = (value: unknown): value is PlacementChoice => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.motherCaptureId === 'string' && typeof record.fatherCaptureId === 'string';
};

/** 手动挑的候选配对（按行键）：重进页面时还按它显示；旧值一律当没挑过。 */
export function readPlacementChoices(accountId: string | null): PlacementChoices {
  if (!accountId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CHOICE_KEY_PREFIX + accountId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const choices: PlacementChoices = {};
    for (const [rowKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPlacementChoice(value)) choices[rowKey] = value;
    }
    return choices;
  } catch {
    return {};
  }
}

export function writePlacementChoice(
  accountId: string,
  rowKey: string,
  choice: PlacementChoice | null,
): PlacementChoices {
  const choices = readPlacementChoices(accountId);
  if (choice) choices[rowKey] = choice;
  else delete choices[rowKey];
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CHOICE_KEY_PREFIX + accountId, JSON.stringify(choices));
    } catch {
      // 存不下只是下次打开回到第一组（同 demandPickStore.ts）
    }
  }
  return { ...choices };
}

/** 接单上窝页里手动收起的账号（accountKey），下次打开仍然收起；按云身份分开记。 */
export function readCollapsedAccounts(accountId: string | null): string[] {
  if (!accountId || typeof window === 'undefined') return [];
  const parse = (raw: string | null): string[] => {
    try {
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return [];
    }
  };
  // 旧版本只有一个全局键：读一次迁到当前身份下，然后清掉（R2-2-L04）
  const legacy = window.localStorage.getItem(COLLAPSED_KEY);
  if (legacy != null) {
    const migrated = parse(legacy);
    try {
      window.localStorage.setItem(COLLAPSED_KEY + ':' + accountId, JSON.stringify(migrated));
      window.localStorage.removeItem(COLLAPSED_KEY);
    } catch {
      // 迁移失败就继续用旧键
    }
    return migrated;
  }
  return parse(window.localStorage.getItem(COLLAPSED_KEY + ':' + accountId));
}

export function writeCollapsedAccounts(accountId: string, accountKeys: readonly string[]): void {
  if (!accountId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      COLLAPSED_KEY + ':' + accountId,
      JSON.stringify([...new Set(accountKeys)]),
    );
  } catch {
    // 存不下只是下次打开不再收起
  }
}

/** 重置本机数据时清掉当前云身份的「已上窝」勾选（R2-2-M07）。 */
export function clearPlacementMarks(accountId: string | null): void {
  if (!accountId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY_PREFIX + accountId);
  } catch {
    // 清不掉只是那份勾选还留着
  }
}

/** 同上：清掉当前云身份的账号折叠状态（含旧版本那个全局键）。 */
export function clearCollapsedAccounts(accountId: string | null): void {
  if (!accountId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(COLLAPSED_KEY + ':' + accountId);
    window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // 清不掉只是下次打开还收着
  }
}
