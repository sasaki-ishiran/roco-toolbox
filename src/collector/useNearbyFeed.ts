import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollectorState } from './nativeCollector';
import { readCollectorState } from './nativeCollector';
import { observeCollectorState, isNearbyOwnedSession } from './captureOriginStore';
import type { CaptureProgress } from './captureProgress';
import { freshNearbySnapshot, useNearbySnapshot, type NearbySnapshot } from './nearbyStore';
import { useCaptureProgress } from './useCaptureProgress';

/**
 * 附近页的数据源（2026-11-06）。
 *
 * 采集页只在它自己挂载时轮询；用户切到附近页后，需要这里独立轮询采集状态并解码快照，
 * 雷达才能继续刷新。使用 `live: true` 保证「数据已收齐」后也不停止，`persist: false`
 * 避免把进度缓存写脏、影响采集页的自动停止。
 *
 * 2026-11-07 剥离（还原自动导入）：这里轮询到 capturing 时顺带把会话 id 绑进采集归属；
 * progress 也暴露出去 —— 「我的」页发起的采集停在附近页时，数据收齐照样由
 * autoImportFlow 自动停止并导入；附近页发起的则永不停（见 captureOriginStore）。
 */
export interface NearbyFeed {
  state: CollectorState | null;
  snapshot: NearbySnapshot | null;
  checked: boolean;
  error: string | null;
  checking: boolean;
  /** 当前进度（live 模式下也会走到 ready；用于触发自动导入等） */
  progress: CaptureProgress | null;
  /** 手动刷新：立即重新读取快照，不用切页面 */
  refresh: () => void;
}

const POLL_MS = 1500;
/**
 * 附近页发起的采集只服务雷达：只解文件尾部 2MiB，刷新间隔从 ~10s 降到 ~1s（2026-11-08）。
 * 「我的」页发起的采集仍走全量解析 —— 那里要靠完整结果判断「已收齐」并自动停止导入。
 */
const NEARBY_WINDOW_BYTES = 2 * 1024 * 1024;

export function useNearbyFeed(): NearbyFeed {
  const [state, setState] = useState<CollectorState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const mounted = useRef(true);
  const reading = useRef(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    mounted.current = true;
    const readState = async () => {
      if (reading.current) return;
      reading.current = true;
      try {
        const next = await readCollectorState();
        if (!mounted.current) return;
        setState(next);
        setStateError(null);
        // 采集真正开始后把会话 id 绑进「采集归属」（附近页发起 / 我的页发起）
        observeCollectorState(next);
      } catch (cause) {
        if (mounted.current) setStateError(cause instanceof Error ? cause.message : '无法读取采集状态');
      } finally {
        reading.current = false;
        if (mounted.current) setChecked(true);
      }
    };
    void readState();
    const poll = window.setInterval(() => { if (!document.hidden) void readState(); }, POLL_MS);
    const visible = () => { if (!document.hidden) void readState(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  const snapshot = freshNearbySnapshot(useNearbySnapshot(), state?.fileId);
  const windowBytes = isNearbyOwnedSession(state?.fileId) ? NEARBY_WINDOW_BYTES : 0;
  const progress = useCaptureProgress(state, { live: true, persist: false, refreshKey, windowBytes });
  return {
    state,
    snapshot,
    checked,
    error: stateError ?? progress.error,
    checking: progress.checking,
    progress: progress.progress,
    refresh,
  };
}
