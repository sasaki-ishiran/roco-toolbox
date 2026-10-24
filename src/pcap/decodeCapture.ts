import type { ConvertedPayload } from '../pcap-decoder/tools/pcap-json-app/src/core';
import { decodeInWorker } from './decodeInWorker';

/**
 * 把采集器的 PCAP 抓包解成 hatch-backup 格式的数据。
 *
 * 解析器不是本项目写的：它来自「数据采集器」的源码（GPL-3.0），完整拷贝放在
 * src/pcap-decoder/ 下（含 LICENSE），并按上游目录结构原样保留 —— 这样游戏协议变化、
 * 上游出了新版本时，可以整段替换而不必重新梳理改动。
 *
 * 因为这份解析器有 1 MB 出头（含图鉴数据），这里用动态 import 懒加载：
 * 只有真的拿到 PCAP 时才去加载它，不拖累首屏。
 */

export type DecodedCapture = {
  payload: ConvertedPayload;
  mainText: string;
  mainName: string;
  report: {
    linkType: number;
    boxes: number;
    accountCount: number;
    counts: Record<string, number>;
  };
};

export async function decodeCapture(bytes: Uint8Array, fileName: string): Promise<DecodedCapture> {
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('抓包超过 128MiB，请缩短采集时长后重新采集；原始文件仍保留');
  if (typeof Worker !== 'undefined') return decodeInWorker(bytes, fileName);
  const core = await import('../pcap-decoder/tools/pcap-json-app/src/core');
  return core.convertPcapBytes(bytes, fileName);
}
