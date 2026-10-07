import { describe, expect, test } from 'vitest';
import { CHANGELOG, pendingChangelog, type ChangelogEntry } from './changelog';

const list: ChangelogEntry[] = [
  { id: 'v3', title: '第三次', items: ['c'] },
  { id: 'v2', title: '第二次', items: ['b'] },
  { id: 'v1', title: '第一次', items: ['a'] },
];

describe('pendingChangelog', () => {
  test('本机没记录过 → 只给最新一条，不倒历史', () => {
    expect(pendingChangelog(null, list)).toEqual([list[0]]);
  });

  test('已看过最新一条 → 不弹', () => {
    expect(pendingChangelog('v3', list)).toEqual([]);
  });

  test('看过较旧的一条 → 给出它之后新增的（最新的在前）', () => {
    expect(pendingChangelog('v2', list)).toEqual([list[0]]);
    expect(pendingChangelog('v1', list)).toEqual([list[0], list[1]]);
  });

  test('看过一条已不存在的旧标识 → 退化为只给最新一条', () => {
    expect(pendingChangelog('很旧的版本', list)).toEqual([list[0]]);
  });

  test('空列表返回空数组', () => {
    expect(pendingChangelog(null, [])).toEqual([]);
  });

  test('内置 CHANGELOG 最新一条带 id 与 items（发版约定）', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0].id).toBeTruthy();
    expect(CHANGELOG[0].items.length).toBeGreaterThan(0);
  });
});
