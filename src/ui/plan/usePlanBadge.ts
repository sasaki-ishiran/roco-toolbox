import { useEffect, useState } from 'react';
import { eggTaskActionable } from '../../shared/eggTaskActions';
import { getEggMatching } from '../../api/eggMatching';
import { readAccountId, subscribeSession } from '../../api/session';
import { readLastGroupId, subscribeLastGroupId } from '../collectionGroupStore';
import {
  publishPlanAlertBadge,
} from './planAlertsStore';

/**
 * 「小组」页签红点（2026-11-08）。
 *
 * 只在后台轻量轮询我最近进入的母本组计划，算「待我确认 + 新提供」；
 * 算不出（没登录 / 没进过组 / 接口失败）就不显示，不硬造数据。
 * 进小组页后由 `GroupPlanHub` 接管实时计数与已读水位。
 */
export function usePlanBadge(): void {
  const [accountId, setAccountId] = useState<string | null>(() => readAccountId());
  const [groupId, setGroupId] = useState<string | null>(() =>
    readLastGroupId(readAccountId(), 'mother'),
  );

  useEffect(() => subscribeSession(() => setAccountId(readAccountId())), []);

  // 切组要立刻按新组重算：只依赖 accountId 会让红点一直按旧组算到刷新（2026-11-08）。
  useEffect(() => {
    setGroupId(readLastGroupId(accountId, 'mother'));
  }, [accountId]);

  useEffect(
    () =>
      subscribeLastGroupId((nextAccountId, nextGroupId) => {
        if (nextAccountId !== accountId) return;
        setGroupId(nextGroupId);
      }),
    [accountId],
  );

  useEffect(() => {
    if (!accountId || !groupId) {
      publishPlanAlertBadge(0);
      return;
    }
    let alive = true;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await getEggMatching(groupId, controller.signal);
        if (!alive) return;
        publishPlanAlertBadge(data.state.trades.filter(t=>eggTaskActionable(t,accountId)).length);
      } catch {
        // 提醒失败不影响主流程：保留上一次数字
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [accountId, groupId]);
}
