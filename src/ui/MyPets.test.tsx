import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { allNatureNames, species, targetNaturePool } from '../data/catalog';
import { isBreedableGroup } from '../domain/eggs';
import { clearAccountFilter } from './accountFilterStore';
import { resetMyPetsFiltersForTest } from './myPetsFilterStore';
import { MyPets } from './MyPets';

const { pets } = vi.hoisted(() => ({
  pets: [
    {
      gameId: 900001,
      name: '零身高精灵',
      gender: '公',
      nature: '开朗',
      voiceDb: 100,
      medalBody: '大块头',
      heightPercent: 0,
      weightPercent: 100,
      isShiny: true,
      account: '账号甲',
    },
    {
      gameId: 900002,
      name: '满身高精灵',
      gender: '母',
      nature: '固执',
      voiceDb: -100,
      medalBody: '小不点',
      heightPercent: 100,
      weightPercent: 50,
      isShiny: false,
      account: '账号甲',
    },
  ],
}));
const speciesWithEggGroup = species.find((entry) => entry.eggGroups.some(isBreedableGroup));
const speciesWithTwoEggGroups = species.find(
  (entry) => entry.eggGroups.filter(isBreedableGroup).length >= 2,
);
const firstTwoEggGroups = speciesWithTwoEggGroups?.eggGroups.filter(isBreedableGroup).slice(0, 2) ?? [];
const speciesWithFirstEggGroupOnly =
  firstTwoEggGroups.length === 2
    ? species.find((entry) => {
        const groups = entry.eggGroups.filter(isBreedableGroup);
        return groups.length === 1 && groups[0] === firstTwoEggGroups[0];
      })
    : undefined;
const expectVisiblePetCount = (count: number) => {
  expect(screen.getByTestId('pet-list-items').children).toHaveLength(count);
  expect(screen.queryByTestId('pet-count')).toBeNull();
};

vi.mock('./useOwnedPets', () => ({
  useOwnedPets: () => ({ owned: pets, accounts: ['账号甲'] }),
}));

afterEach(() => {
  cleanup();
  clearAccountFilter();
  resetMyPetsFiltersForTest();
});

describe('MyPets', () => {
  beforeEach(() => {
    pets[0].gameId = 900001;
    pets[1].gameId = 900002;
    clearAccountFilter();
    resetMyPetsFiltersForTest();
  });

  test('公母、性格和蛋组在同一行，身高范围使用百分比文本框和按钮', () => {
    if (speciesWithEggGroup) {
      pets.forEach((pet) => {
        pet.gameId = speciesWithEggGroup.gameId;
      });
    }
    const onTotalCountChange = vi.fn();
    render(<MyPets onTotalCountChange={onTotalCountChange} />);
    expect(onTotalCountChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByTestId('pet-filters-toggle'));

    for (const kind of ['gender', 'body', 'voice', 'height']) {
      expect(screen.queryByTestId(`filter-tile-${kind}`)).toBeNull();
    }
    const primaryFilters = screen.getByTestId('inventory-primary-filters');
    expect(primaryFilters).toHaveClass('flex-nowrap');
    expect(primaryFilters.children[0]).toBe(screen.getByTestId('filter-row-gender'));
    expect(primaryFilters).toContainElement(screen.getByTestId('filter-tile-nature'));
    expect(primaryFilters).toContainElement(screen.getByTestId('filter-tile-eggGroup'));
    expect(screen.getByTestId('filter-tile-nature')).toHaveClass('justify-center');
    expect(screen.getByTestId('filter-tile-eggGroup')).toHaveClass('justify-center');
    expect(screen.getByTestId('filter-row-gender')).not.toHaveTextContent('性别');
    const heightControls = screen.getByTestId('height-filter-controls');
    expect(heightControls).toBeInTheDocument();
    expect(heightControls).toHaveClass('py-0');
    expect(heightControls).not.toHaveClass('border-slate-100');
    expect(heightControls).not.toHaveTextContent('身高范围');
    expect(heightControls).not.toHaveTextContent('最低');
    expect(heightControls).not.toHaveTextContent('最高');
    expect(heightControls).toHaveTextContent('身高:');
    expect(heightControls).toHaveTextContent('至');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByTestId('height-range-min')).toHaveAttribute('type', 'text');
    expect(screen.getByTestId('height-range-max')).toHaveAttribute('type', 'text');
    expect(screen.getByTestId('height-range-min')).toHaveValue('0');
    expect(screen.getByTestId('height-range-max')).toHaveValue('100');
    const zeroHeight = screen.getByRole('button', { name: '零身高' });
    const fullHeight = screen.getByRole('button', { name: '满身高' });
    for (const button of [zeroHeight, fullHeight]) {
      expect(button).toHaveClass('min-h-[28px]', 'rounded-md', 'px-2', 'text-[10px]');
      expect(button).toHaveClass('bg-slate-100');
    }
    expect(screen.getByTestId('height-range-reset').tagName).toBe('BUTTON');
    expect(screen.getByTestId('height-range-reset')).toHaveClass(
      'min-h-[28px]',
      'text-[10px]',
      'text-red-600',
    );
    expect(screen.getByTestId('filter-opt-gender-gender:公')).toBeInTheDocument();
    expect(screen.getByTestId('filter-opt-body-body:大块头').querySelector('img')).toHaveAttribute(
      'src',
      '/ui/medals/1001.png',
    );
    expect(screen.getByTestId('filter-opt-voice-voice:婉转声').querySelector('img')).toHaveAttribute(
      'src',
      '/ui/medals/1026.png',
    );
    fireEvent.click(screen.getByTestId('filter-opt-gender-gender:公'));
    expectVisiblePetCount(1);
    // 「共 N 只」是背包总数，筛选后不跟着变
    expect(onTotalCountChange).toHaveBeenLastCalledWith(2);
  });

  test('性格保留八大默认选项，奖牌依次排列为稀有度、体型、声音', () => {
    expect(targetNaturePool).toHaveLength(8);
    expect(allNatureNames).toHaveLength(30);
    render(<MyPets />);
    fireEvent.click(screen.getByTestId('pet-filters-toggle'));
    fireEvent.click(screen.getByTestId('filter-tile-nature'));
    const naturePanel = screen.getByTestId('filter-panel-nature');
    expect(naturePanel).toHaveClass('absolute');
    expect(naturePanel).toHaveClass('w-[calc(100vw-2rem)]');
    expect(naturePanel.querySelector('.grid-cols-4')).not.toBeNull();
    expect(screen.getByTestId('filter-nature-group-target')).toBeInTheDocument();
    targetNaturePool.forEach(({ name }) => {
      expect(screen.getByTestId(`filter-opt-nature-nature:${name}`)).toBeInTheDocument();
    });
    expect(
      naturePanel.querySelectorAll('[data-testid^="filter-opt-nature-nature:"]'),
    ).toHaveLength(8);
    expect(screen.queryByTestId('filter-nature-group-物攻')).toBeNull();
    expect(screen.queryByTestId('filter-opt-nature-nature:大胆')).toBeNull();
    const targetToggle = screen.getByTestId('filter-nature-target-toggle');
    expect(targetToggle.tagName).toBe('BUTTON');
    expect(targetToggle).toHaveAttribute('aria-pressed', 'true');
    const natureGroupControls = screen.getByTestId('nature-group-controls');
    expect(natureGroupControls).toContainElement(targetToggle);
    expect(natureGroupControls).toContainElement(screen.getByTestId('nature-show-all-toggle'));
    expect(natureGroupControls).toContainElement(screen.getByTestId('filter-clear-nature'));
    expect(natureGroupControls).toHaveClass('relative', 'w-full');
    expect(screen.getByTestId('filter-clear-nature')).toHaveClass('absolute', 'right-0');

    const showAllButton = screen.getByTestId('nature-show-all-toggle');
    expect(showAllButton).toHaveTextContent('全部性格');
    expect(showAllButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(showAllButton);
    expect(showAllButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('filter-nature-group-物攻')).toBeInTheDocument();
    allNatureNames.forEach((name) => {
      expect(screen.getByTestId(`filter-opt-nature-nature:${name}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId('filter-clear-nature')).toHaveTextContent('清除');
    expect(
      naturePanel.querySelectorAll('[data-testid^="filter-opt-nature-nature:"]'),
    ).toHaveLength(allNatureNames.length);
    expect(naturePanel.querySelector('.overflow-x-auto')).toBeNull();
    for (const stat of ['物攻', '物防', '魔攻', '魔防', '速度', '生命']) {
      expect(
        screen
          .getByTestId(`filter-nature-group-${stat}`)
          .querySelectorAll('[data-testid^="filter-opt-nature-nature:"]'),
      ).toHaveLength(5);
      const natureGroup = screen.getByTestId(`filter-nature-group-${stat}`);
      expect(natureGroup.firstElementChild).toHaveClass('grid-cols-6');
      expect(natureGroup.firstElementChild?.querySelectorAll('button')).toHaveLength(6);
      natureGroup
        .querySelectorAll('[data-testid^="filter-opt-nature-nature:"]')
        .forEach((button) => expect(button).toHaveClass('min-h-[30px]', 'text-xs'));
    }
    expect(naturePanel.lastElementChild).toContainElement(natureGroupControls);
    const physicalAttackGroup = screen.getByTestId('filter-nature-group-物攻');
    expect(physicalAttackGroup).toHaveTextContent('大胆');
    expect(physicalAttackGroup).toHaveTextContent('勇敢');
    const boldNature = screen.getByTestId('filter-opt-nature-nature:大胆');
    expect(boldNature).not.toBeDisabled();
    const physicalAttackToggle = screen.getByTestId('filter-nature-stat-物攻');
    expect(physicalAttackToggle.tagName).toBe('BUTTON');
    fireEvent.click(physicalAttackToggle);
    expect(physicalAttackToggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(targetToggle);
    expect(targetToggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('filter-nature-group-物攻')).toBeNull();
    expect(boldNature).not.toBeInTheDocument();

    expect(screen.queryByTestId('filter-tile-shiny')).toBeNull();
    const medalFilters = screen.getByTestId('pet-medal-filters');
    expect(medalFilters).not.toHaveClass('border-slate-100');
    // 稀有挪到公母 / 性格 / 蛋组那一行，且不再写「稀有:」与「不限」（2026-11-18 用户口径）
    const primaryRow = screen.getByTestId('inventory-primary-filters');
    const rarityFilter = screen.getByTestId('pet-rarity-filter');
    expect(primaryRow).toContainElement(rarityFilter);
    expect(rarityFilter).toContainElement(screen.getByTestId('filter-row-shiny'));
    expect(medalFilters).not.toHaveTextContent('稀有');
    expect(medalFilters).not.toHaveTextContent('稀有度');
    expect(medalFilters).toHaveTextContent('体型');
    expect(medalFilters).toHaveTextContent('声音');
    expect(screen.getByTestId('filter-row-shiny')).not.toHaveTextContent('稀有');
    expect(screen.getByTestId('filter-row-shiny')).not.toHaveTextContent('不限');
    expect(screen.getByTestId('filter-row-body').firstElementChild).toHaveTextContent('体型:');
    expect(screen.getByTestId('filter-row-voice').firstElementChild).toHaveTextContent('声音:');
    for (const kind of ['shiny', 'body', 'voice']) {
      expect(screen.getByTestId(`filter-row-${kind}`).querySelector('div')).toHaveClass(
        'flex-nowrap',
        'whitespace-nowrap',
      );
    }
    // 稀有 / 体型 / 声音只留图标（放大一倍，2026-11-18 用户口径）
    expect(screen.getByTestId('filter-opt-shiny-shiny:异色').querySelector('img')).toHaveClass(
      'h-6',
      'w-6',
    );
    expect(screen.getByTestId('filter-opt-body-body:大块头').querySelector('img')).toHaveClass(
      'h-6',
      'w-6',
    );
    expect(screen.getByTestId('filter-opt-voice-voice:婉转声').querySelector('img')).toHaveClass(
      'h-6',
      'w-6',
    );
    expect(screen.queryByTestId('pet-medal-filters-clear')).toBeNull();
    for (const kind of ['body', 'voice']) {
      expect(screen.getByTestId(`filter-unlimited-${kind}`)).toHaveAttribute('aria-pressed', 'true');
    }
    // 稀有不再有「不限」按钮（2026-11-18 用户口径）
    expect(screen.queryByTestId('filter-unlimited-shiny')).toBeNull();
    expect(medalFilters.children).toHaveLength(2);
    expect(medalFilters.children[0]).toBe(screen.getByTestId('filter-row-body'));
    expect(medalFilters.children[1]).toBe(screen.getByTestId('filter-row-voice'));
    expect(
      [...screen.getByTestId('filter-row-body').querySelectorAll('button')].map(
        (button) => button.getAttribute('aria-label') ?? button.textContent,
      ),
    ).toEqual(['不限', '大块头', '小不点', '满体重', '零体重']);
    expect(
      [...screen.getByTestId('filter-row-voice').querySelectorAll('button')].map(
        (button) => button.getAttribute('aria-label') ?? button.textContent,
      ),
    ).toEqual(['不限', '婉转声', '粗嗓门', '+100', '-100']);
    expect(screen.getByTestId('filter-opt-shiny-shiny:异色炫彩').querySelector('img')).toHaveAttribute(
      'src',
      '/ui/rarity/shiny-colorful.png',
    );
  });

  test('蛋组多选取并集，双组只匹配同时具有两组的精灵', () => {
    expect(speciesWithTwoEggGroups).toBeDefined();
    expect(speciesWithFirstEggGroupOnly).toBeDefined();
    if (!speciesWithTwoEggGroups || !speciesWithFirstEggGroupOnly || firstTwoEggGroups.length !== 2) {
      throw new Error('Expected catalog species with overlapping and distinct egg groups');
    }

    pets[0].gameId = speciesWithTwoEggGroups.gameId;
    pets[1].gameId = speciesWithFirstEggGroupOnly.gameId;
    render(<MyPets />);
    fireEvent.click(screen.getByTestId('pet-filters-toggle'));
    fireEvent.click(screen.getByTestId('filter-tile-eggGroup'));
    const eggGroupPanel = screen.getByTestId('filter-panel-eggGroup');
    expect(eggGroupPanel).toHaveClass('absolute', 'w-[calc(100vw-2rem)]');
    const eggGroupOption = screen.getByTestId(
      `filter-opt-eggGroup-eggGroup:${firstTwoEggGroups[0]}`,
    );
    expect(
      eggGroupOption.parentElement,
    ).toHaveClass('grid-cols-4');
    expect(eggGroupOption).toHaveClass('text-[10px]');
    const eggGroupModes = screen.getByTestId('egg-group-match-mode');
    // 模式切换在二级卡片里独占一行，上下留白更足
    expect(eggGroupModes.parentElement).toHaveClass('mb-2', 'w-full');
    for (const mode of ['multi', 'dual']) {
      expect(screen.getByTestId(`egg-group-mode-${mode}`)).toHaveClass(
        'min-h-[30px]',
        'flex-1',
        'py-1',
      );
    }

    fireEvent.click(screen.getByTestId('egg-group-mode-dual'));
    fireEvent.click(screen.getByTestId(`filter-opt-eggGroup-eggGroup:${firstTwoEggGroups[0]}`));
    fireEvent.click(screen.getByTestId(`filter-opt-eggGroup-eggGroup:${firstTwoEggGroups[1]}`));

    expectVisiblePetCount(1);
    expect(screen.getByTestId('egg-group-mode-dual')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('egg-group-mode-multi'));
    expectVisiblePetCount(2);
  });

  test('身高文本框、快捷按钮和清除都能更新筛选范围', () => {
    render(<MyPets />);

    fireEvent.click(screen.getByTestId('pet-filters-toggle'));
    fireEvent.change(screen.getByTestId('height-range-min'), { target: { value: '50' } });
    fireEvent.blur(screen.getByTestId('height-range-min'));

    expect(screen.getByTestId('height-range-min')).toHaveValue('50');
    expect(screen.getByTestId('height-range-max')).toHaveValue('100');
    expectVisiblePetCount(1);
    expect(screen.getByText('满身高精灵')).toBeInTheDocument();
    expect(screen.queryByText('零身高精灵')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '零身高' }));

    expectVisiblePetCount(1);
    expect(screen.getByText('零身高精灵')).toBeInTheDocument();
    expect(screen.queryByText('满身高精灵')).toBeNull();

    fireEvent.click(screen.getByTestId('height-range-reset'));
    expect(screen.getByTestId('height-range-min')).toHaveValue('0');
    expect(screen.getByTestId('height-range-max')).toHaveValue('100');
    expectVisiblePetCount(2);
  });

  test('极限奖牌直接作为选项；各分类的不限按钮只清除对应筛选', () => {
    render(<MyPets />);
    fireEvent.click(screen.getByTestId('pet-filters-toggle'));

    const rarity = screen.getByTestId('filter-opt-shiny-shiny:异色');
    // 不再有「极限」开关：满体重 / 零体重、+100 / -100 直接是选项
    expect(screen.queryByTestId('body-extreme-mode-toggle')).toBeNull();
    expect(screen.queryByTestId('voice-extreme-mode-toggle')).toBeNull();

    fireEvent.click(rarity);
    fireEvent.click(screen.getByTestId('filter-opt-body-body:满体重'));
    fireEvent.click(screen.getByTestId('filter-opt-voice-voice:+100'));
    expectVisiblePetCount(1);
    expect(screen.getByTestId('filter-opt-body-body:满体重').querySelector('img')).toHaveAttribute(
      'src',
      '/ui/medals/1001-max.png',
    );
    expect(screen.getByTestId('filter-opt-voice-voice:+100').querySelector('img')).toHaveAttribute(
      'src',
      '/ui/medals/1026-max.png',
    );

    // 单选：换回普通档就替换掉极限档
    fireEvent.click(screen.getByTestId('filter-opt-body-body:大块头'));
    expect(screen.getByTestId('filter-opt-body-body:大块头')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('filter-opt-body-body:满体重')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    const unlimitedBody = screen.getByTestId('filter-unlimited-body');
    const unlimitedVoice = screen.getByTestId('filter-unlimited-voice');
    fireEvent.click(unlimitedBody);
    fireEvent.click(unlimitedVoice);
    expect(rarity).toHaveAttribute('aria-pressed', 'true');
    expect(unlimitedBody).toHaveAttribute('aria-pressed', 'true');
    expect(unlimitedVoice).toHaveAttribute('aria-pressed', 'true');
    expectVisiblePetCount(1);

    // 稀有不再有「不限」按钮（2026-11-18 用户口径）：点已选中的稀有档位取消
    expect(screen.queryByTestId('filter-unlimited-shiny')).toBeNull();
    fireEvent.click(rarity);
    expect(rarity).toHaveAttribute('aria-pressed', 'false');
    expectVisiblePetCount(2);
  });

  test('体型和声音各只能选一个档位（单选，点另一个就换过去）', () => {
    render(<MyPets />);
    fireEvent.click(screen.getByTestId('pet-filters-toggle'));

    const bigBody = screen.getByTestId('filter-opt-body-body:大块头');
    const smallBody = screen.getByTestId('filter-opt-body-body:小不点');
    fireEvent.click(bigBody);
    expect(bigBody).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(smallBody);
    expect(smallBody).toHaveAttribute('aria-pressed', 'true');
    expect(bigBody).toHaveAttribute('aria-pressed', 'false');

    const softVoice = screen.getByTestId('filter-opt-voice-voice:婉转声');
    const roughVoice = screen.getByTestId('filter-opt-voice-voice:粗嗓门');
    fireEvent.click(softVoice);
    expect(softVoice).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(roughVoice);
    expect(roughVoice).toHaveAttribute('aria-pressed', 'true');
    expect(softVoice).toHaveAttribute('aria-pressed', 'false');
  });

  test('身高和体重共用一个显示开关，切换不影响筛选', () => {
    render(<MyPets />);
    fireEvent.click(screen.getByTestId('pet-filters-toggle'));
    expectVisiblePetCount(2);

    // 不再有身高 / 体重各自的开关，只剩一个百分比 / 数值
    expect(screen.queryByTestId('card-size-height-percent')).toBeNull();
    expect(screen.queryByTestId('card-size-weight-percent')).toBeNull();
    expect(screen.queryByTestId('card-size-height-value')).toBeNull();
    expect(screen.queryByTestId('card-size-weight-value')).toBeNull();
    expect(screen.getByTestId('card-size-percent')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('card-size-value')).toHaveAttribute('aria-pressed', 'false');

    // 切到数值：筛选条件（身高范围、命中数量）不变
    fireEvent.click(screen.getByTestId('card-size-value'));
    expect(screen.getByTestId('card-size-value')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('card-size-percent')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('height-range-min')).toHaveValue('0');
    expect(screen.getByTestId('height-range-max')).toHaveValue('100');
    expectVisiblePetCount(2);
  });
});
