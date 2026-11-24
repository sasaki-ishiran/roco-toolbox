import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as motherGroupsApi from '../../api/motherGroups';
import type { AccountSnapshot } from '../../domain/parseBackup';
import { readCurrentGroupId, saveCurrentGroupId } from '../motherGroupStore';
import { EggStockView } from './EggStockView';

/** jsdom 没有 matchMedia：横屏用例给一份方向判定。 */
const setLandscape = (landscape: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('landscape') ? landscape : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

/**
 * 小组接口按用例返回：这里 mock 的是**服务端**，不 mock `useMotherGroups`。
 * 线上 bug 的根因就是「本机偏好 ≠ 群组成员关系」，只有让真实 hook 跑起来
 * （本地没记住组 ID、服务端却返回了组）才测得到。
 */
vi.mock('../../api/motherGroups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/motherGroups')>();
  return {
    ...actual,
    listMotherGroups: vi.fn(),
    getMotherGroup: vi.fn(),
  };
});

const summary = { id: 'g1', name: '周末互换', ownerAccountId: 'acc-1', memberCount: 1 };

const detail = {
  group: { id: 'g1', name: '周末互换', ownerAccountId: 'acc-1', createdAt: 1 },
  members: [{ accountId: 'acc-1', displayName: '甲', joinedAt: 1, resourceRevision: 0, resource: null }],
};

const h = vi.hoisted(() => ({ eggs: [] as Array<Record<string, unknown>> }));

const eggOf = (id: string, gameAccountKey: string, accountName?: string): Record<string, unknown> => ({
  id, accountId: 'acc-1', gameAccountKey, ...(accountName ? { accountName } : {}),
  eggGameId: 3227, nature: '固执', body: '大块头', voice: '婉转声', kind: 'ordinary',
  status: 'available', listed: true, provenance: 'unknown', confidence: 'manual',
  labelSource: 'unknown', location: 'bag', lastConfirmedAt: 1,
});

const snapshotOf = (gameId: number, accountName: string): AccountSnapshot => ({
  accountName,
  gameId,
  accountKey: `uid:${gameId}`,
  exportedAt: '2026-11-23T00:00:00.000Z',
  importedAt: '2026-11-23T00:00:00.000Z',
  pets: [],
  eggs: [],
});

vi.mock('./useEggMatching', () => ({
  useEggMatching: () => ({
    data: { version: 1, state: { demands: [], eggs: h.eggs, lines: [], trades: [] } },
    loading: false,
    busy: false,
    error: null,
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue(undefined),
  }),
}));

/** 蛋仓屏在真实页面里由 Home 提供标题行的插槽；这里复刻同一份结构。 */
function SlotHarness({ snapshots = [] as readonly AccountSnapshot[] }: { snapshots?: readonly AccountSnapshot[] }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div>
      <div data-testid="header-slot" ref={setSlot} />
      <EggStockView snapshots={snapshots} headerSlot={slot} />
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // 已登录（身份是 localStorage 里的一行，不 mock 会话模块）
  window.localStorage.setItem('roco.accountId', 'acc-1');
  vi.mocked(motherGroupsApi.listMotherGroups).mockResolvedValue([summary]);
  vi.mocked(motherGroupsApi.getMotherGroup).mockResolvedValue(detail);
  h.eggs = [eggOf('e1', 'uid:1', '阿甲'), eggOf('e2', 'uid:1', '阿甲')];
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

test('有小组时把换蛋的蛋仓原样搬进家园页', async () => {
  saveCurrentGroupId('acc-1', 'g1');
  render(<EggStockView snapshots={[]} />);
  // 蛋仓列表本体就是组内广场那套（stock-card）
  expect(await screen.findAllByTestId('stock-card')).toHaveLength(2);
});

test('本地没记住组 ID、服务端有小组：照样渲染蛋仓，不出现「先加入一个小组」', async () => {
  // 线上场景：账号在组里，但这台设备从没进过组内广场 → localStorage 没有当前组
  expect(readCurrentGroupId('acc-1')).toBeNull();
  render(<EggStockView snapshots={[]} onGoGroups={() => {}} />);
  expect(await screen.findAllByTestId('stock-card')).toHaveLength(2);
  expect(screen.queryByTestId('egg-stock-need-group')).toBeNull();
  // 回落到的组要记住，下次进来不用再等列表
  expect(readCurrentGroupId('acc-1')).toBe('g1');
});

test('服务端一个小组都没有：才提示先加入一个小组', async () => {
  vi.mocked(motherGroupsApi.listMotherGroups).mockResolvedValue([]);
  const onGoGroups = vi.fn();
  render(<EggStockView snapshots={[]} onGoGroups={onGoGroups} />);
  expect(await screen.findByTestId('egg-stock-need-group')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '去组内广场' }));
  expect(onGoGroups).toHaveBeenCalledTimes(1);
});

test('小组列表还在加载时只说读取中，不先闪「先加入一个小组」', async () => {
  let resolveList!: (value: typeof summary[]) => void;
  vi.mocked(motherGroupsApi.listMotherGroups).mockReturnValue(
    new Promise<typeof summary[]>((resolve) => { resolveList = resolve; }),
  );
  render(<EggStockView snapshots={[]} />);
  expect(screen.getByTestId('egg-stock-loading-groups')).toBeTruthy();
  expect(screen.queryByTestId('egg-stock-need-group')).toBeNull();
  await act(async () => { resolveList([summary]); });
  expect(await screen.findAllByTestId('stock-card')).toHaveLength(2);
});

test('组列表读失败：不说「没有小组」，给重试', async () => {
  vi.mocked(motherGroupsApi.listMotherGroups).mockRejectedValue(new Error('网络连接失败，请检查网络后重试'));
  render(<EggStockView snapshots={[]} />);
  expect(await screen.findByTestId('egg-stock-group-error')).toBeTruthy();
  expect(screen.queryByTestId('egg-stock-need-group')).toBeNull();
});

test('没登录时提示先登录，不渲染蛋仓列表', async () => {
  window.localStorage.removeItem('roco.accountId');
  const onGoAccount = vi.fn();
  render(<EggStockView snapshots={[]} onGoAccount={onGoAccount} />);
  expect(screen.getByTestId('egg-stock-need-account')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '去登录' }));
  expect(onGoAccount).toHaveBeenCalledTimes(1);
  expect(screen.queryAllByTestId('stock-card')).toHaveLength(0);
  expect(screen.queryByTestId('egg-stock-need-group')).toBeNull();
});

test('角色筛选：标题行列出本账号的游戏角色，选中后只留这个角色的蛋', async () => {
  h.eggs = [eggOf('a1', 'uid:1', '阿甲'), eggOf('a2', 'uid:1', '阿甲'), eggOf('b1', 'uid:2', '阿乙')];
  render(<SlotHarness />);
  expect(await screen.findAllByTestId('stock-card')).toHaveLength(3);
  const slot = screen.getByTestId('header-slot');
  const select = within(slot).getByRole('combobox', { name: '按游戏角色筛选' });
  expect(within(select).getAllByRole('option').map((option) => option.textContent))
    .toEqual(['全部角色', '阿甲', '阿乙']);
  fireEvent.change(select, { target: { value: 'uid:2' } });
  expect(screen.getAllByTestId('stock-card')).toHaveLength(1);
});

test('蛋上没带角色名：用本机快照里的账号名顶上', async () => {
  h.eggs = [eggOf('a1', 'uid:1', '阿甲'), eggOf('b1', 'uid:2')];
  render(<SlotHarness snapshots={[snapshotOf(2, '阿乙')]} />);
  expect(await screen.findAllByTestId('stock-card')).toHaveLength(2);
  const select = within(screen.getByTestId('header-slot')).getByRole('combobox', { name: '按游戏角色筛选' });
  expect(within(select).getAllByRole('option').map((option) => option.textContent))
    .toEqual(['全部角色', '阿甲', '阿乙']);
});

test('只有一个游戏角色：不出现角色筛选，别白占标题行', async () => {
  render(<SlotHarness />);
  expect(await screen.findAllByTestId('stock-card')).toHaveLength(2);
  expect(within(screen.getByTestId('header-slot')).queryByRole('combobox')).toBeNull();
});

test('横屏蛋仓的标题栏带返回家园，点了回家园页', async () => {
  setLandscape(true);
  saveCurrentGroupId('acc-1', 'g1');
  const onBack = vi.fn();
  render(<EggStockView snapshots={[]} onBack={onBack} />);
  await screen.findAllByTestId('stock-card');
  fireEvent.click(screen.getByRole('button', { name: '返回家园' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('横屏 + 未登录：空态也能回到家园', () => {
  setLandscape(true);
  window.localStorage.removeItem('roco.accountId');
  const onBack = vi.fn();
  render(<EggStockView snapshots={[]} onGoAccount={() => {}} onBack={onBack} />);
  expect(screen.getByTestId('egg-stock-need-account')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回家园' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('横屏未登录空态：不留说明，只放居中的去登录按钮', () => {
  setLandscape(true);
  window.localStorage.removeItem('roco.accountId');
  render(<EggStockView snapshots={[]} onGoAccount={() => {}} onBack={() => {}} />);

  const empty = screen.getByTestId('egg-stock-need-account');
  // 2026-11-24 用户口径：文案移除、按钮缩到 1/3 宽并居中
  expect(empty.querySelector('p')).toBeNull();
  expect(empty.className).toContain('items-center');
  const button = within(empty).getByRole('button', { name: '去登录' });
  expect(button.className).toContain('w-1/3');
  expect(button.className).toContain('mx-auto');
});

test('横屏 + 服务端没有小组：空态也能回到家园', async () => {
  setLandscape(true);
  vi.mocked(motherGroupsApi.listMotherGroups).mockResolvedValue([]);
  const onBack = vi.fn();
  render(<EggStockView snapshots={[]} onGoGroups={() => {}} onBack={onBack} />);
  expect(await screen.findByTestId('egg-stock-need-group')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回家园' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('未登录空态不把蛋仓屏记进下次启动：重新挂载会回到家园', () => {
  window.localStorage.setItem('roco.homeView', 'stock');
  window.localStorage.removeItem('roco.accountId');
  // 模拟 Home 的读法：只有记住「stock」才会直接落在蛋仓屏
  const Mount = () =>
    window.localStorage.getItem('roco.homeView') === 'stock'
      ? <EggStockView snapshots={[]} />
      : <p>家园首页</p>;
  const first = render(<Mount />);
  expect(screen.getByTestId('egg-stock-need-account')).toBeTruthy();
  expect(window.localStorage.getItem('roco.homeView')).toBeNull();
  first.unmount();
  render(<Mount />);
  expect(screen.getByText('家园首页')).toBeTruthy();
  expect(screen.queryByTestId('home-egg-stock-view')).toBeNull();
});

test('没有小组的空态也不把蛋仓屏记进下次启动', async () => {
  window.localStorage.setItem('roco.homeView', 'stock');
  vi.mocked(motherGroupsApi.listMotherGroups).mockResolvedValue([]);
  const Mount = () =>
    window.localStorage.getItem('roco.homeView') === 'stock'
      ? <EggStockView snapshots={[]} />
      : <p>家园首页</p>;
  const first = render(<Mount />);
  expect(await screen.findByTestId('egg-stock-need-group')).toBeTruthy();
  expect(window.localStorage.getItem('roco.homeView')).toBeNull();
  first.unmount();
  render(<Mount />);
  expect(screen.getByText('家园首页')).toBeTruthy();
});

test('加载中不抹掉分页记忆：别把「还在读小组」当成空态', async () => {
  window.localStorage.setItem('roco.homeView', 'stock');
  let resolveList!: (value: typeof summary[]) => void;
  vi.mocked(motherGroupsApi.listMotherGroups).mockReturnValue(
    new Promise<typeof summary[]>((resolve) => { resolveList = resolve; }),
  );
  render(<EggStockView snapshots={[]} />);
  expect(screen.getByTestId('egg-stock-loading-groups')).toBeTruthy();
  expect(window.localStorage.getItem('roco.homeView')).toBe('stock');
  await act(async () => { resolveList([summary]); });
  await screen.findAllByTestId('stock-card');
  expect(window.localStorage.getItem('roco.homeView')).toBe('stock');
});

test('有账号有小组时保留分页记忆，不打扰正常回访', async () => {
  window.localStorage.setItem('roco.homeView', 'stock');
  saveCurrentGroupId('acc-1', 'g1');
  render(<EggStockView snapshots={[]} />);
  expect(await screen.findAllByTestId('stock-card')).toHaveLength(2);
  expect(window.localStorage.getItem('roco.homeView')).toBe('stock');
});
