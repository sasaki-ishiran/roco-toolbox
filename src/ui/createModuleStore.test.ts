import { describe, expect, test } from 'vitest';

/**
 * 在「读 localStorage 属性本身就抛错」的环境（被禁第三方存储的 WebView / 受限 iframe），
 * 模块求值阶段不能炸——否则所有依赖 store 的模块都加载不了，应用起不来。
 */
describe('createModuleStore 存储获取', () => {
  test('window.localStorage 访问抛错时，store 仍能创建与读写（只在内存生效）', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage blocked');
      },
    });

    try {
      const { createModuleStore } = await import('./createModuleStore');
      const store = createModuleStore<number>(0, { persistKey: 'roco.testKey' });

      expect(store.get()).toBe(0);
      store.set(1);
      expect(store.get()).toBe(1);
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });
});
