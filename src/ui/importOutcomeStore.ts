import { createModuleStore } from './createModuleStore';

/**
 * 一次导入的三个阶段反馈（2026-10-24 重构任务 6）。
 *
 * - `local`：本机保存（解析 / 合并 / 写入 IndexedDB）
 * - `cloud`：私有云同步（只有开了工具箱身份才会有）
 * - `group`：小组资源是否需更新——**永远先写 unverified**，不能凭导入就声称全部小组已更新
 *
 * 仅内存保存，供「我的」与看板同时展示；云同步的冲突详情仍以 syncNoticeStore 为准，
 * 这里不复制第二份可编辑冲突状态。
 */
export interface ImportOutcome {
  operationId: number;
  local: 'idle' | 'importing' | 'saved' | 'failed';
  cloud: 'not-enabled' | 'syncing' | 'synced' | 'failed' | 'conflict';
  group: 'unverified';
  message: string | null;
}

const INITIAL: ImportOutcome = {
  operationId: 0,
  local: 'idle',
  cloud: 'not-enabled',
  group: 'unverified',
  message: null,
};

const store = createModuleStore<ImportOutcome>(INITIAL);

let counter = 0;

export function useImportOutcome(): ImportOutcome {
  return store.use();
}

export function getImportOutcome(): ImportOutcome {
  return store.get();
}

/** 开始一次导入：返回 operationId，晚到的旧响应不能覆盖它。 */
export function beginImport(): number {
  counter += 1;
  const operationId = counter;
  store.set({ ...INITIAL, operationId, local: 'importing' });
  return operationId;
}

export function updateImportOutcome(
  operationId: number,
  patch: Partial<Omit<ImportOutcome, 'operationId'>>,
): void {
  const current = store.get();
  // 旧操作的晚到响应直接丢弃：否则会把新一次导入的结果覆盖成旧的
  if (operationId !== current.operationId) return;
  store.set({ ...current, ...patch, group: 'unverified' });
}

export function resetImportOutcomeForTest(): void {
  counter = 0;
  store.set(INITIAL);
}

/** 重置导入数据时把三阶段反馈清回初始，避免页面还挂着上一次导入的成功提示。 */
export function resetImportOutcome(): void {
  store.set(INITIAL);
}
