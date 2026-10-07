import { afterEach, describe, expect, test } from 'vitest';
import { SHELL_CAPTURE_URL, fetchShellCapture, takeNativeShare } from './nativeShare';

afterEach(() => {
  window.__rocoPendingShare = undefined;
});

describe('原生壳分享进来的内容', () => {
  test('壳还没注入时返回 null', () => {
    expect(takeNativeShare()).toBeNull();
  });

  test('文本分享（JSON）能取到，取走后清空', () => {
    window.__rocoPendingShare = { name: 'hatch-backup.json', text: '{"accounts":[]}' };

    expect(takeNativeShare()).toEqual({
      kind: 'text',
      name: 'hatch-backup.json',
      text: '{"accounts":[]}',
    });
    expect(takeNativeShare()).toBeNull();
  });

  test('壳没给出文件名时也能取到内容', () => {
    window.__rocoPendingShare = { text: '{"accounts":[]}' };

    expect(takeNativeShare()).toEqual({ kind: 'text', name: '', text: '{"accounts":[]}' });
  });

  test('抓包分享：给出壳上的取用地址，默认走约定地址', () => {
    window.__rocoPendingShare = { kind: 'capture', name: 'capture-1.pcap' };
    expect(takeNativeShare()).toEqual({
      kind: 'capture',
      name: 'capture-1.pcap',
      url: SHELL_CAPTURE_URL,
    });
    expect(takeNativeShare()).toBeNull();
  });

  test('壳给了自定义取用地址时以它为准', () => {
    window.__rocoPendingShare = { kind: 'capture', name: 'x.pcap', url: 'https://example.invalid/a' };
    expect(takeNativeShare()).toEqual({
      kind: 'capture',
      name: 'x.pcap',
      url: 'https://example.invalid/a',
    });
  });

  test('注入的内容既不是抓包也不是文本时当作没有', () => {
    window.__rocoPendingShare = { name: 'bad.json' };
    expect(takeNativeShare()).toBeNull();
  });
});

describe('从壳里取抓包字节', () => {
  test('拿不到时给出可读的错误', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('network down'));
    try {
      await expect(fetchShellCapture(SHELL_CAPTURE_URL)).rejects.toThrow(/重新分享/);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('壳回了非 200 时也不静默当作空数据', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response);
    try {
      await expect(fetchShellCapture(SHELL_CAPTURE_URL)).rejects.toThrow(/HTTP 500/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
