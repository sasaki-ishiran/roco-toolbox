import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { setMyPetsSizeUnit } from './myPetsFilterStore';
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
  test('使用统一卡片尺寸、头像尺寸和顶部元数据布局，不显示已收集徽标', () => {
    render(<PetCard pet={pet} species={species} eggGroupNames={{ 6: '动物组', 9: '植物组' }} />);
    const card = screen.getByRole('article');
    expect(card.className).toContain('h-[104px]');
    expect(screen.getByTestId('pet-card-avatar')).toHaveClass(
      'absolute',
      'left-1/2',
      'top-[16px]',
      '-translate-x-1/2',
    );
    expect(screen.getByTestId('pet-avatar').className).toContain('h-11');
    expect(screen.getByTestId('pet-avatar').parentElement).toHaveClass('items-center', 'justify-center');
    expect(screen.getByRole('heading', { level: 3 })).toHaveClass('top-[62px]', 'text-[8px]');
    expect(screen.getByTestId('pet-card-egg-groups')).toHaveClass('flex-col');
    expect(screen.getByTestId('pet-card-natures')).toHaveClass('flex-col', 'items-end');
    expect(card).not.toHaveTextContent('已收集');
  });

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

  test('性别显示在性格前，体型和声音显示双奖牌，稀有图标覆盖头像角落', () => {
    render(
      <PetCard
        pet={{ ...pet, isColorful: true, heightPercent: 0, weightPercent: 12.5 }}
        species={species}
        eggGroupNames={{}}
      />,
    );
    const rarity = screen.getByAltText('炫彩');
    const nature = screen.getByTestId('pet-card-natures');
    const gender = screen.getByTestId('pet-card-gender');
    const medals = screen.getByTestId('pet-card-medals');
    const rarityBadge = screen.getByTestId('pet-card-rarity');
    expect(nature.parentElement).toContainElement(gender);
    expect(nature.parentElement).toHaveClass('items-center');
    expect(gender.firstElementChild).toHaveClass('h-3', 'w-3');
    expect(nature.firstElementChild).toHaveClass('inline-flex', 'h-3', 'items-center');
    expect(gender.nextElementSibling).toBe(nature);
    expect(nature.parentElement?.parentElement).toContainElement(medals);
    // 稀有徽标挪到蛋组下方（2026-11-17 用户口径），不再压在头像角上
    const eggGroups = screen.getByTestId('pet-card-egg-groups');
    expect(eggGroups.parentElement).toContainElement(rarityBadge);
    expect(screen.getByTestId('pet-card-avatar')).not.toContainElement(rarityBadge);
    expect(Array.from(medals.querySelectorAll('img')).map((image) => image.alt)).toEqual([
      '大块头',
      '婉转声',
    ]);
    expect(medals.querySelectorAll('img')).toHaveLength(2);
    expect(rarityBadge).toBe(rarity);
    // 声音数值跟在奖牌下面（2026-11-17 用户口径），成长数据行带「高 / 重」前缀
    expect(screen.getByText('高0% · 重12.5%')).toBeInTheDocument();
    expect(screen.getByTestId('pet-card-voice')).toHaveTextContent('100dB');
    expect(medals).toContainElement(screen.getByTestId('pet-card-voice'));
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

  test('显示开关切到「数值」时，身高和体重一起换成米 / 公斤', () => {
    setMyPetsSizeUnit('value');
    render(
      <PetCard
        pet={{ ...pet, heightPercent: 100, weightPercent: 0 }}
        species={{
          ...species,
          heightSize: { min: 0.38, max: 0.65 },
          bodySize: { small: 9.12, big: 14.88 },
        }}
        eggGroupNames={{}}
      />,
    );
    // 一个开关管两个值：身高转米、体重转公斤
    expect(screen.getByText('高0.65m · 重9.1kg')).toBeInTheDocument();
    setMyPetsSizeUnit('percent');
  });
});
