import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { species as catalog } from '../data/catalog';
import type { StudRecommendation } from '../domain/suggestions';
import { SuggestionCard } from './SuggestionCard';
import { clearSuggestionCard } from './suggestionCardStore';

const recommendationSpecies = catalog.find((entry) => entry.number)!;

const ITEM: StudRecommendation = {
  id: 'r1',
  natureName: '平和',
  displayName: '白发懒人',
  groupIds: [6],
  groupLabels: ['动物组'],
  grade: '大婉',
  gameId: recommendationSpecies.gameId,
};

describe('SuggestionCard', () => {
  afterEach(() => {
    act(() => clearSuggestionCard());
    localStorage.clear();
  });

  test('显示页面给的提示语（目标已全收齐时不再让用户去导入）', () => {
    render(
      <SuggestionCard
        items={[]}
        emptyNote="种公网络已全通，没有要补的缺口"
      />,
    );
    expect(screen.getByTestId('recommend-empty')).toHaveTextContent('种公网络已全通');
  });

  test('默认展示全部推荐，四列布局且头像旁显示性格', () => {
    const items = Array.from({ length: 17 }, (_, index) => ({
      ...ITEM,
      id: `r${index}`,
      gameId: catalog[index].gameId,
      displayName: `${ITEM.displayName}${index}`,
    }));
    render(<SuggestionCard items={items} emptyNote="不该出现" />);
    expect(screen.queryByTestId('recommend-empty')).toBeNull();
    const displayedItems = screen.getAllByTestId('recommend-item');
    expect(displayedItems).toHaveLength(17);
    expect(screen.getByTestId('recommend-items').className).toContain('grid-cols-4');
    expect(displayedItems[0]).toHaveTextContent('平和');
    expect(displayedItems[0]).toHaveTextContent('白发懒人0');
    expect(displayedItems[0]).not.toHaveTextContent('未换到');
    expect(within(displayedItems[0]).queryByRole('checkbox')).toBeNull();
    expect(within(displayedItems[0]).getByText(`No.${recommendationSpecies.number}`)).toBeInTheDocument();
    expect(within(displayedItems[0]).getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    expect(within(displayedItems[0]).getByTestId('pet-avatar').className).toContain('h-11');
    expect(within(displayedItems[0]).getByTestId('recommend-item-nature')).toHaveClass('items-end');
    expect(screen.getByTestId('recommend-list').className).not.toContain('p-4');
    expect(screen.queryByTestId('recommend-quantity')).toBeNull();
    expect(screen.queryByRole('heading', { name: '种公推荐' })).toBeNull();
  });

  test('同一精灵合并推荐并批量标记已换到或还原，不使用复选框', () => {
    const sameSpecies: StudRecommendation = {
      ...ITEM,
      id: 'r2',
      natureName: '固执',
      groupIds: [7],
      groupLabels: ['植物组'],
    };
    render(<SuggestionCard items={[ITEM, sameSpecies]} emptyNote="不该出现" />);

    const card = screen.getByTestId('recommend-item');
    expect(screen.getAllByTestId('recommend-item')).toHaveLength(1);
    expect(card).toHaveTextContent('平和');
    expect(card).toHaveTextContent('固执');
    expect(card).toHaveTextContent('动物组');
    expect(card).toHaveTextContent('植物组');
    expect(within(card).getByTestId('pet-avatar').className).toContain('h-11');
    fireEvent.click(within(card).getByRole('button', { name: /标记.*已换到/ }));
    expect(screen.queryByTestId('recommend-items')).toBeNull();
    expect(screen.getByTestId('recommend-done-toggle')).toHaveTextContent('已换到 1 只');
    fireEvent.click(screen.getByTestId('recommend-done-toggle'));
    expect(screen.getByRole('button', { name: /还原.*已换到/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /还原.*已换到/ }));
    expect(screen.getAllByTestId('recommend-item')).toHaveLength(1);
    expect(screen.queryByTestId('recommend-done')).toBeNull();
  });
});
