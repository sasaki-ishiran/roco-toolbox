import type { DecodedCapture } from './decodeCapture';
import { isCollectorCaptureUrl } from './collectorUrl';
const defaultWorker = () => new Worker(new URL('./decodeCapture.worker.ts', import.meta.url), { type: 'module' });
type Input = { bytes: Uint8Array; fileName: string } | { url: string; fileName: string };
function run(input: Input, createWorker: () => Worker): Promise<DecodedCapture> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const timer = setTimeout(() => finish(new Error('解析用时过长，原始文件仍保留，请稍后重试')), 120_000);
    let finished = false;
    const finish = (error: Error | null, value?: DecodedCapture) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    worker.onmessage = (event: MessageEvent<{ ok: boolean; value?: DecodedCapture; error?: string }>) => {
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
  return run({ bytes, fileName }, createWorker);
}
export async function decodeUrlInWorker(url: string, fileName: string, createWorker = defaultWorker): Promise<DecodedCapture> {
  if (!isCollectorCaptureUrl(url)) throw new Error('无效的本机采集授权链接');
  return run({ url, fileName }, createWorker);
}
