import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetCard } from './PetCard';

const pet: OwnedPet = {
  gameId: 3001,
  name: '喵喵',
  gender: '母',
  nature: '开朗',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '账号甲',
};

const species: SpeciesEntry = {
  key: 'pet_000001',
  gameId: 3001,
  name: '喵喵',
  officialName: '喵喵',
  number: '002',
  eggGroups: [6, 9],
};

describe('PetCard 头像', () => {
  test('有图鉴条目时按 gameId 显示官方头像', () => {
    render(<PetCard pet={pet} species={species} eggGroupNames={{}} />);
    const img = screen.getByTestId('pet-avatar') as HTMLImageElement;
    expect(img.src).toBe('https://game.gtimg.cn/images/rocom/rocodata/jingling/3001/icon.png');
  });

  test('头像加载失败时退化为名字首字占位', () => {
    render(<PetCard pet={pet} species={species} eggGroupNames={{}} />);
    fireEvent.error(screen.getByTestId('pet-avatar'));
    expect(screen.queryByTestId('pet-avatar')).toBeNull();
    expect(screen.getByTestId('pet-avatar-fallback').textContent).toBe('喵');
  });

  test('异色精灵用异色头像；炫彩仍用原色头像（官方没有炫彩立绘）', () => {
    render(<PetCard pet={{ ...pet, isShiny: true }} species={species} eggGroupNames={{}} />);
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(
      'https://game.gtimg.cn/images/rocom/rocodata/jingling/3001/icon_yise.png',
    );
    cleanup();
    render(<PetCard pet={{ ...pet, isColorful: true }} species={species} eggGroupNames={{}} />);
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(
      'https://game.gtimg.cn/images/rocom/rocodata/jingling/3001/icon.png',
    );
  });

  test('异色头像加载失败时先退回普通头像，再失败才用首字占位', () => {
    render(<PetCard pet={{ ...pet, isShiny: true }} species={species} eggGroupNames={{}} />);
    fireEvent.error(screen.getByTestId('pet-avatar'));
    expect((screen.getByTestId('pet-avatar') as HTMLImageElement).src).toBe(
      'https://game.gtimg.cn/images/rocom/rocodata/jingling/3001/icon.png',
    );
    fireEvent.error(screen.getByTestId('pet-avatar'));
    expect(screen.getByTestId('pet-avatar-fallback').textContent).toBe('喵');
  });
});
