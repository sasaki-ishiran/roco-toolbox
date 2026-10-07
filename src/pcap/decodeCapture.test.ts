import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseBackup } from '../domain/parseBackup';
import { decodeCapture } from './decodeCapture';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(`src/pcap/__fixtures__/${name}`));

describe('把采集器的 PCAP 解成看板能用的数据', () => {
  test('标准以太网抓包能解出精灵背包', async () => {
    const decoded = await decodeCapture(fixture('synthetic-capture.pcap'), 'synthetic.pcap');

    expect(decoded.payload.meta.type).toBe('hatch-backup');
    expect(decoded.payload.meta.gameId).toBe(151910);
    expect(decoded.payload.meta.playerName).toBe('测试玩家');
    expect(decoded.report.linkType).toBe(1);
    expect(decoded.report.boxes).toBe(1);
    expect(decoded.report.counts.petBackpackItems).toBe(1);
    expect(decoded.mainName).toMatch(/^测试玩家_151910_\d{8}-\d{6}\.json$/);
  });

  test('解出来的数据能直接喂给现有导入流程（parseBackup）', async () => {
    const decoded = await decodeCapture(fixture('synthetic-capture.pcap'), 'synthetic.pcap');
    const snapshot = parseBackup(decoded.payload, '2026-10-03T00:00:00.000Z');

    expect(snapshot.accountName).toBe('测试玩家');
    expect(snapshot.gameId).toBe(151910);
    expect(snapshot.pets).toHaveLength(1);
    // 盒子位置是配窝建议要用的，必须跟着解出来
    expect(snapshot.pets[0].boxNumber).toBe(1);
    expect(snapshot.pets[0].slotOrder).toBe(1);
  });

  test('分页收齐的蛋仓全部解出来', async () => {
    const decoded = await decodeCapture(fixture('paged-eggs-capture.pcap'), 'paged.pcap');

    expect(decoded.payload.collections.eggInventory?.eggs).toHaveLength(300);
  });

  test('中途换号时以最后一个账号为准', async () => {
    const decoded = await decodeCapture(fixture('account-switch-capture.pcap'), 'switch.pcap');

    expect(decoded.payload.meta.gameId).toBe(437157099);
    expect(decoded.payload.meta.playerName).toBe('新账号');
    expect(decoded.report.accountCount).toBe(2);
  });
});
