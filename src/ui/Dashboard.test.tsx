import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import type { CollectionSummary } from './useCollectionSummary';
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
    // 完整明细不落在看板
    expect(container.querySelector('[data-testid="nest-layout"]')).toBeNull();
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
      location: { kind: 'inventory', view: 'stud' },
    });

    fireEvent.click(screen.getByTestId('progress-card-action-mother'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'mothers', status: 'missing' },
    });

    fireEvent.click(screen.getByTestId('recommend-quantity-all'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'eggs' },
    });

    fireEvent.click(screen.getByTestId('nest-open-coverage'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'coverage', groupId: 3 },
    });

    fireEvent.click(screen.getByTestId('nest-open-breed'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'breed' },
    });
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
    expect(screen.getByTestId('nest-no-plan')).toHaveTextContent('没有能自己孵的方案');
  });

  test('目标全收齐时不写「还差」也不让用户去导入', () => {
    h.summary = {
      ...h.summary,
      stud: { ...h.summary.stud, cells: [], groupCount: 14, passedGroups: 14 },
      recommendations: [],
    };
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByTestId('nest-summary-line')).toHaveTextContent('已全部收集');
    expect(screen.getByTestId('recommend-empty')).toHaveTextContent('没有要补的缺口');
  });
});
