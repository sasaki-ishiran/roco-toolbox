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
  let inspectCalls = 0;
  class WorkerStub {
    onmessage?: (event: unknown) => void;
    terminate() {}
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: fail ? { ok: false, error: '本次无法解析' } : { ok: true, value: analysis } })); }
  }
  vi.stubGlobal('Worker', WorkerStub);
  window.RocoCapture = {
    getState: () => JSON.stringify(state),
    inspectCapture: () => {
      inspectCalls += 1;
      return JSON.stringify({ id: state.fileId, size, url: 'https://roco-share.invalid/collector/12345678-1234-1234-1234-123456789abc' });
    },
  };
  const hook = renderHook((value) => useCaptureProgress(value), { initialProps: state });
  return { ...hook, failure: () => { fail = true; size++; }, inspectCalls: () => inspectCalls };
}
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('采集进度生命周期', () => {
  test('进度走满后立刻停止检测：再来数据包也不复核，不打断自动导入', async () => {
    const hook = setup();
    await tick(0); await tick(12000);
    expect(hook.result.current.progress?.stage).toBe('ready');
    const calls = hook.inspectCalls();
    hook.failure(); await tick(30000);
    expect(hook.result.current.progress?.stage).toBe('ready');
    expect(hook.result.current.error).toBeNull();
    expect(hook.inspectCalls()).toBe(calls);
  });
  test('切到后台不会清零已识别进度，回到前台也不再复核', async () => {
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
    expect(hook.result.current.progress?.stage).toBe('ready');
    hook.rerender({ ...state, phase: 'idle' });
    expect(hook.result.current.progress).toBeNull();
  });

  test('切页重挂后先恢复上次进度，不从头开始', async () => {
    const first = setup();
    await tick(0); await tick(12000);
    expect(first.result.current.progress?.stage).toBe('ready');
    const calls = first.inspectCalls();
    first.unmount();

    const second = renderHook(() => useCaptureProgress(state));
    expect(second.result.current.progress?.stage).toBe('ready');
    expect(second.result.current.sourceBytes).toBe(100);
    // 已走满的会话不再重新读快照 / 解码
    await tick(30000);
    expect(second.result.current.progress?.stage).toBe('ready');
    expect(first.inspectCalls()).toBe(calls);
  });
});
