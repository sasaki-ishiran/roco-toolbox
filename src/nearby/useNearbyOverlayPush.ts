import { useEffect, useRef, useState } from 'react';
import type { CollectorState } from '../collector/nativeCollector';
import { readCollectorState } from '../collector/nativeCollector';
import { freshNearbySnapshot, useNearbySnapshot } from '../collector/nearbyStore';
import { registerLiveTick } from '../collector/useCaptureProgress';
import { hasNearbyOverlayShell, pushNearbyOverlayToShell } from './overlayBridge';
import { buildNearbyOverlayPayload } from './overlayPayload';
import { useNearbyOverlayPanels } from './overlayPanels';

/** 推送节流，与 PC 小窗同一口径 */
const PUSH_INTERVAL_MS = 800;
/** 采集状态轮询间隔（页面可见时；不可见时由安卓壳的心跳唤醒） */
const STATE_POLL_MS = 1000;

/**
 * 安卓壳悬浮面板的推送生命周期（2026-11-08，应用级）。
 *
 * 之前推送只挂在「附近」页：从「我的」页发起采集时没有面板，切页即卸载、
 * 壳停在最后一帧，停采集也不会收起。现在挂在 App 上跟随采集状态：
 * - 采集中按节流推送最新附近数据；面板开关变化立即重推；
 * - 采集停止（含 stopping）推一次 `visible=false` 让壳收起；
 * - 页面卸载 / 重载时兜底推一次收起，避免壳停在最后一帧。
 *
 * 旧 APK 没有 `updateNearbyOverlay` 时整个 hook 不做事，网页不受影响。
 */
export function useNearbyOverlayPush(): void {
  const supported = hasNearbyOverlayShell();
  const [state, setState] = useState<CollectorState | null>(null);
  // 换局后旧会话的附近数据不再推给壳（O-9），停止采集仍保留同一 session 的最后一帧
  const snapshot = freshNearbySnapshot(useNearbySnapshot(), state?.fileId);
  const panels = useNearbyOverlayPanels();

  // 轮询采集状态：可见时定时读；不可见时挂在壳的心跳上（定时器会被 WebView 节流）
  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let reading = false;
    const read = () => {
      if (disposed || reading) return;
      reading = true;
      readCollectorState()
        .then((next) => { if (!disposed) setState(next); })
        .catch(() => { /* 读不到就保持上一帧，等下一次轮询 */ })
        .finally(() => { reading = false; });
    };
    read();
    const timer = window.setInterval(() => {
      if (!document.hidden) read();
    }, STATE_POLL_MS);
    const unregisterTick = registerLiveTick(read);
    const onVisibility = () => read();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      unregisterTick();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [supported]);

  const capturing = state?.phase === 'capturing';
  const latest = useRef({ snapshot, hasKey: Boolean(snapshot?.hasKey) });
  latest.current = { snapshot, hasKey: Boolean(snapshot?.hasKey) };
  const pushed = useRef(false);
  const lastPushAt = useRef(0);
  const panelsSignature = useRef('');

  // 跟随采集状态推送（与页面是否挂载无关）
  useEffect(() => {
    if (!supported) return;
    const signature = `${panels.battle}-${panels.nearby}`;
    const panelsChanged = panelsSignature.current !== signature;
    panelsSignature.current = signature;

    const push = (visible: boolean) => {
      pushed.current = visible;
      lastPushAt.current = Date.now();
      void pushNearbyOverlayToShell(buildNearbyOverlayPayload({
        capturing: visible,
        hasKey: latest.current.hasKey,
        snapshot: latest.current.snapshot,
      }));
    };

    if (!capturing) {
      // 停止采集：必须显式推一次收起（没推过就不用推）
      if (pushed.current) push(false);
      return;
    }
    // 第一次推、或开关变化立即推；其余按节流
    if (pushed.current && !panelsChanged && Date.now() - lastPushAt.current < PUSH_INTERVAL_MS) return;
    push(true);
  }, [supported, capturing, snapshot, panels]);

  // 页面卸载 / 重载兜底收起，避免壳停在最后一帧
  useEffect(() => {
    if (!supported) return;
    const hide = () => {
      if (!pushed.current) return;
      pushed.current = false;
      void pushNearbyOverlayToShell(buildNearbyOverlayPayload({
        capturing: false,
        hasKey: latest.current.hasKey,
        snapshot: latest.current.snapshot,
      }));
    };
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      hide();
    };
  }, [supported]);
}
