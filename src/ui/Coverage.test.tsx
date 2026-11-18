import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { allNatureNames, targetNatureNames } from '../data/catalog';
import { Coverage } from './Coverage';
import { getCoverageFilter, resetCoverageFilter, toggleFilterGrade } from './coverageFilterStore';
import { getTargetMode, setTargetMode } from './targetModeStore';

/**
 * 覆盖度页的关键路径（R2-4-M05）：本批把筛选项、性格两排与「更多」都搬进了这一页，
 * 之前只有说明卡与筛选 store 有单测，页面级没有护栏。
 *
 * 只锁筛选折叠、目标选择、自选空态、性格批量切换，以及已勾池外性格的可见性。
 * 种公阵列用轻壳替换（本页只负责把筛选内容塞进去），阵列/矩阵自身不在本用例范围。
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
  StudMatrix: (props: {
    filterOpen?: boolean;
    onToggleFilter?: () => void;
    filterActive?: boolean;
    filterPanel?: React.ReactNode;
  }) => (
    <div data-testid="stub-stud-matrix">
      <button
        type="button"
        data-testid="stud-matrix-filter-toggle"
        aria-expanded={props.filterOpen === true}
        onClick={props.onToggleFilter}
      >
        筛选
      </button>
      {props.filterActive ? <span data-testid="stud-matrix-filter-dot" /> : null}
      {props.filterOpen ? <div data-testid="stud-matrix-filter">{props.filterPanel}</div> : null}
    </div>
  ),
}));
vi.mock('./SourceNotice', () => ({ SourceNotice: () => <div /> }));
vi.mock('./CoverageIntroCard', () => ({ CoverageIntroCard: () => <div /> }));

const openFilter = () => fireEvent.click(screen.getByTestId('stud-matrix-filter-toggle'));

describe('覆盖度页（筛选项收进种公阵列右上角）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setTargetMode('perfect');
    resetCoverageFilter();
    // 档位是全局口径、覆盖度的「恢复默认」刻意不动它 → 用例里显式复位，保证隔离
    if (!getCoverageFilter().grades.includes('大婉')) toggleFilterGrade('大婉');
    for (const grade of getCoverageFilter().grades.filter((item) => item !== '大婉')) {
      toggleFilterGrade(grade);
    }
  });

  test('筛选默认收起；点右上角「筛选」才展开档位与蛋组', () => {
    render(<Coverage />);
    expect(screen.queryByTestId('coverage-filter')).toBeNull();

    openFilter();
    expect(screen.getByTestId('coverage-filter')).toBeTruthy();
    expect(screen.getByRole('group', { name: '种公目标模式' })).toBeTruthy();
    expect(screen.getByTestId('coverage-target-grade-大婉')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('coverage-groups-toggle')).toHaveTextContent('蛋组（14/14）');
    expect(screen.queryByText('奖牌目标')).toBeNull();
    expect(screen.queryByTestId('coverage-open-target-editor')).toBeNull();
    expect(screen.queryByTestId('coverage-filter-reset')).toBeNull();
  });

  test('奖牌目标使用母本同款模式且强制单选，并更新种公档位', () => {
    render(<Coverage />);
    openFilter();

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

  test('自选性格一个都没勾：给提示且不白屏', () => {
    render(<Coverage />);
    openFilter();
    fireEvent.click(screen.getByTestId('nature-mode-custom'));

    expect(screen.getByTestId('custom-natures')).toBeTruthy();
    expect(screen.getByTestId('custom-natures-empty')).toBeTruthy();
    // 槽位为 0 时分母是 0，不是 NaN / 白屏
    expect(screen.getByTestId('coverage-total')).toHaveTextContent('已通 0');
    expect(document.body.textContent).not.toContain('NaN');
  });

  test('勾了一个性格后「筛选」圆点点亮（筛选已偏离默认）', () => {
    render(<Coverage />);
    expect(screen.queryByTestId('stud-matrix-filter-dot')).toBeNull();

    openFilter();
    // 切到自选模式本身就算偏离默认（推荐模式下每组前 3 不再生效）
    fireEvent.click(screen.getByTestId('nature-mode-custom'));
    expect(screen.getByTestId('stud-matrix-filter-dot')).toBeTruthy();

    fireEvent.click(screen.getByTestId('custom-nature-固执'));
    expect(screen.queryByTestId('custom-natures-empty')).toBeNull();
    expect(screen.getByTestId('custom-nature-固执')).toHaveAttribute('aria-pressed', 'true');
  });

  test('全选八大 / 全部取消：只作用八大性格，按钮文案随之切换', () => {
    render(<Coverage />);
    openFilter();
    fireEvent.click(screen.getByTestId('nature-mode-custom'));
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

  test('收起「更多」后，已勾的池外性格仍然可见（不能只看得到它生效）', () => {
    const outsideName = allNatureNames.find((name) => !targetNatureNames.includes(name));
    expect(outsideName).toBeTruthy();

    render(<Coverage />);
    openFilter();
    fireEvent.click(screen.getByTestId('nature-mode-custom'));
    fireEvent.click(screen.getByTestId('custom-nature-more'));
    fireEvent.click(screen.getByTestId(`custom-nature-${outsideName}`));
    fireEvent.click(screen.getByTestId('custom-nature-more'));

    expect(screen.queryByTestId(`custom-nature-${outsideName}`)).toBeNull();
    expect(screen.getByTestId('custom-natures-hidden')).toHaveTextContent(outsideName ?? '');
  });
});
