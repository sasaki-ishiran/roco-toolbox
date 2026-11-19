import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AccountSnapshot } from '../domain/parseBackup';
import { clearAccountFilter, toggleAccount } from './accountFilterStore';
import { HomeLand, saveHomeView } from './Home';

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

vi.mock('./useClaimedDemands', () => ({
  useClaimedDemands: () => ({
    accountId: null,
    items: [],
    loading: false,
    error: '',
    reload: () => {},
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
  clearAccountFilter();
  window.localStorage.removeItem('roco.homeView');
  h.snapshots = [];
  h.loaded = true;
});

describe('家园页', () => {
  test('显示实际配对和有没有蛋', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    // 配窝卡片（2026-11-19）：跟补全计划同一张大卡，两张精灵卡也带小头像
    expect(screen.getAllByTestId('pet-avatar')).toHaveLength(2);
    expect(screen.getByTestId('home-pair-card-list')).toHaveTextContent('公本乙');
    expect(screen.getByTestId('home-pair-card-list')).toHaveTextContent('母本甲');
    expect(screen.getAllByTestId('breed-pet-card')).toHaveLength(2);
    expect(screen.getByTestId('home-egg-count')).toHaveTextContent('有 1 枚蛋');
    // 2026-11-19 用户口径：家园下方的精灵卡和地上的蛋列表整块去掉
    expect(screen.queryByTestId('home-residents')).toBeNull();
    expect(screen.queryByTestId('home-eggs')).toBeNull();
    expect(screen.queryByTestId('home-no-eggs')).toBeNull();
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
  });

  test('小窝总数按 nests 全量计，nestType 未知的小窝也算', () => {
    const snapshot = snapshotWithHome();
    snapshot.home!.nests.push({
      furnitureGuid: '8803',
      configId: 1001073,
      nestType: null,
      nestName: '木桩小窝',
      residentIds: [],
      roomName: '二楼',
    });
    h.snapshots = [snapshot];
    render(<HomeLand />);

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('小窝（学院 1）')).toBeTruthy();
  });

  test('学院小窝的精灵卡有绿框', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    const cards = screen.getAllByTestId('breed-pet-card');
    expect(cards.filter((card) => card.className.includes('border-emerald-500'))).toHaveLength(1);
    expect(screen.getByText('小窝（学院 1）')).toBeTruthy();
  });

  test('采集期间有精灵进出时提示配对可能过期', () => {
    const snapshot = snapshotWithHome();
    if (snapshot.home) snapshot.home.couplesStale = true;
    h.snapshots = [snapshot];
    render(<HomeLand />);

    expect(screen.getByTestId('home-stale')).toHaveTextContent('重新采集一次家园会更准');
  });

  test('增量快照提示可能不含全部住户', () => {
    const snapshot = snapshotWithHome();
    if (snapshot.home) snapshot.home.snapshotKind = 'delta';
    h.snapshots = [snapshot];
    render(<HomeLand />);

    expect(screen.getByText(/这份是增量快照/)).toBeTruthy();
  });

  test('默认只展示首个账号；从二级卡切换后只展示选中的家园', () => {
    const first = snapshotWithHome();
    const second = snapshotWithHome();
    second.accountName = '测试乙';
    second.gameId = 151911;
    second.accountKey = 'uid:151911';
    second.home!.gameId = '151911';
    second.home!.residents[0].name = '母本乙';
    second.home!.residents[1].name = '公本丙';
    h.snapshots = [first, second];
    render(<HomeLand />);

    expect(screen.getByTestId('home-account-summary')).toHaveTextContent('测试甲');
    expect(screen.getByTestId('home-account-switcher').parentElement).toBe(
      screen.getByTestId('home-header'),
    );
    expect(screen.getByTestId('home-account-151910')).toBeTruthy();
    expect(screen.queryByTestId('home-account-151911')).toBeNull();

    fireEvent.click(screen.getByTestId('home-account-summary'));
    expect(screen.getByTestId('home-account-options')).toBeTruthy();
    fireEvent.click(screen.getByTestId('home-account-option-测试乙'));

    expect(screen.getByTestId('home-account-summary')).toHaveTextContent('测试乙');
    expect(screen.queryByTestId('home-account-151910')).toBeNull();
    expect(screen.getByTestId('home-account-151911')).toBeTruthy();
    expect(screen.getByTestId('home-pair-card-list')).toHaveTextContent('母本乙');
  });

  test('配窝卡片同样只写基础名，完整名字放 title', () => {
    const snapshot = snapshotWithHome();
    snapshot.home!.residents[1].name = '雪绒鸟_夏天的样子';
    h.snapshots = [snapshot];
    render(<HomeLand />);

    const card = screen
      .getAllByTestId('breed-pet-card')
      .find((item) => item.querySelector('h4')?.getAttribute('title') === '雪绒鸟_夏天的样子');
    expect(card).toBeTruthy();
    expect(card).not.toHaveTextContent('夏天的样子');
    expect(card).toHaveTextContent('雪绒鸟');
  });

  test('配对里缺少公本时降级成「公本未知」，不崩也不空白', () => {
    const snapshot = snapshotWithHome();
    if (snapshot.home) snapshot.home.layEggCouples = [{ femaleActorId: '7002', maleActorIds: ['7999'] }];
    h.snapshots = [snapshot];
    render(<HomeLand />);

    expect(screen.getByTestId('home-pair-card-list')).toHaveTextContent('公本未知');
  });

  test('刷新说明默认收在问号按钮中，点击后显示并可收起', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    expect(screen.queryByRole('button', { name: '家园现状' })).toBeNull();
    expect(screen.queryByTestId('home-title')).toBeNull();
    expect(screen.getByTestId('home-account-summary')).toHaveTextContent('测试甲');
    expect(screen.getByTestId('home-refresh-start')).toBeDisabled();
    expect(screen.queryByRole('note')).toBeNull();

    fireEvent.click(screen.getByTestId('home-refresh-help'));
    expect(screen.getByRole('note')).toHaveTextContent('只在安卓版小布助手安装包内可用');
    fireEvent.click(screen.getByTestId('home-refresh-help'));
    expect(screen.queryByRole('note')).toBeNull();

    expect(screen.getByTestId('home-view-demands').parentElement).toBe(
      screen.getByTestId('home-refresh').parentElement,
    );
  });

  test('家园分页：默认家园现状，可切到接单上窝并记住选择', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    expect(screen.queryByTestId('home-title')).toBeNull();
    expect(screen.getByTestId('home-account-summary')).toHaveTextContent('测试甲');
    expect(screen.queryByTestId('home-view-nests')).toBeNull();
    expect(screen.getByTestId('home-pair-card-list')).toBeTruthy();

    fireEvent.click(screen.getByTestId('home-view-demands'));
    expect(screen.getByTestId('home-demand-placements')).toBeTruthy();
    expect(screen.queryByTestId('home-pair-card-list')).toBeNull();
    expect(screen.getByTestId('home-title')).toHaveTextContent('接单上窝');
    expect(window.localStorage.getItem('roco.homeView')).toBe('demands');

    fireEvent.click(screen.getByTestId('home-view-nests'));
    expect(screen.getByTestId('home-pair-card-list')).toBeTruthy();
  });

  test('没导入数据时接单上窝给导入引导，不显示「都排不上」', () => {
    render(<HomeLand />);
    fireEvent.click(screen.getByTestId('home-view-demands'));

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.queryByTestId('home-demand-placements')).toBeNull();
  });

  test('全局账号筛选不影响接单上窝，照常按全部账号计算', () => {
    h.snapshots = [snapshotWithHome()];
    toggleAccount('测试甲');
    render(<HomeLand />);
    fireEvent.click(screen.getByTestId('home-view-demands'));

    expect(screen.queryByTestId('home-demand-no-account')).toBeNull();
    expect(screen.getByTestId('home-demand-placements')).toBeTruthy();
    expect(screen.getByTestId('home-demand-scope')).toHaveTextContent('按全部 1 个账号计算');
  });

  test('外部切分页（新手引导）时，已挂载的家园页跟着切，不用重新挂载', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    expect(screen.getByTestId('home-pair-card-list')).toBeTruthy();
    act(() => saveHomeView('demands'));
    expect(screen.getByTestId('home-title')).toHaveTextContent('接单上窝');
    expect(screen.getByTestId('home-view-nests')).toBeTruthy();
    expect(screen.getByTestId('home-demand-placements')).toBeTruthy();
    expect(screen.queryByTestId('home-pair-card-list')).toBeNull();
  });
});
