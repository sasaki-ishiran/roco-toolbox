import { useEffect, useRef } from 'react';
import { track } from '../api/analytics';

/**
 * 页签曝光埋点（2026-11-08）。
 *
 * 只在页签名真的变化时上报：之前 effect 依赖整个 `navigation` 对象，
 * `consume-focus` 之类的操作会换新对象，同一次进页会多报一条 `tab_view`。
 * 引导（tour）自己会切好几页，这期间不上报。
 */
export function useTabViewTracking(page: string, tab: string, tour: boolean): void {
  const reportedPage = useRef<string | null>(null);
  useEffect(() => {
    if (tour) return;
    if (reportedPage.current === page) return;
    reportedPage.current = page;
    track('tab_view', { tab });
  }, [page, tab, tour]);
}
