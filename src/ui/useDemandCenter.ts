import { useCallback, useEffect, useRef, useState } from 'react';
import { getCollectionDemands, listCollectionGroups } from '../api/collectionGroups';
import { readAccountId, subscribeSession } from '../api/session';
import type { CollectionDemand } from '../shared/collectionGroups';

/**
 * 需求中心里「还没完成」的全部需求（2026-11-06）。
 *
 * `useClaimedDemands` 只拉「我接的单」；附近雷达需要知道整个需求中心在找什么，
 * 所以这里按组拉 open / claimed 的全部需求，按当前身份缓存 60 秒。
 */
export interface DemandCenterItem extends CollectionDemand {
  groupName: string;
}

interface Cache {
  accountId: string;
  items: DemandCenterItem[];
  loadedAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: Cache | null = null;

export interface DemandCenterState {
  accountId: string | null;
  items: DemandCenterItem[];
  loading: boolean;
  error: string;
  reload: () => void;
}

/**
 * 需求中心列表。
 *
 * @param enabled 传 false 时不发请求（悬浮面板只在安卓壳里用需求命中过滤，
 *                网页端不用为了它多打一轮接口）。
 */
export function useDemandCenter(enabled = true): DemandCenterState {
  const [accountId, setAccountId] = useState<string | null>(() => readAccountId());
  const [items, setItems] = useState<DemandCenterItem[]>(() => {
    const current = readAccountId();
    return cache && cache.accountId === current ? cache.items : [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const requestRef = useRef(0);
  const forceRef = useRef(false);

  useEffect(
    () => subscribeSession(() => setAccountId(readAccountId())),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    if (!accountId) {
      setItems([]);
      setLoading(false);
      setError('');
      return;
    }
    const cached = cache && cache.accountId === accountId ? cache : null;
    setItems(cached ? cached.items : []);
    const forced = forceRef.current;
    forceRef.current = false;
    if (cached && !forced && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      setLoading(false);
      setError('');
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');

    (async () => {
      try {
        const groups = (await listCollectionGroups(controller.signal)).filter(
          (group) => group.groupType === 'mother',
        );
        const results = await Promise.allSettled(
          groups.map(async (group) => {
            const demands = await getCollectionDemands(group.id, controller.signal);
            return demands
              .filter((demand) => demand.status !== 'done')
              .map((demand) => ({ ...demand, groupName: group.name }));
          }),
        );
        if (cancelled || requestRef.current !== requestId) return;
        const merged: DemandCenterItem[] = [];
        let failed = 0;
        for (const result of results) {
          if (result.status === 'fulfilled') merged.push(...result.value);
          else failed += 1;
        }
        merged.sort((a, b) => a.createdAt - b.createdAt || a.groupId.localeCompare(b.groupId));
        cache = { accountId, items: merged, loadedAt: Date.now() };
        setItems(merged);
        setError(failed > 0 ? `${failed} 个小组需求读取失败，先显示已读到的` : '');
      } catch (cause) {
        if (cancelled || controller.signal.aborted || requestRef.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : '读取需求中心失败');
      } finally {
        if (!cancelled && requestRef.current === requestId) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accountId, nonce, enabled]);

  const reload = useCallback(() => {
    forceRef.current = true;
    setNonce((value) => value + 1);
  }, []);

  return { accountId, items, loading, error, reload };
}

/** 测试用：清空跨挂载缓存。 */
export function resetDemandCenterCacheForTest(): void {
  cache = null;
}
