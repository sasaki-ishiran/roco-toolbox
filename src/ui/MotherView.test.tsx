import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MotherGroup } from '../domain/petFilters';
import type { OwnedPet } from '../domain/types';
import { DEFAULT_MOTHER_CRITERIA } from '../domain/motherCriteria';
import { eggNatures } from '../domain/recommendedNatures';
import { species } from '../data/catalog';
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
    expect(within(list).getAllByTestId('pet-card-avatar')[0]).toHaveClass(
      'top-[9px]',
      'h-[62px]',
      'w-[62px]',
    );
    expect(within(list).getAllByTestId('pet-avatar')[0]).toHaveClass('h-[62px]', 'w-[62px]');
    expect(within(list).getAllByRole('heading', { level: 3 })[0]).toHaveClass(
      'top-[72px]',
      'text-[12px]',
      'font-medium',
    );
    expect(within(list).getAllByTestId('mother-card-natures')[0]).toHaveClass('flex-col');
    expect(within(list).getAllByTestId('mother-card-egg-groups')[0]).toHaveClass('flex-col');
  });

  test('未收集卡点开「怎么补」悬浮窗，计划入口已移除', () => {
    render(
      <MotherView
        owned={[]}
        searchIndex={new Map()}
        eggGroupNames={{ 1: '怪兽组' }}
        motherGroups={groups}
        mode="perfect"
        status="missing"
        motherSuggestions={new Map()}
        accountNames={['昭昭']}
        gapTarget={{ label: '目标 满分大婉', bodyMedal: '大块头', voiceDb: 100, weightPercent: 100 }}
      />,
    );

    // 「计划收集」整段与卡底「计划 / 已计划」按钮都不再出现
    expect(screen.queryByTestId('mother-plan')).toBeNull();
    expect(screen.queryByTestId('mother-plan-toggle')).toBeNull();
    expect(screen.queryByText('计划收集')).toBeNull();

    const rows = screen.getAllByTestId('mother-chain-row');
    fireEvent.click(within(rows[0]).getByRole('button'));
    expect(screen.getByRole('dialog', { name: '怎么补' })).toBeTruthy();
    expect(screen.getByTestId('gap-fill-eyebrow').textContent).toBe('母本缺口 · 怎么补');
    expect(screen.getByTestId('gap-unpairable').textContent).toContain('本号、跨号都无法配对');
    // 母本页的悬浮窗不再提供「加入配窝建议」（计划入口只留看板侧）
    expect(screen.queryByTestId('gap-add-to-plan')).toBeNull();

    fireEvent.click(screen.getByTestId('gap-fill-close'));
    expect(screen.queryByTestId('gap-fill-dialog')).toBeNull();
  });

  test('已收集卡去掉「查看」按钮，点卡片跳精灵背包并带齐筛选', () => {
    const recommended = eggNatures(species, 3003, {});
    const motherNature = recommended[0] ?? '固执';
    const owned: OwnedPet[] = [
      {
        gameId: 3003,
        name: '火花',
        gender: '母',
        nature: motherNature,
        voiceDb: 100,
        medalBody: '大块头',
        weightPercent: 100,
        isShiny: false,
        account: '账号甲',
      },
    ];
    const group: MotherGroup = {
      chainKey: 'egg:3003',
      eggGameId: 3003,
      collected: true,
      quality: true,
      motherClass: '大婉',
      formLabel: '火花',
      number: '005',
      eggGroups: [1],
      memberIndexes: [0],
    };
    const onOpenInventory = vi.fn();
    render(
      <MotherView
        owned={owned}
        searchIndex={new Map()}
        eggGroupNames={{ 1: '巨灵组' }}
        motherGroups={[group]}
        mode="perfect"
        status="collected"
        onOpenInventory={onOpenInventory}
      />,
    );

    const card = screen.getByTestId('mother-chain-row');
    // 不再有「查看」按钮：整张卡就是跳转入口
    expect(within(card).queryByTestId('mother-chain-open')).toBeNull();
    const natures = within(card).getByTestId('mother-card-natures');
    expect(within(natures).getByText(motherNature)).toHaveClass('bg-emerald-100');
    const other = recommended.find((nature) => nature !== motherNature);
    if (other) expect(within(natures).getByText(other)).toHaveClass('bg-slate-100');

    fireEvent.click(within(card).getByRole('button'));
    expect(onOpenInventory).toHaveBeenCalledWith({
      name: '火花',
      // 体型按「奖牌 或 身高到顶」取并集：无奖牌但身高 100% 的母本也要能筛到
      tags: expect.arrayContaining([
        'gender:母',
        'body:大块头',
        'body:满身高',
        'voice:+100',
        `nature:${motherNature}`,
      ]),
    });
  });

  test('小不点档位带「零身高」并集标签', () => {
    const owned: OwnedPet[] = [
      {
        gameId: 3003,
        name: '火花',
        gender: '母',
        nature: '固执',
        voiceDb: -100,
        medalBody: '',
        heightPercent: 0,
        weightPercent: 2,
        isShiny: false,
        account: '账号甲',
      },
    ];
    const group: MotherGroup = {
      chainKey: 'egg:3003',
      eggGameId: 3003,
      collected: true,
      quality: true,
      motherClass: '小粗',
      formLabel: '火花',
      number: '005',
      eggGroups: [1],
      memberIndexes: [0],
    };
    const onOpenInventory = vi.fn();
    setMotherCriteria({ ...DEFAULT_MOTHER_CRITERIA, grades: ['小粗'] });
    render(
      <MotherView
        owned={owned}
        searchIndex={new Map()}
        eggGroupNames={{ 1: '巨灵组' }}
        motherGroups={[group]}
        mode="perfect"
        status="collected"
        onOpenInventory={onOpenInventory}
      />,
    );

    fireEvent.click(within(screen.getByTestId('mother-chain-row')).getByRole('button'));
    expect(onOpenInventory).toHaveBeenCalledWith({
      name: '火花',
      tags: expect.arrayContaining(['body:小不点', 'body:零身高', 'voice:-100']),
    });
  });
});
