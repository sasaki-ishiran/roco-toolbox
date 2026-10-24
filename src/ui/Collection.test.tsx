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
vi.mock('./Swap', () => ({ Swap: () => <div data-testid="stub-swap" /> }));

describe('Collection（收集）', () => {
  test('母本默认未收集，可切已收集', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'mothers', status: 'missing' }}
        focusRevision={0}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-mother-view')).toBeTruthy();
    expect(screen.getByTestId('mother-status-missing')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('mother-status-collected'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'mothers', status: 'collected' },
    });
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

  test('精灵库固定入口：全部 / 合格种公，并有按代表档位查看的次入口', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'inventory', view: 'all' }}
        focusRevision={0}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByTestId('stub-mypets')).toBeTruthy();
    expect(screen.getByTestId('inventory-view-all')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('inventory-view-stud'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'inventory', view: 'stud' },
    });

    fireEvent.click(screen.getByTestId('inventory-grade-toggle'));
    expect(screen.getByTestId('mother-grade-inventory')).toBeTruthy();
  });

  test('顶部三类视图可互相切换', () => {
    const onNavigate = vi.fn();
    render(
      <Collection
        location={{ kind: 'mothers', status: 'missing' }}
        focusRevision={0}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId('collection-kind-studs'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'studs', view: 'coverage' },
    });
    fireEvent.click(screen.getByTestId('collection-kind-inventory'));
    expect(onNavigate).toHaveBeenCalledWith({
      type: 'open-collection',
      location: { kind: 'inventory', view: 'all' },
    });
  });
});
