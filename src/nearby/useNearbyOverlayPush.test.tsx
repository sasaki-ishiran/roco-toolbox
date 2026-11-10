import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NearbySnapshot } from '../collector/nearbyStore';
import { resetNearbyStoreForTest, writeNearbySnapshot } from '../collector/nearbyStore';
import { useDemandCenter } from '../ui/useDemandCenter';
import { resetNearbyOverlayBridgeForTest } from './overlayBridge';
import { resetNearbyOverlayPanelsForTest, setNearbyOverlayPanel } from './overlayPanels';
import { useNearbyOverlayPush } from './useNearbyOverlayPush';

vi.mock('../ui/useDemandCenter', () => ({ useDemandCenter: vi.fn() }));

const noDemands = {
  accountId: null,
  items: [],
  loading: false,
  error: '',
  reload: () => {},
};

function Harness() {
  useNearbyOverlayPush();
  return null;
}

const snapshot: NearbySnapshot = {
  session: 'capture-1.pcap',
  scene: 10003,
  pets: [{
    key: 'rare', cfgId: 10001, petId: 3002, name: '护主犬', level: 37, voiceDb: 100,
    weightPct: 99, kinds: ['big', 'high'], rare: true, alertReason: '+100dB 婉转声',
    distanceM: null, pos: { x: 100, y: 0, z: 0 },
  }],
  self: null,
  encounter: null,
  updatedAt: Date.now(),
};

type Phase = 'idle' | 'starting' | 'capturing' | 'stopping' | 'failed';

function installShell(phase: () => Phase) {
  const update = vi.fn((_json: string) => 'ok');
  (window as unknown as { RocoCapture: unknown }).RocoCapture = {
    getState: () => JSON.stringify({
      version: 1, supported: true, phase: phase(), message: '',
      packets: 1, bytes: 1, files: [], progressVersion: 1,
      fileId: 'capture-1.pcap', savedBytes: 1,
    }),
    updateNearbyOverlay: update,
  };
  return update;
}

function lastPayload(update: ReturnType<typeof vi.fn>) {
  return JSON.parse(String(update.mock.calls[update.mock.calls.length - 1][0]));
}

describe('useNearbyOverlayPush（应用级悬浮面板推送）', () => {
  beforeEach(() => {
    resetNearbyStoreForTest();
    resetNearbyOverlayBridgeForTest();
    resetNearbyOverlayPanelsForTest();
    vi.mocked(useDemandCenter).mockReturnValue(noDemands);
    delete (window as unknown as { RocoCapture?: unknown }).RocoCapture;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as unknown as { RocoCapture?: unknown }).RocoCapture;
  });

  test('采集从「我的」页开始（附近页没挂载）也会把面板推给安卓壳', async () => {
    const update = installShell(() => 'capturing');
    writeNearbySnapshot(snapshot);

    render(<Harness />);

    await waitFor(() => expect(update).toHaveBeenCalled());
    const sent = lastPayload(update);
    expect(sent.visible).toBe(true);
    expect(sent.pets.length).toBe(1);
    expect(sent.panels).toEqual({ battle: true, nearby: true });
  });

  test('停止采集时推一次 visible=false，壳侧据此收起', async () => {
    let phase: Phase = 'capturing';
    const update = installShell(() => phase);
    writeNearbySnapshot(snapshot);
    render(<Harness />);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(lastPayload(update).visible).toBe(true);

    phase = 'stopping';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(lastPayload(update).visible).toBe(false));
  });

  test('页面卸载时也兜底推一次收起，壳不会停在最后一帧', async () => {
    const update = installShell(() => 'capturing');
    writeNearbySnapshot(snapshot);
    const view = render(<Harness />);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(lastPayload(update).visible).toBe(true);

    view.unmount();

    expect(lastPayload(update).visible).toBe(false);
  });

  test('切换面板开关后立即重推配置', async () => {
    const update = installShell(() => 'capturing');
    writeNearbySnapshot(snapshot);
    render(<Harness />);
    await waitFor(() => expect(update).toHaveBeenCalled());

    act(() => {
      setNearbyOverlayPanel('nearby', false);
    });

    await waitFor(() => expect(lastPayload(update).panels).toEqual({ battle: true, nearby: false }));
  });

  test('节流窗口内到达的新坐标不丢：窗口结束时尾随补推最新一帧', async () => {
    vi.useFakeTimers();
    const update = installShell(() => 'capturing');
    writeNearbySnapshot(snapshot);
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(update).toHaveBeenCalledTimes(1);

    // 窗口内又来一帧：立即推被节流挡住，但不能像以前那样直接丢掉
    act(() => {
      writeNearbySnapshot({ ...snapshot, self: { x: 100, y: 200 } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(update).toHaveBeenCalledTimes(1);

    // 窗口（250ms）一结束补推，且补的是最新快照
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(update).toHaveBeenCalledTimes(2);
    expect(lastPayload(update).self).toEqual({ x: 100, y: 200 });
  });

  test('需求中心命中的精灵排在列表最前（全部档下普通精灵也进列表）', async () => {
    const update = installShell(() => 'capturing');
    vi.mocked(useDemandCenter).mockReturnValue({
      ...noDemands,
      accountId: 'u1',
      items: [{
        groupId: 'g1', demanderAccountId: 'u1', eggGameId: 3002,
        nature: '', gender: '', body: '', voice: '', status: 'open',
        claimerAccountId: null, version: 1, createdAt: 0, updatedAt: 0,
        groupName: '测试小组',
      }],
    });
    writeNearbySnapshot({
      ...snapshot,
      pets: [
        {
          key: 'demand', cfgId: 10002, petId: 3002, name: '水蓝蓝', level: 12, voiceDb: 0,
          weightPct: 50, kinds: [], rare: false, alertReason: null,
          distanceM: null, pos: { x: 100, y: 0, z: 0 },
        },
        {
          key: 'plain', cfgId: 10003, petId: 99999, name: '普通精灵', level: 6, voiceDb: 0,
          weightPct: 50, kinds: [], rare: false, alertReason: null,
          distanceM: null, pos: { x: 200, y: 0, z: 0 },
        },
      ],
      self: { x: 0, y: 0 },
    });

    render(<Harness />);

    await waitFor(() => expect(update).toHaveBeenCalled());
    const sent = lastPayload(update);
    expect(sent.pets.map((item: { key: string }) => item.key)).toEqual(['demand', 'plain']);
    expect(sent.pets[0].reason).toBe('demand');
    expect(sent.matched).toBe(2);
    expect(sent.total).toBe(2);
    expect(sent.mapPets.map((item: { key: string }) => item.key)).toEqual(['demand', 'plain']);
  });
});
