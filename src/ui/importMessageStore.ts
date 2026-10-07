import { createModuleStore } from './createModuleStore';

/**
 * 「已导入/已导出」的反馈文案（import 页 data-message）。
 *
 * 用模块级 store 而不是组件内 useState：导入动作完成后可能立刻被跳回看板（有数据时默认落看板），
 * 导入页会卸载；文案若放在组件 state，跳回来就没了。「行为不变」要求这份提示在切页/卸载后仍能看见。
 *
 * 不持久化——重开应用后清空（导入动作的反馈本来就是一次性提示）。
 */
const store = createModuleStore<string | null>(null);

export function getImportMessage(): string | null {
  return store.get();
}

export function setImportMessage(message: string | null): void {
  store.set(message);
}

export function useImportMessage(): string | null {
  return store.use();
}

/** 供单元测试复位（模块级状态在 vitest 多文件间共享，需要各自复位）。 */
export function resetImportMessageForTest(): void {
  store.set(null);
}