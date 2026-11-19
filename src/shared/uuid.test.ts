import { afterEach, describe, expect, test, vi } from 'vitest';
import { newUuid } from './uuid';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newUuid', () => {
  test('有原生 randomUUID 时直接用它', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-uuid', getRandomValues: vi.fn() });
    expect(newUuid()).toBe('native-uuid');
  });

  test('局域网 HTTP 没有 randomUUID 时退回 v4', () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 7) % 256;
        return bytes;
      },
    });
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
