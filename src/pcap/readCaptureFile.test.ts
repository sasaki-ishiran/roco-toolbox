import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { detectCaptureFormat, readCaptureFile } from './readCaptureFile';

const fixtureBytes = (name: string): Uint8Array<ArrayBuffer> => {
  const source = readFileSync(`src/pcap/__fixtures__/${name}`);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
};

describe('识别采集器分享或用户选择的文件', () => {
  test('采集器输出的 PCAP 头能认出来', () => {
    expect(detectCaptureFormat(fixtureBytes('synthetic-capture.pcap'))).toBe('pcap');
  });

  test('JSON 不会被误判成抓包', () => {
    expect(detectCaptureFormat(new TextEncoder().encode('{"meta":{"type":"hatch-backup"}}'))).toBeNull();
  });

  test('PCAPNG 头能认出来（用来给出可读提示，而不是丢一个 JSON 报错）', () => {
    expect(detectCaptureFormat(new Uint8Array([0x0a, 0x0d, 0x0d, 0x0a]))).toBe('pcapng');
  });

  test('文件太短时不乱认', () => {
    expect(detectCaptureFormat(new Uint8Array([0xd4, 0xc3]))).toBeNull();
  });

  test('选抓包文件：自动解成待导入数据', async () => {
    const file = new File([fixtureBytes('synthetic-capture.pcap')], 'capture-1.pcap');
    const raw = await readCaptureFile(file);

    expect((raw as { meta: { type: string } }).meta.type).toBe('hatch-backup');
  });

  test('选 JSON 文件：仍是原来的解析流程', async () => {
    const file = new File(['{"meta":{"type":"hatch-backup"}}'], 'backup.json');
    const raw = await readCaptureFile(file);

    expect((raw as { meta: { type: string } }).meta.type).toBe('hatch-backup');
  });

  test('PCAPNG 给出可读的错误，而不是 JSON 解析失败', async () => {
    const file = new File([new Uint8Array([0x0a, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0])], 'x.pcapng');

    await expect(readCaptureFile(file)).rejects.toThrow(/PCAPNG/);
  });

  test('JSON 内容损坏时给可读提示，而不是透出解析器英文原文', async () => {
    const file = new File(['{ not json'], 'broken.json');

    await expect(readCaptureFile(file)).rejects.toThrow(/不是有效的 JSON/);
  });
});
