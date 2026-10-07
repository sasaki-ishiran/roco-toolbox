import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  getMotherPlan,
  mergeMotherPlan,
  removeManyFromMotherPlan,
  resetMotherPlanForTest,
  toggleMotherPlan,
  useMotherPlan,
} from './motherPlanStore';

describe('母本计划 store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMotherPlanForTest();
  });

  test('默认空清单', () => {
    expect(getMotherPlan()).toEqual([]);
  });

  test('勾选 / 取消勾选', () => {
    toggleMotherPlan('evo_a');
    expect(getMotherPlan()).toEqual(['evo_a']);
    toggleMotherPlan('evo_a');
    expect(getMotherPlan()).toEqual([]);
  });

  test('写进 localStorage，reset 后能读回', () => {
    toggleMotherPlan('evo_a');
    expect(JSON.parse(window.localStorage.getItem('roco.motherPlan') ?? '[]')).toEqual(['evo_a']);
    resetMotherPlanForTest();
    expect(getMotherPlan()).toEqual(['evo_a']);
  });

  test('批量移除（清除已达成）', () => {
    mergeMotherPlan(['a', 'b', 'c']);
    removeManyFromMotherPlan(['a', 'c']);
    expect(getMotherPlan()).toEqual(['b']);
  });

  test('合并取并集，返回新增条数', () => {
    expect(mergeMotherPlan(['a', 'b'])).toBe(2);
    expect(mergeMotherPlan(['b', 'c'])).toBe(1);
    expect([...getMotherPlan()].sort()).toEqual(['a', 'b', 'c']);
    // 全重复时新增 0 条，不改动
    expect(mergeMotherPlan(['a', 'b', 'c'])).toBe(0);
  });

  test('useMotherPlan 跟随 store 变化', () => {
    const { result } = renderHook(() => useMotherPlan());
    expect(result.current).toEqual([]);
    act(() => toggleMotherPlan('evo_a'));
    expect(result.current).toEqual(['evo_a']);
  });
});