import { useEffect, useState } from 'react';
import { inspectUrlInWorker } from '../pcap/decodeInWorker';
import { nextCaptureProgress, type CaptureAnalysis, type CaptureProgress } from './captureProgress';
import { clearCaptureProgressCache, readCaptureProgressCache, writeCaptureProgressCache } from './captureProgressCache';
import { readCaptureSnapshot, type CollectorState } from './nativeCollector';

interface ProgressState { progress: CaptureProgress | null; sourceBytes: number; error: string | null; checking: boolean }
const empty: ProgressState = { progress: null, sourceBytes: 0, error: null, checking: false };

export function useCaptureProgress(state: CollectorState | null): ProgressState {
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
    if (initial.progress?.stage === 'ready') return;

    let disposed = false, epoch = 0;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let settled = false;
    let previous: CaptureProgress | null = cached?.progress ?? null;
    let analysisCache: { size: number; analysis: CaptureAnalysis } | null = cached
      ? { size: cached.sourceBytes, analysis: cached.analysis }
      : null;
    const active = (run: number) => !disposed && !document.hidden && run === epoch;

    const persist = (next: ProgressState, analysis: CaptureAnalysis | null) => {
      if (!analysis || !next.progress) return;
      writeCaptureProgressCache({
        session,
        progress: next.progress,
        analysis,
        sourceBytes: next.sourceBytes,
        error: next.error,
        checking: next.checking,
      });
    };

    const check = async (run: number) => {
      if (!active(run) || settled) return;
      try {
        const snapshot = await readCaptureSnapshot();
        if (!active(run)) return;
        if (!snapshot || snapshot.id !== session) {
          previous = null;
          analysisCache = null;
          clearCaptureProgressCache();
          setResult(empty);
        } else {
          let analysis = analysisCache?.size === snapshot.size ? analysisCache.analysis : null;
          if (!analysis) {
            setResult((current) => ({ ...current, checking: true }));
            controller = new AbortController();
            analysis = await inspectUrlInWorker(snapshot.url, snapshot.id, controller.signal);
          }
          if (!active(run)) return;
          analysisCache = { size: snapshot.size, analysis };
          previous = nextCaptureProgress(previous, analysis, performance.now(), session);
          const next: ProgressState = {
            progress: previous,
            sourceBytes: snapshot.size,
            error: null,
            checking: false,
          };
          setResult(next);
          persist(next, analysis);
          if (next.progress?.stage === 'ready') {
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
          writeCaptureProgressCache({
            session,
            progress: cached.progress,
            analysis: cached.analysis,
            sourceBytes: cached.sourceBytes,
            error: next.error,
            checking: false,
          });
        }
      }
      if (active(run)) timer = window.setTimeout(() => { void check(run); }, 3000);
    };

    const visibility = () => {
      if (settled) return;
      const run = ++epoch;
      window.clearTimeout(timer); controller?.abort();
      if (!document.hidden) void check(run);
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true; epoch++; window.clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, session]);
  if (!enabled || result.progress?.session !== session) return { ...empty, error: enabled ? result.error : null };
  return result;
}
