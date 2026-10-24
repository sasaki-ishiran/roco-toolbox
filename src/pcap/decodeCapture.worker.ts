import { convertPcapBytes } from '../pcap-decoder/tools/pcap-json-app/src/core';
import { isCollectorCaptureUrl, MAX_CAPTURE_BYTES } from './collectorUrl';
import { inspectCaptureBytes } from '../collector/inspectCapture';

// The decoder is shared with the existing import flow, not a second protocol model.
self.onmessage = async (event: MessageEvent<{ bytes?: Uint8Array; url?: string; fileName: string; mode?: 'inspect' }>) => {
  try {
    let bytes = event.data.bytes;
    if (event.data.url) {
      if (!isCollectorCaptureUrl(event.data.url)) throw new Error('无效的本机采集授权链接');
      const response = await fetch(event.data.url, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('无法读取本机原包，请返回工具箱重新导入');
      const length = Number(response.headers.get('Content-Length'));
      if (length > MAX_CAPTURE_BYTES) throw new Error('抓包超过 128MiB，请缩短采集时长后重新采集');
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!bytes || bytes.byteLength > MAX_CAPTURE_BYTES) throw new Error('抓包为空或超过 128MiB');
    const value = event.data.mode === 'inspect' ? await inspectCaptureBytes(bytes) : convertPcapBytes(bytes, event.data.fileName);
    self.postMessage({ ok: true, value });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : '无法解析抓包文件' });
  }
};
