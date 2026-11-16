import { eggTaskActionable } from '../../shared/eggTaskActions';
import { publishPlanAlertBadge } from './planAlertsStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EggMatchingError, getEggMatching, mutateEggMatching, type EggMatchingResponse } from '../../api/eggMatching';

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
      if (identity.current !== requested || writing.current) return;
      if (!current.current || next.version >= current.current.version) { current.current = next; setData(next); }
      setError(null);
    } catch (failure) {
      if (identity.current === requested) setError(failure instanceof Error ? failure.message : '读取失败');
    } finally { if (identity.current === requested) setLoading(false); }
  }, [groupId, key]);
  useEffect(() => {
    identity.current = key; current.current = null; writing.current=null; setBusy(false); setData(null); setLoading(true); setError(null);
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
      if (identity.current !== requested) return;
      current.current = next; setData(next); setError(null);
    } catch (failure) {
      if (identity.current === requested) {
        setError(failure instanceof Error ? failure.message : '操作失败');
        if (failure instanceof EggMatchingError && failure.status === 409) {
          const next = await getEggMatching(groupId);
          if (identity.current === requested) { current.current = next; setData(next); }
        }
      }
      throw failure;
    } finally { if(writing.current===requested)writing.current = null; if (identity.current === requested) setBusy(false); }
  }, [groupId, key]);
  useEffect(()=>{if(data)publishPlanAlertBadge(data.state.trades.filter(t=>eggTaskActionable(t,accountId)).length);},[data,accountId]);
  return { data, loading, busy, error, refresh, mutate };
}
