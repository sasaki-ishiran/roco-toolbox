import { describe, expect, test } from 'vitest';
import { serverEnvOf } from './serverEnv';

describe('环境角标判定', () => {
  test('正式站', () => {
    expect(serverEnvOf('roco-toolbox.pages.dev')).toBe('prod');
  });

  test('测试站与旧别名都算内测', () => {
    expect(serverEnvOf('test.roco-toolbox.pages.dev')).toBe('test');
    expect(serverEnvOf('internal.roco-toolbox.pages.dev')).toBe('test');
  });

  test('预览域（hash 子域）算内测', () => {
    expect(serverEnvOf('66667282.roco-toolbox.pages.dev')).toBe('test');
  });

  test('本机与其它地址算自定义', () => {
    expect(serverEnvOf('localhost')).toBe('custom');
    expect(serverEnvOf('example.com')).toBe('custom');
    expect(serverEnvOf('')).toBe('custom');
  });
});
