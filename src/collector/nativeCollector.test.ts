import { afterEach, describe, expect, test, vi } from 'vitest';
import { collectorAction, readCollectorState, readCaptureSnapshot } from './nativeCollector';

afterEach(() => { delete window.RocoCapture; });
const state = { version: 1, supported: true, phase: 'idle', message: '', packets: 0, bytes: 0, files: [] };
describe('内置采集桥', () => {
  test('网页和旧 APK 不显示可用采集器', async () => {
    await expect(readCollectorState()).resolves.toBeNull();
    await expect(collectorAction('startCapture')).rejects.toThrow('更新');
  });
  test('读取真实能力与文件元数据，拒绝未知版本', async () => {
    window.RocoCapture = { getState: () => JSON.stringify(state) };
    await expect(readCollectorState()).resolves.toEqual(state);
    window.RocoCapture.getState = () => JSON.stringify({ ...state, version: 2 });
    await expect(readCollectorState()).rejects.toThrow('版本');
  });
  test('损坏的状态必须报错，不能伪装空清单', async () => {
    window.RocoCapture = { getState: () => '{' };
    await expect(readCollectorState()).rejects.toThrow();
    window.RocoCapture.getState = () => JSON.stringify({ ...state, files: [{ id: '../secret' }] });
    await expect(readCollectorState()).rejects.toThrow('状态');
  });
  test('动作明确调用原生入口并传递文件 ID；错误可见', async () => {
    const importCapture = vi.fn(() => '');
    window.RocoCapture = { getState: () => JSON.stringify(state), importCapture };
    await collectorAction('importCapture', 'capture-123.pcap');
    expect(importCapture).toHaveBeenCalledWith('capture-123.pcap');
    window.RocoCapture.importCapture = () => '该文件未完整保存';
    await expect(collectorAction('importCapture', 'capture-123.pcap')).rejects.toThrow('未完整保存');
  });
  test('进度快照只接受受限本机地址和有效长度，兼容旧壳', async () => {
    window.RocoCapture = { getState: () => JSON.stringify(state) };
    await expect(readCaptureSnapshot()).resolves.toBeNull();
    const snapshot = { id: 'capture-123.pcap', size: 100, url: 'https://roco-share.invalid/collector/12345678-1234-1234-1234-123456789abc' };
    window.RocoCapture.inspectCapture = () => JSON.stringify(snapshot);
    await expect(readCaptureSnapshot()).resolves.toEqual(snapshot);
    for (const bad of [{ ...snapshot, url: 'https://example.com/x' }, { ...snapshot, size: 24 }, { ...snapshot, id: '../x' }]) {
      window.RocoCapture.inspectCapture = () => JSON.stringify(bad);
      await expect(readCaptureSnapshot()).rejects.toThrow('快照');
    }
  });
});
