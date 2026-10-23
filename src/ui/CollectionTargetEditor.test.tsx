import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_MOTHER_CRITERIA,
} from '../domain/motherCriteria';
import { CollectionTargetEditor } from './CollectionTargetEditor';
import { getCoverageFilter, resetCoverageFilter, toggleFilterGrade } from './coverageFilterStore';
import { getMotherCriteria, setMotherCriteria } from './motherCriteriaStore';
import { setTargetMode } from './targetModeStore';

beforeEach(() => {
  resetCoverageFilter();
  const grades = getCoverageFilter().grades;
  for (const grade of grades) toggleFilterGrade(grade);
  toggleFilterGrade('大婉');
  setTargetMode('perfect');
  setMotherCriteria({ ...DEFAULT_MOTHER_CRITERIA });
});

const renderEditor = (section: 'studs' | 'mothers') => {
  render(<CollectionTargetEditor open section={section} onClose={() => {}} />);
};

describe('CollectionTargetEditor', () => {
  test('种公分区：档位与蛋组写回原 store，母本条件不变', () => {
    renderEditor('studs');
    const motherBefore = { ...getMotherCriteria() };

    fireEvent.click(screen.getByTestId('editor-target-grade-小婉'));
    expect(getCoverageFilter().grades).toContain('小婉');

    fireEvent.click(screen.getByTestId('editor-group-2'));
    expect(getCoverageFilter().groupIds).not.toContain(2);

    expect(getMotherCriteria()).toEqual(motherBefore);
  });

  test('母本分区：体型写回原 store，种公目标不变', () => {
    renderEditor('mothers');
    const gradesBefore = [...getCoverageFilter().grades];

    fireEvent.click(screen.getByTestId('editor-mother-body-小不点'));
    expect(getMotherCriteria().bodies).not.toContain('小不点');

    expect(getCoverageFilter().grades).toEqual(gradesBefore);
  });

  test('声音维度清空 = 不限，不会被偷偷还原成默认', () => {
    renderEditor('mothers');
    fireEvent.click(screen.getByTestId('editor-mother-voice-+100'));
    fireEvent.click(screen.getByTestId('editor-mother-voice--100'));
    expect(getMotherCriteria().voices).toEqual([]);

    // 恢复默认按钮才把它改回默认
    fireEvent.click(screen.getByTestId('editor-reset-mothers'));
    expect(getMotherCriteria().voices).toEqual(DEFAULT_MOTHER_CRITERIA.voices);
  });

  test('种公恢复默认：蛋组/性格回默认，档位保持不变', () => {
    renderEditor('studs');
    fireEvent.click(screen.getByTestId('editor-group-2'));
    expect(getCoverageFilter().groupIds).toHaveLength(13);

    fireEvent.click(screen.getByTestId('editor-reset-studs'));
    expect(getCoverageFilter().groupIds).toHaveLength(14);
    expect(getCoverageFilter().grades).toEqual(['大婉']);
  });
});
