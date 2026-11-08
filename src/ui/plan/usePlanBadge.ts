import { useEffect, useState } from 'react';
import { getCollectionPlans } from '../../api/collectionGroups';
import { readAccountId, subscribeSession } from '../../api/session';
import { readLastGroupId } from '../collectionGroupStore';
import {
  planAlertCounts,
  publishPlanAlertBadge,
  readPlanAlertSeen,
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

  useEffect(() => subscribeSession(() => setAccountId(readAccountId())), []);

  useEffect(() => {
    const groupId = readLastGroupId(accountId, 'mother');
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
        const data = await getCollectionPlans(groupId, controller.signal);
        if (!alive) return;
        const seenAt = readPlanAlertSeen(accountId, groupId);
        publishPlanAlertBadge(planAlertCounts(data.plans, accountId, seenAt).total);
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
  }, [accountId]);
}
