import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  adoptBackupTargetMode,
  getTargetMode,
  resetTargetModeForTest,
  setTargetMode,
  useTargetMode,
} from './targetModeStore';

describe('目标模式 store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetTargetModeForTest();
  });

  test('默认是追满分', () => {
    expect(getTargetMode()).toBe('perfect');
  });

  test('切换后写进 localStorage 并标记「已显式选择」', () => {
    setTargetMode('medal');
    expect(getTargetMode()).toBe('medal');
    expect(window.localStorage.getItem('roco.targetMode')).toBe('medal');
    expect(window.localStorage.getItem('roco.targetModeChosen')).toBe('1');
  });

  test('本地优先：本机显式选过就不采用备份里的模式', () => {
    setTargetMode('medal');
    adoptBackupTargetMode('perfect');
    expect(getTargetMode()).toBe('medal');
    expect(window.localStorage.getItem('roco.targetMode')).toBe('medal');
  });

  test('本机从没选过时才采用备份里的模式', () => {
    adoptBackupTargetMode('medal');
    expect(getTargetMode()).toBe('medal');
    expect(window.localStorage.getItem('roco.targetMode')).toBe('medal');
  });

  test('备份没带模式时不做改动', () => {
    adoptBackupTargetMode(undefined);
    expect(getTargetMode()).toBe('perfect');
  });

  test('useTargetMode 跟随 store 变化', () => {
    const { result } = renderHook(() => useTargetMode());
    expect(result.current).toBe('perfect');
    act(() => setTargetMode('medal'));
    expect(result.current).toBe('medal');
  });
});