import { useCallback, useEffect, useRef, useState } from 'react';
import { listCollectionGroups } from '../api/collectionGroups';
import { getEggMatching } from '../api/eggMatching';
import type { EggLine, WorkflowTrade } from '../shared/eggWorkflow';
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
  workflowTaskId?:string;
  workflowVersion?:number;
  workflowTask?:WorkflowTrade;
  placementLine?:EggLine;
}

interface Cache {
  accountId: string;
  items: ClaimedDemandItem[];
  loadedAt: number;
}

/** 缓存有效期：短时间内反复切回家园页不再重拉（重试按钮会强制刷新）。 */
const CACHE_TTL_MS = 60_000;

/** 切页不闪：模块级缓存，回来先用旧内容；60 秒内直接复用，过期再后台刷新。 */
let cache: Cache | null = null;
// Invalidate even while the home view is unmounted.
if(typeof window!=='undefined')window.addEventListener('roco:egg-workflow-changed',()=>{cache=null;});

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
  /** 重试 / 手动刷新时绕过缓存有效期。 */
  const forceRef = useRef(false);
  useEffect(()=>{
    const changed=()=>{forceRef.current=true;setNonce(value=>value+1);};
    window.addEventListener('roco:egg-workflow-changed',changed);
    return()=>window.removeEventListener('roco:egg-workflow-changed',changed);
  },[]);

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
    // 换身份：缓存命中照旧秒开；不命中先清空，别拿旧账号的单顶着新身份显示（R2-2-M01）
    const cached = cache && cache.accountId === accountId ? cache : null;
    setItems(cached ? cached.items : []);
    const forced = forceRef.current;
    forceRef.current = false;
    // 60 秒内的缓存直接复用，反复切家园页不再把每组需求重拉一遍（R2-2-M05）
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
            const data = await getEggMatching(group.id, controller.signal);
            return data.state.trades
              .filter(t=>t.status==='accepted'&&t.type==='custom'&&(t.supplierAccountId===accountId&&!!(t.line||t.legacy||!t.returnLine)||t.demanderAccountId===accountId&&!!t.returnLine))
              .map((t):ClaimedDemandItem=>{
                const isReturn=t.demanderAccountId===accountId;
                const egg=isReturn?t.receive!:t.give;
                return {groupId:group.id,groupName:group.name,demanderAccountId:isReturn?t.supplierAccountId:t.demanderAccountId,
                  eggGameId:egg.eggGameId,nature:egg.nature,gender:'',body:egg.body==='unknown'?'':egg.body,voice:egg.voice==='unknown'?'':egg.voice,
                  status:'claimed',claimerAccountId:accountId,version:data.version,createdAt:t.createdAt,updatedAt:t.createdAt,placedAt:(isReturn?t.returnPlaced:t.placed)?t.createdAt:null,
                  workflowTaskId:t.id,workflowVersion:data.version,workflowTask:t,placementLine:isReturn?t.returnLine:t.line};
              });
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
        // 中止是页面卸载 / 换号的正常结果，不能当成「读取失败」写进界面
        if (cancelled || controller.signal.aborted || requestRef.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : '读取接单失败');
      } finally {
        if (!cancelled && requestRef.current === requestId) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accountId, nonce]);

  const reload = useCallback(() => {
    forceRef.current = true;
    setNonce((value) => value + 1);
  }, []);

  return { accountId, items, loading, error, reload };
}
