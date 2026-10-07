import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseBackup } from './parseBackup';

const fixturePath = resolve(process.cwd(), 'src/domain/__fixtures__/backup-sample.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('parseBackup', () => {
  test('正常解析：账号名、精灵数、字段、蛋仓', () => {
    const snapshot = parseBackup(fixture, '2026-09-26T00:00:00.000Z');
    expect(snapshot.accountName).toBe('测试甲');
    expect(snapshot.gameId).toBe(1000001);
    expect(snapshot.exportedAt).toBe('2026-09-25T12:38:43.262Z');
    expect(snapshot.importedAt).toBe('2026-09-26T00:00:00.000Z');
    expect(snapshot.pets).toHaveLength(4);

    const first = snapshot.pets[0];
    expect(first.gameId).toBe(3200);
    expect(first.gender).toBe('母');
    expect(first.nature).toBe('大胆');
    expect(first.voiceDb).toBe(100);
    expect(first.medalBody).toBe('大块头');
    expect(first.weightPercent).toBe(98.4);
    expect(first.isShiny).toBe(true);
    expect(first.account).toBe('测试甲');

    expect(snapshot.eggs).toHaveLength(2);
    expect(snapshot.eggs[0].petName).toBe('鸭吉吉_等一等鸭');
    expect(snapshot.eggs[0].weightGrams).toBe(6194);
  });

  test('缺少 collections.petBackpack.items 时抛出可读错误', () => {
    const bad = { meta: { type: 'hatch-backup' }, collections: { petBackpack: {} } };
    expect(() => parseBackup(bad, 'now')).toThrow(/有效的抓包备份文件/);
  });

  test('meta.type 不是 hatch-backup 时抛出可读错误', () => {
    const bad = { meta: { type: 'other' }, collections: { petBackpack: { items: [] } } };
    expect(() => parseBackup(bad, 'now')).toThrow(/hatch-backup/);
  });

  test('rawProtocol 不进入结果', () => {
    const snapshot = parseBackup(fixture, 'now');
    expect(JSON.stringify(snapshot)).not.toContain('rawProtocol');
    expect(JSON.stringify(snapshot)).not.toContain('runtime-should-be-dropped');
  });

  test('保留盒子位置字段；缺失时返回 undefined', () => {
    const snapshot = parseBackup(fixture, 'now');
    const first = snapshot.pets[0];
    expect(first.boxGroup).toBe('盒子01');
    expect(first.boxNumber).toBe(1);
    expect(first.slotOrder).toBeUndefined();
    expect(snapshot.pets[3].slotOrder).toBe(3);
  });

  test('保留抓包唯一编号 captureId（缺字段时为 undefined）', () => {
    const snapshot = parseBackup(fixture, 'now');
    // 靠它精确判断「这次新抓了哪些」，所以不能丢
    expect(snapshot.pets.map((p) => p.captureId)).toEqual([
      'capture_1000001_715',
      'capture_1000001_716',
      'capture_1000001_717',
      'capture_1000001_718',
    ]);

    const withoutId = JSON.parse(JSON.stringify(fixture));
    delete withoutId.collections.petBackpack.items[1].id;
    const parsed = parseBackup(withoutId, 'now');
    expect(parsed.pets[1].captureId).toBeUndefined();
    expect(parsed.pets[0].captureId).toBe('capture_1000001_715');
  });

  test('缺 name 的精灵条目被丢弃（与备份导入保持同一清洗口径）', () => {
    const raw = {
      meta: { type: 'hatch-backup', playerName: '甲', gameId: 1 },
      collections: {
        petBackpack: {
          items: [{ speciesPetId: 3200 }, { speciesPetId: 3201, name: '机械方方' }],
        },
      },
    };
    const snapshot = parseBackup(raw, 'now');

    // 没有 name 就没有可读标识，领域逻辑全部失明 → 直接丢弃，而不是留一只空名精灵
    expect(snapshot.pets.map((p) => p.name)).toEqual(['机械方方']);
  });
});
