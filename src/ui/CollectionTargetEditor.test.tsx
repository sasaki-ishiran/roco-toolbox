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
  test('种公设置弹层只编辑蛋组和性格，不重复提供模式或奖牌组合', () => {
    renderEditor('studs');
    expect(screen.getByRole('dialog', { name: '调整目标' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: '目标模式' })).toBeNull();
    expect(screen.queryByRole('group', { name: '目标奖牌组合（公母共用）' })).toBeNull();
    const motherBefore = { ...getMotherCriteria() };
    const gradesBefore = [...getCoverageFilter().grades];

    fireEvent.click(screen.getByTestId('editor-group-2'));
    expect(getCoverageFilter().groupIds).not.toContain(2);
    expect(getCoverageFilter().grades).toEqual(gradesBefore);
    expect(getMotherCriteria()).toEqual(motherBefore);
  });

  test('母本分区：组合奖牌写回原 store（单选），种公目标不变', () => {
    renderEditor('mothers');
    expect(screen.getByRole('dialog', { name: '调整母本达标条件' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '种公目标' })).toBeNull();
    const gradesBefore = [...getCoverageFilter().grades];

    // 点另一个档位是「换过去」，不是累加
    fireEvent.click(screen.getByTestId('editor-mother-grade-小婉'));
    expect(getMotherCriteria().grades).toEqual(['小婉']);

    expect(getCoverageFilter().grades).toEqual(gradesBefore);
  });

  test('组合奖牌强制单选：换档位只留最后点的那个，点已选中的不会清空', () => {
    renderEditor('mothers');
    fireEvent.click(screen.getByTestId('editor-mother-grade-大粗'));
    expect(getMotherCriteria().grades).toEqual(['大粗']);

    fireEvent.click(screen.getByTestId('editor-mother-grade-小粗'));
    expect(getMotherCriteria().grades).toEqual(['小粗']);

    // 再点已选中的那个：保持选中，不会变成「一个都不选」
    fireEvent.click(screen.getByTestId('editor-mother-grade-小粗'));
    expect(getMotherCriteria().grades).toEqual(['小粗']);

    // 恢复默认按钮才把它改回默认
    fireEvent.click(screen.getByTestId('editor-reset-mothers'));
    expect(getMotherCriteria().voices).toEqual(DEFAULT_MOTHER_CRITERIA.voices);
    expect(getMotherCriteria().grades).toBeUndefined();
  });

  test('母本达标模式切换更新组合奖牌图标与声音条件', () => {
    renderEditor('mothers');
    const perfectVoice = screen.getByTestId('editor-mother-grade-大婉').querySelectorAll('img')[1];
    expect(perfectVoice).toHaveAttribute('src', '/ui/medals/1026-max.png');

    fireEvent.click(screen.getByTestId('editor-mother-mode-medal'));

    expect(getMotherCriteria().voices).toEqual(['婉转声']);
    expect(screen.getByTestId('editor-mother-grade-大婉').querySelectorAll('img')[1]).toHaveAttribute(
      'src',
      '/ui/medals/1026.png',
    );
    expect(screen.queryByTestId('editor-mother-voice-+100')).toBeNull();
  });

  test('双牌模式下恢复默认会恢复双牌声音条件', () => {
    renderEditor('mothers');
    fireEvent.click(screen.getByTestId('editor-mother-mode-medal'));
    fireEvent.click(screen.getByTestId('editor-reset-mothers'));
    expect(getMotherCriteria().voices).toEqual(['婉转声', '粗嗓门']);
  });

  test('种公恢复默认：蛋组/性格回默认，主页奖牌组合保持不变', () => {
    renderEditor('studs');
    fireEvent.click(screen.getByTestId('editor-group-2'));
    expect(getCoverageFilter().groupIds).toHaveLength(13);

    fireEvent.click(screen.getByTestId('editor-reset-studs'));
    expect(getCoverageFilter().groupIds).toHaveLength(14);
    expect(getCoverageFilter().grades).toEqual(['大婉']);
  });
});
