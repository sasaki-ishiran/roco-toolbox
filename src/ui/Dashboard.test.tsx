import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import type { CollectionSummary } from './useCollectionSummary';
import type { NestPet, NestPlan } from '../domain/nestPlan';
import { toggleAllAccounts } from './accountFilterStore';

const h = vi.hoisted(() => ({
  summary: null as unknown as CollectionSummary,
  accounts: ['测试甲'],
}));

vi.mock('./useCollectionSummary', () => ({ useCollectionSummary: () => h.summary }));
vi.mock('./useOwnedPets', () => ({
  useOwnedPets: () => ({ owned: h.summary.owned, accounts: h.accounts }),
}));

const motherGroup = (index: number) =>
  ({
    chainKey: `c${index}`,
    formLabel: `母本${index}`,
    memberIndexes: [],
    eggGroups: [2],
    motherClass: null,
    eggGameId: 100 + index,
  }) as never;

const nestPet = (key: string, name: string, gender: '公' | '母'): NestPet => ({
  key,
  gameId: 3001,
  name,
  account: '测试甲',
  gender,
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  box: '盒子1 第1位',
});

/** 手写一份可展示的配窝方案，验证看板直接渲染摆位与配对 */
const demoPlan: NestPlan = {
  account: '测试甲',
  pairings: [{
    tier: 'normal60',
    groupIds: [2],
    natureName: '固执',
    grade: '大婉',
    account: '测试甲',
    father: nestPet('f', '父兽', '公'),
    mother: nestPet('m', '母兽', '母'),
    academyParent: null,
    partner: nestPet('f', '父兽', '公'),
    natureChance: 0.6,
    distance: 8,
    fatherPosition: { x: 8, y: 0 },
    motherPosition: { x: 0, y: 0 },
    expected: { species: '母兽', nature: '固执', body: '大块头', voice: '100' },
  }],
  blockedLinks: [],
  slots: [
    { position: { x: 0, y: 0 }, pet: nestPet('m', '母兽', '母'), cluster: 0, academy: false },
    { position: { x: 8, y: 0 }, pet: nestPet('f', '父兽', '公'), cluster: 0, academy: false },
  ],
  nestsUsed: 2,
  nestsTotal: 11,
  clusters: [[{ x: 0, y: 0 }, { x: 8, y: 0 }]],
  unfilled: [],
  alternatives: [],
};

beforeEach(() => {
  h.accounts = ['测试甲'];
  toggleAllAccounts([]);
  h.summary = {
    loaded: true,
    owned: [{ gameId: 3200, account: '测试甲' } as never],
    motherGroups: Array.from({ length: 5 }, (_, index) => motherGroup(index)),
    mode: 'perfect',
    mother: { collected: 0, total: 5 },
    stud: {
      cells: [
        { groupId: 3, state: 'breedable' } as never,
        { groupId: 4, state: 'empty' } as never,
      ],
      groupCount: 14,
      passedGroups: 0,
      total: 2,
      covered: 2,
      groupSummary: [],
    },
    plans: [],
    recommendations: [
      {
        id: 'r1',
        natureName: '固执',
        displayName: '火花',
        groupIds: [2],
        groupLabels: ['巨灵组'],
        grade: '大婉',
        gameId: 1,
      },
    ],
  };
});

describe('Dashboard（看板）', () => {
  test('有导入账号但全部被筛掉时不误报未导入', () => {
    toggleAllAccounts(h.accounts);
    h.summary = { ...h.summary, owned: [], recommendations: [] };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('recommend-empty')).not.toHaveTextContent('导入抓包数据');
    expect(screen.getByTestId('dashboard-empty-accounts')).toHaveTextContent('当前未选中任何账号');
  });

  test('单个账号被筛掉时仍保留恢复筛选入口', () => {
    toggleAllAccounts(h.accounts);
    h.summary = { ...h.summary, owned: [], recommendations: [] };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('account-filter')).toBeTruthy();
    expect(screen.getByTestId('account-filter-toggle-all')).toHaveTextContent('全选');
    fireEvent.click(screen.getByTestId('account-filter-toggle-all'));
    expect(screen.queryByTestId('dashboard-empty-accounts')).toBeNull();
  });

  test('未设置种公目标时配窝摘要不声称全部收集', () => {
    h.summary = {
      ...h.summary,
      stud: { ...h.summary.stud, cells: [], groupCount: 0, passedGroups: 0, total: 0 },
      recommendations: [],
    };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('nest-summary-line')).toHaveTextContent('未设置种公目标');
    expect(screen.getByTestId('nest-summary-line')).not.toHaveTextContent('全部收集');
  });
  test('结构与顺序：目标摘要 → 并列进度 → 母本缺口 → 种公推荐 → 配窝汇总', () => {
    const { container } = render(<Dashboard onNavigate={vi.fn()} />);
    const order = [
      screen.getByTestId('target-mode'),
      screen.getByTestId('progress-card-action-stud'),
      screen.getByTestId('progress-card-action-mother'),
      screen.getByTestId('mother-actions'),
      screen.getByTestId('recommend-list'),
      screen.getByTestId('nest-summary'),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // 配窝明细现在直接落在看板（2026-10-25 用户要求）；母本档位明细仍在收集页
    expect(screen.getByTestId('breed-empty')).toBeTruthy();
    expect(container.querySelector('[data-testid="mother-grade-inventory"]')).toBeNull();
  });

  test('母本缺口最多 3 条并说明原因，有完整入口', () => {
    const onNavigate = vi.fn();
    render(<Dashboard onNavigate={onNavigate} />);
    expect(screen.getAllByTestId('mother-action-item')).toHaveLength(3);
    expect(screen.getAllByTestId('mother-action-item')[0]).toHaveTextContent('还没有达标母本');
    fireEvent.click(screen.getByTestId('mother-actions-more'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'mothers', status: 'missing' },
    });
  });

  test('进度卡与行动都发明确导航意图', () => {
    const onNavigate = vi.fn();
    render(<Dashboard onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('progress-card-action-stud'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'coverage' },
    });

    fireEvent.click(screen.getByTestId('progress-card-action-mother'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'mothers', status: 'missing' },
    });

    fireEvent.click(screen.getByTestId('recommend-quantity-all'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-groups',
      groupType: 'stud',
    });

    fireEvent.click(screen.getByTestId('nest-open-coverage'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'coverage', groupId: 3 },
    });
  });

  test('看板直接展示配窝建议的摆位图与配对', () => {
    h.summary = { ...h.summary, plans: [demoPlan] };
    render(<Dashboard onNavigate={vi.fn()} />);

    expect(screen.getByTestId('breed-list')).toBeTruthy();
    expect(screen.getByTestId('nest-layout')).toBeTruthy();
    expect(screen.getAllByTestId('breed-suggestion').length).toBeGreaterThan(0);
  });

  test('没有可自己孵的方案时明确解释，不制造空推荐', () => {
    h.summary = {
      ...h.summary,
      stud: {
        ...h.summary.stud,
        cells: [{ groupId: 4, state: 'empty' } as never],
      },
    };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('breed-empty')).toHaveTextContent('没有能自己孵的方案');
  });

  test('目标全收齐时不写「还差」也不让用户去导入', () => {
    h.summary = {
      ...h.summary,
      stud: { ...h.summary.stud, cells: [], groupCount: 14, passedGroups: 14 },
      recommendations: [],
    };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('nest-summary-line')).toHaveTextContent('已全部收集');
    expect(screen.getByTestId('breed-empty')).toHaveTextContent('已全部收集');
    expect(screen.getByTestId('recommend-empty')).toHaveTextContent('没有要补的缺口');
  });
});
