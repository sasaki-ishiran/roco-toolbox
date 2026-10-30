import { useCallback, useEffect, useRef, useState } from 'react';
import { getCollectionDemands, listCollectionGroups } from '../api/collectionGroups';
import { readAccountId, subscribeSession } from '../api/session';
import type { CollectionDemand } from '../shared/collectionGroups';

/**
 * 当前身份在所有收集小组里「我接的、还没完成」的需求（需求中心二期）。
 *
 * 需求中心只保存当前小组的详情；家园页要跨小组汇总，所以这里自己拉：
 * 先读组列表，再并发读每组的需求，只留 `claimed` 且承接人是自己的。
 */
export interface ClaimedDemandItem extends CollectionDemand {
  groupName: string;
}

interface Cache {
  accountId: string;
  items: ClaimedDemandItem[];
  loadedAt: number;
}

/** 切页不闪：模块级缓存，回来先用旧内容再后台刷新。 */
let cache: Cache | null = null;

export interface ClaimedDemandsState {
  accountId: string | null;
  items: ClaimedDemandItem[];
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useClaimedDemands(): ClaimedDemandsState {
  const [accountId, setAccountId] = useState<string | null>(() => readAccountId());
  const [items, setItems] = useState<ClaimedDemandItem[]>(() => {
    const current = readAccountId();
    return cache && cache.accountId === current ? cache.items : [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const requestRef = useRef(0);

  useEffect(
    () =>
      subscribeSession(() => {
        setAccountId(readAccountId());
      }),
    [],
  );

  useEffect(() => {
    if (!accountId) {
      setItems([]);
      setLoading(false);
      setError('');
      return;
    }
    if (cache && cache.accountId === accountId) setItems(cache.items);

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let cancelled = false;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const groups = (await listCollectionGroups()).filter((group) => group.groupType === 'mother');
        const results = await Promise.allSettled(
          groups.map(async (group) => {
            const demands = await getCollectionDemands(group.id);
            return demands
              .filter((demand) => demand.status === 'claimed' && demand.claimerAccountId === accountId)
              .map((demand) => ({ ...demand, groupName: group.name }));
          }),
        );
        if (cancelled || requestRef.current !== requestId) return;
        const merged: ClaimedDemandItem[] = [];
        let failed = 0;
        for (const result of results) {
          if (result.status === 'fulfilled') merged.push(...result.value);
          else failed += 1;
        }
        // 接单会更新 updatedAt，用它近似「接单时间」做先到先得。
        merged.sort((a, b) => a.updatedAt - b.updatedAt || a.groupId.localeCompare(b.groupId));
        cache = { accountId, items: merged, loadedAt: Date.now() };
        setItems(merged);
        setError(failed > 0 ? `${failed} 个小组读取失败，先显示已读到的单` : '');
      } catch (cause) {
        if (cancelled || requestRef.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : '读取接单失败');
      } finally {
        if (!cancelled && requestRef.current === requestId) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { accountId, items, loading, error, reload };
}
