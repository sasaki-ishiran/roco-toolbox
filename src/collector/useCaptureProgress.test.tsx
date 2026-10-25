import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CaptureAnalysis } from './captureProgress';
import { clearCaptureProgressCache } from './captureProgressCache';
import type { CollectorState } from './nativeCollector';
import { useCaptureProgress } from './useCaptureProgress';

const analysis: CaptureAnalysis = { fingerprint: 'a', hasGameTraffic: true, hasKey: true, hasProfile: true, accountCount: 1, boxes: 1, records: 1, missingRecords: 0, hasEggInventory: true, eggInventoryComplete: true, eggRecords: 0, completionCandidate: true, truncated: false, flowErrors: 0, stableWaitMs: 12000 };
const state: CollectorState = { version: 1, supported: true, phase: 'capturing', message: '', packets: 2, bytes: 100, files: [], progressVersion: 1, fileId: 'capture-1.pcap', savedBytes: 100 };
beforeEach(() => { clearCaptureProgressCache(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.RocoCapture; });
function setup() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let fail = false;
  let size = 100;
  class WorkerStub {
    onmessage?: (event: unknown) => void;
    terminate() {}
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: fail ? { ok: false, error: '本次无法解析' } : { ok: true, value: analysis } })); }
  }
  vi.stubGlobal('Worker', WorkerStub);
  window.RocoCapture = { getState: () => JSON.stringify(state), inspectCapture: () => JSON.stringify({ id: state.fileId, size, url: 'https://roco-share.invalid/collector/12345678-1234-1234-1234-123456789abc' }) };
  const hook = renderHook((value) => useCaptureProgress(value), { initialProps: state });
  return { ...hook, failure: () => { fail = true; size++; } };
}
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('采集进度生命周期', () => {
  test('解析错误撤销旧就绪状态，继续采集仍可重试', async () => {
    const hook = setup();
    await tick(0); await tick(12000);
    expect(hook.result.current.progress?.stage).toBe('ready');
    hook.failure(); await tick(3000);
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.error).toBe('本次无法解析');
  });
  test('切到后台不会清零已识别进度，回到前台继续核对', async () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const hook = setup();
    await tick(0); await tick(12000);
    expect(hook.result.current.progress?.stage).toBe('ready');
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await tick(60000);
    expect(hook.result.current.progress?.stage).toBe('ready');
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await tick(0);
    expect(hook.result.current.progress?.stage).toBe('stabilizing');
    expect(hook.result.current.progress?.remainingMs).toBe(12000);
    hook.rerender({ ...state, phase: 'idle' });
    expect(hook.result.current.progress).toBeNull();
  });

  test('切页重挂后先恢复上次进度，不从头开始', async () => {
    const first = setup();
    await tick(0); await tick(12000);
    expect(first.result.current.progress?.stage).toBe('ready');
    first.unmount();

    const second = renderHook(() => useCaptureProgress(state));
    expect(second.result.current.progress?.stage).toBe('ready');
    expect(second.result.current.sourceBytes).toBe(100);
  });
});
