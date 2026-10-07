import type { AccountSnapshot } from '../domain/parseBackup';
import { listSnapshots } from './snapshots';

/**
 * 账号快照的内存缓存。
 *
 * 四个页面（看板 / 我的精灵 / 覆盖度 / 换什么）原来各自在挂载时读一次 IndexedDB，
 * 切页签就会闪一下"正在读取本地数据…"。这里改成进程内共享：第一次读完后进缓存，
 * 之后切页签同步取用，不再有加载态闪烁；导入或重置数据后调用 refreshSnapshots() 刷新。
 *
 * 2026-10-04 分层收敛：本文件只保留非 React 的缓存/订阅逻辑；
 * 页面用的 `useSnapshots()` hook 移到 `src/ui/useSnapshots.ts`。
 */
let cache: AccountSnapshot[] | null = null;
let inFlight: Promise<AccountSnapshot[]> | null = null;
const listeners = new Set<(snapshots: AccountSnapshot[]) => void>();

export function getCachedSnapshots(): AccountSnapshot[] | null {
  return cache;
}

/** 订阅快照变化（导入 / 重置后触发）。 */
export function subscribeSnapshots(listener: (snapshots: AccountSnapshot[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 重新从 IndexedDB 读取（导入 / 重置后调用），并通知所有订阅者。 */
export function refreshSnapshots(): Promise<AccountSnapshot[]> {
  if (inFlight) {
    // 已有一次读到一半：**等它结束后再读一次**。
    // 直接复用旧 Promise 会让「读途中发生的写入」在下一次刷新里看不到（表现为「刚导入的账号没出现」）。
    return inFlight.then(() => refreshSnapshots());
  }
  inFlight = listSnapshots()
    .then((snapshots) => {
      cache = snapshots;
      inFlight = null;
      for (const listener of listeners) listener(snapshots);
      return snapshots;
    })
    // 2026-10-06 修复（M5）：失败也要释放 in-flight，否则一次 IndexedDB 故障
    // 会让之后所有 refreshSnapshots() 永远复用这个 rejected promise（永久卡死）。
    .catch((error: unknown) => {
      inFlight = null;
      throw error;
    });
  return inFlight;
}

/** 仅供测试：清空缓存，模拟首次进入应用。 */
export function resetSnapshotCacheForTest(): void {
  cache = null;
  inFlight = null;
  listeners.clear();
}
