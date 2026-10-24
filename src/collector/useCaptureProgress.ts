import { useEffect, useState } from 'react';
import { inspectUrlInWorker } from '../pcap/decodeInWorker';
import { nextCaptureProgress, type CaptureAnalysis, type CaptureProgress } from './captureProgress';
import { readCaptureSnapshot, type CollectorState } from './nativeCollector';

interface ProgressState { progress: CaptureProgress | null; sourceBytes: number; error: string | null; checking: boolean }
const empty: ProgressState = { progress: null, sourceBytes: 0, error: null, checking: false };

export function useCaptureProgress(state: CollectorState | null): ProgressState {
  const [result, setResult] = useState<ProgressState>(empty);
  const enabled = state?.phase === 'capturing' && state.progressVersion === 1;
  const session = state?.fileId;
  useEffect(() => {
    setResult(empty);
    if (!enabled || !session) return;
    let disposed = false, epoch = 0;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let previous: CaptureProgress | null = null;
    let cached: { size: number; analysis: CaptureAnalysis } | null = null;
    const active = (run: number) => !disposed && !document.hidden && run === epoch;
    const check = async (run: number) => {
      if (!active(run)) return;
      try {
        const snapshot = await readCaptureSnapshot();
        if (!active(run)) return;
        if (!snapshot || snapshot.id !== session) {
          previous = null; cached = null; setResult(empty);
        } else {
          let analysis = cached?.size === snapshot.size ? cached.analysis : null;
          if (!analysis) {
            setResult((current) => ({ ...current, checking: true }));
            controller = new AbortController();
            analysis = await inspectUrlInWorker(snapshot.url, snapshot.id, controller.signal);
          }
          if (!active(run)) return;
          cached = { size: snapshot.size, analysis };
          previous = nextCaptureProgress(previous, analysis, performance.now(), session);
          setResult({ progress: previous, sourceBytes: snapshot.size, error: null, checking: false });
        }
      } catch (error) {
        if (!active(run)) return;
        previous = null; cached = null;
        setResult({ ...empty, error: error instanceof Error ? error.message : '暂时无法核对数据进度，正在重试' });
      }
      if (active(run)) timer = window.setTimeout(() => { void check(run); }, 3000);
    };
    const visibility = () => {
      const run = ++epoch;
      window.clearTimeout(timer); controller?.abort();
      previous = null; cached = null; setResult(empty);
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
