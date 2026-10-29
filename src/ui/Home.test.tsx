import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AccountSnapshot } from '../domain/parseBackup';
import { HomeLand } from './Home';

const h = vi.hoisted(() => ({
  snapshots: [] as AccountSnapshot[],
  loaded: true,
}));

vi.mock('./useSnapshots', () => ({
  useSnapshots: () => ({
    snapshots: h.snapshots,
    loaded: h.loaded,
    refreshError: null,
    refreshedAt: null,
  }),
}));

const snapshotWithHome = (): AccountSnapshot => ({
  accountName: '测试甲',
  gameId: 151910,
  accountKey: 'uid:151910',
  exportedAt: '2026-10-27T00:00:00.000Z',
  importedAt: '2026-10-27T00:00:00.000Z',
  pets: [
    {
      gameId: 2201,
      name: '母本甲',
      captureId: 'capture_151910_1101',
      gender: '母',
      nature: '固执',
      voiceDb: 100,
      medalBody: '大块头',
      heightPercent: 50,
      weightPercent: 99,
      isShiny: false,
      account: '测试甲',
    },
  ],
  eggs: [],
  home: {
    schemaVersion: 1,
    gameId: '151910',
    capturedAt: '2026-10-27T00:00:00.000Z',
    homeLevel: 2,
    roomLevel: 3,
    couplesStale: false,
    snapshotKind: 'full',
    residents: [
      {
        instanceId: '1101',
        baseId: '2201',
        furnitureGuid: '8801',
        actorId: '7001',
        name: '母本甲',
        nature: '固执',
        gender: '母',
        nest: {
          furnitureGuid: '8801',
          configId: 1001071,
          nestType: 'ordinary',
          nestName: '普通小窝',
          roomName: '一楼',
        },
      },
      {
        instanceId: '1102',
        baseId: '2202',
        furnitureGuid: '8802',
        actorId: '7002',
        name: '公本乙',
        gender: '公',
        nest: {
          furnitureGuid: '8802',
          configId: 1001072,
          nestType: 'academy',
          nestName: '学院小窝',
          roomName: '一楼',
        },
      },
    ],
    nests: [
      {
        furnitureGuid: '8801',
        configId: 1001071,
        nestType: 'ordinary',
        nestName: '普通小窝',
        residentIds: ['1101'],
        roomName: '一楼',
      },
      {
        furnitureGuid: '8802',
        configId: 1001072,
        nestType: 'academy',
        nestName: '学院小窝',
        residentIds: ['1102'],
        roomName: '一楼',
      },
    ],
    layEggCouples: [{ femaleActorId: '7002', maleActorIds: ['7001'] }],
    sceneEggs: [{ actorId: '7009', furnitureGuid: '8801', npcConfigId: 301 }],
  },
});

afterEach(() => {
  cleanup();
  h.snapshots = [];
  h.loaded = true;
});

describe('家园页', () => {
  test('显示住户、实际配对和有没有蛋', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    expect(screen.getByTestId('home-residents')).toHaveTextContent('母本甲');
    expect(screen.getByTestId('home-residents')).toHaveTextContent('公本乙');
    expect(screen.getAllByTestId('home-pet-card')).toHaveLength(2);
    // 两张精灵卡 + 配窝卡片里的一公一母各一个头像
    expect(screen.getAllByTestId('pet-avatar')).toHaveLength(4);
    expect(screen.getByTestId('home-residents')).toHaveTextContent('50.00%');
    expect(screen.getByTestId('home-residents')).toHaveTextContent('99.00%');
    expect(screen.getByTestId('home-pair-cards')).toHaveTextContent('公本乙');
    expect(screen.getByTestId('home-pair-cards')).toHaveTextContent('母本甲');
    expect(screen.getAllByTestId('home-pair-card')).toHaveLength(1);
    expect(screen.getByTestId('home-egg-count')).toHaveTextContent('有 1 枚蛋');
    expect(screen.getByTestId('home-eggs')).toHaveTextContent('普通小窝 · 一楼');
  });

  test('多形态只展示名字，不写形态（形态由头像区分）', () => {
    const snapshot = snapshotWithHome();
    snapshot.home!.residents[0].name = '雪绒鸟_夏天的样子';
    h.snapshots = [snapshot];
    render(<HomeLand />);

    const card = screen.getAllByTestId('home-pet-card')[0];
    expect(card).toHaveTextContent('雪绒鸟');
    expect(card).not.toHaveTextContent('夏天的样子');
  });

  test('没有家园记录时给出采集提示', () => {
    const snapshot = snapshotWithHome();
    delete snapshot.home;
    h.snapshots = [snapshot];
    render(<HomeLand />);

    expect(screen.getByTestId('home-no-capture')).toHaveTextContent('进入家园走一圈');
  });

  test('没有蛋时明确显示没有蛋', () => {
    const snapshot = snapshotWithHome();
    if (snapshot.home) snapshot.home.sceneEggs = [];
    h.snapshots = [snapshot];
    render(<HomeLand />);

    expect(screen.getByTestId('home-egg-count')).toHaveTextContent('没有蛋');
    expect(screen.getByTestId('home-no-eggs')).toBeTruthy();
  });
});
