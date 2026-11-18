import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { eggGroupNames, species as catalog } from '../data/catalog';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { OwnedPet } from '../domain/types';
import { demandPickKey } from './demandPickStore';
import { HomeDemandPlacements } from './HomeDemandPlacements';
import { mutateEggMatching } from '../api/eggMatching';
vi.mock('../api/eggMatching',()=>({mutateEggMatching:vi.fn().mockResolvedValue({})}));

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
  render(<HomeDemandPlacements snapshots={[snapshot(pets)]} labelOf={() => '账号A'} />);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  h.state = { accountId: 'me', items: [], loading: false, error: '', reload: () => {} };
});

describe('家园 · 接单上窝', () => {
  test('a migrated workflow task marks placement through its task ID and version',async()=>{
    h.state.items=[demandItem({workflowTaskId:'task-new',workflowVersion:7,workflowTask:{id:'task-new',line:{gameAccountKey:'uid:1001',motherId:'cap_academy',fatherId:'cap_'+fatherSpecies.gameId+'_公'}}})];
    renderPanel([pet({gameId:egg.gameId,gender:'母',captureId:'cap_academy'}),pet({gameId:fatherSpecies.gameId,gender:'公'})]);
    expect(screen.getByTestId('home-demand-summary')).toHaveTextContent('1 个账号 · 1 单待上窝');
    expect(screen.getByTestId('home-demand-summary')).toHaveTextContent('2 只精灵');
    fireEvent.click(screen.getByTestId('home-demand-placed'));
    expect(mutateEggMatching).toHaveBeenCalledWith('g1',7,{type:'place',id:'task-new'});
  });
  test('摘要显示待上窝单数，单行默认展开', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    expect(screen.getByTestId('home-demand-summary')).toHaveTextContent('1 单待上窝');
    expect(screen.getByTestId('home-demand-row')).toBeTruthy();
  });

  test('没有实例号的同名精灵按两只算，不合并计数', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', name: '同名', captureId: undefined }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '同名', captureId: undefined }),
    ]);

    expect(screen.getByTestId('home-demand-summary')).toHaveTextContent('2 只精灵');
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
    expect(window.localStorage.getItem('roco.demandCollapsedAccounts:me')).toContain('uid:11');

    view.unmount();
    renderPanel(pets);
    expect(screen.queryByTestId('home-demand-row')).toBeNull();
  });

  test('「换配对」展开候选，点「用这对」切换成当前配对', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '种公甲', captureId: 'cap_f1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '种公乙', captureId: 'cap_f2' }),
    ]);

    fireEvent.click(screen.getByTestId('home-demand-badge'));
    expect(screen.getByTestId('home-demand-badge')).toHaveTextContent('换配对 2');
    expect(screen.getByTestId('home-demand-option-0')).toHaveTextContent('当前');
    expect(screen.getByTestId('home-demand-use-option-1')).toHaveTextContent('用这对');
    fireEvent.click(screen.getByTestId('home-demand-use-option-1'));
    expect(screen.getByTestId('home-demand-row')).toHaveTextContent('种公乙');
    expect(screen.queryByTestId('home-demand-options')).toBeNull();
  });

  test('换候选按新配对重算：同档多条都列出来，低档的不列', () => {
    h.state.items = [
      demandItem({ nature: '固执', updatedAt: 1 }),
      demandItem({ nature: '开朗', updatedAt: 2, demanderAccountId: 'm2' }),
    ];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', nature: '固执', captureId: 'cap_m1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', nature: '固执', captureId: 'cap_f0' }),
      pet({ gameId: egg.gameId, gender: '母', nature: '开朗', captureId: 'cap_m2' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '开朗公甲', nature: '开朗', captureId: 'cap_f1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '开朗公乙', nature: '开朗', captureId: 'cap_f2' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '固执公', nature: '固执', captureId: 'cap_f3' }),
    ]);

    // 第二条单默认是「双亲同性格」的 30%（60% × 性别 50%）；同档两对，30% 的那对（15%）不列
    expect(screen.getAllByTestId('home-demand-chance')[1]).toHaveTextContent('约 30%');
    expect(screen.getAllByTestId('home-demand-badge')[1]).toHaveTextContent('换配对 2');
    expect(screen.queryByText(/约 15%/)).toBeNull();

    fireEvent.click(screen.getAllByTestId('home-demand-badge')[1]);
    fireEvent.click(screen.getByTestId('home-demand-use-option-1'));

    // 换成同档的另一对：概率不变，种公换成第二只
    expect(screen.getAllByTestId('home-demand-chance')[1]).toHaveTextContent('约 30%');
    expect(screen.getAllByTestId('home-demand-row')[1]).toHaveTextContent('开朗公乙');
  });

  test('挑过的候选写进本机，重进仍按那一对显示', () => {
    h.state.items = [demandItem()];
    const pets = [
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '种公甲', captureId: 'cap_f1' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '种公乙', captureId: 'cap_f2' }),
    ];
    const view = renderPanel(pets);
    fireEvent.click(screen.getByTestId('home-demand-badge'));
    fireEvent.click(screen.getByTestId('home-demand-use-option-1'));
    expect(screen.getByTestId('home-demand-row')).toHaveTextContent('种公乙');
    expect(window.localStorage.getItem('roco.demandPlacementChoice:me')).toContain('cap_f2');

    view.unmount();
    renderPanel(pets);
    expect(screen.getByTestId('home-demand-row')).toHaveTextContent('种公乙');
    expect(screen.queryByTestId('home-demand-pref-fallback')).toBeNull();
  });

  test('小组页选的蛋会带过来，本机排不上时给出提示（R2-3-M02）', () => {
    const eggB = catalog.find(
      (entry) =>
        entry.eggGameId === entry.gameId &&
        entry.maleCapable === true &&
        entry.gameId !== egg.gameId &&
        (entry.eggGroups ?? []).includes(groupId),
    );
    expect(eggB).toBeTruthy();
    h.state.items = [demandItem({ eggGameId: -groupId, gender: '公', nature: '固执' })];
    const pets = [
      pet({ gameId: egg.gameId, gender: '母', name: '母甲', nature: '固执', captureId: 'cap_academy' }),
      pet({ gameId: eggB!.gameId, gender: '母', name: '母乙', nature: '开朗', captureId: 'cap_m2' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '公甲', nature: '开朗', captureId: 'cap_f1' }),
      pet({ gameId: egg.gameId, gender: '公', name: '公乙', nature: '固执', captureId: 'cap_f2' }),
    ];

    // 先看默认用哪一颗当母本，再选另一颗，保证用「不带选蛋」的默认结果做对照
    const first = renderPanel(pets);
    const defaultMother = screen.getAllByTestId('home-demand-parent')[0].textContent ?? '';
    first.unmount();
    const picked = defaultMother.includes('母甲') ? eggB! : egg;

    window.localStorage.setItem(
      'roco.demandPick',
      JSON.stringify({
        [demandPickKey('g1', {
          demanderAccountId: 'm1',
          eggGameId: -groupId,
          nature: '固执',
          gender: '公',
          body: '大块头',
          voice: '+100',
        })]: picked.gameId,
      }),
    );
    renderPanel(pets);
    expect(screen.getAllByTestId('home-demand-parent')[0]).toHaveTextContent(
      picked === egg ? '母甲' : '母乙',
    );
    expect(screen.queryByTestId('home-demand-pick-fallback')).toBeNull();
  });

  test('小组页选的蛋母本是进化形态时也能对上，不误报排不上（2026-11-01 用户反馈）', () => {
    // 挑一颗有进化形态的蛋：小组页记的是蛋 id，家园里的母本却可能是进化后的精灵
    const eggB = catalog.find(
      (entry) =>
        entry.eggGameId === entry.gameId &&
        entry.maleCapable === true &&
        entry.gameId !== egg.gameId &&
        (entry.eggGroups ?? []).includes(groupId) &&
        catalog.some((other) => other.eggGameId === entry.gameId && other.gameId !== entry.gameId),
    );
    expect(eggB).toBeTruthy();
    const evolved = catalog.find(
      (entry) => entry.eggGameId === eggB!.gameId && entry.gameId !== eggB!.gameId,
    );
    expect(evolved).toBeTruthy();

    h.state.items = [demandItem({ eggGameId: -groupId, gender: '公', nature: '' })];
    const pets = [
      // 排在前面的是默认母本：没选蛋时家园会用它
      pet({ gameId: egg.gameId, gender: '母', name: '母甲', captureId: 'cap_m1' }),
      pet({ gameId: evolved!.gameId, gender: '母', name: '母乙', captureId: 'cap_m2' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公', name: '种公甲', captureId: 'cap_f1' }),
    ];
    window.localStorage.setItem(
      'roco.demandPick',
      JSON.stringify({
        [demandPickKey('g1', {
          demanderAccountId: 'm1',
          eggGameId: -groupId,
          nature: '',
          gender: '公',
          body: '大块头',
          voice: '+100',
        })]: eggB!.gameId,
      }),
    );

    renderPanel(pets);
    expect(screen.getAllByTestId('home-demand-parent')[0]).toHaveTextContent('母乙');
    expect(screen.queryByTestId('home-demand-pick-fallback')).toBeNull();
  });

  test('种公需求（负数蛋组号）改用蛋组首字徽标，不再是一个字灰块（R2-2-L08）', () => {
    h.state.items = [demandItem({ eggGameId: -groupId, gender: '公', nature: '固执' })];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    const badge = screen.getByTestId('home-demand-group-badge');
    expect(badge.textContent).toBe((eggGroupNames[groupId] ?? '').slice(0, 1));
  });

  test('页头写明「按全部账号计算」，账号筛选不影响上窝（R2-2-U01）', () => {
    h.state.items = [];
    renderPanel([]);

    expect(screen.getByTestId('home-demand-scope')).toHaveTextContent('按全部 1 个账号计算');
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
    // 尺寸盖住卡片缩放后的外沿（141.6×86.7 + 2px×2）
    expect(frame.style.width).toBe('146px');
    expect(frame.style.height).toBe('91px');
  });

  test('两张亲本卡在 375 宽的行内并排放得下，不再需要横向滚动（2026-11-01 用户反馈）', () => {
    h.state.items = [demandItem()];
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    const boxes = screen.getAllByTestId('home-demand-parent-box');
    expect(boxes).toHaveLength(2);
    const total = boxes.reduce((sum, box) => sum + Number.parseFloat(box.style.width), 0);
    // 375 屏宽下：375 - 页面 32 - 区块 32 - 行边框 2 - 行内边距 16 = 293，间距 8
    expect(total + 8).toBeLessThanOrEqual(293);
    expect(screen.getByTestId('home-demand-parent-row').className).not.toContain('overflow-x-auto');
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

  test('同款需求撤回重发后重新接单，不继承旧的已上窝勾选', () => {
    const pets = [
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ];
    h.state.items = [demandItem({ updatedAt: 1 })];
    const view = renderPanel(pets);
    fireEvent.click(screen.getByTestId('home-demand-placed'));
    expect(screen.getByTestId('home-demand-placed')).toBeChecked();
    view.unmount();

    // 服务端撤回是整行删除、重发版本号从 0 重计；只有接单时间能区分新旧单
    h.state.items = [demandItem({ updatedAt: 2 })];
    renderPanel(pets);
    expect(screen.getByTestId('home-demand-placed')).not.toBeChecked();
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

  test('有一个小组读失败时也能重试，并保留已读到的单', () => {
    h.state.items = [demandItem()];
    h.state.error = '2 个小组读取失败，先显示已读到的单';
    h.state.reload = vi.fn();
    renderPanel([
      pet({ gameId: egg.gameId, gender: '母', captureId: 'cap_academy' }),
      pet({ gameId: fatherSpecies.gameId, gender: '公' }),
    ]);

    expect(screen.getByTestId('home-demand-error')).toHaveTextContent('重试');
    expect(screen.getByTestId('home-demand-row')).toBeTruthy();
    fireEvent.click(screen.getByTestId('home-demand-retry'));
    expect(h.state.reload).toHaveBeenCalled();
  });

  test('没有接单时给出去需求中心接单的指引', () => {
    h.state.items = [];
    renderPanel([]);

    expect(screen.getByTestId('home-demand-empty')).toHaveTextContent('暂无现孵任务');
  });
});
