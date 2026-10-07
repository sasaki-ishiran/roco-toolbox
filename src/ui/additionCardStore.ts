import { createModuleStore } from './createModuleStore';
import type { AccountImportResult } from '../domain/importDiff';

/**
 * 看板「本次新增」卡的展开态：记的是**被用户收起的那一份结果**（2026-10-07）。
 *
 * 以前展开态是卡片组件里的 useState —— 切到别的页签会把看板卸载，回来看板又默认展开，
 * 用户刚收起就被弹开。改成按结果记之后：
 * - 同一份结果：切页 / 组件重挂载后仍保持收起；
 * - 来了新结果（新的导入、或云同步合并进来的新增）：自动展开，免得新增被漏掉
 *   （`setLastImportResult` 每次都产生新数组，比较引用即可）。
 *
 * 不持久化：重开应用后最新结果本来就没了（只在内存里），卡片本身也不渲染。
 */
const store = createModuleStore<AccountImportResult[] | null>(null);

/** 被收起的那一份结果（从没被收起过则为 null = 展开）。 */
export function getCollapsedResult(): AccountImportResult[] | null {
  return store.get();
}

/** 收起 / 展开这一份结果。 */
export function toggleCollapsedResult(results: AccountImportResult[]): void {
  store.set(store.get() === results ? null : results);
}

export function useCollapsedResult(): AccountImportResult[] | null {
  return store.use();
}
