import { useEffect, useState } from 'react';
import type { AccountImportResult } from '../domain/importDiff';
import {
  getLastImportHistory,
  getLastImportResult,
  subscribeLastImportHistory,
  subscribeLastImportResult,
  type ImportHistoryEntry,
} from '../storage/lastImportStore';

/**
 * 「本次导入新增」的 hook（2026-10-04 从 lastImportStore 移出，storage 层只留非 React 逻辑）。
 * 最新一次结果 + 最近 5 次历史。
 */
export function useLastImportResult(): AccountImportResult[] | null {
  const [value, setValue] = useState<AccountImportResult[] | null>(getLastImportResult());

  useEffect(() => subscribeLastImportResult(setValue), []);

  return value;
}

/** 最近 5 次导入历史（用于看板卡片底部的「历史导入」区）。 */
export function useLastImportHistory(): ImportHistoryEntry[] {
  const [value, setValue] = useState<ImportHistoryEntry[]>(getLastImportHistory());

  useEffect(() => subscribeLastImportHistory(setValue), []);

  return value;
}
