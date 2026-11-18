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
  test('显示住户、实际配对和有没有蛋', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    expect(screen.getByTestId('home-residents')).toHaveTextContent('母本甲');
    expect(screen.getByTestId('home-residents')).toHaveTextContent('公本乙');
    expect(screen.getAllByTestId('home-pet-card')).toHaveLength(2);
    // 配窝卡片改成摆位图画法，不再带小头像：头像只有上面两张精灵卡
    expect(screen.getAllByTestId('pet-avatar')).toHaveLength(2);
    expect(screen.getByTestId('home-residents')).toHaveTextContent('50%');
    expect(screen.getByTestId('home-residents')).toHaveTextContent('99%');
    expect(screen.getByTestId('home-pair-cards')).toHaveTextContent('公本乙');
    expect(screen.getByTestId('home-pair-cards')).toHaveTextContent('母本甲');
    expect(screen.getAllByTestId('home-pair-node')).toHaveLength(2);
    expect(screen.getByTestId('home-egg-count')).toHaveTextContent('有 1 枚蛋');
    expect(screen.getByTestId('home-eggs')).toHaveTextContent('普通小窝 · 一楼');
  });

  test('多形态只展示名字，不写形态（形态由头像区分）', () => {
    const snapshot = snapshotWithHome();
    snapshot.home!.residents[0].name = '雪绒鸟_夏天的样子';
    h.snapshots = [snapshot];
    render(<HomeLand />);

    const card = screen
      .getAllByTestId('home-pet-card')
      .find((item) => item.textContent?.includes('雪绒鸟'));
    expect(card).toBeTruthy();
    expect(card).not.toHaveTextContent('夏天的样子');
    expect(card).toHaveTextContent('雪绒鸟');
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

  test('学院小窝的精灵卡标记 academy 并整卡变绿', () => {
    h.snapshots = [snapshotWithHome()];
    render(<HomeLand />);

    const cards = screen.getAllByTestId('home-pet-card');
    const academyCards = cards.filter((card) => card.getAttribute('data-academy') === 'true');
    expect(academyCards).toHaveLength(1);
    expect(academyCards[0].className).toContain('bg-emerald-50');
    expect(screen.getByText('小窝（学院 1）')).toBeTruthy();
  });

  test('家园精灵按配对顺序排：同一对挨着，1:2 的簇排到普通两对之后', () => {
    const snapshot = snapshotWithHome();
    const base = snapshot.home!.residents[0];
    const resident = (actorId: string, instanceId: string, name: string, gender: '公' | '母', academy = false) => ({
      ...base,
      actorId,
      instanceId,
      name,
      gender,
      nest: academy
        ? { ...base.nest!, nestType: 'academy' as const, nestName: '学院小窝' }
        : base.nest,
    });
    snapshot.home!.residents = [
      resident('1', '101', '甲', '母'),
      resident('2', '102', '乙', '公'),
      resident('3', '103', '丙', '母'),
      resident('4', '104', '丁', '公', true),
      resident('5', '105', '戊', '母'),
    ];
    // 两条普通配对 + 一条 1:2（丁 同时配 丙 和 戊）
    snapshot.home!.layEggCouples = [
      { femaleActorId: '1', maleActorIds: ['2'] },
      { femaleActorId: '3', maleActorIds: ['4'] },
      { femaleActorId: '5', maleActorIds: ['4'] },
    ];
    h.snapshots = [snapshot];
    render(<HomeLand />);

    const order = screen
      .getAllByTestId('home-pet-card')
      .map((card) => ['甲', '乙', '丙', '丁', '戊'].find((name) => card.textContent?.includes(name)));
    expect(order).toEqual(['甲', '乙', '丙', '丁', '戊']);
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
    expect(screen.getByTestId('home-residents')).toHaveTextContent('母本乙');
  });

  test('配窝方块同样只写基础名，完整名字放 title', () => {
    const snapshot = snapshotWithHome();
    snapshot.home!.residents[1].name = '雪绒鸟_夏天的样子';
    h.snapshots = [snapshot];
    render(<HomeLand />);

    const nodes = screen.getAllByTestId('home-pair-node');
    const node = nodes.find((item) => item.getAttribute('data-name') === '雪绒鸟_夏天的样子');
    expect(node).toBeTruthy();
    expect(node).not.toHaveTextContent('夏天的样子');
    expect(node).toHaveTextContent('雪绒鸟');
  });

  test('配对里缺少公本时降级成「公本未知」，不崩也不空白', () => {
    const snapshot = snapshotWithHome();
    if (snapshot.home) snapshot.home.layEggCouples = [{ femaleActorId: '7002', maleActorIds: ['7999'] }];
    h.snapshots = [snapshot];
    render(<HomeLand />);

    expect(screen.getByTestId('home-pair-diagram')).toHaveTextContent('公本未知');
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
    expect(screen.getByRole('note')).toHaveTextContent('只在安卓工具箱安装包内可用');
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
    expect(screen.getByTestId('home-residents')).toBeTruthy();

    fireEvent.click(screen.getByTestId('home-view-demands'));
    expect(screen.getByTestId('home-demand-placements')).toBeTruthy();
    expect(screen.queryByTestId('home-residents')).toBeNull();
    expect(screen.getByTestId('home-title')).toHaveTextContent('接单上窝');
    expect(window.localStorage.getItem('roco.homeView')).toBe('demands');

    fireEvent.click(screen.getByTestId('home-view-nests'));
    expect(screen.getByTestId('home-residents')).toBeTruthy();
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

    expect(screen.getByTestId('home-residents')).toBeTruthy();
    act(() => saveHomeView('demands'));
    expect(screen.getByTestId('home-title')).toHaveTextContent('接单上窝');
    expect(screen.getByTestId('home-view-nests')).toBeTruthy();
    expect(screen.getByTestId('home-demand-placements')).toBeTruthy();
    expect(screen.queryByTestId('home-residents')).toBeNull();
  });
});
