import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import type { MotherGroup } from '../domain/petFilters';
import { DEFAULT_MOTHER_CRITERIA } from '../domain/motherCriteria';
import { MotherView } from './MotherView';
import { setMotherCriteria } from './motherCriteriaStore';
import { setTargetMode } from './targetModeStore';

const groups: MotherGroup[] = [1, 2, 3, 4].map((id) => ({
  chainKey: `egg:${id}`,
  eggGameId: id,
  collected: false,
  quality: false,
  motherClass: null,
  formLabel: `测试精灵${id}`,
  number: String(id).padStart(3, '0'),
  eggGroups: [1],
  memberIndexes: [],
}));

beforeEach(() => {
  setMotherCriteria({ ...DEFAULT_MOTHER_CRITERIA });
  setTargetMode('perfect');
});

describe('MotherView', () => {
  test('移除母本条件摘要区，未收集精灵以四列头像卡片显示', () => {
    render(
      <MotherView
        owned={[]}
        searchIndex={new Map()}
        eggGroupNames={{ 1: '怪兽组' }}
        motherGroups={groups}
        mode="perfect"
        status="missing"
      />,
    );

    expect(screen.queryByText('我的母本达标条件')).toBeNull();
    expect(screen.queryByText('影响范围')).toBeNull();
    expect(screen.getByTestId('mother-criteria-combinations')).toHaveClass('grid-cols-4');
    const list = screen.getByTestId('mother-chain-group-list-1');
    expect(list).toHaveClass('grid-cols-4');
    expect(within(list).getAllByTestId('mother-chain-row')).toHaveLength(4);
    expect(within(list).getAllByTestId('pet-avatar')).toHaveLength(4);
    expect(within(list).getAllByTestId('mother-card-natures')[0]).toHaveClass('flex-col');
    expect(within(list).getAllByTestId('mother-card-egg-groups')[0]).toHaveClass('flex-col');
  });
});
