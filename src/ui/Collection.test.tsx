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
vi.mock('./MyPets', () => ({ MyPets: () => <div data-testid="stub-mypets" /> }));
vi.mock('./Coverage', () => ({ Coverage: () => <div data-testid="stub-coverage" /> }));

describe('Collection（收集）', () => {
  test('母本不再在顶部重复「未收集 / 已收集」：列表内那个控件是唯一入口', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'mothers', status: 'missing' }}
        focusRevision={0}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-mother-view')).toBeTruthy();
    expect(screen.queryByTestId('mother-status-missing')).toBeNull();
    expect(screen.queryByTestId('mother-status-collected')).toBeNull();
  });

  test('种公只保留覆盖矩阵，求蛋入口已迁到小组', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'studs', view: 'coverage' }}
        focusRevision={0}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-coverage')).toBeTruthy();
    expect(screen.queryByTestId('stud-tool-eggs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-swap')).not.toBeInTheDocument();
  });

  test('精灵背包只放全部精灵：不再有「合格种公」视图，按代表档位查看仍在', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'inventory' }}
        focusRevision={0}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-mypets')).toBeTruthy();
    // 2026-10-29 用户口径：合格种公页不要了，种公只留种公阵列
    expect(screen.queryByTestId('inventory-view-all')).toBeNull();
    expect(screen.queryByTestId('inventory-view-stud')).toBeNull();

    fireEvent.click(screen.getByTestId('inventory-grade-toggle'));
    expect(screen.getByTestId('mother-grade-inventory')).toBeTruthy();
  });

  test('顶部三张卡可互相切换，卡片写清各自职责', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'mothers', status: 'missing' }}
        focusRevision={0}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('collection-kind-inventory')).toHaveTextContent('精灵背包');
    expect(screen.getByTestId('collection-kind-inventory')).toHaveTextContent('看全部精灵');
    expect(screen.getByTestId('collection-kind-mothers')).toHaveTextContent('看我的所有母本');
    expect(screen.getByTestId('collection-kind-studs')).toHaveTextContent('挑种公去孵蛋');

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
