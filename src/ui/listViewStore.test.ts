import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearGroupListSession,
  ensureGroupSession,
  resetGroupTargetCriteriaForTest,
  resetPersonalListViewsForTest,
  setGroupList,
  setPersonalQuery,
  useGroupList,
  usePersonalList,
} from './listViewStore';

beforeEach(() => {
  resetPersonalListViewsForTest();
  clearGroupListSession();
  resetGroupTargetCriteriaForTest();
});

describe('个人清单搜索（仅本次会话）', () => {
  test('各清单互不影响', () => {
    const all = renderHook(() => usePersonalList('inventory-all'));
    const mothers = renderHook(() => usePersonalList('mothers'));
    act(() => setPersonalQuery('inventory-all', '布灵'));
    expect(all.result.current.query).toBe('布灵');
    expect(mothers.result.current.query).toBe('');
  });

  test('重新加载（复位）清空', () => {
    const hook = renderHook(() => usePersonalList('mothers'));
    act(() => setPersonalQuery('mothers', '火神'));
    expect(hook.result.current.query).toBe('火神');
    act(() => resetPersonalListViewsForTest());
    expect(hook.result.current.query).toBe('');
  });
});

describe('小组清单临时状态', () => {
  test('默认未收集、无关键词、无成员筛选；目标筛选条默认母 / 不挑性格 / 大块头 / +100', () => {
    const hook = renderHook(() => useGroupList('A', 'g1'));
    expect(hook.result.current).toEqual({
      query: '',
      view: 'missing',
      memberFilter: '',
      missingMembers: [],
      seekingMembers: [],
      onlyOwned: false,
      ignoreNatures: false,
      targetGender: '母',
      targetNature: '',
      targetBody: '大块头',
      targetVoice: '+100',
      targetKind: 'mother',
      onlyGroupLine: false,
    });
  });

  test('按身份 + 小组隔离：切组不串条件', () => {
    const g1 = renderHook(() => useGroupList('A', 'g1'));
    const g2 = renderHook(() => useGroupList('A', 'g2'));
    act(() => setGroupList('A', 'g1', { query: '火神', view: 'all' }));
    expect(g1.result.current).toMatchObject({ query: '火神', view: 'all' });
    expect(g2.result.current).toMatchObject({ query: '', view: 'missing' });
  });

  test('换我的身份立即清旧临时态', () => {
    ensureGroupSession('A');
    const hook = renderHook(() => useGroupList('A', 'g1'));
    act(() => setGroupList('A', 'g1', { query: '火神' }));
    expect(hook.result.current.query).toBe('火神');

    act(() => ensureGroupSession('B'));
    expect(hook.result.current.query).toBe('');
  });

  test('patch 只改传入字段', () => {
    const hook = renderHook(() => useGroupList('A', 'g1'));
    act(() => setGroupList('A', 'g1', { view: 'help' }));
    act(() => setGroupList('A', 'g1', { onlyOwned: true }));
    expect(hook.result.current).toMatchObject({ view: 'help', onlyOwned: true });
  });
});

describe('「我缺的」目标口径跨会话记住（2026-11-01 用户反馈）', () => {
  test('选了小不点 +100 后写进本机，换组也沿用', () => {
    const g1 = renderHook(() => useGroupList('A', 'g1'));
    act(() => setGroupList('A', 'g1', { targetBody: '小不点', targetVoice: '+100' }));

    const stored = window.localStorage.getItem('roco.groupTargetCriteria');
    expect(stored).toContain('小不点');
    expect(stored).toContain('+100');

    const g2 = renderHook(() => useGroupList('A', 'g2'));
    expect(g2.result.current.targetBody).toBe('小不点');
    expect(g1.result.current.targetBody).toBe('小不点');
  });

  test('换身份清临时筛选，但不丢目标口径', () => {
    ensureGroupSession('A');
    const hook = renderHook(() => useGroupList('A', 'g1'));
    act(() => setGroupList('A', 'g1', { query: '火神', targetNature: '开朗' }));

    act(() => ensureGroupSession('B'));
    expect(hook.result.current.query).toBe('');
    expect(hook.result.current.targetNature).toBe('开朗');
  });

  test('查询 / 成员筛选仍是会话状态，不落盘', () => {
    renderHook(() => useGroupList('A', 'g1'));
    act(() => setGroupList('A', 'g1', { query: '火神', memberFilter: 'm1' }));

    expect(window.localStorage.getItem('roco.groupTargetCriteria')).toBeNull();
  });

  test('「不挑性格」写进本机，换组与刷新后沿用（2026-11-02 用户口径）', () => {
    renderHook(() => useGroupList('A', 'g1'));
    act(() => setGroupList('A', 'g1', { ignoreNatures: true }));

    expect(window.localStorage.getItem('roco.groupTargetCriteria')).toContain('"ignoreNatures":true');

    const g2 = renderHook(() => useGroupList('A', 'g2'));
    expect(g2.result.current.ignoreNatures).toBe(true);
  });
});
