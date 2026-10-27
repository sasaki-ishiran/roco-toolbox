import { beforeEach, describe, expect, test } from 'vitest';
import {
  readCollectionGroupPrefs,
  readLastGroupId,
  saveLastGroupId,
  savePageMode,
  savePersonalType,
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

  test('页面模式与个人求蛋类型按身份隔离；旧 stud 类型归到 mother', () => {
    savePageMode('A', 'group');
    savePersonalType('A', 'stud');
    expect(readCollectionGroupPrefs('A').mode).toBe('group');
    expect(readCollectionGroupPrefs('A').personalType).toBe('mother');
    expect(readCollectionGroupPrefs('B').mode).toBe('personal');
  });

  test('未登录时用设备级草稿，不串到登录后的身份', () => {
    savePageMode(null, 'personal');
    savePersonalType(null, 'stud');
    expect(readCollectionGroupPrefs(null).personalType).toBe('mother');
    expect(readCollectionGroupPrefs('A').personalType).toBe('mother');
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
    expect(prefs.personalType).toBe('mother');
    expect(prefs.lastGroupIds).toEqual({ mother: 'g-mother' });
  });

  test('损坏的存储按默认值处理', () => {
    window.localStorage.setItem('roco.collectionGroups:A', '{bad json');
    expect(readCollectionGroupPrefs('A').mode).toBe('personal');
    expect(readCollectionGroupPrefs('A').lastGroupIds).toEqual({});
  });
});
