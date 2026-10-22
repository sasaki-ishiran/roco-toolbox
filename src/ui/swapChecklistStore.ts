import type {
  ChecklistItem,
  ChecklistOwner,
  ChecklistState,
  MotherChecklist,
} from '../domain/swapChecklist';
import { createModuleStore } from './createModuleStore';

/**
 * 「互换清单」的本地状态（持久化在 localStorage）。
 *
 * 清单本身（三份名单）由**有数据的设备**算一次、随分享码上传；
 * 加入方直接渲染云端的名单，不需要自己再算一遍。
 */
export interface SwapChecklistState {
  /** 我方账号（显示名）；为空 = 还没选。发布方 = 自己的号，加入方 = 发布方给的对方账号 */
  mineAccounts: string[];
  /**
   * 角色：publisher = 手里有全部数据、负责生成名单的一方；joiner = 只渲染名单的一方。
   * 名单里的「我」始终指发布方，界面按角色翻译成「我方/对方」。
   */
  role: 'publisher' | 'joiner' | null;
  /** 分享码；空 = 还没共享 */
  code: string;
  /** 云端版本（乐观锁） */
  version: number;
  /** 三份名单（发布方算好 / 加入方从云端拿到） */
  lists: MotherChecklist | null;
  /** 每条：owner + done */
  items: ChecklistState;
  /** 最近一次成功同步的毫秒时间 */
  lastSyncAt: number;
  /** 最近一次同步错误（null = 正常） */
  syncError: string | null;
}

const INITIAL: SwapChecklistState = {
  mineAccounts: [],
  role: null,
  code: '',
  version: 0,
  lists: null,
  items: {},
  lastSyncAt: 0,
  syncError: null,
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isItemList = (value: unknown): value is ChecklistItem[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as ChecklistItem).eggGameId === 'number' &&
      typeof (item as ChecklistItem).name === 'string' &&
      isStringArray((item as ChecklistItem).accounts),
  );

const toLists = (value: unknown): MotherChecklist | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isItemList(record.heCanHatch) || !isItemList(record.iCanHatch) || !isItemList(record.neither)) {
    return null;
  }
  return {
    heCanHatch: record.heCanHatch,
    iCanHatch: record.iCanHatch,
    neither: record.neither,
  };
};

const toItems = (value: unknown): ChecklistState => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: ChecklistState = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const owner = item.owner === 'mine' || item.owner === 'theirs' ? item.owner : null;
    result[key] = {
      owner,
      done: item.done === true,
      at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : 0,
    };
  }
  return result;
};

const store = createModuleStore<SwapChecklistState>(INITIAL, {
  persistKey: 'roco.swapChecklist',
  migrate: (loaded) => ({
    mineAccounts: isStringArray(loaded.mineAccounts) ? loaded.mineAccounts : [],
    role: loaded.role === 'publisher' || loaded.role === 'joiner' ? loaded.role : null,
    code: typeof loaded.code === 'string' ? loaded.code : '',
    version: typeof loaded.version === 'number' && Number.isFinite(loaded.version) ? loaded.version : 0,
    lists: toLists(loaded.lists),
    items: toItems(loaded.items),
    lastSyncAt: typeof loaded.lastSyncAt === 'number' ? loaded.lastSyncAt : 0,
    syncError: null,
  }),
});

export function useSwapChecklist(): SwapChecklistState {
  return store.use();
}

export function getSwapChecklist(): SwapChecklistState {
  return store.get();
}

export function setMineAccounts(mineAccounts: string[]): void {
  store.set({ ...store.get(), mineAccounts });
}

/** 发布成功 / 加入成功：写入分享码与名单 */
export function setSharedTarget(input: {
  code: string;
  version: number;
  lists: MotherChecklist | null;
  items?: ChecklistState;
  mineAccounts?: string[];
  role: 'publisher' | 'joiner';
}): void {
  const current = store.get();
  store.set({
    ...current,
    code: input.code,
    version: input.version,
    lists: input.lists ?? current.lists,
    items: input.items ?? current.items,
    mineAccounts: input.mineAccounts ?? current.mineAccounts,
    role: input.role,
    lastSyncAt: Date.now(),
    syncError: null,
  });
}

/** 本地改一条（勾选 / 归属）：带上时间戳，合并时用 */
export function patchChecklistItem(
  key: string,
  patch: { owner?: ChecklistOwner; done?: boolean },
  at = Date.now(),
): void {
  const current = store.get();
  const previous = current.items[key] ?? { owner: null, done: false, at: 0 };
  store.set({
    ...current,
    items: {
      ...current.items,
      [key]: { ...previous, ...patch, at },
    },
  });
}

/** 应用云端合并结果（拉取/冲突重试时用） */
export function applyRemoteChecklist(input: {
  version: number;
  lists: MotherChecklist | null;
  mineAccounts?: string[];
  items: ChecklistState;
}): void {
  const current = store.get();
  store.set({
    ...current,
    version: input.version,
    lists: input.lists ?? current.lists,
    mineAccounts: input.mineAccounts ?? current.mineAccounts,
    items: input.items,
    lastSyncAt: Date.now(),
    syncError: null,
  });
}

export function setSyncError(syncError: string | null): void {
  store.set({ ...store.get(), syncError });
}

/** 退出共享（保留本地勾选） */
export function clearSharedTarget(): void {
  store.set({ ...store.get(), code: '', version: 0, syncError: null });
}

/* ---------- 云端 payload 的序列化 / 解析 ---------- */

export interface RemoteChecklistPayload {
  v: 1;
  catalogVersion: string;
  mineAccounts: string[];
  lists: MotherChecklist;
  items: ChecklistState;
}

export function buildRemotePayload(state: SwapChecklistState, catalogVersion: string): string {
  const payload: RemoteChecklistPayload = {
    v: 1,
    catalogVersion,
    mineAccounts: state.mineAccounts,
    lists: state.lists ?? { heCanHatch: [], iCanHatch: [], neither: [] },
    items: state.items,
  };
  return JSON.stringify(payload);
}

export function parseRemotePayload(text: string): RemoteChecklistPayload | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const lists = toLists(raw.lists);
    if (!lists) return null;
    return {
      v: 1,
      catalogVersion: typeof raw.catalogVersion === 'string' ? raw.catalogVersion : '',
      mineAccounts: isStringArray(raw.mineAccounts) ? raw.mineAccounts : [],
      lists,
      items: toItems(raw.items),
    };
  } catch {
    return null;
  }
}
