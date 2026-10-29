import { beforeEach, describe, expect, test } from 'vitest';
import { readLastTab, saveLastTab } from './lastTab';

beforeEach(() => {
  window.localStorage.clear();
});

describe('lastTab', () => {
  test('默认落在「导入数据」', () => {
    expect(readLastTab()).toBe('import');
  });

  test('记住并读回上次停留的页签', () => {
    saveLastTab('swap');
    expect(readLastTab()).toBe('swap');
    saveLastTab('dashboard');
    expect(readLastTab()).toBe('dashboard');
  });

  test('家园页签也能记住并读回', () => {
    saveLastTab('home');
    expect(readLastTab()).toBe('home');
  });

  test('本地存了非法值时退回「导入数据」', () => {
    window.localStorage.setItem('roco.lastTab', 'nope');
    expect(readLastTab()).toBe('import');
  });
});
