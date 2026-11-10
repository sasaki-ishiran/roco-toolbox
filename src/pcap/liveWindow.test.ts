import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  __resetFrameCacheForTest,
  exportLiveDecodeState,
  extractPcap,
  importLiveDecodeState
} from '../pcap-decoder/tools/pcap-json-app/src/core';

const OPTIONS = { allowTruncated: true, retainRawProtocol: false };

/** 夹具是单记录 pcap：24B 全局头 + 16B 记录头 + 一个完整以太网帧。 */
function fixtureParts() {
  const base = new Uint8Array(readFileSync('src/pcap/__fixtures__/synthetic-capture.pcap'));
  const recordHeader = base.subarray(24, 40);
  const packet = base.subarray(40);
  const linkHeader = packet.subarray(0, 54); // 以太网 14 + IPv4 20 + TCP 20
  return { globalHeader: base.subarray(0, 24), recordHeader, linkHeader, payload: packet.subarray(54) };
}

const readU32BE = (bytes: Uint8Array, offset: number) => (
  (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0
);

const writeU32LE = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
};

/** 把一段 TCP 载荷包成以太网帧（只改 IP 总长与 TCP 序号，校验和解析器不校验）。 */
function frameOf(linkHeader: Uint8Array, part: Uint8Array, sequence: number): Uint8Array {
  const frame = new Uint8Array(linkHeader.length + part.length);
  frame.set(linkHeader);
  const totalLength = 20 + 20 + part.length;
  frame[16] = (totalLength >> 8) & 0xff;
  frame[17] = totalLength & 0xff;
  frame[38] = (sequence >>> 24) & 0xff;
  frame[39] = (sequence >>> 16) & 0xff;
  frame[40] = (sequence >>> 8) & 0xff;
  frame[41] = sequence & 0xff;
  frame.set(part, linkHeader.length);
  return frame;
}

function pcapOf(frames: Uint8Array[]): { bytes: Uint8Array; lengths: number[] } {
  const { globalHeader, recordHeader } = fixtureParts();
  const lengths = frames.map((frame) => 16 + frame.length);
  const total = 24 + lengths.reduce((sum, length) => sum + length, 0);
  const bytes = new Uint8Array(total);
  bytes.set(globalHeader, 0);
  let offset = 24;
  frames.forEach((frame, index) => {
    const header = recordHeader.slice();
    writeU32LE(header, 8, frame.length);
    writeU32LE(header, 12, frame.length);
    bytes.set(header, offset);
    bytes.set(frame, offset + 16);
    offset += lengths[index];
  });
  return { bytes, lengths };
}

/** 载荷里每个 0x33 0x66 是一个 TGCP 帧起点，用来在帧边界上切记录。 */
function magicOffsets(payload: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let index = 0; index + 1 < payload.length; index += 1) {
    if (payload[index] === 0x33 && payload[index + 1] === 0x66) offsets.push(index);
  }
  return offsets;
}

const summarize = (bytes: Uint8Array, options: Record<string, unknown> = {}) => {
  const extracted = extractPcap(bytes, { ...OPTIONS, ...options });
  return {
    extracted,
    packets: extracted.packets ?? 0,
    profile: extracted.profile?.player_name ?? null,
    records: extracted.records.length,
    boxes: extracted.boxes?.length ?? 0
  };
};

beforeEach(() => __resetFrameCacheForTest());

describe('实时巡检尾部窗口', () => {
  test('窗口里有握手帧时只解尾部记录，结果与全量一致', () => {
    const { linkHeader, payload } = fixtureParts();
    const sequence = readU32BE(linkHeader, 38);
    const first = frameOf(linkHeader, payload, sequence);
    const second = frameOf(linkHeader, payload, sequence + payload.length);
    const { bytes, lengths } = pcapOf([first, second]);
    const full = summarize(bytes);

    // 窗口刚好覆盖最后一份：里面自带握手帧，不会退回全量
    const windowed = summarize(bytes, { windowBytes: lengths[1] + 24, sessionKey: 'w1' });

    expect(windowed.packets).toBeLessThan(full.packets);
    expect(windowed.profile).toBe(full.profile);
    expect(windowed.records).toBe(full.records);
    expect(windowed.boxes).toBe(full.boxes);
  });

  test('第二轮复用上一轮的解析结果，界面数据不丢', () => {
    const { linkHeader, payload } = fixtureParts();
    const first = frameOf(linkHeader, payload, 1000);
    const second = frameOf(linkHeader, payload, 1000 + payload.length);
    const { bytes, lengths } = pcapOf([first, second]);
    const windowBytes = lengths[1] + 24;

    const round1 = summarize(bytes, { windowBytes, sessionKey: 'w2' });
    const round2 = summarize(bytes, { windowBytes, sessionKey: 'w2' });

    expect(round1.records).toBe(1);
    // 已完整应用过的帧直接跳过：本轮不再重扫明文，记录为空是预期
    expect(round2.records).toBe(0);
    // 但账号 / 角色仍从基线沿用，界面不能因此掉线
    expect(round2.profile).toBe(round1.profile);
  });

  test('尾窗滑动后新帧不会被当成已应用帧（去重键必须是绝对偏移）', () => {
    const { linkHeader, payload } = fixtureParts();
    const first = frameOf(linkHeader, payload, 1000);
    const second = frameOf(linkHeader, payload, 1000 + payload.length);
    const third = frameOf(linkHeader, payload, 1000 + payload.length * 2);

    const head = pcapOf([first, second]);
    const windowBytes = head.lengths[1] + 24;
    const round1 = summarize(head.bytes, { windowBytes, sessionKey: 'slide1' });
    expect(round1.records).toBe(1);

    const grown = pcapOf([first, second, third]);
    const round2 = summarize(grown.bytes, { windowBytes, sessionKey: 'slide1' });

    // 如果去重键用「窗口内相对偏移」，第三帧会和上一轮第二帧撞在偏移 0 上被跳过 → records 为 0，
    // 新场景 / 新精灵就永远刷不出来。用整份文件的绝对偏移时它是新帧，必须被应用。
    expect(round2.records).toBe(1);
    expect(round2.profile).toBe(round1.profile);
  });

  test('文件还没超过窗口大小时也走增量：第二轮不再重放整份文件', () => {
    const { linkHeader, payload } = fixtureParts();
    const first = frameOf(linkHeader, payload, 1000);
    const second = frameOf(linkHeader, payload, 1000 + payload.length);
    const { bytes } = pcapOf([first, second]);
    const full = summarize(bytes);

    // 2MiB 窗口远大于文件：修复前这里直接退回全量解析，每轮把两份记录都重放一遍。
    const round1 = summarize(bytes, { windowBytes: 2 * 1024 * 1024, sessionKey: 'small1' });
    const round2 = summarize(bytes, { windowBytes: 2 * 1024 * 1024, sessionKey: 'small1' });

    expect(round1.records).toBe(full.records);
    expect(round2.records).toBe(0);
    expect(round2.profile).toBe(round1.profile);
  });

  test('换采集会话后基线作废，重新完整解析窗口', () => {
    const { linkHeader, payload } = fixtureParts();
    const first = frameOf(linkHeader, payload, 1000);
    const second = frameOf(linkHeader, payload, 1000 + payload.length);
    const { bytes, lengths } = pcapOf([first, second]);
    const windowBytes = lengths[1] + 24;

    summarize(bytes, { windowBytes, sessionKey: 'w3' });
    const other = summarize(bytes, { windowBytes, sessionKey: 'w4' });

    expect(other.records).toBe(1);
    expect(other.profile).toBe('测试玩家');
  });

  test('冷启动尾窗没有 key 时用文件头补扫，不退回全量', () => {
    const { linkHeader, payload } = fixtureParts();
    const recordHeaderLength = 16;
    const magic = magicOffsets(payload)[1] ?? payload.length;
    // 记录 1 = 完整一份（含握手帧），记录 2 = 只有第二份的握手帧之后的半段
    const first = frameOf(linkHeader, payload, 1000);
    const tail = frameOf(linkHeader, payload.subarray(magic), 1000 + payload.length);
    const { bytes, lengths } = pcapOf([first, tail]);

    const full = summarize(bytes);
    // 模拟「Worker 里没有任何可用 key」的冷启动：不能让上一轮全量解析留下的 key 干扰
    __resetFrameCacheForTest();
    const windowed = summarize(bytes, {
      windowBytes: lengths[1] + recordHeaderLength,
      sessionKey: 'w5'
    });

    // 补扫文件头拿到 key / 账号后只解尾窗，不再整份重解
    expect(windowed.packets).toBeLessThan(full.packets);
    expect(windowed.profile).toBe(full.profile);
    expect(windowed.records).toBe(full.records);
  });
});

/** 大于 2MiB 的抓包：记录 1 带握手帧，后面全是「没有握手帧」的业务帧。 */
function largeCapture() {
  const { linkHeader, payload } = fixtureParts();
  const sequence = readU32BE(linkHeader, 38);
  const postKey = payload.subarray(magicOffsets(payload)[1] ?? payload.length);
  const frames: Uint8Array[] = [frameOf(linkHeader, payload, sequence)];
  let next = sequence + payload.length;
  const copies = Math.ceil(120_000 / postKey.length);
  for (let index = 0; index < copies; index += 1) {
    frames.push(frameOf(linkHeader, postKey, next));
    next += postKey.length;
  }
  const { bytes, lengths } = pcapOf(frames);
  return { frames, bytes, postKey, headLimit: 24 + lengths[0] };
}

describe('冷启动补扫与裁剪后的会话恢复', () => {
  test('冷启动先补扫文件头建基线，尾窗不再退回全量解析', () => {
    const { bytes, headLimit } = largeCapture();
    const full = summarize(bytes);
    const windowed = summarize(bytes, { windowBytes: 20_000, sessionKey: 'head1', headScanBytes: headLimit });

    // 尾窗里没有握手帧：补扫头部后应直接解密，而不是退回全量
    expect(windowed.profile).toBe(full.profile);
    expect(windowed.packets).toBeLessThan(full.packets);
  });

  test('文件被滚动裁剪变小后保留账号基线，不整份作废', () => {
    const { frames, headLimit } = largeCapture();
    const full = pcapOf(frames);
    summarize(full.bytes, { windowBytes: 20_000, sessionKey: 'shrink1', headScanBytes: headLimit });

    const trimmed = pcapOf(frames.slice(-100));
    const after = summarize(trimmed.bytes, { windowBytes: 20_000, sessionKey: 'shrink1', headScanBytes: 1 });

    expect(after.profile).toBe('测试玩家');
  });

  test('导出的会话状态可在 Worker 重置后恢复裁剪文件的解密', () => {
    const { frames, bytes, headLimit } = largeCapture();
    const first = summarize(bytes, { windowBytes: 20_000, sessionKey: 'resume1', headScanBytes: headLimit });
    const state = JSON.parse(JSON.stringify(exportLiveDecodeState()));
    expect(state.key).toBe('resume1');
    expect(state.keys.length).toBeGreaterThan(0);

    __resetFrameCacheForTest();
    const trimmed = pcapOf(frames.slice(-100));
    const cold = summarize(trimmed.bytes, { windowBytes: 20_000, sessionKey: 'resume1', headScanBytes: 1 });
    // 没有 key 时尾窗无法解密，会退回全量；这里先确认这是「冷启动失败」状态
    expect(cold.profile).toBe(null);

    expect(importLiveDecodeState(state)).toBe(true);
    const resumed = summarize(trimmed.bytes, { windowBytes: 20_000, sessionKey: 'resume1', headScanBytes: 1 });
    expect(resumed.profile).toBe(first.profile);
    expect(resumed.packets).toBeLessThan(summarize(trimmed.bytes).packets);
  });
});
