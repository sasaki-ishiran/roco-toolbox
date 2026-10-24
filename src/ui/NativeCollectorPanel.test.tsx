import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { NativeCollectorPanel } from './NativeCollectorPanel';
import type { CollectorState } from '../collector/nativeCollector';
const file = { id: 'capture-123.pcap', name: 'capture-123.pcap', size: 1234, createdAt: 123, valid: true };
afterEach(() => { delete window.RocoCapture; });
function setup(overrides: Partial<CollectorState> = {}) {
  let state: CollectorState = { version: 1, supported: true, phase: 'idle', message: '准备采集', packets: 0, bytes: 0, files: [file], ...overrides };
  const bridge = {
    getState: () => JSON.stringify(state),
    startCapture: vi.fn(() => { state = { ...state, phase: 'capturing' }; return ''; }),
    stopCapture: vi.fn(() => { state = { ...state, phase: 'idle' }; return ''; }),
    openGame: vi.fn(() => ''), importCapture: vi.fn(() => ''), shareCapture: vi.fn(() => ''),
    deleteCapture: vi.fn(() => { state = { ...state, files: [] }; return ''; }),
  };
  window.RocoCapture = bridge;
  render(<NativeCollectorPanel />);
  return bridge;
}
describe('内置采集入口', () => {
  test('网页及旧壳不伪造开始采集按钮', () => {
    render(<NativeCollectorPanel />);
    expect(screen.queryByTestId('native-collector')).toBeNull();
  });
  test('开始、打开游戏、停止分别调用原生；采集中禁止导入和删除', async () => {
    const bridge = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: '开始采集' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '开始采集' }));
    expect(bridge.startCapture).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '解析并导入' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '打开游戏' }));
    expect(bridge.openGame).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '停止并保存' }));
    expect(bridge.stopCapture).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('button', { name: '解析并导入' })).not.toBeDisabled());
  });
  test('残缺文件可导出但不允许导入', async () => {
    const bridge = setup({ files: [{ ...file, valid: false }] });
    await waitFor(() => expect(screen.getByRole('button', { name: '解析并导入' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '解析并导入' })).toBeDisabled();
    expect(screen.getByText(/未完整保存/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出原包' })); });
    expect(bridge.shareCapture).toHaveBeenCalledWith(file.id);
  });
  test('删除取消保留文件，确认才调用删除', async () => {
    const bridge = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '保留文件' }));
    expect(bridge.deleteCapture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(bridge.deleteCapture).toHaveBeenCalledWith(file.id);
  });
  test('老 Android 说明版本限制，桥错误可以重试', async () => {
    setup({ supported: false });
    await waitFor(() => expect(screen.getByText(/Android 8/)).toBeTruthy());
    expect(screen.getByText(/Android 8/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开始采集' })).toBeNull();
  });
  test('原生交付导入事件前禁止重复导入和删除原包', async () => {
    const bridge = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: '解析并导入' })).toBeTruthy());
    const button = screen.getByRole('button', { name: '解析并导入' });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    expect(bridge.importCapture).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
  });
});
