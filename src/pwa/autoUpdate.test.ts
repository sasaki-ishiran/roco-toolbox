import { describe, expect, test, vi } from 'vitest';
import { reloadWhenUpdated } from './autoUpdate';

describe('reloadWhenUpdated', () => {
  test('首次访问（还没有旧版本在跑）不订阅、不刷新', () => {
    const subscribe = vi.fn();
    const reload = vi.fn();

    const watching = reloadWhenUpdated({ controlled: false, subscribe, reload });

    expect(watching).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  test('已有旧版本在跑：新版本接管时自动刷新一次', () => {
    let onChange: (() => void) | undefined;
    const reload = vi.fn();

    const watching = reloadWhenUpdated({
      controlled: true,
      subscribe: (listener) => {
        onChange = listener;
      },
      reload,
    });

    expect(watching).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    onChange?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('controllerchange 连续触发也只刷新一次（不进刷新循环）', () => {
    let onChange: (() => void) | undefined;
    const reload = vi.fn();

    reloadWhenUpdated({
      controlled: true,
      subscribe: (listener) => {
        onChange = listener;
      },
      reload,
    });

    onChange?.();
    onChange?.();
    onChange?.();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
