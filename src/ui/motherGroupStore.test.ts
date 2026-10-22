import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearMotherGroupPrefs,
  readCurrentGroupId,
  readInviteCode,
  readMotherGroupPrefs,
  readPendingInviteCode,
  saveCurrentGroupId,
  saveInviteCode,
  savePendingInviteCode,
} from './motherGroupStore';

beforeEach(() => {
  window.localStorage.clear();
});

describe('motherGroupStore：按身份隔离的本机偏好', () => {
  test('当前组与邀请码按 accountId 隔离', () => {
    saveCurrentGroupId('A', 'g1');
    saveInviteCode('A', 'g1', 'ABCD2345');
    saveCurrentGroupId('B', 'g2');

    expect(readCurrentGroupId('A')).toBe('g1');
    expect(readInviteCode('A', 'g1')).toBe('ABCD2345');
    expect(readCurrentGroupId('B')).toBe('g2');
    expect(readInviteCode('B', 'g1')).toBeNull();
  });

  test('只保存当前组与邀请码明文，不写 token 或他人资源', () => {
    saveCurrentGroupId('A', 'g1');
    saveInviteCode('A', 'g1', 'ABCD2345');
    const raw = window.localStorage.getItem('roco.motherGroups:A') ?? '';
    expect(raw).toContain('g1');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('eggGameIds');
  });

  test('损坏的本地数据不会让页面崩掉', () => {
    window.localStorage.setItem('roco.motherGroups:A', '{not json');
    expect(readMotherGroupPrefs('A')).toEqual({ currentGroupId: null, inviteCodes: {} });
    window.localStorage.setItem('roco.motherGroups:A', JSON.stringify({ currentGroupId: 3, inviteCodes: 'x' }));
    expect(readMotherGroupPrefs('A')).toEqual({ currentGroupId: null, inviteCodes: {} });
  });

  test('待加入码是设备级草稿，退出登录后仍保留', () => {
    savePendingInviteCode(' abcd2345 ');
    expect(readPendingInviteCode()).toBe('ABCD2345');
    savePendingInviteCode('');
    expect(readPendingInviteCode()).toBe('');
  });

  test('清掉某个身份的偏好不影响另一个身份', () => {
    saveCurrentGroupId('A', 'g1');
    saveCurrentGroupId('B', 'g2');
    clearMotherGroupPrefs('A');
    expect(readCurrentGroupId('A')).toBeNull();
    expect(readCurrentGroupId('B')).toBe('g2');
  });
});
