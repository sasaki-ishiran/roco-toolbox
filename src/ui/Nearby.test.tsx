import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAutoImport, requestAutoImport } from '../collector/autoImportFlow';
import { isNearbyOwnedSession, resetCaptureOriginForTest } from '../collector/captureOriginStore';
import type { CaptureProgress } from '../collector/captureProgress';
import { resetNearbyAlertGateForTest } from '../collector/nearbyAlert';
import { resetNearbyRetainedForTest } from '../collector/nearbyRetainStore';
import type { NearbySnapshot } from '../collector/nearbyStore';
import type { SeasonEncounter } from '../collector/captureProgress';
import { useRareAlert } from '../collector/rareAlertStore';
import { useNearbyFeed } from '../collector/useNearbyFeed';
import { readNearbyOverlayPanels, resetNearbyOverlayPanelsForTest } from '../nearby/overlayPanels';
import { resetNearbyFilterForTest } from '../nearby/nearbyFilterStore';
import type { DemandCenterItem } from './useDemandCenter';
import { useDemandCenter } from './useDemandCenter';
import { Nearby } from './Nearby';

vi.mock('../collector/useNearbyFeed', () => ({ useNearbyFeed: vi.fn() }));
vi.mock('./useDemandCenter', () => ({ useDemandCenter: vi.fn() }));
vi.mock('../collector/rareAlertStore', () => ({ useRareAlert: vi.fn(() => false) }));
vi.mock('../collector/autoImportFlow', () => ({
  useAutoImport: vi.fn(() => ({ session: null, stage: 'idle', completion: null, completionError: null, error: null })),
  requestAutoImport: vi.fn(),
}));

const pets: NearbySnapshot['pets'] = [
  {
    key: 'rare', cfgId: 10001, petId: 3002, name: '护主犬', level: 37, voiceDb: 100,
    weightPct: 99, kinds: ['big', 'high'], rare: true, alertReason: '+100dB 婉转声',
    distanceM: null, pos: { x: 100, y: 0, z: 0 },
  },
  {
    key: 'normal', cfgId: 10002, petId: 3002, name: '蹦蹦种子', level: 12, voiceDb: 3,
    weightPct: 50, kinds: [], rare: false, alertReason: null,
    distanceM: null, pos: { x: -100, y: 100, z: 0 },
  },
  {
    key: 'wanted', cfgId: 10003, petId: 3001, name: '喵喵', level: 8, voiceDb: 2,
    weightPct: 50, kinds: [], rare: false, alertReason: null,
    distanceM: null, pos: { x: 0, y: 100, z: 0 },
  },
];
const snapshot: NearbySnapshot = { session: 'capture-1.pcap', scene: 10003, pets, self: null, encounter: null, updatedAt: Date.now() };

const encounter: SeasonEncounter = {
  guardName: '龙棋士', rewardPetId: 3011, rewardName: '恶魔狼',
  level: 41, natureId: 4, natureConfirmed: true, nature: '勇敢',
  gender: '公', height: 180, weight: 82000, heightPct: 45, weightPct: 30, voiceDb: 14,
};

const wantedDemand: DemandCenterItem = {
  groupId: 'g1', groupName: '小组甲', demanderAccountId: 'a1', eggGameId: 3001,
  nature: '', gender: '', body: '', voice: '', status: 'open',
  claimerAccountId: null, version: 1, createdAt: 0, updatedAt: 0,
};

const feed = (
  value: NearbySnapshot | null = snapshot,
  phase: 'capturing' | 'idle' = 'capturing',
  progress: CaptureProgress | null = null,
) => {
  vi.mocked(useNearbyFeed).mockReturnValue({
    state: {
      version: 1, supported: true, phase, message: '', packets: 1, bytes: 1,
      files: [], progressVersion: 1, fileId: 'capture-1.pcap', savedBytes: 1,
    },
    snapshot: value, checked: true, error: null, checking: false, refresh: vi.fn(), progress,
  });
};

/** 「数据已收齐」的进度（我的页发起的采集停在附近页时，由 autoImportFlow 接手） */
const readyProgress: CaptureProgress = {
  session: 'capture-1.pcap',
  analysis: {
    fingerprint: 'f', hasGameTraffic: true, hasKey: true, hasProfile: true,
    accountCount: 1, boxes: 1, records: 1, missingRecords: 0,
    hasEggInventory: true, eggInventoryComplete: true, eggRecords: 1,
    completionCandidate: true, truncated: false, flowErrors: 0, stableWaitMs: 0,
  },
  checkedAt: 0, stableSince: 0, remainingMs: 0, stage: 'ready',
};

const demandCenter = (items: DemandCenterItem[] = []) => {
  vi.mocked(useDemandCenter).mockReturnValue({
    accountId: 'a1', items, loading: false, error: '', reload: vi.fn(),
  });
};

/** 安卓壳带悬浮面板桥（window.RocoCapture.updateNearbyOverlay）：返回推送 spy */
const shellWithOverlay = () => {
  const updateNearbyOverlay = vi.fn((_json: string) => 'ok');
  window.RocoCapture = {
    getState: () => '{}',
    updateBattleOverlay: vi.fn(() => 'ok'),
    updateNearbyOverlay,
  } as unknown as Window['RocoCapture'];
  return updateNearbyOverlay;
};

const openList = () => fireEvent.click(screen.getByRole('button', { name: '列表' }));

beforeEach(() => {
  resetNearbyRetainedForTest();
  resetNearbyAlertGateForTest();
  resetCaptureOriginForTest();
  resetNearbyOverlayPanelsForTest();
  resetNearbyFilterForTest();
  window.localStorage.clear();
  vi.mocked(useRareAlert).mockReturnValue(false);
  vi.mocked(useAutoImport).mockReturnValue({ session: null, stage: 'idle', completion: null, completionError: null, error: null });
  vi.mocked(requestAutoImport).mockReset();
  demandCenter();
  delete window.RocoCapture;
  delete window.rocoDesktop;
});

describe('附近页', () => {
  test('有数据时显示状态与地图', () => {
    feed();
    render(<Nearby onNavigate={vi.fn()} />);
    expect(screen.getByTestId('nearby-map')).toBeTruthy();
    expect(screen.getByText(/场景 10003/)).toBeTruthy();
    expect(screen.getByText(/附近 3 只/)).toBeTruthy();
  });

  test('赛季奇遇战显示捕获后的精灵名与百分比', () => {
    feed({ ...snapshot, encounter });
    render(<Nearby onNavigate={vi.fn()} />);
    const card = screen.getByTestId('nearby-battle-card');
    expect(card.textContent).toContain('赛季奇遇 · 恶魔狼');
    expect(card.textContent).toContain('守卫 龙棋士');
    expect(card.textContent).toContain('L41 · 公 · 勇敢');
    expect(card.textContent).toContain('身高 1.80m（45%）');
    expect(card.textContent).toContain('体重 82.00kg（30%）');
    expect(card.textContent).toContain('声音 14dB');
  });

  test('还没拿到真实 petId 时不猜精灵名，显示守卫名', () => {
    feed({ ...snapshot, encounter: { ...encounter, rewardPetId: null, rewardName: '' } });
    render(<Nearby onNavigate={vi.fn()} />);
    const card = screen.getByTestId('nearby-battle-card');
    expect(card.textContent).toContain('赛季奇遇 · 龙棋士');
    expect(card.textContent).toContain('捕获后确认精灵');
  });

  test('切到列表后只显示高价值精灵（普通精灵不常驻）', () => {
    feed();
    demandCenter([wantedDemand]);
    render(<Nearby onNavigate={vi.fn()} />);
    openList();
    expect(screen.getAllByTestId('nearby-row')).toHaveLength(2);
    expect(screen.getByText(/护主犬/)).toBeTruthy();
    expect(screen.getAllByText(/喵喵/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/蹦蹦种子/)).toBeNull();
  });

  test('只看稀有时列表只剩稀有精灵', () => {
    feed();
    render(<Nearby onNavigate={vi.fn()} />);
    openList();
    fireEvent.click(screen.getByRole('button', { name: '稀有' }));
    expect(screen.getAllByTestId('nearby-row')).toHaveLength(1);
    expect(screen.queryByText(/蹦蹦种子/)).toBeNull();
  });

  test('只看需求时只留命中需求中心的精灵', () => {
    feed();
    demandCenter([wantedDemand]);
    render(<Nearby onNavigate={vi.fn()} />);
    openList();
    fireEvent.click(screen.getByRole('button', { name: '需求' }));
    const rows = screen.getAllByTestId('nearby-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('喵喵');
    expect(rows[0].textContent).toContain('需求中心');
  });

  test('命中需求中心时弹强提示与系统通知', async () => {
    const notify = vi.fn((_title: string, _body: string) => '');
    window.RocoCapture = { getState: () => '{}', notifyRareAlert: notify };
    vi.mocked(useRareAlert).mockReturnValue(true);
    feed();
    demandCenter([wantedDemand]);
    render(<Nearby onNavigate={vi.fn()} />);
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0][0]).toBe('需求中心精灵出现！');
    expect(String(notify.mock.calls[0][1])).toContain('喵喵');
    expect(String(notify.mock.calls[0][1])).toContain('可叫「小组甲」发需求的人来抓');
    expect(screen.getByTestId('nearby-alert')).toBeTruthy();
  });

  test('全屏后左上角显示概要与更新时间，可切到列表，关闭退出', () => {
    feed();
    render(<Nearby onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('nearby-fullscreen-open'));
    const overlay = screen.getByTestId('nearby-fullscreen-view');
    expect(within(overlay).getByText(/附近精灵 · 采集中/)).toBeTruthy();
    expect(within(overlay).getByText(/场景 10003/)).toBeTruthy();
    expect(within(overlay).getByText(/更新于/)).toBeTruthy();
    // 全屏内可切换成列表
    fireEvent.click(screen.getByTestId('nearby-fullscreen-view-list'));
    expect(screen.getByTestId('nearby-fullscreen-list')).toBeTruthy();
    fireEvent.click(screen.getByTestId('nearby-fullscreen-view-map'));
    expect(screen.queryByTestId('nearby-fullscreen-list')).toBeNull();
    fireEvent.click(screen.getByTestId('nearby-fullscreen-close'));
    expect(screen.queryByTestId('nearby-fullscreen-view')).toBeNull();
  });

  test('没有数据时显示空状态，点按钮去开始采集', () => {
    // 无采集桥（网页版）：state 读出来是 null，只有跳转入口
    vi.mocked(useNearbyFeed).mockReturnValue({
      state: null, snapshot: null, checked: true, error: null, checking: false,
      refresh: vi.fn(), progress: null,
    });
    const onNavigate = vi.fn();
    render(<Nearby onNavigate={onNavigate} />);
    expect(screen.getByText('还没有附近精灵数据')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '去开始采集' }));
    expect(onNavigate).toHaveBeenCalledWith({ type: 'open-profile', section: 'data' });
  });

  test('只有普通精灵时列表为空，提示只保留高价值', () => {
    feed({ ...snapshot, pets: [pets[1]] });
    render(<Nearby onNavigate={vi.fn()} />);
    openList();
    expect(screen.getByText('还没有高价值精灵')).toBeTruthy();
  });

  test('筛选后为空给出提示', () => {
    feed({ ...snapshot, pets: [pets[0]] });
    render(<Nearby onNavigate={vi.fn()} />);
    openList();
    fireEvent.click(screen.getByRole('button', { name: '需求' }));
    expect(screen.getByText('当前筛选下没有精灵')).toBeTruthy();
  });

  test('有采集桥：本页「开始采集」把会话标记为附近发起（不自动停止 / 导入）', async () => {
    feed(null, 'idle');
    const bridge = {
      getState: () => '{}',
      startCapture: vi.fn(() => ''),
      stopCapture: vi.fn(() => ''),
    };
    window.RocoCapture = bridge;
    render(<Nearby onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('nearby-capture-toggle'));
    await waitFor(() => expect(bridge.startCapture).toHaveBeenCalledTimes(1));
    // 待绑定窗口内：这路采集算附近发起，我的页的自动导入会跳过它
    expect(isNearbyOwnedSession()).toBe(true);
    expect(bridge.stopCapture).not.toHaveBeenCalled();
  });

  test('有采集桥且未采集：空态不给「去开始采集」跳转，本页开关直接开始', () => {
    feed(null, 'idle');
    window.RocoCapture = { getState: () => '{}', startCapture: vi.fn(() => '') };
    render(<Nearby onNavigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '去开始采集' })).toBeNull();
    expect(screen.getByTestId('nearby-capture-toggle')).toBeTruthy();
  });

  test('开始采集前检查悬浮窗权限：没授权先询问，可直接开始', async () => {
    feed(null, 'idle');
    const bridge = {
      getState: () => '{}',
      canDrawOverlay: vi.fn(() => 'false'),
      startCapture: vi.fn(() => ''),
      requestOverlayPermission: vi.fn(() => ''),
    };
    window.RocoCapture = bridge;
    render(<Nearby onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('nearby-capture-toggle'));
    await waitFor(() => expect(screen.getByTestId('overlay-permission-dialog')).toBeTruthy());
    expect(bridge.startCapture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '先不用悬浮球' }));
    await waitFor(() => expect(bridge.startCapture).toHaveBeenCalledWith('battle'));
  });

  test('选择去开启悬浮窗权限：跳系统设置，返回页面后自动开始采集', async () => {
    feed(null, 'idle');
    const bridge = {
      getState: () => '{}',
      canDrawOverlay: vi.fn(() => 'false'),
      startCapture: vi.fn(() => ''),
      requestOverlayPermission: vi.fn(() => ''),
    };
    window.RocoCapture = bridge;
    render(<Nearby onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('nearby-capture-toggle'));
    await waitFor(() => expect(screen.getByRole('button', { name: '去开启权限' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '去开启权限' }));
    await waitFor(() => expect(bridge.requestOverlayPermission).toHaveBeenCalledTimes(1));
    expect(bridge.startCapture).not.toHaveBeenCalled();
    // 从系统设置返回：页面重新可见后自动继续
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(bridge.startCapture).toHaveBeenCalledWith('battle'));
  });

  test('已授权悬浮窗时不再询问，直接开始', async () => {
    feed(null, 'idle');
    const bridge = {
      getState: () => '{}',
      canDrawOverlay: vi.fn(() => 'true'),
      startCapture: vi.fn(() => ''),
      requestOverlayPermission: vi.fn(() => ''),
    };
    window.RocoCapture = bridge;
    render(<Nearby onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('nearby-capture-toggle'));
    await waitFor(() => expect(bridge.startCapture).toHaveBeenCalledWith('battle'));
    expect(screen.queryByTestId('overlay-permission-dialog')).toBeNull();
    expect(bridge.requestOverlayPermission).not.toHaveBeenCalled();
  });

  test('网页端 / 旧壳没有 updateNearbyOverlay 时不显示展开内容开关', () => {
    feed();
    render(<Nearby onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('nearby-panel-settings')).toBeNull();
  });

  test('有悬浮面板桥时，状态卡里默认两个面板都开启', () => {
    shellWithOverlay();
    feed();
    render(<Nearby onNavigate={vi.fn()} />);
    expect(screen.getByTestId('nearby-panel-settings')).toBeTruthy();
    expect(screen.getByTestId('nearby-panel-battle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('nearby-panel-nearby').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('至少保留一项')).toBeNull();
  });

  test('关掉附近面板后只剩战斗命中：最后一个开关置灰并提示', () => {
    shellWithOverlay();
    feed();
    render(<Nearby onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('nearby-panel-nearby'));
    expect(readNearbyOverlayPanels()).toEqual({ battle: true, nearby: false });
    expect(screen.getByTestId('nearby-panel-nearby').getAttribute('aria-pressed')).toBe('false');
    const battle = screen.getByTestId('nearby-panel-battle') as HTMLButtonElement;
    expect(battle.disabled).toBe(true);
    expect(screen.getByText('至少保留一项')).toBeTruthy();
    fireEvent.click(battle);
    expect(readNearbyOverlayPanels()).toEqual({ battle: true, nearby: false });
  });

  // 悬浮面板推送到安卓壳的生命周期已移到应用级：见 src/nearby/useNearbyOverlayPush.test.tsx
  // （推送跟随采集状态，不再随本页挂载 / 卸载）

  test('「数据已收齐」时触发全局自动导入（附近页只是发起方，跳不跳由归属决定）', () => {
    feed(null, 'idle', readyProgress);
    render(<Nearby onNavigate={vi.fn()} />);
    expect(requestAutoImport).toHaveBeenCalledWith('capture-1.pcap');
  });

  test('自动导入流程的行内错误也在附近页展示', () => {
    feed();
    vi.mocked(useAutoImport).mockReturnValue({
      session: 'capture-1.pcap', stage: 'failed', completion: null, completionError: null,
      error: '停止采集失败，请重试',
    });
    render(<Nearby onNavigate={vi.fn()} />);
    expect(screen.getByText('停止采集失败，请重试')).toBeTruthy();
  });
});

/** 桌面小窗桥（window.rocoDesktop.updateNearbyOverlay）：返回推送 spy */
const desktopWithOverlay = () => {
  const updateNearbyOverlay = vi.fn((_text: string) => '');
  window.rocoDesktop = {
    platform: 'win32',
    version: '1',
    updateNearbyOverlay,
    showOverlay: vi.fn(() => ''),
    hideOverlay: vi.fn(() => ''),
    getOverlayState: vi.fn(() => '{}'),
  };
  return updateNearbyOverlay;
};

describe('桌面悬浮小窗', () => {
  test('推送与手机面板同一份口径：分贝、方位箭头、自身朝向、地图点位', async () => {
    feed();
    const update = desktopWithOverlay();
    render(<Nearby onNavigate={vi.fn()} />);
    await waitFor(() => expect(update).toHaveBeenCalled());
    const calls = update.mock.calls;
    const payload = JSON.parse(String(calls[calls.length - 1]?.[0]));
    const rare = payload.pets.find((pet: { key: string }) => pet.key === 'rare');
    expect(rare.voiceDb).toBe(100);
    expect(rare.level).toBe(37);
    expect(rare.bearingArrow).toBeTruthy();
    expect(payload.mapPets.length).toBe(3);
    // 快照没有朝向数据时不伪造箭头：字段为 null，小窗退回圆点
    expect(payload.selfHeading).toBeNull();
  });

  test('停止采集时收起小窗', async () => {
    feed();
    const update = desktopWithOverlay();
    const hideOverlay = vi.fn(() => '');
    window.rocoDesktop!.hideOverlay = hideOverlay;
    const view = render(<Nearby onNavigate={vi.fn()} />);
    await waitFor(() => expect(update).toHaveBeenCalled());
    feed(null, 'idle');
    view.rerender(<Nearby onNavigate={vi.fn()} />);
    await waitFor(() => expect(hideOverlay).toHaveBeenCalled());
  });
});
