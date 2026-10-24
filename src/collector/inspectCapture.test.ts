import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { captureFingerprint, inspectCaptureBytes } from './inspectCapture';

afterEach(() => vi.unstubAllGlobals());
describe('真实 PCAP 进度摘要', () => {
  test('复用解析器识别角色、精灵与仓库，缺少蛋仓时不能暗示已经收齐', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const result = await inspectCaptureBytes(new Uint8Array(readFileSync('src/pcap/__fixtures__/synthetic-capture.pcap')));
    expect(result.hasProfile).toBe(true);
    expect(result.records).toBe(1);
    expect(result.boxes).toBe(1);
    expect(result.hasEggInventory).toBe(false);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  test('同一内容重复到达不改变指纹，字段值改变则必须改变', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const first = { records: [{ instance_id: 1, int_fields: { 9: [3] }, occurrences: 1, raw_source: { lastPacket: 10 } }] };
    const repeat = { records: [{ raw_source: { lastPacket: 20 }, occurrences: 2, int_fields: { 9: [3] }, instance_id: 1 }] };
    const changed = { records: [{ instance_id: 1, int_fields: { 9: [4] }, occurrences: 2 }] };
    expect(await captureFingerprint(first)).toBe(await captureFingerprint(repeat));
    expect(await captureFingerprint(first)).not.toBe(await captureFingerprint(changed));
  });
  test('蛋仓数量不变但孵化内容变化必须改变指纹', async () => {
    vi.stubGlobal('crypto', webcrypto);
    expect(await captureFingerprint({ eggInventory: { eggs: [{ instanceId: 1, nature: 3 }] } }))
      .not.toBe(await captureFingerprint({ eggInventory: { eggs: [{ instanceId: 1, nature: 4 }] } }));
  });
});
