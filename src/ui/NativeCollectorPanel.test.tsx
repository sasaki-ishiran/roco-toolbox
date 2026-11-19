import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { NativeCollectorPanel } from './NativeCollectorPanel';
import { type CollectorState } from '../collector/nativeCollector';
import { resetLiveModeForTest } from '../collector/liveModeStore';
import { resetRareAlertForTest } from '../collector/rareAlertStore';
const file = { id: 'capture-123.pcap', name: 'capture-123.pcap', size: 1234, createdAt: 123, valid: true };
afterEach(() => { delete window.RocoCapture; resetLiveModeForTest(); resetRareAlertForTest(); });
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
  test('持续获取模式可切换，并改成不高亮自动停止的说明', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('native-live-mode')).toBeTruthy());
    const row = screen.getByTestId('native-live-mode');
    fireEvent.click(within(row).getByRole('button', { name: '已关闭' }));
    expect(within(row).getByRole('button', { name: '已开启' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/想结束时点「停止并保存」/)).toBeTruthy();
  });
  test('稀有精灵提醒开关可切换，默认开启', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('native-rare-alert')).toBeTruthy());
    const row = screen.getByTestId('native-rare-alert');
    expect(within(row).getByRole('button', { name: '已开启' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: '已开启' }));
    expect(within(row).getByRole('button', { name: '已关闭' })).toBeTruthy();
  });
  test('网页环境显示本机采集说明，不伪造开始采集按钮', async () => {
    render(<NativeCollectorPanel />);
    await waitFor(() => expect(screen.getByTestId('native-collector-fallback')).toBeTruthy());
    expect(screen.getByText(/只在安卓版小布助手安装包内提供/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开始采集' })).toBeNull();
  });
  test('有采集桥但状态未读完时先显示稳定骨架，不整块空白', () => {
    window.RocoCapture = { getState: () => new Promise<string>(() => {}) };
    render(<NativeCollectorPanel />);
    expect(screen.getByTestId('native-collector-loading')).toBeTruthy();
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
  test('采集中不把正在写的当前文件当成残缺文件提示', async () => {
    setup({ phase: 'capturing', fileId: file.id, files: [{ ...file, valid: false }] });
    await waitFor(() => expect(screen.getByText('还没有本机采集文件')).toBeTruthy());
    expect(screen.queryByText(/未完整保存/)).toBeNull();
    expect(screen.queryByRole('button', { name: '解析并导入' })).toBeNull();
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
  test('原包支持全选并批量删除', async () => {
    const files = [file, { ...file, id: 'capture-456.pcap', name: 'capture-456.pcap', createdAt: 456 }];
    const bridge = setup({ files });
    await waitFor(() => expect(screen.getByTestId('capture-file-select-all')).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByTestId('capture-file-select-all')); });
    expect(screen.getByTestId('capture-file-delete-selected')).toHaveTextContent('删除已选 2 个');
    await act(async () => { fireEvent.click(screen.getByTestId('capture-file-delete-selected')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })); });
    expect(bridge.deleteCapture).toHaveBeenCalledWith(file.id);
    expect(bridge.deleteCapture).toHaveBeenCalledWith('capture-456.pcap');
  });
  test('老 Android 说明版本限制，桥错误可以重试', async () => {
    setup({ supported: false });
    await waitFor(() => expect(screen.getByText(/Android 8/)).toBeTruthy());
    expect(screen.getByText(/Android 8/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开始采集' })).toBeNull();
  });
  test('新版壳等待真实解析时显示检查进度，旧壳明确提示升级', async () => {
    setup({ phase: 'capturing', progressVersion: 1, fileId: file.id, savedBytes: 0 });
    await waitFor(() => expect(screen.getByText('等待游戏数据')).toBeTruthy());
    expect(screen.queryByText('已识别内容稳定，可以停止保存')).toBeNull();
  });
  test('旧壳采集中仍可停止保存，说明进度需要更新 APK', async () => {
    setup({ phase: 'capturing' });
    await waitFor(() => expect(screen.getByText(/更新安卓安装包可查看实时数据进度/)).toBeTruthy());
    expect(screen.getByRole('button', { name: '停止并保存' })).not.toBeDisabled();
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
