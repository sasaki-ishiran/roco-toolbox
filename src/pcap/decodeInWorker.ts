import type { DecodedCapture } from './decodeCapture';
import { isCollectorCaptureUrl } from './collectorUrl';
import type { CaptureAnalysis } from '../collector/captureProgress';
const defaultWorker = () => new Worker(new URL('./decodeCapture.worker.ts', import.meta.url), { type: 'module' });
type Input = ({ bytes: Uint8Array; fileName: string } | { url: string; fileName: string }) & { mode?: 'inspect' };
function run<T>(input: Input, createWorker: () => Worker, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const timer = setTimeout(() => finish(new Error('解析用时过长，原始文件仍保留，请稍后重试')), 120_000);
    let finished = false;
    const finish = (error: Error | null, value?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new DOMException('采集进度检查已暂停', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.onmessage = (event: MessageEvent<{ ok: boolean; value?: T; error?: string }>) => {
      if (event.data?.ok && event.data.value) finish(null, event.data.value);
      else finish(new Error(event.data?.error || '抓包解析失败，原始文件仍保留'));
    };
    worker.onerror = (event) => { event.preventDefault(); finish(new Error('无法完成后台解析，原始文件仍保留；请重试或导出后在电脑导入')); };
    worker.onmessageerror = () => finish(new Error('无法读取后台解析结果，原始文件仍保留'));
    try {
      // Transfer one owned buffer; subarrays must not expose unrelated bytes.
      if ('bytes' in input) {
        const { bytes, fileName } = input;
        const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
          ? bytes : bytes.slice();
        worker.postMessage({ bytes: owned, fileName }, [owned.buffer]);
      } else worker.postMessage(input, []);
    } catch (error) { finish(error instanceof Error ? error : new Error('无法交付抓包字节')); }
  });
}
export function decodeInWorker(bytes: Uint8Array, fileName: string, createWorker = defaultWorker): Promise<DecodedCapture> {
  return run<DecodedCapture>({ bytes, fileName }, createWorker);
}
export async function decodeUrlInWorker(url: string, fileName: string, createWorker = defaultWorker): Promise<DecodedCapture> {
  if (!isCollectorCaptureUrl(url)) throw new Error('无效的本机采集授权链接');
  return run<DecodedCapture>({ url, fileName }, createWorker);
}
export async function inspectUrlInWorker(url: string, fileName: string, signal: AbortSignal, createWorker = defaultWorker): Promise<CaptureAnalysis> {
  if (!isCollectorCaptureUrl(url)) throw new Error('无效的本机采集授权链接');
  return run<CaptureAnalysis>({ url, fileName, mode: 'inspect' }, createWorker, signal);
}
