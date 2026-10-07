import type { AccountImportResult } from '../domain/importDiff';

/**
 * 「本次导入新增」结果的模块级缓存 + 最近 5 次历史（localStorage 持久化）。
 *
 * 导入完成后写入，看板据此渲染卡片。切到别的页签再回来卡片还在
 * （页面组件会卸载重建，所以不能把结果放在组件自身的 state 里）。
 *
 * 2026-10-04 优化（用户拍板）：原来纯内存、刷新即丢；现在最新一次照旧
 * 走内存（`useLastImportResult`），同时把每次导入结果追加进 localStorage
 * 的 `roco.lastImportResults`（cap 5），卡片底部可展开查看历史。
 *
 * 2026-10-04 分层收敛：本文件只保留非 React 的存储/订阅逻辑，
 * 页面用的 hook 移到 `src/ui/useLastImportResult.ts`。
 */
const HISTORY_KEY = 'roco.lastImportResults';
const HISTORY_CAP = 5;

export interface ImportHistoryEntry {
  at: string; // ISO 时间
  results: AccountImportResult[];
}

/** 一个「种公 / 母本」分组：里面必须带 pets 数组（ImportResultCard 会 map 它取条数） */
const isPetGroup = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Record<string, unknown>).pets);

/** 条目形状校验：localStorage 被污染 / 改形状时丢弃坏条目，
 *  否则 ImportResultCard 对 entry.results.map / account.studs[].pets 的调用会让页面崩掉。 */
const isValidEntry = (value: unknown): value is ImportHistoryEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const { at, results } = value as Record<string, unknown>;
  if (typeof at !== 'string' || !Array.isArray(results)) return false;
  return results.every((account) => {
    if (typeof account !== 'object' || account === null) return false;
    const record = account as Record<string, unknown>;
    return (
      Array.isArray(record.studs) &&
      record.studs.every(isPetGroup) &&
      Array.isArray(record.mothers) &&
      record.mothers.every(isPetGroup)
    );
  });
};

const readHistory = (): ImportHistoryEntry[] => {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
  } catch {
    return [];
  }
};

const writeHistory = (entries: ImportHistoryEntry[]): void => {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_CAP)));
  } catch {
    // 隐私模式下写不了 localStorage：本次历史只在内存里生效
  }
};

let result: AccountImportResult[] | null = null;
let history: ImportHistoryEntry[] = readHistory();
const listeners = new Set<(next: AccountImportResult[] | null) => void>();
const historyListeners = new Set<(entries: ImportHistoryEntry[]) => void>();

export function getLastImportResult(): AccountImportResult[] | null {
  return result;
}

export function getLastImportHistory(): ImportHistoryEntry[] {
  return history;
}

export function subscribeLastImportResult(
  listener: (next: AccountImportResult[] | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeLastImportHistory(
  listener: (entries: ImportHistoryEntry[]) => void,
): () => void {
  historyListeners.add(listener);
  return () => {
    historyListeners.delete(listener);
  };
}

/**
 * 写入最新一次结果（看板「本次新增」卡据此渲染），并把这次结果追加进导入历史。
 *
 * @param options.history 是否同时追加进「导入历史」（默认追加）。云同步合并进来的新增传
 *   `false`——同步不是导入，别污染「导入历史（N 次）」。
 */
export function setLastImportResult(
  next: AccountImportResult[],
  options: { history?: boolean } = {},
): void {
  result = next;
  const toHistory = options.history !== false;
  if (toHistory) {
    // 每次导入都追加一条历史（最多保留 5 次）
    history = [
      { at: new Date().toISOString(), results: next },
      ...history.filter((entry) => entry.results !== next),
    ].slice(0, HISTORY_CAP);
    writeHistory(history);
  }
  for (const listener of listeners) listener(next);
  if (toHistory) {
    for (const listener of historyListeners) listener(history);
  }
}

export function clearLastImportResult(): void {
  result = null;
  for (const listener of listeners) listener(null);
}

/** 清空全部导入历史（「重置导入数据」用：否则重置后历史卡片还留着旧账号明细）。 */
export function clearLastImportHistory(): void {
  history = [];
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // 隐私模式：内存里清掉即可
  }
  for (const listener of historyListeners) listener(history);
}

/** 仅供测试：清空缓存。 */
export function resetLastImportForTest(): void {
  result = null;
  history = [];
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // 忽略
  }
  listeners.clear();
  historyListeners.clear();
}
