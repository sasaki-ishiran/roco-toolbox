import { createModuleStore } from './createModuleStore';
import type { CloudMeta } from '../api/session';

/**
 * 导入后「自动云同步」的反馈（2026-10-07）。
 *
 * 为什么必须放模块级而不是 ImportPanel 的 useState：
 * 分享导入成功后 App 会立刻切到看板并**卸载 ImportPanel**，而自动同步是网络操作，
 * 必然在卸载之后才 resolve —— 那时 setState 全是 no-op，409 冲突与「设置已跟随云端」
 * 这两条提示会被永久吞掉（409 还得靠这块让用户二选一）。放模块级后，用户下次进
 * 「导入数据」页仍能看到并处理。
 */
export interface SyncFeedback {
  /** 自动同步撞到的 409：交给「云同步」面板让用户选「用云端 / 用本地覆盖」 */
  conflict: CloudMeta | null;
  /** 从云端补上了本机没有的设置（刷新后生效），或自动同步失败的提示 */
  notice: string | null;
}

const EMPTY: SyncFeedback = { conflict: null, notice: null };

const store = createModuleStore<SyncFeedback>(EMPTY);

export function getSyncFeedback(): SyncFeedback {
  return store.get();
}

/** 记下一次自动同步冲突（清掉旧的提示，避免两条同时挂着互相矛盾） */
export function setSyncConflict(conflict: CloudMeta | null): void {
  store.set({ conflict, notice: null });
}

/** 记下一次自动同步提示（成功后清掉冲突） */
export function setSyncNotice(notice: string | null): void {
  store.set({ conflict: null, notice });
}

export function clearSyncFeedback(): void {
  store.set(EMPTY);
}

export function useSyncFeedback(): SyncFeedback {
  return store.use();
}
