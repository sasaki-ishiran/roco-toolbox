import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CaptureAnalysis } from './captureProgress';
import { clearCaptureProgressCache } from './captureProgressCache';
import type { CollectorState } from './nativeCollector';
import { useCaptureProgress, resetLiveLoopForTest } from './useCaptureProgress';
import { resetDecodeWorkerForTest } from '../pcap/decodeInWorker';

const analysis: CaptureAnalysis = { fingerprint: 'a', hasGameTraffic: true, hasKey: true, hasProfile: true, accountCount: 1, boxes: 1, records: 1, missingRecords: 0, hasEggInventory: true, eggInventoryComplete: true, eggRecords: 0, completionCandidate: true, truncated: false, flowErrors: 0, stableWaitMs: 12000 };
const state: CollectorState = { version: 1, supported: true, phase: 'capturing', message: '', packets: 2, bytes: 100, files: [], progressVersion: 1, fileId: 'capture-1.pcap', savedBytes: 100 };
beforeEach(() => { clearCaptureProgressCache(); });
afterEach(() => { resetDecodeWorkerForTest(); resetLiveLoopForTest(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.RocoCapture; delete window.__rocoLiveTick; });
function setup(options: { live?: boolean; background?: boolean; windowBytes?: number } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let fail = false;
  let size = 100;
  let inspectCalls = 0;
  class WorkerStub {
    onmessage?: (event: unknown) => void;
    terminate() {}
    // Worker 长驻后请求带 id，回包必须原样带回，主线程才认得出是哪一轮
    postMessage(message: { id?: number }) { queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ...(fail ? { ok: false, error: '本次无法解析' } : { ok: true, value: analysis }) } })); }
  }
  vi.stubGlobal('Worker', WorkerStub);
  // live 分支走增量读取（readCaptureSnapshotBytes）：首轮全量，之后 ?from=N 只取新增段
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const match = /[?&]from=(\d+)/.exec(String(input));
    const from = match ? Number(match[1]) : 0;
    return {
      ok: true,
      headers: { get: (name: string) => (name === 'X-Capture-From' ? String(from) : null) },
      arrayBuffer: async () => new Uint8Array(Math.max(0, size - from)).buffer,
    } as unknown as Response;
  }));
  window.RocoCapture = {
    getState: () => JSON.stringify(state),
    inspectCapture: () => {
      inspectCalls += 1;
      return JSON.stringify({ id: state.fileId, size, url: 'https://roco-share.invalid/collector/12345678-1234-1234-1234-123456789abc' });
    },
  };
  const hook = renderHook((value) => useCaptureProgress(value, options), { initialProps: state });
  return { ...hook, failure: () => { fail = true; size++; }, grow: () => { size += 100; }, inspectCalls: () => inspectCalls };
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
  test('持续获取模式：走满后继续读快照，新数据能刷新', async () => {
    const hook = setup({ live: true });
    await tick(0); await tick(15000);
    expect(hook.result.current.progress?.stage).toBe('ready');
    const calls = hook.inspectCalls();
    hook.grow();
    await tick(2500);
    expect(hook.inspectCalls()).toBeGreaterThan(calls);
    expect(hook.result.current.sourceBytes).toBe(200);
  });
  test('一轮解码很快时约 250ms 就开下一轮，不再固定等 500ms', async () => {
    const hook = setup({ live: true });
    await tick(0);
    const calls = hook.inspectCalls();
    hook.grow();
    await tick(260);
    expect(hook.inspectCalls()).toBeGreaterThan(calls);
  });
  test('后台心跳能直接唤醒一轮刷新，不依赖被节流的页面定时器', async () => {
    const hook = setup({ live: true, background: true, windowBytes: 2 * 1024 * 1024 });
    await tick(0);
    const calls = hook.inspectCalls();
    hook.grow();
    // 页面定时器不推进，只模拟安卓壳每秒调一次 __rocoLiveTick
    await act(async () => { window.__rocoLiveTick?.(); await Promise.resolve(); });
    expect(hook.inspectCalls()).toBeGreaterThan(calls);
    expect(hook.result.current.sourceBytes).toBe(200);
  });
});

describe('单一解码源（两个消费者共享一轮）', () => {
  test('悬浮球与附近页同时挂 live 时，一轮只解一次，不会各自起循环', async () => {
    // 悬浮球那条：后台也继续，尾窗
    const orb = setup({ live: true, background: true, windowBytes: 2 * 1024 * 1024 });
    await tick(0);
    const calls = orb.inspectCalls();
    // 附近页那条：前台、全量（优先级更高）
    const nearby = renderHook(() => useCaptureProgress(state, { live: true, persist: false }));
    await tick(0);
    await tick(1000);
    const rounds = orb.inspectCalls() - calls;
    // 单源：1s 约 250ms 一轮；两条各自解码会翻到 8 次以上
    expect(rounds).toBeGreaterThan(0);
    expect(rounds).toBeLessThan(7);
    nearby.unmount();
  });

  test('前台全量消费者能从前台/后台的尾窗循环手里接管，进度照常刷新', async () => {
    setup({ live: true, background: true, windowBytes: 2 * 1024 * 1024 });
    await tick(0);
    // 全量那条挂上后应当接管，并把完整进度算出来（尾窗结果不写进度缓存）
    const nearby = renderHook(() => useCaptureProgress(state, { live: true }));
    await tick(0);
    await tick(12000);
    expect(nearby.result.current.progress?.stage).toBe('ready');
    expect(nearby.result.current.sourceBytes).toBe(100);
    nearby.unmount();
  });

  test('前台循环退到后台让出后，后台循环在最小间隔内接手，不停更', async () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const orb = setup({ live: true, background: true, windowBytes: 2 * 1024 * 1024 });
    await tick(0);
    const nearby = renderHook(() => useCaptureProgress(state, { live: true }));
    await tick(0); // 前台全量接管
    const calls = orb.inspectCalls();
    // 切到后台：附近页让出解码源，只剩悬浮窗那条
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await tick(500);
    expect(orb.inspectCalls()).toBeGreaterThan(calls);
    nearby.unmount();
  });
});
