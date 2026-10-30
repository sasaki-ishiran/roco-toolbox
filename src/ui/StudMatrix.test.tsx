import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CoverageSlot } from '../domain/studCoverage';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { StudMatrix, studMatrixCellName } from './StudMatrix';
import { resetStudMatrixPicksForTest } from './studMatrixStore';

const species: SpeciesEntry[] = [
  { key: 'a', gameId: 101, name: '单组兽', number: '001', eggGroups: [2] },
  { key: 'b', gameId: 102, name: '双组兽', number: '002', eggGroups: [2, 6] },
  { key: 'c', gameId: 103, name: '猛男兽', number: '003', eggGroups: [2] },
];
const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));
const eggGroupNames = { 2: '巨灵组', 6: '动物组' };

const pet = (over: Partial<OwnedPet> & { gameId: number; nature: string }): OwnedPet => ({
  name: 'x',
  gender: '公',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '甲',
  ...over,
});

const slots: CoverageSlot[] = [
  { groupId: 2, natureId: 1, natureName: '固执', grade: '大婉' },
  { groupId: 2, natureId: 2, natureName: '开朗', grade: '大婉' },
  { groupId: 6, natureId: 1, natureName: '固执', grade: '大婉' },
  { groupId: 2, natureId: 2, natureName: '开朗', grade: '小婉' },
];

const owned: OwnedPet[] = [
  pet({ gameId: 101, nature: '固执', account: '甲', weightPercent: 99 }),
  pet({ gameId: 103, nature: '固执', account: '乙', weightPercent: 80 }),
  pet({ gameId: 102, nature: '开朗', account: '甲', weightPercent: 90 }),
];

const renderMatrix = () =>
  render(
    <StudMatrix
      slots={slots}
      owned={owned}
      species={species}
      speciesByGameId={speciesByGameId}
      eggGroupNames={eggGroupNames}
      mode="perfect"
    />,
  );

beforeEach(() => {
  resetStudMatrixPicksForTest();
});

describe('StudMatrix', () => {
  test('行=蛋组、列=目标性格并集；没选该性格的格子显示 —', () => {
    renderMatrix();
    expect(screen.getByTestId('stud-matrix')).toBeTruthy();
    expect(screen.getByTestId('stud-matrix-grade-大婉')).toBeTruthy();
    // 列头
    expect(screen.getByText('固执')).toBeTruthy();
    expect(screen.getByText('开朗')).toBeTruthy();
    // 动物组没有「开朗」目标 → 淡灰 —
    const animalRow = screen.getByText('动物组').closest('tr')!;
    expect(within(animalRow).getAllByText('—')).toHaveLength(1);
  });

  test('同格多只种公显示小数字，点开可换代表并记住', () => {
    renderMatrix();
    const cell = screen.getByTestId('stud-cell-2-固执');
    // 候选 2 只 → 显示数字 2
    expect(within(cell).getByTestId('stud-cell-count-2-固执')).toHaveTextContent('2');
    // 默认自动取体重更满的那只
    expect(within(cell).getByText('单组兽')).toBeTruthy();

    fireEvent.click(cell);
    const picker = screen.getByTestId('stud-picker');
    expect(within(picker).getByText('选择代表种公')).toBeTruthy();

    fireEvent.click(within(picker).getByText('猛男兽'));
    // 卡片换成手动选择的那只
    expect(within(screen.getByTestId('stud-cell-2-固执')).getByText('猛男兽')).toBeTruthy();

    // 再打开 → 恢复自动 → 回到排序第一
    fireEvent.click(screen.getByTestId('stud-cell-2-固执'));
    fireEvent.click(screen.getByTestId('stud-picker-auto'));
    expect(within(screen.getByTestId('stud-cell-2-固执')).getByText('单组兽')).toBeTruthy();
  });

  test('切档位 tab 后列与候选跟着变', () => {
    renderMatrix();
    fireEvent.click(screen.getByTestId('stud-matrix-grade-小婉'));
    // 小婉只有 巨灵组 × 开朗 一个槽位
    expect(screen.queryByText('固执')).toBeNull();
    expect(screen.getByText('开朗')).toBeTruthy();
    // 手里的开朗是大婉，小婉 tab 下这一格没有候选 → 缺
    const giant = screen.getByText('巨灵组').closest('tr')!;
    expect(within(giant).getByTestId('stud-cell-empty-2-开朗')).toHaveTextContent('缺');
  });

  test('格子尺寸统一：固定高度 + 固定列宽，名字长短不撑大格子', () => {
    renderMatrix();
    const scroll = screen.getByTestId('stud-matrix-scroll');
    // 触摸表格区域时仍要能上下滚整页：不能再锁成只允许横向手势
    expect(scroll.className).not.toContain('touch-pan-x');
    const table = within(scroll).getByRole('table');
    expect(table.className).toContain('table-fixed');
    const cells = within(scroll).getAllByRole('button');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      // 2026-10-29 起高度走内联样式（52px，比原来的 58 再收一点）
      expect(cell.style.height).toBe('52px');
      expect(cell.className).toContain('overflow-hidden');
    }
    // 列宽固定后，长名字只会在格子里省略，不会把整列撑宽
    expect(within(scroll).getByText('单组兽').className).toContain('truncate');
  });

  test('筛选在卡片右上角：收起时只露按钮，展开后才出现筛选内容', () => {
    const onToggleFilter = vi.fn();
    const { rerender } = render(
      <StudMatrix
        slots={slots}
        owned={owned}
        species={species}
        speciesByGameId={speciesByGameId}
        eggGroupNames={eggGroupNames}
        mode="perfect"
        filterPanel={<div data-testid="stub-filter">筛选内容</div>}
        filterOpen={false}
        onToggleFilter={onToggleFilter}
        filterActive
      />,
    );
    expect(screen.queryByTestId('stud-matrix-filter')).toBeNull();
    expect(screen.getByTestId('stud-matrix-filter-dot')).toBeTruthy();
    fireEvent.click(screen.getByTestId('stud-matrix-filter-toggle'));
    expect(onToggleFilter).toHaveBeenCalled();

    rerender(
      <StudMatrix
        slots={slots}
        owned={owned}
        species={species}
        speciesByGameId={speciesByGameId}
        eggGroupNames={eggGroupNames}
        mode="perfect"
        filterPanel={<div data-testid="stub-filter">筛选内容</div>}
        filterOpen
        onToggleFilter={onToggleFilter}
      />,
    );
    expect(within(screen.getByTestId('stud-matrix-filter')).getByTestId('stub-filter')).toBeTruthy();
  });

  test('没有目标档位 / 性格时仍保留右上角筛选，否则自选性格后没法再勾回来', () => {
    render(
      <StudMatrix
        slots={[]}
        owned={owned}
        species={species}
        speciesByGameId={speciesByGameId}
        eggGroupNames={eggGroupNames}
        mode="perfect"
        filterPanel={<div data-testid="stub-filter">筛选内容</div>}
        filterOpen
        onToggleFilter={() => {}}
      />,
    );
    expect(screen.getByTestId('stud-matrix-empty')).toBeTruthy();
    expect(screen.getByTestId('stub-filter')).toBeTruthy();
  });

  test('蛋组列收到 35px、性格列 60px，左侧不再占掉大半张卡', () => {
    renderMatrix();
    const table = within(screen.getByTestId('stud-matrix-scroll')).getByRole('table');
    const cols = table.querySelectorAll('col');
    expect((cols[0] as HTMLElement).style.width).toBe('35px');
    expect((cols[1] as HTMLElement).style.width).toBe('60px');
  });

  test('名字过长时只显示基础名，不展示形态', () => {
    expect(studMatrixCellName('雪绒鸟_夏天的样子')).toBe('雪绒鸟');
    expect(studMatrixCellName('火花')).toBe('火花');

    const longSpecies: SpeciesEntry = {
      key: 'long',
      gameId: 104,
      name: '雪绒鸟',
      form: '夏天的样子',
      officialName: '雪绒鸟_夏天的样子',
      number: '004',
      eggGroups: [2],
    };
    render(
      <StudMatrix
        slots={slots}
        owned={[pet({ gameId: 104, nature: '固执' })]}
        species={[...species, longSpecies]}
        speciesByGameId={new Map([...speciesByGameId, [104, longSpecies]])}
        eggGroupNames={eggGroupNames}
        mode="perfect"
      />,
    );
    const cell = screen.getByTestId('stud-cell-2-固执');
    expect(within(cell).getByText('雪绒鸟')).toBeTruthy();
    expect(within(cell).queryByText('雪绒鸟_夏天的样子')).toBeNull();
  });

  test('没收集到的格子填入推荐种公，用淡黄色卡片区分', () => {
    render(
      <StudMatrix
        slots={slots}
        owned={owned}
        species={species}
        speciesByGameId={speciesByGameId}
        eggGroupNames={eggGroupNames}
        mode="perfect"
        recommendations={[
          {
            id: 'rec-6-固执',
            natureName: '固执',
            displayName: '雪绒鸟_夏天的样子',
            groupIds: [6],
            groupLabels: ['动物组'],
            grade: '大婉',
            gameId: 104,
          },
        ]}
      />,
    );
    const cell = screen.getByTestId('stud-cell-recommend-6-固执');
    // 长名字同样只显示基础名；卡片是淡黄色 + 「荐」标记
    expect(cell).toHaveTextContent('雪绒鸟');
    expect(cell).toHaveTextContent('荐');
    expect(cell.className).toContain('bg-amber-50');
    expect(screen.queryByTestId('stud-cell-empty-6-固执')).toBeNull();
  });

  test('没有精确推荐时，按蛋组兜底推荐一只可当种公的蛋物种', () => {
    const fallbackSpecies: SpeciesEntry = {
      key: 'group-6',
      gameId: 106,
      name: '六组兽',
      number: '006',
      eggGameId: 106,
      eggGroups: [6],
      maleCapable: true,
    };
    render(
      <StudMatrix
        slots={slots}
        owned={owned}
        species={[...species, fallbackSpecies]}
        speciesByGameId={new Map([...speciesByGameId, [106, fallbackSpecies]])}
        eggGroupNames={eggGroupNames}
        mode="perfect"
      />,
    );
    const cell = screen.getByTestId('stud-cell-recommend-6-固执');
    expect(cell).toHaveTextContent('六组兽');
    expect(cell.className).toContain('bg-amber-50');
    expect(screen.queryByTestId('stud-cell-empty-6-固执')).toBeNull();
  });

  test('点淡黄推荐格可以直接发到小组需求中心（负数蛋组 id + 当前档位）', async () => {
    const onLoadDemandGroups = vi.fn();
    const onPublishStudDemand = vi.fn().mockResolvedValue(undefined);
    render(
      <StudMatrix
        slots={slots}
        owned={owned}
        species={species}
        speciesByGameId={speciesByGameId}
        eggGroupNames={eggGroupNames}
        mode="perfect"
        recommendations={[
          {
            id: 'rec-6-固执',
            natureName: '固执',
            displayName: '雪绒鸟',
            groupIds: [6],
            groupLabels: ['动物组'],
            grade: '大婉',
            gameId: 104,
          },
        ]}
        demandGroups={[{ id: 'g1', name: '测试组' }]}
        onLoadDemandGroups={onLoadDemandGroups}
        onPublishStudDemand={onPublishStudDemand}
      />,
    );
    fireEvent.click(screen.getByTestId('stud-cell-recommend-6-固执'));
    expect(onLoadDemandGroups).toHaveBeenCalled();
    expect(screen.getByTestId('stud-demand-publish')).toBeTruthy();
    expect(screen.getByTestId('stud-demand-publish-summary')).toHaveTextContent('动物组');
    expect(screen.getByTestId('stud-demand-publish-summary')).toHaveTextContent('固执');

    fireEvent.click(screen.getByTestId('stud-demand-publish-g1'));
    await waitFor(() =>
      expect(onPublishStudDemand).toHaveBeenCalledWith({
        groupId: 'g1',
        groupName: '测试组',
        eggGroupId: 6,
        natureName: '固执',
        body: '大块头',
        voice: '+100',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('stud-demand-publish-message')).toHaveTextContent('测试组'),
    );
  });

  test('没有候选的目标格显示「缺」', () => {
    renderMatrix();
    // 巨灵组的固执有候选；换一个没有种公的组合：动物组 固执（102 是开朗）
    const animal = screen.getByText('动物组').closest('tr')!;
    expect(within(animal).getByTestId('stud-cell-empty-6-固执')).toHaveTextContent('缺');
  });
});
