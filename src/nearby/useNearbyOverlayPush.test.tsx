import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NearbySnapshot } from '../collector/nearbyStore';
import { resetNearbyStoreForTest, writeNearbySnapshot } from '../collector/nearbyStore';
import { resetNearbyOverlayBridgeForTest } from './overlayBridge';
import { resetNearbyOverlayPanelsForTest, setNearbyOverlayPanel } from './overlayPanels';
import { useNearbyOverlayPush } from './useNearbyOverlayPush';

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
    delete (window as unknown as { RocoCapture?: unknown }).RocoCapture;
  });
  afterEach(() => {
    cleanup();
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
});
