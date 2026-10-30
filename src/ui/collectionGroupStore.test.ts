import { beforeEach, describe, expect, test } from 'vitest';
import {
  readCollectionGroupPrefs,
  readDemandCompletionSeenAt,
  readLastGroupId,
  saveDemandCompletionSeenAt,
  saveLastGroupId,
  savePageMode,
} from './collectionGroupStore';

beforeEach(() => {
  window.localStorage.clear();
});

describe('小组页本机偏好（二期）', () => {
  test('只记住母本组的当前组；旧种公组记忆被丢弃', () => {
    saveLastGroupId('A', 'mother', 'g-mother');
    saveLastGroupId('A', 'stud', 'g-stud');
    expect(readLastGroupId('A', 'mother')).toBe('g-mother');
    expect(readLastGroupId('A', 'stud')).toBeNull();
    saveLastGroupId('A', 'mother', null);
    expect(readLastGroupId('A', 'mother')).toBeNull();
  });

  test('页面模式按身份隔离', () => {
    savePageMode('A', 'group');
    expect(readCollectionGroupPrefs('A').mode).toBe('group');
    expect(readCollectionGroupPrefs('B').mode).toBe('personal');
  });

  test('未登录时用设备级草稿，不串到登录后的身份', () => {
    savePageMode(null, 'personal');
    expect(readCollectionGroupPrefs(null).mode).toBe('personal');
    expect(readCollectionGroupPrefs('A').mode).toBe('personal');
  });

  test('旧 localStorage 里的种公组类型与组 id 被忽略，避免进入已删除的组', () => {
    window.localStorage.setItem(
      'roco.collectionGroups:A',
      JSON.stringify({
        mode: 'group',
        personalType: 'stud',
        lastGroupIds: { stud: 'deleted-stud-group', mother: 'g-mother' },
      }),
    );
    const prefs = readCollectionGroupPrefs('A');
    expect(prefs.lastGroupIds).toEqual({ mother: 'g-mother' });
  });

  test('损坏的存储按默认值处理', () => {
    window.localStorage.setItem('roco.collectionGroups:A', '{bad json');
    expect(readCollectionGroupPrefs('A').mode).toBe('personal');
    expect(readCollectionGroupPrefs('A').lastGroupIds).toEqual({});
  });

  test('结单提示的已读水位按组保存，只前进不后退', () => {
    expect(readDemandCompletionSeenAt('A', 'g1')).toBeNull();
    saveDemandCompletionSeenAt('A', 'g1', 200);
    expect(readDemandCompletionSeenAt('A', 'g1')).toBe(200);
    saveDemandCompletionSeenAt('A', 'g1', 100);
    expect(readDemandCompletionSeenAt('A', 'g1')).toBe(200);
    saveDemandCompletionSeenAt('A', 'g2', 50);
    expect(readDemandCompletionSeenAt('A', 'g1')).toBe(200);
    expect(readDemandCompletionSeenAt('A', 'g2')).toBe(50);
    expect(readDemandCompletionSeenAt('B', 'g1')).toBeNull();
  });
});
