import { convertPcapBytes } from '../pcap-decoder/tools/pcap-json-app/src/core';
import { isCollectorCaptureUrl, MAX_CAPTURE_BYTES } from './collectorUrl';
import { inspectCaptureBytes } from '../collector/inspectCapture';

// The decoder is shared with the existing import flow, not a second protocol model.
// Worker 长驻复用（2026-11-08）：同一 Worker 会连续处理多轮请求，必须带 id 回包，
// 主线程才分得清哪一轮的结果；模块级解密缓存也依赖 Worker 不被销毁。
self.onmessage = async (event: MessageEvent<{ id?: number; bytes?: Uint8Array; url?: string; fileName: string; mode?: 'inspect'; windowBytes?: number; resume?: string }>) => {
  const id = event.data.id;
  try {
    let bytes = event.data.bytes;
    if (event.data.url) {
      if (!isCollectorCaptureUrl(event.data.url)) throw new Error('无效的本机采集授权链接');
      const response = await fetch(event.data.url, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('无法读取本机原包，请返回小布助手重新导入');
      const length = Number(response.headers.get('Content-Length'));
      if (length > MAX_CAPTURE_BYTES) throw new Error('抓包超过 128MiB，请缩短采集时长后重新采集');
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!bytes || bytes.byteLength > MAX_CAPTURE_BYTES) throw new Error('抓包为空或超过 128MiB');
    const value = event.data.mode === 'inspect'
      ? await inspectCaptureBytes(bytes, {
        windowBytes: event.data.windowBytes,
        sessionKey: event.data.fileName,
        resume: event.data.resume,
      })
      : convertPcapBytes(bytes, event.data.fileName);
    self.postMessage({ id, ok: true, value });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : '无法解析抓包文件' });
  }
};
