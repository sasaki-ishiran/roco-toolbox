import { describe, expect, test, vi } from 'vitest';
import { decodeInWorker, decodeUrlInWorker } from './decodeInWorker';

function harness() {
  const worker = { onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn(), terminate: vi.fn() };
  return { worker, factory: () => worker as unknown as Worker };
}
describe('PCAP 后台解析', () => {
  test('本机授权 URL 直接交给 Worker，主线程不读取原包', async () => {
    const { worker, factory } = harness();
    const url = 'https://roco-share.invalid/collector/12345678-1234-1234-1234-123456789abc';
    const result = decodeUrlInWorker(url, 'capture-123.pcap', factory);
    expect(worker.postMessage).toHaveBeenCalledWith({ url, fileName: 'capture-123.pcap' }, []);
    worker.onmessage!({ data: { ok: true, value: { mainName: 'parsed.json' } } } as MessageEvent);
    await expect(result).resolves.toEqual({ mainName: 'parsed.json' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  test('外部链接和伪造授权不能交给 Worker 下载', async () => {
    const { factory, worker } = harness();
    for (const url of ['https://example.com/x.pcap', 'https://roco-share.invalid/collector/../../secret', 'https://roco-share.invalid/collector/12345678-1234-1234-1234-123456789abc?x=1']) {
      await expect(decodeUrlInWorker(url, 'x.pcap', factory)).rejects.toThrow('无效');
    }
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
  test('转移字节，成功后释放 Worker', async () => {
    const { worker, factory } = harness();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = decodeInWorker(bytes, 'x.pcap', factory);
    expect(worker.postMessage).toHaveBeenCalledWith({ bytes, fileName: 'x.pcap' }, [bytes.buffer]);
    worker.onmessage!({ data: { ok: true, value: { mainName: 'parsed.json' } } } as MessageEvent);
    await expect(result).resolves.toEqual({ mainName: 'parsed.json' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  test('解析失败和内存/加载失败都释放资源并允许重试', async () => {
    const first = harness();
    const result = decodeInWorker(new Uint8Array([1]), 'x.pcap', first.factory);
    first.worker.onmessage!({ data: { ok: false, error: '缺少握手，请重新登录采集' } } as MessageEvent);
    await expect(result).rejects.toThrow('缺少握手');
    expect(first.worker.terminate).toHaveBeenCalledOnce();
    const second = harness();
    const retry = decodeInWorker(new Uint8Array([1]), 'x.pcap', second.factory);
    second.worker.onerror!({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    await expect(retry).rejects.toThrow('原始文件');
    expect(second.worker.terminate).toHaveBeenCalledOnce();
  });
  test('无法转移字节时同样终止 Worker', async () => {
    const { worker, factory } = harness();
    worker.postMessage.mockImplementation(() => { throw new Error('clone failed'); });
    await expect(decodeInWorker(new Uint8Array([1]), 'x.pcap', factory)).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
