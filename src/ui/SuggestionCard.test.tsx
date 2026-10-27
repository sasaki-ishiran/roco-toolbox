import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { StudRecommendation } from '../domain/suggestions';
import { SuggestionCard } from './SuggestionCard';

const ITEM: StudRecommendation = {
  id: 'r1',
  natureName: '平和',
  displayName: '白发懒人',
  groupIds: [6],
  groupLabels: ['动物组'],
  grade: '大婉',
  gameId: 1,
};

describe('SuggestionCard 空清单提示', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('显示页面给的提示语（目标已全收齐时不再让用户去导入）', () => {
    render(
      <SuggestionCard
        title="优质种公推荐"
        items={[]}
        emptyNote="种公网络已全通，没有要补的缺口"
      />,
    );
    expect(screen.getByTestId('recommend-empty')).toHaveTextContent('种公网络已全通');
  });

  test('有清单时不显示空提示', () => {
    render(<SuggestionCard title="优质种公推荐" items={[ITEM]} emptyNote="不该出现" />);
    expect(screen.queryByTestId('recommend-empty')).toBeNull();
    expect(screen.getByTestId('recommend-item')).toHaveTextContent('平和白发懒人');
  });
});
