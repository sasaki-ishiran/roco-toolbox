import { useEffect, useRef, useState } from 'react';
import { inspectBytesInWorker, inspectUrlInWorker } from '../pcap/decodeInWorker';
import { nextCaptureProgress, type CaptureAnalysis, type CaptureProgress } from './captureProgress';
import { clearCaptureProgressCache, readCaptureProgressCache, writeCaptureProgressCache } from './captureProgressCache';
import { readNearbySnapshot, writeNearbySnapshot } from './nearbyStore';
import { trackNearbySelf } from './nearbySelfTrack';
import { recordCapturePerf } from './perfProbe';
import { readLiveDecodeState, writeLiveDecodeState } from './liveDecodeStore';
import { readCaptureSnapshot, readCaptureSnapshotBytes, type CollectorState } from './nativeCollector';

interface ProgressState { progress: CaptureProgress | null; sourceBytes: number; error: string | null; checking: boolean }
const empty: ProgressState = { progress: null, sourceBytes: 0, error: null, checking: false };
/**
 * live 刷新的自适应区间（2026-11-10 下限 500 → 250）：
 * 上行自身坐标帧的中位间隔只有 106ms，500ms 一轮等于主动丢掉 4/5 的位移；
 * 解一轮很快时 250ms 就开下一轮，解一轮就慢的机器按实测耗时 + 呼吸间隔排下一轮，最多 1.5s。
 */
const LIVE_INTERVAL_MIN_MS = 250;
const LIVE_INTERVAL_MAX_MS = 1500;
/** 两轮之间留的呼吸时间：解完立刻再解会把 JS 线程排满，反而拖慢渲染与推送。 */
const LIVE_INTERVAL_HEADROOM_MS = 80;
/** 一轮解析超过这个时间还没结束就认定卡死，由后台心跳重开（2MiB 尾窗正常 1~5s）。 */
const LIVE_STALL_MS = 15000;
/**
 * 后台心跳配合的有界解析窗口（2026-11-09）：页面不可见时无论如何都用 2MiB 尾窗，
 * 否则「我的」页发起的全量采集在后台每轮都要重解整份文件，跟不上 1s 心跳。
 */
const BACKGROUND_WINDOW_BYTES = 2 * 1024 * 1024;

/**
 * 后台心跳订阅（2026-11-08）。
 *
 * 用户切到游戏后工具箱页面不可见，WebView 会把 setTimeout / setInterval 节流到
 * 每分钟一次甚至暂停，表现就是悬浮球「有时候一直不刷新」。安卓壳在主线程每秒
 * 调一次 `window.__rocoLiveTick()` 来绕过定时器节流；这里登记需要被唤醒的轮询。
 */
declare global {
  interface Window { __rocoLiveTick?: () => void }
}
const liveTicks = new Set<() => void>();
export function registerLiveTick(tick: () => void): () => void {
  liveTicks.add(tick);
  if (typeof window !== 'undefined' && !window.__rocoLiveTick) {
    window.__rocoLiveTick = () => {
      liveTicks.forEach((fn) => {
        try { fn(); } catch { /* 单个订阅失败不影响其它订阅 */ }
      });
    };
  }
  return () => {
    liveTicks.delete(tick);
    if (liveTicks.size === 0 && typeof window !== 'undefined') delete window.__rocoLiveTick;
  };
}
/**
 * 单一解码源（2026-11-10）。
 *
 * 附近页、悬浮球、悬浮窗推送都会挂 live 轮询；各自起循环会同时抢同一个 worker，
 * 一轮的耗时被摊成两份、`gap` 也翻倍，表现是球/面板都更不跟手。
 * 这里让同一时刻只有一个实例真正去读快照 + 解码，其余实例只等结果被写进
 * nearbyStore / captureProgressCache（也就是「订阅同一份快照」）。
 *
 * 交接规则：
 * - 一轮进行中绝不换手，也不 abort worker（避免半途丢弃）；
 * - 优先级：全量解析（windowBytes=0）> 尾窗解析，前台 > 后台；
 * - 同分不抢，先占着的继续跑，避免两个消费者每轮来回顶；
 * - 抢不到的实例按 `LIVE_INTERVAL_MIN_MS` 重试，所以对方卸载 / 退后台后最多 250ms 就有人接手。
 */
let liveLoopOwner: symbol | null = null;
let liveLoopScore = -1;
let liveLoopSeenAt = 0;
let liveRoundOwner: symbol | null = null;
/** 测试用：清空模块级解码源所有权，避免用例之间互相影响。 */
export function resetLiveLoopForTest() {
  liveLoopOwner = null;
  liveLoopScore = -1;
  liveLoopSeenAt = 0;
  liveRoundOwner = null;
}

export interface CaptureProgressOptions {
  /** 持续获取模式：进度走满也不停止轮询，继续按固定间隔刷新实时计数。 */
  live?: boolean;
  /**
   * 是否写 `captureProgressCache`（默认 true）。附近页用 live 轮询时传 false，
   * 避免把 ready 缓存写脏、回到采集页触发提前自动停止。
   */
  persist?: boolean;
  /** 手动刷新：递增后重启轮询 effect，立即重新读取快照 */
  refreshKey?: number;
  /**
   * 切到后台也继续轮询 / 解码（默认 false）。
   * 2026-11-08：安卓壳的系统悬浮窗要在游戏上方实时变色，网页退到后台后
   * document.hidden 为真，普通模式会停掉解码；只有原生浮窗场景才需要打开。
   */
  background?: boolean;
  /**
   * 尾部窗口字节数（2026-11-08 性能）：只解析文件最后 N 字节。
   * 附近页 / 悬浮球实时雷达用 2MiB，刷新从 ~10s 降到 ~1s；
   * 「我的」页不传（0 = 全量），进度判断与导入仍按整份文件。
   */
  windowBytes?: number;
}

export function useCaptureProgress(state: CollectorState | null, options: CaptureProgressOptions = {}): ProgressState {
  const live = Boolean(options.live);
  const requestedWindowBytes = Number(options.windowBytes) || 0;
  // background 打开时强制有界窗口：后台心跳每秒都会重开一轮，全量重解会直接卡死
  const backgroundWindowBytes = options.background ? BACKGROUND_WINDOW_BYTES : 0;
  const windowBytes = requestedWindowBytes || backgroundWindowBytes;
  // 窗口化解析结果不完整，绝不能写进进度缓存（否则采集页会拿它当作已收齐）
  const persistCache = options.persist !== false && windowBytes === 0;
  const refreshKey = options.refreshKey ?? 0;
  /**
   * 手动刷新不重建整个 effect：重建会在旧一轮解码还没结束时再排一次解码，
   * WebView 里容易叠加内存把页面打白。这里只让当前轮立即重读快照。
   */
  const restartRef = useRef<(() => void) | null>(null);
  const background = Boolean(options.background);
  const enabled = state?.phase === 'capturing' && state.progressVersion === 1;
  const session = state?.fileId;
  const hydrated = session ? readCaptureProgressCache(session) : null;
  const [result, setResult] = useState<ProgressState>(() =>
    hydrated
      ? {
          progress: hydrated.progress,
          sourceBytes: hydrated.sourceBytes,
          error: hydrated.error,
          checking: hydrated.checking,
        }
      : empty,
  );
  useEffect(() => {
    if (!enabled || !session) return;
    const cached = readCaptureProgressCache(session);
    const initial: ProgressState = cached
      ? {
          progress: cached.progress,
          sourceBytes: cached.sourceBytes,
          error: cached.error,
          checking: cached.checking,
        }
      : empty;
    setResult(initial);
    // 已经走满：彻底停下，不再读快照 / 解码。否则走满后再来个数据包就会重新复核，
    // 拖住紧随其后的自动停止与导入（2026-10-25 用户要求）。
    // 持续获取模式例外：不能停，否则实时计数就死在「已收齐」那一刻。
    if (initial.progress?.stage === 'ready' && !live) return;

    let disposed = false, epoch = 0;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let settled = false;
    let previous: CaptureProgress | null = cached?.progress ?? null;
    let analysisCache: { size: number; analysis: CaptureAnalysis } | null = cached
      ? { size: cached.sourceBytes, analysis: cached.analysis }
      : null;
    const active = (run: number) => !disposed && (background || !document.hidden) && run === epoch;
    /** 当前是否有一轮在跑 + 开始时间：后台心跳据此判断「卡死」并重开。 */
    let running = false;
    let runningSince = 0;
    /** 上一次解出的朝向与自身坐标：静止时沿用朝向、307 缺失时按位移补朝向。 */
    let lastHeading: number | null = null;
    let lastSelfPoint: { x: number; y: number } | null = null;

    // 单一解码源：本实例的身份与优先级（全量 > 尾窗，前台 > 后台）
    const owner = Symbol('rocoLiveLoop');
    const loopScore = () => (windowBytes === 0 ? 2 : 0) + (document.hidden ? 0 : 1);
    const takeLoop = () => {
      liveLoopOwner = owner;
      liveLoopScore = loopScore();
      liveLoopSeenAt = performance.now();
    };
    const claimLoop = (force = false) => {
      if (liveLoopOwner === owner) {
        liveLoopScore = loopScore();
        liveLoopSeenAt = performance.now();
        return true;
      }
      // 一轮还没跑完：等它跑完再交接，绝不中途 abort（worker 被打断等于白跑一轮）
      if (liveRoundOwner !== null) return false;
      if (liveLoopOwner === null || force) { takeLoop(); return true; }
      // 对方长时间没开新轮（被节流 / 定时器被杀）：视作失效，直接接手
      const stale = performance.now() - liveLoopSeenAt > LIVE_INTERVAL_MAX_MS * 2;
      if (stale || loopScore() > liveLoopScore) { takeLoop(); return true; }
      return false;
    };
    const releaseLoop = () => {
      if (liveLoopOwner === owner) { liveLoopOwner = null; liveLoopScore = -1; }
      if (liveRoundOwner === owner) liveRoundOwner = null;
    };

    const persist = (next: ProgressState, analysis: CaptureAnalysis | null) => {
      if (!persistCache || !analysis || !next.progress) return;
      writeCaptureProgressCache({
        session,
        progress: next.progress,
        analysis,
        sourceBytes: next.sourceBytes,
        error: next.error,
        checking: next.checking,
      });
    };

    const runCheck = async (run: number) => {
      const startedAt = performance.now();
      try {
        const snapshot = await readCaptureSnapshot();
        if (!active(run)) return;
        if (!snapshot || snapshot.id !== session) {
          previous = null;
          analysisCache = null;
          if (persistCache) clearCaptureProgressCache();
          setResult(empty);
        } else {
          // live 模式每次都重新解码：不按文件尺寸跳过，避免「文件在涨但界面不动」的假缓存
          let analysis = !live && analysisCache?.size === snapshot.size ? analysisCache.analysis : null;
          if (!analysis) {
            setResult((current) => ({ ...current, checking: true }));
            controller = new AbortController();
            if (live) {
              // 增量读取（2026-11-08）：只搬新增的一段，拼接后送 worker。
              // run() 会 transfer 走传入的 buffer，slice 一份保住主线程的增量缓存。
              const readStart = performance.now();
              const bytes = await readCaptureSnapshotBytes(snapshot, controller.signal);
              const readMs = performance.now() - readStart;
              // 冷启动恢复点：Worker 被回收后靠它继续解裁剪过的文件（见 liveDecodeStore）
              const resume = windowBytes ? readLiveDecodeState(snapshot.id) : null;
              const decodeStart = performance.now();
              analysis = await inspectBytesInWorker(bytes.slice(), snapshot.id, controller.signal, undefined, windowBytes, resume ?? undefined);
              recordCapturePerf({
                session,
                readMs,
                decodeMs: performance.now() - decodeStart,
                bytes: bytes.length,
                windowBytes,
                selfRaw: analysis.nearbySelf != null,
                selfX: analysis.nearbySelf?.x ?? null,
                selfY: analysis.nearbySelf?.y ?? null,
                pets: analysis.nearby?.length ?? 0,
              });
            } else {
              analysis = await inspectUrlInWorker(snapshot.url, snapshot.id, controller.signal, undefined, windowBytes);
            }
          }
          if (!active(run)) return;
          if (live && windowBytes && analysis.liveState) writeLiveDecodeState(snapshot.id, analysis.liveState);
          analysisCache = { size: snapshot.size, analysis };
          const scene = analysis.nearbyScene ?? null;
          const rawSelf = analysis.nearbySelf ?? null;
          // 307 是稀疏帧：本轮没解到就沿用同场景上一帧，再不行用里程计，
          // 否则自身坐标一秒变 null，地图会整块消失（2026-11-10）
          const tracked = trackNearbySelf(session, scene, analysis.nearby ?? [], rawSelf);
          const previousSnapshot = readNearbySnapshot();
          const carried = previousSnapshot
            && previousSnapshot.session === session
            && previousSnapshot.scene === scene
            ? previousSnapshot.self
            : null;
          // 自身坐标来源：壳端 RocoPerf 要看它判断「是 307 没变还是在用旧值」
          const selfSource = rawSelf ? 'packet' : tracked.self ? 'odometry' : carried ? 'stale' : 'none';
          // 自身朝向：包内没有独立朝向字段，取同一帧的速度方向（见 parseUpstreamSelfPosition）；
          // 静止时速度是 0，沿用上一次朝向，避免箭头乱指（2026-11-10 真机 pcap 验证）。
          const resolvedSelf = rawSelf ?? tracked.self ?? carried;
          let selfHeading = rawSelf?.heading ?? null;
          if (selfHeading == null && resolvedSelf && lastSelfPoint) {
            const dx = resolvedSelf.x - lastSelfPoint.x;
            const dy = resolvedSelf.y - lastSelfPoint.y;
            if (Math.hypot(dx, dy) / 100 >= 3) {
              selfHeading = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
            }
          }
          if (selfHeading == null) selfHeading = lastHeading ?? previousSnapshot?.selfHeading ?? null;
          lastHeading = selfHeading;
          if (resolvedSelf) lastSelfPoint = { x: resolvedSelf.x, y: resolvedSelf.y };
          writeNearbySnapshot({
            session,
            scene,
            pets: analysis.nearby ?? [],
            // 307 是稀疏帧：本轮没解到就先用里程计估算；估算也没有才沿用上一帧，
            // 否则自身坐标一秒变 null，地图会整块消失（2026-11-10）。
            // 注意顺序：carried 是旧坐标，不能盖掉正在更新的估算值，否则走远了地图不动。
            self: resolvedSelf,
            selfHeading,
            estimatedSelf: tracked.self,
            selfSource,
            selfAt: rawSelf || tracked.self ? Date.now() : previousSnapshot?.selfAt,
            encounter: analysis.encounter ?? null,
            hasKey: Boolean(analysis.hasKey),
            updatedAt: Date.now(),
          });
          previous = nextCaptureProgress(previous, analysis, performance.now(), session);
          const next: ProgressState = {
            progress: previous,
            sourceBytes: snapshot.size,
            error: null,
            checking: false,
          };
          setResult(next);
          persist(next, analysis);
          if (next.progress?.stage === 'ready' && !live) {
            settled = true;
            return;
          }
        }
      } catch (error) {
        if (!active(run)) return;
        previous = null;
        analysisCache = null;
        const next: ProgressState = {
          ...empty,
          error: error instanceof Error ? error.message : '暂时无法核对数据进度，正在重试',
        };
        setResult(next);
        if (cached) {
          if (persistCache) writeCaptureProgressCache({
            session,
            progress: cached.progress,
            analysis: cached.analysis,
            sourceBytes: cached.sourceBytes,
            error: next.error,
            checking: false,
          });
        }
      }
      // live 模式要尽可能跟上游戏：按上一轮实测耗时自适应（快则 250ms，慢则按耗时 +80ms 排），
      // 避免把 CPU 一直压满反而更卡。
      if (active(run)) {
        const elapsed = performance.now() - startedAt;
        const interval = live
          ? Math.max(LIVE_INTERVAL_MIN_MS,
              Math.min(LIVE_INTERVAL_MAX_MS, elapsed + LIVE_INTERVAL_HEADROOM_MS))
          : 3000;
        timer = window.setTimeout(() => { void check(run); }, interval);
      }
    };

    /** 包一层只为记录「这一轮是否还在跑」，并按单一解码源决定这一轮由谁解。 */
    const check = async (run: number, force = false) => {
      if (!active(run) || settled) return;
      if (!claimLoop(force)) {
        // 抢不到：这一轮只重排定时器，不读快照、不碰 worker，等对方这一轮结束再接管
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { void check(run); }, LIVE_INTERVAL_MIN_MS);
        return;
      }
      liveRoundOwner = owner;
      running = true;
      runningSince = performance.now();
      try {
        await runCheck(run);
      } finally {
        // 被心跳重开后旧轮次才结束：别把新轮次的 running 清掉
        if (run === epoch) running = false;
        if (liveRoundOwner === owner) liveRoundOwner = null;
        // 退到后台且自己不负责后台：让出所有权，交给还活着的实例（悬浮窗心跳那条）
        if (disposed || (!background && document.hidden)) releaseLoop();
      }
    };

    // 后台心跳：页面不可见时由安卓壳唤醒；卡死超过阈值就中止旧轮次重开
    let unregisterTick: (() => void) | null = null;
    if (background) {
      unregisterTick = registerLiveTick(() => {
        if (disposed || settled) return;
        const stalled = running && performance.now() - runningSince > LIVE_STALL_MS;
        if (running && !stalled) return;
        const run = ++epoch;
        window.clearTimeout(timer);
        controller?.abort();
        void check(run);
      });
    }

    const visibility = () => {
      if (settled) return;
      // 一轮正在解时不打断：换 epoch 会丢弃这一轮 worker 的结果，两个消费者还会互相顶
      if (running) return;
      if (background || !document.hidden) {
        const run = ++epoch;
        window.clearTimeout(timer);
        void check(run);
      } else {
        // 退到后台且自己不负责后台：让出解码源，另一条（悬浮窗心跳）下一轮就能接手
        releaseLoop();
        window.clearTimeout(timer);
      }
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    // 手动刷新：当前没有在解析就立刻重读，正在解析就等这一轮结束，避免叠加解码
    restartRef.current = () => {
      if (running || settled) return;
      window.clearTimeout(timer);
      // 用户手动刷新优先级最高：可以直接从别的消费者手里接管
      void check(epoch, true);
    };

    return () => {
      disposed = true; epoch++; window.clearTimeout(timer); controller?.abort();
      releaseLoop();
      if (unregisterTick) unregisterTick();
      document.removeEventListener('visibilitychange', visibility);
      restartRef.current = null;
    };
  }, [enabled, session, live, background, windowBytes]);
  useEffect(() => {
    if (refreshKey > 0) restartRef.current?.();
  }, [refreshKey]);
  if (!enabled || result.progress?.session !== session) return { ...empty, error: enabled ? result.error : null };
  return result;
}
