import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { allNatureNames, targetNatureNames } from '../data/catalog';
import { Coverage } from './Coverage';
import { getCoverageFilter, resetCoverageFilter, setTargetGrade } from './coverageFilterStore';
import { getTargetMode, setTargetMode } from './targetModeStore';

/**
 * 覆盖度页的关键路径（R2-4-M05）：筛选、性格三模式与自选性格网格都在这一页，
 * 之前只有说明卡与筛选 store 有单测，页面级没有护栏。
 *
 * 2026-11-19 用户口径：筛选提成一级卡片常显、性格默认「八大性格」。
 * 种公阵列用轻壳替换（阵列/矩阵自身不在本用例范围）。
 */
vi.mock('./useCollectionSummary', () => ({
  useCollectionSummary: () => ({
    loaded: true,
    owned: [],
    motherGroups: [],
    mode: 'perfect',
    mother: { collected: 0, total: 0 },
    stud: { cells: [], groupCount: 14, passedGroups: 0, total: 0, covered: 0, groupSummary: [] },
    plans: [],
    recommendations: [],
  }),
}));
vi.mock('./useOwnedPets', () => ({
  useOwnedPets: () => ({ owned: [], accounts: ['测试甲'], all: [] }),
}));
vi.mock('./StudMatrix', () => ({
  StudMatrix: () => <div data-testid="stub-stud-matrix" />,
}));
vi.mock('./SourceNotice', () => ({ SourceNotice: () => <div /> }));
vi.mock('./CoverageIntroCard', () => ({ CoverageIntroCard: () => <div /> }));

describe('覆盖度页（筛选一级卡片 + 性格三模式）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setTargetMode('perfect');
    resetCoverageFilter();
    setTargetGrade('大婉');
  });

  test('筛选常显在页面顶部，不需要点开关；默认选中八大性格', () => {
    render(<Coverage />);

    expect(screen.getByTestId('coverage-filter-card')).toBeTruthy();
    expect(screen.getByTestId('coverage-filter')).toBeTruthy();
    expect(screen.getByRole('group', { name: '种公目标模式' })).toBeTruthy();
    expect(screen.getByTestId('coverage-target-grade-大婉')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('coverage-groups-toggle')).toHaveTextContent('蛋组（14/14）');
    expect(screen.queryByText('奖牌目标')).toBeNull();
    expect(screen.queryByTestId('coverage-open-target-editor')).toBeNull();
    expect(screen.queryByTestId('coverage-filter-reset')).toBeNull();

    expect(screen.getByTestId('nature-mode-eight')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('nature-mode-recommended')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('nature-mode-eight-list')).toHaveTextContent('八大性格：固执');
    // 默认就是默认值：不亮「已改」
    expect(screen.queryByTestId('coverage-filter-active')).toBeNull();
  });

  test('奖牌目标使用母本同款模式且强制单选，并更新种公档位', () => {
    render(<Coverage />);

    fireEvent.click(screen.getByTestId('coverage-target-grade-小婉'));
    expect(getCoverageFilter().grades).toEqual(['小婉']);
    expect(screen.getByTestId('coverage-target-grade-小婉')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('coverage-target-grade-大婉')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByTestId('coverage-target-mode-medal'));
    expect(getTargetMode()).toBe('medal');
    expect(screen.getByTestId('coverage-target-mode-medal')).toHaveAttribute('aria-pressed', 'true');
  });

  test('切到自选性格先预选八大；默认收起，展开后一个都不勾给提示且不白屏', () => {
    render(<Coverage />);
    fireEvent.click(screen.getByTestId('nature-mode-custom'));

    // 默认收起：只留一行摘要，6×5 网格不占地方
    expect(screen.getByTestId('custom-natures')).toBeTruthy();
    expect(screen.queryByTestId('custom-nature-grid')).toBeNull();
    expect(screen.getByTestId('custom-nature-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('custom-natures-summary')).toHaveTextContent(
      `已选 ${targetNatureNames.length} 个`,
    );

    fireEvent.click(screen.getByTestId('custom-nature-toggle'));
    expect(screen.getByTestId('custom-nature-grid')).toBeTruthy();
    for (const name of targetNatureNames) {
      expect(screen.getByTestId(`custom-nature-${name}`)).toHaveAttribute('aria-pressed', 'true');
    }
    expect(screen.queryByTestId('custom-natures-empty')).toBeNull();

    // 全部取消后才回到「未选」提示；槽位为 0 时分母是 0，不是 NaN / 白屏
    fireEvent.click(screen.getByTestId('custom-nature-select-all'));
    expect(screen.getByTestId('custom-natures-empty')).toBeTruthy();
    expect(screen.getByTestId('coverage-total')).toHaveTextContent('已通 0');
    expect(document.body.textContent).not.toContain('NaN');
  });

  test('性格模式偏离默认时「已改」标记点亮', () => {
    render(<Coverage />);
    expect(screen.queryByTestId('coverage-filter-active')).toBeNull();

    fireEvent.click(screen.getByTestId('nature-mode-custom'));
    expect(screen.getByTestId('coverage-filter-active')).toBeTruthy();

    fireEvent.click(screen.getByTestId('nature-mode-eight'));
    expect(screen.queryByTestId('coverage-filter-active')).toBeNull();
  });

  test('全选八大 / 全部取消：只作用八大性格，按钮文案随之切换', () => {
    render(<Coverage />);
    fireEvent.click(screen.getByTestId('nature-mode-custom'));
    fireEvent.click(screen.getByTestId('custom-nature-toggle'));
    fireEvent.click(screen.getByTestId('custom-nature-固执'));

    const selectAll = () => screen.getByTestId('custom-nature-select-all');
    expect(selectAll()).toHaveTextContent('全选八大');
    fireEvent.click(selectAll());
    for (const name of targetNatureNames) {
      expect(screen.getByTestId(`custom-nature-${name}`)).toHaveAttribute('aria-pressed', 'true');
    }
    expect(selectAll()).toHaveTextContent('全部取消');

    fireEvent.click(selectAll());
    expect(screen.getByTestId('custom-nature-固执')).toHaveAttribute('aria-pressed', 'false');
  });

  test('下拉框装下全部 30 个性情：点开是六行五列，再点收起，网格不占页面高度', () => {
    render(<Coverage />);
    fireEvent.click(screen.getByTestId('nature-mode-custom'));

    // 默认收起；没有旧的「更多 / 收起」和只读摘要
    expect(screen.queryByTestId('custom-nature-grid')).toBeNull();
    expect(screen.queryByTestId('custom-nature-more')).toBeNull();
    expect(screen.queryByTestId('custom-natures-hidden')).toBeNull();

    fireEvent.click(screen.getByTestId('custom-nature-toggle'));
    expect(screen.getByTestId('custom-nature-toggle')).toHaveAttribute('aria-expanded', 'true');
    for (const name of allNatureNames) {
      expect(screen.getByTestId(`custom-nature-${name}`)).toBeTruthy();
    }
    // 六行：物攻 / 物防 / 魔攻 / 魔防 / 速度 / 生命，每行 5 个
    for (const stat of ['物攻', '物防', '魔攻', '魔防', '速度', '生命']) {
      expect(screen.getByTestId(`custom-nature-row-${stat}`)).toBeTruthy();
    }

    // 池外性格也在下拉里，点一下直接生效
    const outsideName = allNatureNames.find((name) => !targetNatureNames.includes(name));
    expect(outsideName).toBeTruthy();
    fireEvent.click(screen.getByTestId(`custom-nature-${outsideName}`));
    expect(getCoverageFilter().customNatures).toContain(outsideName);

    // 收起：网格消失，摘要里仍看得见已选（包括池外性格）
    fireEvent.click(screen.getByTestId('custom-nature-toggle'));
    expect(screen.queryByTestId('custom-nature-grid')).toBeNull();
    expect(screen.getByTestId('custom-natures-summary')).toHaveTextContent(outsideName ?? '');
  });

  test('点属性名整组勾选 / 再点整组取消', () => {
    render(<Coverage />);
    fireEvent.click(screen.getByTestId('nature-mode-custom'));
    fireEvent.click(screen.getByTestId('custom-nature-toggle'));

    const attackNames = ['大胆', '固执', '调皮', '勇敢', '逞强'];
    // 默认只预选了八大的「固执」，物攻组还没全选
    expect(screen.getByTestId('custom-nature-stat-物攻')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('custom-nature-stat-物攻'));
    for (const name of attackNames) {
      expect(screen.getByTestId(`custom-nature-${name}`)).toHaveAttribute('aria-pressed', 'true');
    }
    fireEvent.click(screen.getByTestId('custom-nature-stat-物攻'));
    for (const name of attackNames) {
      expect(screen.getByTestId(`custom-nature-${name}`)).toHaveAttribute('aria-pressed', 'false');
    }
  });
});
