/**
 * 采集会话的跨挂载标记。
 *
 * `NativeCollectorPanel` 在切页时会卸载；如果自动停止 / 自动导入的「已做过」标记只放在
 * 组件 ref 里，回来后进度条再次走满就会重复停止、重复导入。这里用模块级集合记住
 * 本次会话已经自动停止 / 自动导入过，页面来回切也不会重复触发。
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
export const markAutoImported = (session: string): void => {
  autoImported.add(session);
};

/**
 * 自动导入已发起、但弹窗还没看过的会话。
 * 等待导入 / 云同步期间用户切到别的页会卸载面板；回来时用它补弹「导入完成」，不丢结果。
 */
let pendingCompletion: string | null = null;
export const setPendingCompletion = (session: string): void => {
  pendingCompletion = session;
};
export const takePendingCompletion = (): string | null => {
  const session = pendingCompletion;
  pendingCompletion = null;
  return session;
};

/** 只用于测试：清空会话标记。 */
export const resetCaptureSessionMarks = (): void => {
  autoStopped.clear();
  autoImported.clear();
  pendingCompletion = null;
};
