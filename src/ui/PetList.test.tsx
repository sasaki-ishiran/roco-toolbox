import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetList } from './PetList';

const pets: OwnedPet[] = Array.from({ length: 21 }, (_, index): OwnedPet => ({
  gameId: index + 1,
  name: `精灵${index + 1}`,
  gender: '母',
  nature: '开朗',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '账号甲',
}));

const props = {
  pets,
  speciesByGameId: new Map<number, SpeciesEntry>(),
  eggGroupNames: {},
};

describe('PetList（全部展示，不分页）', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

  beforeEach(() => {
    // 部分安卓 WebView（隐私模式 / 关存储）访问 window.localStorage 直接抛 SecurityError
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('SecurityError: storage is disabled');
      },
      configurable: true,
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(window, 'localStorage', original);
  });

  test('不访问 localStorage，且一次展示全部精灵', () => {
    render(<PetList {...props} />);
    expect(screen.getByTestId('pet-count')).toHaveTextContent('共 21 只');
    expect(screen.getAllByRole('article')).toHaveLength(21);
    expect(screen.getByText('精灵21')).toBeDefined();
    expect(screen.queryByText('上一页')).toBeNull();
    expect(screen.queryByText('下一页')).toBeNull();
    expect(screen.queryByText(/每页/)).toBeNull();
  });
});
