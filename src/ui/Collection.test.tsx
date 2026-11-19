import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Collection } from './Collection';

vi.mock('./useCollectionSummary', () => ({
  useCollectionSummary: () => ({
    loaded: true,
    owned: [],
    motherGroups: [],
    mode: 'perfect',
    mother: { collected: 0, total: 0 },
    stud: { cells: [], groupCount: 14, passedGroups: 0, total: 0, covered: 0, groupSummary: [] },
    plans: [],
    recommendations: [],
  }),
}));
vi.mock('./MotherView', () => ({ MotherView: () => <div data-testid="stub-mother-view" /> }));
vi.mock('./MyPets', () => ({
  MyPets: ({
    onTotalCountChange,
  }: {
    onTotalCountChange?: (count: number) => void;
  }) => (
    <>
      <div data-testid="stub-mypets" />
      <button type="button" onClick={() => onTotalCountChange?.(12)}>
        更新精灵数量
      </button>
    </>
  ),
}));
vi.mock('./Coverage', () => ({ Coverage: () => <div data-testid="stub-coverage" /> }));
vi.mock('./useOwnedPets', () => ({
  useOwnedPets: () => ({ owned: [], accounts: ['账号甲', '账号乙'] }),
}));

describe('Collection（收集）', () => {
  test('母本不再在顶部重复「未收集 / 已收集」：列表内那个控件是唯一入口', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'mothers', status: 'missing' }}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-mother-view')).toBeTruthy();
    expect(screen.queryByTestId('mother-status-missing')).toBeNull();
    expect(screen.queryByTestId('mother-status-collected')).toBeNull();
    expect(screen.getByTestId('collection-kinds').children[0]).toBe(screen.getByTestId('account-filter'));
    expect(screen.getByTestId('collection-kinds').children[1]).toBe(
      screen.getByTestId('collection-kind-inventory'),
    );
  });

  test('种公只保留覆盖矩阵，求蛋入口已迁到小组', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'studs', view: 'coverage' }}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-coverage')).toBeTruthy();
    expect(screen.queryByTestId('stud-tool-eggs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-swap')).not.toBeInTheDocument();
    expect(screen.getByTestId('collection-kinds').children[0]).toBe(screen.getByTestId('account-filter'));
    expect(screen.getByTestId('collection-kinds').children[1]).toBe(
      screen.getByTestId('collection-kind-inventory'),
    );
  });

  test('精灵背包移除副标题和代表档位入口', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'inventory' }}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-mypets')).toBeTruthy();
    expect(screen.queryByTestId('inventory-view-all')).toBeNull();
    expect(screen.queryByTestId('inventory-view-stud')).toBeNull();
    expect(screen.queryByTestId('inventory-grade-toggle')).toBeNull();
    expect(screen.queryByTestId('mypets-mode')).toBeNull();
    expect(screen.getByTestId('account-filter')).toBeInTheDocument();
    expect(screen.queryByTestId('account-filter-options')).toBeNull();
    expect(screen.getByTestId('collection-kinds').children[0]).toBe(screen.getByTestId('account-filter'));
    expect(screen.getByTestId('collection-kind-inventory')).toHaveTextContent('共 0 只');

    fireEvent.click(screen.getByRole('button', { name: '更新精灵数量' }));
    expect(screen.getByTestId('collection-kind-inventory')).toHaveTextContent('共 12 只');
  });

  test('顶部三张卡居中显示并可互相切换', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'mothers', status: 'missing' }}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('collection-kind-inventory')).toHaveTextContent('精灵背包');
    expect(screen.getByTestId('collection-kind-mothers')).toHaveTextContent('母本');
    expect(screen.getByTestId('collection-kind-studs')).toHaveTextContent('种公');
    expect(screen.getByTestId('collection-kind-inventory')).toHaveClass('text-center');
    expect(screen.getByTestId('collection-kind-mothers')).toHaveClass('text-center');
    expect(screen.getByTestId('collection-kind-studs')).toHaveClass('text-center');

    fireEvent.click(screen.getByTestId('collection-kind-studs'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'coverage' },
    });
    fireEvent.click(screen.getByTestId('collection-kind-inventory'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'inventory' },
    });
  });
});
