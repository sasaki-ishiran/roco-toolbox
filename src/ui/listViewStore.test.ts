import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearGroupListSession,
  ensureGroupSession,
  resetPersonalListViewsForTest,
  setGroupList,
  setPersonalQuery,
  useGroupList,
  usePersonalList,
} from './listViewStore';

beforeEach(() => {
  resetPersonalListViewsForTest();
  clearGroupListSession();
});

describe('个人清单搜索（仅本次会话）', () => {
  test('各清单互不影响', () => {
    const all = renderHook(() => usePersonalList('inventory-all'));
    const stud = renderHook(() => usePersonalList('inventory-stud'));
    act(() => setPersonalQuery('inventory-all', '布灵'));
    expect(all.result.current.query).toBe('布灵');
    expect(stud.result.current.query).toBe('');
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
  test('默认未收集、无关键词、无成员筛选', () => {
    const hook = renderHook(() => useGroupList('A', 'g1'));
    expect(hook.result.current).toEqual({
      query: '',
      view: 'missing',
      memberFilter: '',
      seekingMembers: [],
      onlyOwned: false,
    });
  });

  test('按身份 + 小组隔离：切组不串条件', () => {
    const g1 = renderHook(() => useGroupList('A', 'g1'));
    const g2 = renderHook(() => useGroupList('A', 'g2'));
    act(() => setGroupList('A', 'g1', { query: '火神', view: 'all' }));
    expect(g1.result.current).toMatchObject({ query: '火神', view: 'all' });
    expect(g2.result.current).toMatchObject({ query: '', view: 'missing' });
  });

  test('换工具箱身份立即清旧临时态', () => {
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
