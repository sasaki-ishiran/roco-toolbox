import { useEffect, useState } from 'react';
import type { AccountSnapshot } from '../domain/parseBackup';
import {
  getCachedSnapshots,
  refreshSnapshots,
  subscribeSnapshots,
} from '../storage/snapshotStore';

/**
 * 页面取账号快照的 hook（2026-10-04 从 snapshotStore 移出，storage 层只留非 React 逻辑）。
 * 有缓存时同步返回（loaded 一开始就是 true），没有缓存时才触发一次读取。
 */
export function useSnapshots(): { snapshots: AccountSnapshot[]; loaded: boolean } {
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>(getCachedSnapshots() ?? []);
  const [loaded, setLoaded] = useState(getCachedSnapshots() !== null);

  useEffect(() => {
    const unsubscribe = subscribeSnapshots((next) => {
      setSnapshots(next);
      setLoaded(true);
    });
    if (getCachedSnapshots() === null) {
      // 读失败也必须收尾：否则 loaded 永远是 false，页面停在「正在读取本地数据…」，
      // ImportPanel 的消费逻辑（if (!loaded) return）也永不执行 → 分享数据被静默丢弃。
      void refreshSnapshots().catch(() => {
        setLoaded(true);
      });
    } else {
      setSnapshots(getCachedSnapshots() as AccountSnapshot[]);
      setLoaded(true);
    }
    return unsubscribe;
  }, []);

  return { snapshots, loaded };
}
