import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CollectorState } from '../collector/nativeCollector';
import { NativeCollectorPanel } from './NativeCollectorPanel';

vi.mock('./CaptureProgressView', () => ({
  CaptureProgressView: ({ onReady }: { onReady?: () => void }) => (
    <button type="button" onClick={() => onReady?.()}>模拟进度走满</button>
  ),
}));

const file = { id: 'capture-123.pcap', name: 'capture-123.pcap', size: 1234, createdAt: 123, valid: true };

afterEach(() => {
  delete window.RocoCapture;
});

function setup() {
  let state: CollectorState = {
    version: 1, supported: true, phase: 'capturing', message: '采集中', packets: 2, bytes: 1234,
    files: [file], progressVersion: 1, fileId: file.id, savedBytes: 1234,
  };
  const bridge = {
    getState: () => JSON.stringify(state),
    stopCapture: vi.fn(() => { state = { ...state, phase: 'idle', message: '已停止并保存' }; return ''; }),
    importCapture: vi.fn(() => ''),
    shareCapture: vi.fn(() => ''),
    startCapture: vi.fn(() => ''),
    openGame: vi.fn(() => ''),
    deleteCapture: vi.fn(() => ''),
    uploadCapture: vi.fn(() => ''),
  };
  window.RocoCapture = bridge;
  render(<NativeCollectorPanel />);
  return bridge;
}

describe('采集完成自动停止', () => {
  test('进度走满自动停止保存，并弹出采集完成提示', async () => {
    const bridge = setup();
    const ready = await screen.findByRole('button', { name: '模拟进度走满' });
    fireEvent.click(ready);

    await waitFor(() => expect(bridge.stopCapture).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole('dialog', { name: '采集完成' });
    expect(dialog).toHaveTextContent('已自动停止并保存本次采集');

    fireEvent.click(within(dialog).getByRole('button', { name: '解析并导入' }));
    await waitFor(() => expect(bridge.importCapture).toHaveBeenCalledWith(file.id));
  });

  test('同一个采集会话只自动停止一次', async () => {
    const bridge = setup();
    const ready = await screen.findByRole('button', { name: '模拟进度走满' });
    fireEvent.click(ready);
    await waitFor(() => expect(bridge.stopCapture).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟进度走满' }));
    await waitFor(() => expect(bridge.stopCapture).toHaveBeenCalledTimes(1));
  });
});
