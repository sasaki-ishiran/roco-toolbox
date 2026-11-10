import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearCaptureProgressCache } from '../collector/captureProgressCache';
import type { CaptureAnalysis, LiveNearbyPet } from '../collector/captureProgress';
import type { CollectorState } from '../collector/nativeCollector';
import { CaptureProgressView } from './CaptureProgressView';

vi.mock('../collector/useCaptureProgress', () => ({ useCaptureProgress: vi.fn() }));
import { useCaptureProgress } from '../collector/useCaptureProgress';

const pet = (key: string, alertReason: string | null): LiveNearbyPet => ({
  key, cfgId: 10096, name: '护主犬', level: 37, voiceDb: -99, weightPct: 49,
  kinds: ['low'], rare: true, alertReason, distanceM: null,
});
const analysis: CaptureAnalysis = {
  fingerprint: 'a', hasGameTraffic: true, hasKey: true, hasProfile: true, accountCount: 1,
  boxes: 1, records: 1, missingRecords: 0, hasEggInventory: true, eggInventoryComplete: true,
  eggRecords: 0, completionCandidate: true, truncated: false, flowErrors: 0, stableWaitMs: 12000,
  nearbyPets: 1, nearbyScene: 10003, nearby: [pet('1', '-100dB 粗嗓门')],
};
const state: CollectorState = {
  version: 1, supported: true, phase: 'capturing', message: '', packets: 2, bytes: 100,
  files: [], progressVersion: 1, fileId: 'capture-1.pcap', savedBytes: 100,
};
const mock = (overrides: Partial<{ progress: unknown; sourceBytes: number; error: string | null; checking: boolean }> = {}) =>
  vi.mocked(useCaptureProgress).mockReturnValue({
    progress: { session: 'capture-1.pcap', analysis, checkedAt: 1, stableSince: 1, remainingMs: 0, stage: 'collecting' },
    sourceBytes: 100, error: null, checking: false, ...overrides,
  } as any);

beforeEach(() => { clearCaptureProgressCache(); });
afterEach(() => { delete window.RocoCapture; vi.mocked(useCaptureProgress).mockReset(); });

describe('稀有精灵提醒接线', () => {
  test('开启提醒时对可提醒的精灵调用原生通知，且同一只只响一次', async () => {
    const notify = vi.fn(() => '');
    window.RocoCapture = { getState: () => '{}', notifyRareAlert: notify };
    mock();
    const { rerender } = render(<CaptureProgressView state={state} rareAlertOn />);
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith('稀有精灵出现！', '护主犬 37级 · -100dB 粗嗓门');
    rerender(<CaptureProgressView state={state} rareAlertOn />);
    await act(async () => { await Promise.resolve(); });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('关闭提醒时不发通知', async () => {
    const notify = vi.fn(() => '');
    window.RocoCapture = { getState: () => '{}', notifyRareAlert: notify };
    mock();
    render(<CaptureProgressView state={state} />);
    await act(async () => { await Promise.resolve(); });
    expect(notify).not.toHaveBeenCalled();
  });

  test('只有牌子、不满足 ±100 或体重+声音组合的精灵不提醒', async () => {
    const notify = vi.fn(() => '');
    window.RocoCapture = { getState: () => '{}', notifyRareAlert: notify };
    mock({
      progress: {
        session: 'capture-1.pcap', checkedAt: 1, stableSince: 1, remainingMs: 0, stage: 'collecting',
        analysis: { ...analysis, nearby: [pet('2', null)] },
      },
    });
    render(<CaptureProgressView state={state} rareAlertOn />);
    await act(async () => { await Promise.resolve(); });
    expect(notify).not.toHaveBeenCalled();
  });

  test('旧壳没有 notifyRareAlert 时不报错', async () => {
    window.RocoCapture = { getState: () => '{}' };
    mock();
    render(<CaptureProgressView state={state} rareAlertOn />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('capture-progress')).toBeTruthy();
  });
});
