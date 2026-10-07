import { decodeCapture } from './decodeCapture';

/**
 * 把用户选中的文件（或采集器分享过来的文件）转成待导入的数据：
 * - 抓包文件（.pcap）：交给采集器那套解析器解成 hatch-backup 数据
 * - 其他：按 JSON 读（就是原来手动导出的流程）
 */

export type CaptureFormat = 'pcap' | 'pcapng';

const PCAP_MAGICS = [
  0xa1b2c3d4, // 经典 PCAP，大端
  0xd4c3b2a1, // 经典 PCAP，小端（采集器默认输出的就是这种）
  0xa1b23c4d, // 经典 PCAP，纳秒精度，大端
  0x4d3cb2a1, // 经典 PCAP，纳秒精度，小端
];

/** 按文件头魔数认格式，比看扩展名可靠。不是抓包文件就返回 null。 */
export function detectCaptureFormat(bytes: Uint8Array): CaptureFormat | null {
  if (bytes.length < 4) return null;
  // 用乘法而不是左移：左移会把最高位变成负数，比较会失败
  const magic = bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3];
  if (magic === 0x0a0d0d0a) return 'pcapng';
  return PCAP_MAGICS.includes(magic) ? 'pcap' : null;
}

export async function readCaptureFile(file: File): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectCaptureFormat(bytes);
  if (format === 'pcap') {
    const decoded = await decodeCapture(bytes, file.name);
    return decoded.payload;
  }
  if (format === 'pcapng') {
    // 采集器默认导出的就是 .pcap；.pcapng 要先转格式，解析器暂时吃不了
    throw new Error('这是 PCAPNG 格式的抓包，暂时只支持 .pcap：请在采集器里选择 .pcap 文件');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    // JSON.parse 的 SyntaxError 是英文原文，直接透出用户看不懂；导入页只显示 message
    throw new Error('文件不是有效的 JSON 备份：请确认选的是抓包文件（.pcap）或工具箱导出的 JSON');
  }
}
