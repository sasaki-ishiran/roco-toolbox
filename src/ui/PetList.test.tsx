import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetList } from './PetList';

const pets: OwnedPet[] = [
  {
    gameId: 1,
    name: '精灵1',
    gender: '母',
    nature: '开朗',
    voiceDb: 100,
    medalBody: '大块头',
    isShiny: false,
    account: '账号甲',
  },
];

const props = {
  pets,
  speciesByGameId: new Map<number, SpeciesEntry>(),
  eggGroupNames: {},
};

describe('PetList（M4：localStorage 被禁时不能崩整页）', () => {
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

  test('localStorage 抛错时列表仍能渲染（只是不记住每页条数）', () => {
    render(<PetList {...props} />);
    expect(screen.getByTestId('page-indicator')).toBeDefined();
    expect(screen.getByText('精灵1')).toBeDefined();
  });
});
