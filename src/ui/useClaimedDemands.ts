import { useCallback, useEffect, useRef, useState } from 'react';
import { getCollectionGroup, listCollectionGroups } from '../api/collectionGroups';
import { getEggMatching } from '../api/eggMatching';
import type { EggLine, EggWorkflowState, WorkflowTrade } from '../shared/eggWorkflow';
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
  /** 需求方账号 → 显示昵称（从各小组详情里解析，离开小组的成员没有昵称）。 */
  names: Map<string, string>;
  loadedAt: number;
}

/** 缓存有效期：短时间内反复切回家园页不再重拉（重试按钮会强制刷新）。 */
const CACHE_TTL_MS = 60_000;

/** 切页不闪：模块级缓存，回来先用旧内容；60 秒内直接复用，过期再后台刷新。 */
let cache: Cache | null = null;
// Invalidate even while the home view is unmounted.
if(typeof window!=='undefined')window.addEventListener('roco:egg-workflow-changed',()=>{cache=null;});

/**
 * 换蛋单 → 家园「接单上窝」的行（2026-11-19 抽成纯函数）。
 *
 * 口径：只认已接受的定制单。我供蛋时看 `give`（有蛋线 / 老单 / 没有回单都算承接）；
 * 对方供蛋时看 `returnLine`（我这一侧的蛋线）。抽出来是为了让开发预览的假数据
 * 用同一套规则做测试——否则假数据「看起来有单、页面却是空」。
 */
export function claimedItemsOf(
  state: EggWorkflowState,
  accountId: string,
  group: { id: string; name: string },
  version: number,
): ClaimedDemandItem[] {
  return state.trades
    .filter(
      (t) =>
        t.status === 'accepted' &&
        t.type === 'custom' &&
        ((t.supplierAccountId === accountId && !!(t.line || t.legacy || !t.returnLine)) ||
          (t.demanderAccountId === accountId && !!t.returnLine)),
    )
    .map((t): ClaimedDemandItem => {
      const isReturn = t.demanderAccountId === accountId;
      const egg = (isReturn ? t.receive : t.give)!;
      return {
        groupId: group.id,
        groupName: group.name,
        demanderAccountId: isReturn ? t.supplierAccountId : t.demanderAccountId,
        eggGameId: egg.eggGameId,
        nature: egg.nature,
        gender: '',
        body: egg.body === 'unknown' ? '' : egg.body,
        voice: egg.voice === 'unknown' ? '' : egg.voice,
        status: 'claimed',
        claimerAccountId: accountId,
        version,
        createdAt: t.createdAt,
        updatedAt: t.createdAt,
        placedAt: (isReturn ? t.returnPlaced : t.placed) ? t.createdAt : null,
        workflowTaskId: t.id,
        workflowVersion: version,
        workflowTask: t,
        placementLine: isReturn ? t.returnLine : t.line,
      };
    });
}

export interface ClaimedDemandsState {
  accountId: string | null;
  items: ClaimedDemandItem[];
  /** 需求方账号 → 显示昵称；查不到（已退出小组）时调用方回退。 */
  names: ReadonlyMap<string, string>;
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
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => {
    const current = readAccountId();
    return cache && cache.accountId === current ? cache.names : new Map();
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
      setNames(new Map());
      setLoading(false);
      setError('');
      return;
    }
    // 换身份：缓存命中照旧秒开；不命中先清空，别拿旧账号的单顶着新身份显示（R2-2-M01）
    const cached = cache && cache.accountId === accountId ? cache : null;
    setItems(cached ? cached.items : []);
    setNames(cached ? cached.names : new Map());
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
            const [data, detail] = await Promise.all([
              getEggMatching(group.id, controller.signal),
              // 成员昵称用于给需求方一个可读名字；这组读不到不影响接单列表
              getCollectionGroup(group.id, controller.signal).catch(() => null),
            ]);
            const members = new Map(
              (detail?.members ?? []).map((member) => [member.accountId, member.displayName]),
            );
            const trades = claimedItemsOf(data.state, accountId, group, data.version);
            return { members, trades };
          }),
        );
        if (cancelled || requestRef.current !== requestId) return;
        const merged: ClaimedDemandItem[] = [];
        const mergedNames = new Map<string, string>();
        let failed = 0;
        for (const result of results) {
          if (result.status === 'fulfilled') {
            merged.push(...result.value.trades);
            for (const [id, name] of result.value.members) mergedNames.set(id, name);
          } else {
            failed += 1;
          }
        }
        // 接单会更新 updatedAt，用它近似「接单时间」做先到先得。
        merged.sort((a, b) => a.updatedAt - b.updatedAt || a.groupId.localeCompare(b.groupId));
        cache = { accountId, items: merged, names: mergedNames, loadedAt: Date.now() };
        setItems(merged);
        setNames(mergedNames);
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

  return { accountId, items, names, loading, error, reload };
}
