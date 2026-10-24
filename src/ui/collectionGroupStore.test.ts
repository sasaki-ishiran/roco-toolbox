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
  test('母本组与种公组分别记住当前组，不互相覆盖', () => {
    saveLastGroupId('A', 'mother', 'g-mother');
    saveLastGroupId('A', 'stud', 'g-stud');
    expect(readLastGroupId('A', 'mother')).toBe('g-mother');
    expect(readLastGroupId('A', 'stud')).toBe('g-stud');
    saveLastGroupId('A', 'mother', null);
    expect(readLastGroupId('A', 'mother')).toBeNull();
    expect(readLastGroupId('A', 'stud')).toBe('g-stud');
  });

  test('页面模式与个人求蛋类型按身份隔离', () => {
    savePageMode('A', 'group');
    savePersonalType('A', 'stud');
    expect(readCollectionGroupPrefs('A').mode).toBe('group');
    expect(readCollectionGroupPrefs('A').personalType).toBe('stud');
    expect(readCollectionGroupPrefs('B').mode).toBe('personal');
  });

  test('未登录时用设备级草稿，不串到登录后的身份', () => {
    savePageMode(null, 'personal');
    savePersonalType(null, 'stud');
    expect(readCollectionGroupPrefs(null).personalType).toBe('stud');
    expect(readCollectionGroupPrefs('A').personalType).toBe('mother');
  });

  test('损坏的存储按默认值处理', () => {
    window.localStorage.setItem('roco.collectionGroups:A', '{bad json');
    expect(readCollectionGroupPrefs('A').mode).toBe('personal');
    expect(readCollectionGroupPrefs('A').lastGroupIds).toEqual({});
  });
});
