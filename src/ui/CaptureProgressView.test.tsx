import { render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useCaptureProgress } from '../collector/useCaptureProgress';
import type { CaptureAnalysis, CaptureProgress } from '../collector/captureProgress';
import type { CollectorState } from '../collector/nativeCollector';
import { CaptureProgressView } from './CaptureProgressView';

vi.mock('../collector/useCaptureProgress', () => ({ useCaptureProgress: vi.fn() }));

const analysis: CaptureAnalysis = {
  fingerprint: 'a', hasGameTraffic: true, hasKey: true, hasProfile: true, accountCount: 1,
  boxes: 1, records: 1, missingRecords: 0, hasEggInventory: true, eggInventoryComplete: true,
  eggRecords: 0, completionCandidate: true, truncated: false, flowErrors: 0, stableWaitMs: 12000,
};
const progress: CaptureProgress = {
  session: 'capture-1.pcap', analysis, checkedAt: 1, stableSince: 1, remainingMs: 0, stage: 'ready',
};
const state: CollectorState = {
  version: 1, supported: true, phase: 'capturing', message: '', packets: 2, bytes: 100,
  files: [], progressVersion: 1, fileId: 'capture-1.pcap', savedBytes: 100,
};

const mockProgress = (overrides: Partial<{ progress: CaptureProgress | null; sourceBytes: number; error: string | null; checking: boolean }> = {}) => {
  vi.mocked(useCaptureProgress).mockReturnValue({
    progress, sourceBytes: 100, error: null, checking: false, ...overrides,
  });
};

describe('采集进度走满', () => {
  test('进度条完全变绿后只通知一次自动停止', () => {
    mockProgress();
    const onReady = vi.fn();
    const { rerender } = render(<CaptureProgressView state={state} onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
    rerender(<CaptureProgressView state={state} onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test('有新流量正在复核时不自动停止', () => {
    mockProgress({ checking: true });
    const onReady = vi.fn();
    render(<CaptureProgressView state={state} onReady={onReady} />);
    expect(onReady).not.toHaveBeenCalled();
  });

  test('已经停止保存后不再通知', () => {
    mockProgress();
    const onReady = vi.fn();
    render(<CaptureProgressView state={{ ...state, phase: 'idle' }} onReady={onReady} />);
    expect(onReady).not.toHaveBeenCalled();
  });
});
