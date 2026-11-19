import { eggTaskActionable } from '../../shared/eggTaskActions';
import { publishPlanAlertBadge } from './planAlertsStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EggMatchingError, getEggMatching, mutateEggMatching, type EggMatchingResponse } from '../../api/eggMatching';

/**
 * 需求中心的数据缓存（2026-11-18）。
 *
 * 之前每次进页面都把 data 清空再请求，用户每次都要等一次完整加载。
 * 这里按「小组 + 账号」留住上一份响应：再次进入先用缓存立即出内容，
 * 后台再刷新；版本号只增不减，旧响应不会把新数据顶回去。
 */
const cache = new Map<string, EggMatchingResponse>();
/** 仅测试用：清掉缓存，避免用例之间互相影响。 */
export function clearEggMatchingCache(): void { cache.clear(); }

export function useEggMatching(groupId: string, accountId: string) {
  const [data, setData] = useState<EggMatchingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<EggMatchingResponse | null>(null);
  const identity = useRef('');
  const writing = useRef<string | null>(null);
  const key = `${groupId}:${accountId}`;
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const requested = key;
    try {
      const next = await getEggMatching(groupId);
      cache.set(requested, next);
      if (identity.current !== requested || writing.current) return;
      if (!current.current || next.version >= current.current.version) { current.current = next; setData(next); }
      setError(null);
    } catch (failure) {
      if (identity.current === requested) setError(failure instanceof Error ? failure.message : '读取失败');
    } finally { if (identity.current === requested) setLoading(false); }
  }, [groupId, key]);
  useEffect(() => {
    identity.current = key; writing.current=null; setBusy(false); setError(null);
    const cached = cache.get(key) ?? null;
    current.current = cached;
    setData(cached);
    setLoading(!cached);
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 20_000);
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus);
    return () => { identity.current = ''; window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [key, refresh]);
  const mutate = useCallback(async (action: unknown) => {
    if (writing.current || !current.current) throw new Error('数据正在更新，请稍后重试');
    const requested = key;
    writing.current = requested; setBusy(true);
    try {
      const next = await mutateEggMatching(groupId, current.current.version, action);
      cache.set(requested, next);
      if (identity.current !== requested) return;
      current.current = next; setData(next); setError(null);
    } catch (failure) {
      if (identity.current === requested) {
        setError(failure instanceof Error ? failure.message : '操作失败');
        if (failure instanceof EggMatchingError && failure.status === 409) {
          const next = await getEggMatching(groupId);
          cache.set(requested, next);
          if (identity.current === requested) { current.current = next; setData(next); }
        }
      }
      throw failure;
    } finally { if(writing.current===requested)writing.current = null; if (identity.current === requested) setBusy(false); }
  }, [groupId, key]);
  useEffect(()=>{if(data)publishPlanAlertBadge(data.state.trades.filter(t=>eggTaskActionable(t,accountId)).length);},[data,accountId]);
  return { data, loading, busy, error, refresh, mutate };
}
