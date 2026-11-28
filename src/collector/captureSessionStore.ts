/**
 * 采集会话的跨挂载标记。
 *
 * 采集页在切页时会卸载；如果自动停止 / 自动导入的「已做过」标记只放在组件 ref 里，
 * 回来后进度条再次走满就会重复停止、重复导入。这里用模块级集合记住本次会话已经
 * 自动停止 / 自动导入过，页面来回切也不会重复触发。
 * （2026-11-07 起自动导入流程抽到 autoImportFlow.ts 模块级运行，不再依赖面板挂载。）
 */
const autoStopped = new Set<string>();
const autoImported = new Set<string>();

export const hasAutoStopped = (session: string): boolean => autoStopped.has(session);
export const markAutoStopped = (session: string): void => {
  autoStopped.add(session);
};
export const unmarkAutoStopped = (session: string): void => {
  autoStopped.delete(session);
};

export const hasAutoImported = (session: string): boolean => autoImported.has(session);
/** 2026-11-28：失败后「重试」要能把「已尝试自动导入」的标记清掉，否则 run() 会直接 return。 */
export const unmarkAutoImported = (session: string): void => {
  autoImported.delete(session);
};
export const markAutoImported = (session: string): void => {
  autoImported.add(session);
};

/** 只用于测试：清空会话标记。 */
export const resetCaptureSessionMarks = (): void => {
  autoStopped.clear();
  autoImported.clear();
};
