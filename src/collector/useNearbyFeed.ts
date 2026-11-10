import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollectorState } from './nativeCollector';
import { hasNativeBattleOverlay, readCollectorState } from './nativeCollector';
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

/** 附近页轮询间隔：解码是增量的（尾部 2MiB + 跨轮 resume），实测解析 <1ms，可加密到 800ms（2026-11-10） */
const POLL_MS = 800;
/**
 * 附近页发起的采集只服务雷达：只解文件尾部窗口，刷新间隔从 ~10s 降到 ~1s（2026-11-08）。
 * 「我的」页发起的采集仍走全量解析 —— 那里要靠完整结果判断「已收齐」并自动停止导入。
 *
 * 2026-11-10 真机反馈后用真 pcap 实测：同一份 1.64MiB 抓包下，256KiB / 512KiB / 1MiB
 * 三种窗口的附近结果（60 只精灵、自身坐标）与全量解析完全一致；窗口只影响「Worker 重启
 * 后第一轮要补多少」，稳态每轮只看新增帧。这里取 1MiB：比实测最小窗口留 4 倍余量，
 * 同时把重启/后台回来时的补解量从 2MiB 减半（场景 330 帧另有文件头补扫兜底）。
 */
const NEARBY_WINDOW_BYTES = 1 * 1024 * 1024;

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
  // 附近页发起的只解尾窗；「我的」发起的必须全量，autoImport 要靠完整结果判断「已收齐」
  const windowBytes = isNearbyOwnedSession(state?.fileId) ? NEARBY_WINDOW_BYTES : 0;
  const progress = useCaptureProgress(state, {
    live: true,
    persist: false,
    refreshKey,
    windowBytes,
    // 页面退到后台（游戏在前台）时也保持解码。
    // 只给「附近页发起」的会话开：这类采集只解尾窗，后台化无副作用；
    // 「我的页发起」的会话要全量解析才能判断「已收齐」，后台强制尾窗会把 progress 解残，
    // 触发 autoImport 提前停止——这类会话的悬浮窗数据由 BattleHudOrb 的心跳解码负责。
    background: hasNativeBattleOverlay() && isNearbyOwnedSession(state?.fileId),
  });
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
