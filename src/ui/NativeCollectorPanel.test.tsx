import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { NativeCollectorPanel } from './NativeCollectorPanel';
import { CAPTURE_UPLOAD_MAX_BYTES, type CollectorState } from '../collector/nativeCollector';
const file = { id: 'capture-123.pcap', name: 'capture-123.pcap', size: 1234, createdAt: 123, valid: true };
afterEach(() => { delete window.RocoCapture; });
function setup(overrides: Partial<CollectorState> = {},
  options: { onUpload?: (patch: (next: Partial<CollectorState>) => void) => void; withoutUpload?: boolean } = {}) {
  let state: CollectorState = { version: 1, supported: true, phase: 'idle', message: '准备采集', packets: 0, bytes: 0, files: [file], ...overrides };
  const patch = (next: Partial<CollectorState>) => { state = { ...state, ...next }; };
  const bridge = {
    getState: () => JSON.stringify(state),
    startCapture: vi.fn(() => { state = { ...state, phase: 'capturing' }; return ''; }),
    stopCapture: vi.fn(() => { state = { ...state, phase: 'idle' }; return ''; }),
    openGame: vi.fn(() => ''), importCapture: vi.fn(() => ''), shareCapture: vi.fn(() => ''),
    deleteCapture: vi.fn(() => { state = { ...state, files: [] }; return ''; }),
    ...(options.withoutUpload ? {} : { uploadCapture: vi.fn(() => { options.onUpload?.(patch); return ''; }) }),
  };
  window.RocoCapture = bridge;
  render(<NativeCollectorPanel />);
  return bridge;
}
describe('内置采集入口', () => {
  test('网页环境显示本机采集说明，不伪造开始采集按钮', async () => {
    render(<NativeCollectorPanel />);
    await waitFor(() => expect(screen.getByTestId('native-collector-fallback')).toBeTruthy());
    expect(screen.getByText(/只在安卓工具箱安装包内提供/)).toBeTruthy();
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
  test('上传蛋神助手显示云端 UID，成功后按钮置为已上传', async () => {
    const bridge = setup({}, { onUpload: (patch) => patch({ files: [{ ...file, upload: { state: 'persisted', message: '角色数据已完整保存到云端', progress: 100, gameId: '293143' } }] }) });
    await waitFor(() => expect(screen.getByRole('button', { name: '上传蛋神助手' })).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '上传蛋神助手' })); });
    expect(bridge.uploadCapture).toHaveBeenCalledWith(file.id);
    await waitFor(() => expect(screen.getByText(/游戏 UID 293143/)).toBeTruthy());
    expect(screen.getByRole('button', { name: '已上传' })).toBeDisabled();
  });
  test('去重入库按成功展示，不报失败，并保留上传入口', async () => {
    setup({ files: [{ ...file, upload: { state: 'persisted', message: '角色数据已完整保存到云端', progress: 100, gameId: '293143', deduplicated: true } }] });
    await waitFor(() => expect(screen.getByText(/云端已有相同数据/)).toBeTruthy());
    expect(screen.getByText(/游戏 UID 293143/)).toBeTruthy();
    expect(screen.queryByText(/失败/)).toBeNull();
    expect(screen.getByRole('button', { name: '已上传' })).toBeDisabled();
  });
  test('超过 5 MiB 的文件禁止上传并说明原因', async () => {
    setup({ files: [{ ...file, size: CAPTURE_UPLOAD_MAX_BYTES + 1 }] });
    await waitFor(() => expect(screen.getByText(/超过蛋神助手云端 5 MiB 上限/)).toBeTruthy());
    expect(screen.getByRole('button', { name: '上传蛋神助手' })).toBeDisabled();
  });
  test('上传进行中显示进度并锁住删除', async () => {
    setup({ uploadBusy: true, files: [{ ...file, upload: { state: 'uploading', message: '正在上传原始抓包', progress: 42 } }] });
    await waitFor(() => expect(screen.getByText('正在上传 42%')).toBeTruthy());
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
  });
  test('旧壳没有上传动作时隐藏按钮并提示更新安装包', async () => {
    setup({}, { withoutUpload: true });
    await waitFor(() => expect(screen.getByRole('button', { name: '解析并导入' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: '上传蛋神助手' })).toBeNull();
    expect(screen.getByText(/更新安卓安装包后可直接上传蛋神助手/)).toBeTruthy();
  });
});
