import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { species as catalog } from '../data/catalog';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { OwnedPet } from '../domain/types';
import { HomeDemandPlacements } from './HomeDemandPlacements';

const h = vi.hoisted(() => ({
  state: {
    accountId: 'me' as string | null,
    items: [] as Array<Record<string, unknown>>,
    loading: false,
    error: '',
    reload: () => {},
  },
}));

vi.mock('./useClaimedDemands', () => ({
  useClaimedDemands: () => h.state,
}));

const egg = catalog.find(
  (entry) =>
    entry.eggGameId === entry.gameId &&
    entry.maleCapable === true &&
    (entry.eggGroups ?? []).some((group) => group > 1),
)!;
const groupId = (egg.eggGroups ?? []).find((group) => group > 1)!;
const fatherSpecies = catalog.find(
  (entry) =>
    entry.gameId !== egg.gameId &&
    entry.maleCapable === true &&
    (entry.eggGroups ?? []).includes(groupId),
)!;

const pet = (over: Partial<OwnedPet> & Pick<OwnedPet, 'gameId' | 'gender'>): OwnedPet => ({
  name: '精灵',
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  weightPercent: 99,
  heightPercent: 100,
  isShiny: false,
  account: '账号A',
  captureId: `cap_${over.gameId}_${over.gender}`,
  ...over,
});

const snapshot = (pets: OwnedPet[]): AccountSnapshot => ({
  accountName: '账号A',
  gameId: 11,
  accountKey: 'uid:11',
  exportedAt: '2026-10-30T00:00:00.000Z',
  importedAt: '2026-10-30T00:00:00.000Z',
  pets,
  eggs: [],
  // 接单上窝只推荐绿窝方案，测试母本固定放在学院小窝（captureId cap_academy）。
  home: {
    schemaVersion: 1,
    gameId: '11',
    capturedAt: '2026-10-30T00:00:00.000Z',
    residents: [
      {
        instanceId: 'academy',
        baseId: '0',
        furnitureGuid: 'nest-1',
        actorId: 'actor-1',
        name: '学院精灵',
        nest: { furnitureGuid: 'nest-1', configId: 1, nestType: 'academy', nestName: '学院小窝' },
      },
    ],
    nests: [],
    layEggCouples: [],
    sceneEggs: [],
    couplesStale: false,
  },
});

const demandItem = (over: Record<string, unknown> = {}) => ({
  groupId: 'g1',
  groupName: '孵蛋互助',
  demanderAccountId: 'm1',
  eggGameId: egg.gameId,
  nature: '固执',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'claimed',
  claimerAccountId: 'me',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const renderPanel = (pets: OwnedPet[]) =>
  render(
    <HomeDemandPlacements snapshots={[snapshot(pets)]} labelOf={() => '账号A'} loaded />,
  );

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  h.state = { accountId: 'me', items: [], loading: false, error: '', reload: () => {} };
});

describe('家园 · 接单上窝', () => {
  test('摘要显示待上窝单数，单行默认展开', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    expect(screen.getByTestId('home-demand-summary')).toHaveTextContent('1 单待上窝');
    expect(screen.getByTestId('home-demand-row')).toBeTruthy();
  });

  test('按账号列出母本与种公卡', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    expect(screen.getByTestId('home-demand-account')).toHaveTextContent('账号A');
    expect(screen.getAllByTestId('home-demand-parent')).toHaveLength(2);
    expect(screen.getByTestId('home-demand-row')).toHaveTextContent('来自「孵蛋互助」');
  });

  test('勾选已上窝写进本机记忆', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    fireEvent.click(screen.getByTestId('home-demand-placed'));
    const stored = window.localStorage.getItem('roco.demandPlacements:me');
    expect(stored).toBeTruthy();
    expect(stored).toContain('g1');
  });

  test('账号可以单独收起和展开', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    fireEvent.click(screen.getByTestId('home-demand-account-toggle'));
    expect(screen.queryByTestId('home-demand-row')).toBeNull();
    expect(screen.getByTestId('home-demand-summary')).toHaveTextContent('1 单待上窝');
    fireEvent.click(screen.getByTestId('home-demand-account-toggle'));
    expect(screen.getByTestId('home-demand-row')).toBeTruthy();
  });

  test('账号折叠状态写本机并在重新打开时恢复', () => {
    h.state.items = [demandItem()];
    const pets = [
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ];
    const view = renderPanel(pets);
    fireEvent.click(screen.getByTestId('home-demand-account-toggle'));
    expect(window.localStorage.getItem('roco.demandCollapsedAccounts')).toContain('uid:11');

    view.unmount();
    renderPanel(pets);
    expect(screen.queryByTestId('home-demand-row')).toBeNull();
  });

  test('候选可以切换成当前配对', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '种公甲', captureId: 'cap_f1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '种公乙', captureId: 'cap_f2' }),
    ]);

    fireEvent.click(screen.getByTestId('home-demand-badge'));
    expect(screen.getByTestId('home-demand-option-0')).toHaveTextContent('当前');
    fireEvent.click(screen.getByTestId('home-demand-option-1'));
    expect(screen.getByTestId('home-demand-row')).toHaveTextContent('种公乙');
    expect(screen.queryByTestId('home-demand-options')).toBeNull();
  });

  test('已在家园的绿描边单独画在卡片上层，不会被卡片边框和阴影压住', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    const frames = screen.getAllByTestId('home-demand-parent-frame');
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame.className).toContain('border-emerald-300');
    expect(frame.className).toContain('pointer-events-none');
    // 尺寸盖住卡片缩放后的外沿（150.4×112.8 + 2px×2）
    expect(frame.style.width).toBe('154px');
    expect(frame.style.height).toBe('117px');
  });

  test('提示按可孵出概率配色：学院方案 50% 绿', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', nature: '固执', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', nature: '开朗' }),
    ]);

    const chance = screen.getByTestId('home-demand-chance');
    expect(chance).toHaveTextContent('约 50%');
    expect(chance.className).toContain('text-emerald-700');
  });

  test('双亲同性格时 30% 概率，提示用黄色', () => {
    // 先来的单占掉学院小窝，这条只能走普通窝（双亲同性格 60% × 性别 50%）
    h.state.items = [
      demandItem({ nature: '固执', updatedAt: 1 }),
      demandItem({ nature: '开朗', updatedAt: 2, demanderAccountId: 'm2' }),
    ];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', nature: '固执', captureId: 'cap_m1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', nature: '固执' }),
      pet({ gameId: egg.gameId, gender: '母', nature: '开朗', captureId: 'cap_m2' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', nature: '开朗' }),
    ]);

    const chance = screen.getAllByTestId('home-demand-chance')[1];
    expect(chance).toHaveTextContent('约 30%');
    expect(chance.className).toContain('text-amber-600');
  });

  test('只有一方带目标性格时 15% 概率，提示用红色', () => {
    h.state.items = [
      demandItem({ nature: '固执', updatedAt: 1 }),
      demandItem({ nature: '慎重', updatedAt: 2, demanderAccountId: 'm2' }),
    ];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', nature: '固执', captureId: 'cap_m1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', nature: '固执' }),
      pet({ gameId: egg.gameId, gender: '母', nature: '慎重', captureId: 'cap_m2' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', nature: '沉默' }),
    ]);

    const chance = screen.getAllByTestId('home-demand-chance')[1];
    expect(chance).toHaveTextContent('约 15%');
    expect(chance.className).toContain('text-rose-600');
  });

  test('不挑性格时只算性别概率：50% 绿', () => {
    h.state.items = [demandItem({ nature: '' })];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', nature: '慎重', captureId: 'cap_m1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', nature: '沉默' }),
    ]);

    const chance = screen.getByTestId('home-demand-chance');
    expect(chance).toHaveTextContent('约 50%');
    expect(chance.className).toContain('text-emerald-700');
  });

  test('排不上的单单独列出原因', () => {
    h.state.items = [demandItem()];
    renderPanel([pet({ gameId: egg.gameId, gender: '母' })]);

    const skip = screen.getByTestId('home-demand-skip');
    expect(skip).toHaveTextContent('本机没有满足条件的种公');
  });

  test('未登录时提示先开启云同步', () => {
    h.state.accountId = null;
    h.state.items = [];
    renderPanel([]);

    expect(screen.getByTestId('home-demand-signed-out')).toHaveTextContent('开启云同步');
  });

  test('没有接单时给出去需求中心接单的指引', () => {
    h.state.items = [];
    renderPanel([]);

    expect(screen.getByTestId('home-demand-empty')).toHaveTextContent('需求中心');
  });
});
