import { useEffect, useState } from 'react';

export interface ModuleStore<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
  /** 页面 hook：取当前值并订阅变化（2026-10-04 提取，消除 4 处重复样板）。 */
  use: () => T;
}

export interface ModuleStoreOptions<T> {
  /** 持久化键；给了才会写 localStorage（默认 JSON 序列化整个 state） */
  persistKey?: string;
  /** 存储实现，默认 window.localStorage；测试可注入 */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** 从旧版本数据迁移：读出后补默认字段（老数据缺新字段时用） */
  migrate?: (loaded: T) => T;
  /** 自定义序列化；对含 Set 的 state 必须显式提供（JSON 会把 Set 序列化成 {}） */
  serialize?: (state: T) => string;
  deserialize?: (raw: string) => T;
}

/**
 * 模块级 store 工厂（2026-10-04 重构，统一 accountFilterStore / targetModeStore /
 * motherPlanStore / coverageFilterStore 四处的 listeners + commit + useXxx 样板）。
 *
 * 用法：每个 store 用自己的业务逻辑包一层 `set`（localStorage 持久化、派生计算），
 * 订阅/通知/页面 hook 由工厂统一提供。
 *
 * 2026-10-05（筛选持久化专项，用户拍板）：新增可选 `options.persistKey`——
 * 设置了就会在初始化时读 localStorage、每次 `set` 时写回，重启后筛选设置不丢。
 * 注意：含 Set 的 state 要传 `serialize`/`deserialize`；老数据缺新字段用 `migrate` 补。
 *
 * 注意：模块级状态在 vitest 多文件间共享，各 store 仍需提供 `resetXxxForTest()`。
 */
export function createModuleStore<T>(initial: T, options?: ModuleStoreOptions<T>): ModuleStore<T> {
  /**
   * 取默认存储：**读 `window.localStorage` 属性本身**在部分环境（被禁第三方存储的
   * WebView / 受限 iframe）会抛 SecurityError，必须包住——否则模块求值阶段就崩，
   * 所有依赖 store 的模块都加载不了。
   */
  const resolveStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  const storage = options?.storage === undefined ? resolveStorage() : options.storage;
  const key = options?.persistKey;
  const serialize = options?.serialize ?? ((value: T): string => JSON.stringify(value));
  const deserialize = options?.deserialize ?? ((raw: string): T => JSON.parse(raw) as T);
  const migrate = options?.migrate;

  let state = initial;
  if (key && storage) {
    try {
      const raw = storage.getItem(key);
      if (raw != null) {
        const loaded = deserialize(raw);
        state = migrate ? migrate(loaded) : loaded;
      }
    } catch {
      // 坏数据 / 隐私模式：保持默认值
    }
  }

  const listeners = new Set<() => void>();

  const get = (): T => state;

  const set = (next: T): void => {
    state = next;
    if (key && storage) {
      try {
        storage.setItem(key, serialize(next));
      } catch {
        // 隐私模式写不了：本次只在内存生效
      }
    }
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const use = (): T => {
    const [value, setValue] = useState(state);

    useEffect(() => {
      const listener = () => setValue(state);
      listeners.add(listener);
      setValue(state);
      return () => {
        listeners.delete(listener);
      };
    }, []);

    return value;
  };

  return { get, set, subscribe, use };
}
