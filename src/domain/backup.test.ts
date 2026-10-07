import { describe, expect, test } from 'vitest';
import {
  BACKUP_TYPE,
  backupFileName,
  buildBackup,
  mergeSnapshots,
  parseToolboxBackup,
} from './backup';
import type { AccountSnapshot } from './parseBackup';

/** 账号名 → 稳定的假 UID（真实场景 UID 唯一；测试里按名字派生，保证不同账号不同主键） */
const gameIdOf = (name: string): number =>
  [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 7);

const snapshot = (name: string, count: number): AccountSnapshot => ({
  accountName: name,
  gameId: gameIdOf(name),
  exportedAt: '2026-09-25T12:00:00.000Z',
  importedAt: '2026-09-26T00:00:00.000Z',
  pets: Array.from({ length: count }, (_, i) => ({
    gameId: i,
    name: `精灵${i}`,
    gender: '母' as const,
    nature: '固执',
    voiceDb: 100,
    medalBody: '大块头',
    isShiny: false,
    account: name,
  })),
  eggs: [],
});

/** 同一个账号、不同的数据时刻（数据自身时刻与导入时刻一起变，模拟两次不同时间的采集） */
const at = (name: string, when: string, count = 1): AccountSnapshot => ({
  ...snapshot(name, count),
  exportedAt: when,
  importedAt: when,
});

describe('buildBackup / parseToolboxBackup', () => {
  test('导出的备份带有类型标记，能被自己解析回来', () => {
    const backup = buildBackup([snapshot('测试甲', 2), snapshot('测试丙', 3)], {
      exportedAt: '2026-09-26T10:00:00.000Z',
      catalogVersion: 's4-2026-09-24',
    });
    expect(backup.type).toBe(BACKUP_TYPE);
    expect(backup.accounts).toHaveLength(2);

    const parsed = parseToolboxBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed.accounts.map((a) => a.accountName)).toEqual(['测试甲', '测试丙']);
    expect(parsed.accounts[1].pets).toHaveLength(3);
  });

  test('文件名带日期', () => {
    expect(backupFileName('2026-09-26T10:00:00.000Z')).toBe('洛克工具箱备份-2026-09-26.json');
  });

  test('抓包文件会被明确拒绝（给出可读错误）', () => {
    expect(() => parseToolboxBackup({ meta: { type: 'hatch-backup' } })).toThrow(/备份文件/);
  });

  test('备份里没有账号数据时报错', () => {
    expect(() => parseToolboxBackup({ type: BACKUP_TYPE, accounts: [] })).toThrow(/没有可用/);
    expect(() => parseToolboxBackup({ type: BACKUP_TYPE })).toThrow(/accounts/);
  });

  test('损坏的账号条目会被过滤掉，不影响其他账号', () => {
    const parsed = parseToolboxBackup({
      type: BACKUP_TYPE,
      accounts: [snapshot('测试甲', 1), { broken: true }, null],
    });
    expect(parsed.accounts).toHaveLength(1);
  });

  test('账号里损坏的精灵条目被逐只清洗（m3：pets 元素不再整组放过）', () => {
    const good = snapshot('测试甲', 1).pets[0]!;
    const parsed = parseToolboxBackup({
      type: BACKUP_TYPE,
      accounts: [{ ...snapshot('测试甲', 0), pets: [good, null, 42, { name: '坏蛋' }] }],
    });
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0].pets).toHaveLength(2); // null / 42 被丢弃
    expect(parsed.accounts[0].pets.map((p) => p.name)).toEqual(['精灵0', '坏蛋']);
    // 缺失字段按防御式口径归一化，不带脏数据进库
    expect(parsed.accounts[0].pets[1]).toMatchObject({
      gameId: 0,
      gender: '未知',
      voiceDb: 0,
      isShiny: false,
      account: '测试甲',
    });
  });

  test('账号级字段被归一化：缺 gameId 的老备份不会误判成另一个账号', () => {
    const parsed = parseToolboxBackup({
      type: BACKUP_TYPE,
      // 老格式：账号级没有 gameId / 时间 / 蛋仓
      accounts: [{ accountName: '测试甲', pets: [] }],
    });
    expect(parsed.accounts[0].gameId).toBe(0);
    expect(parsed.accounts[0].exportedAt).toBe('');
    expect(parsed.accounts[0].eggs).toEqual([]);

    // gameId 归一化成 0（= 老数据没带编号）→ 按账号名兜底匹配到本地同一账号（不是新增一个）
    const merged = mergeSnapshots([snapshot('测试甲', 1)], parsed.accounts);
    expect(merged.added).toEqual([]);
    expect(merged.kept).toEqual(['测试甲']);
    expect(merged.snapshots).toHaveLength(1);
  });
});

describe('mergeSnapshots 多设备合并', () => {
  test('备份里独有的账号并入，本地独有的账号照样保留', () => {
    const result = mergeSnapshots([snapshot('平板的号', 2)], [snapshot('手机的号', 3)]);
    expect(result.snapshots.map((s) => s.accountName)).toEqual(['平板的号', '手机的号']);
    expect(result.added).toEqual(['手机的号']);
    expect(result.updated).toEqual([]);
    expect(result.kept).toEqual([]);
  });

  test('同账号取导入时间较新的那份（备份更新 → 替换）', () => {
    const result = mergeSnapshots(
      [at('测试甲', '2026-09-26T00:00:00.000Z', 2)],
      [at('测试甲', '2026-09-27T00:00:00.000Z', 5)],
    );
    expect(result.updated).toEqual(['测试甲']);
    expect(result.snapshots[0].pets).toHaveLength(5);
  });

  test('同账号本地更新 → 保留本地，不会被旧备份顶回去', () => {
    const result = mergeSnapshots(
      [at('测试甲', '2026-09-27T00:00:00.000Z', 5)],
      [at('测试甲', '2026-09-26T00:00:00.000Z', 2)],
    );
    expect(result.kept).toEqual(['测试甲']);
    expect(result.updated).toEqual([]);
    expect(result.snapshots[0].pets).toHaveLength(5);
  });

  test('时间相同时保留本地', () => {
    const result = mergeSnapshots(
      [at('测试甲', '2026-09-26T00:00:00.000Z', 5)],
      [at('测试甲', '2026-09-26T00:00:00.000Z', 2)],
    );
    expect(result.kept).toEqual(['测试甲']);
    expect(result.snapshots[0].pets).toHaveLength(5);
  });

  test('云同步路径（tieBreak: incoming）：时间相同时取云端那份，两台设备才能收敛', () => {
    // 同一账号两边各采一份、采集器给出的时间戳完全相同 → 内容却不同。
    // 默认（导入用）保留本机；云同步必须取云端，否则两台各留各的、永远合不到一起。
    const result = mergeSnapshots(
      [at('测试甲', '2026-09-26T00:00:00.000Z', 2)],
      [at('测试甲', '2026-09-26T00:00:00.000Z', 5)],
      { tieBreak: 'incoming' },
    );
    expect(result.updated).toEqual(['测试甲']);
    expect(result.kept).toEqual([]);
    expect(result.snapshots[0].pets).toHaveLength(5);
  });

  test('时间不可比较时保留本地，不用来路不明的数据覆盖', () => {
    const result = mergeSnapshots(
      [{ ...snapshot('测试甲', 5), exportedAt: '', importedAt: '' }],
      [at('测试甲', '2026-09-27T00:00:00.000Z', 2)],
    );
    expect(result.kept).toEqual(['测试甲']);
    expect(result.snapshots[0].pets).toHaveLength(5);
  });

  test('空备份不改变本地数据', () => {
    const local = [snapshot('测试甲', 2)];
    const result = mergeSnapshots(local, []);
    expect(result.snapshots.map((s) => s.accountName)).toEqual(['测试甲']);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.kept).toEqual([]);
  });

  test('两边完全一致时不做任何改动（幂等：反复导入同一份不会变）', () => {
    const local = [snapshot('测试甲', 2), snapshot('测试丙', 1)];
    const result = mergeSnapshots(local, [snapshot('测试甲', 2), snapshot('测试丙', 1)]);
    expect(result.snapshots.map((s) => s.accountName)).toEqual(['测试甲', '测试丙']);
    expect([...result.added, ...result.updated]).toEqual([]);
    expect(result.kept.sort()).toEqual(['测试甲', '测试丙'].sort());
  });

  test('判据用数据自身的时刻：导出时间旧的抓包即使现在才导入，也顶不掉本地更新的那份', () => {
    const result = mergeSnapshots(
      [
        {
          ...snapshot('测试甲', 5),
          exportedAt: '2026-09-20T00:00:00.000Z',
          importedAt: '2026-09-20T00:00:00.000Z',
        },
      ],
      // 数据是 9-10 的旧抓包，但今天（9-30）才导入 → importedAt 最新
      [{ ...snapshot('测试甲', 2), exportedAt: '2026-09-10T00:00:00.000Z', importedAt: '2026-09-30T00:00:00.000Z' }],
    );
    expect(result.kept).toEqual(['测试甲']);
    expect(result.updated).toEqual([]);
    expect(result.snapshots[0].pets).toHaveLength(5);
  });

  test('同名但 UID 不同（两个真实账号）：两份都保留，不再丢弃第二份', () => {
    const result = mergeSnapshots(
      [{ ...snapshot('测试甲', 3), gameId: 111 }],
      [
        {
          ...snapshot('测试甲', 2),
          gameId: 222,
          exportedAt: '2026-09-30T00:00:00.000Z',
          importedAt: '2026-09-30T00:00:00.000Z',
        },
      ],
    );
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots.map((s) => s.gameId).sort()).toEqual([111, 222]);
    expect(result.added).toEqual(['测试甲']);
    expect(result.updated).toEqual([]);
    expect(result.snapshots.find((s) => s.gameId === 111)?.pets).toHaveLength(3);
    expect(result.snapshots.find((s) => s.gameId === 222)?.pets).toHaveLength(2);
  });

  test('本地账号缺 UID（老数据）时按账号名兜底，仍按时间合并', () => {
    const result = mergeSnapshots(
      [{ ...snapshot('测试甲', 3), gameId: 0 }],
      [at('测试甲', '2026-09-30T00:00:00.000Z', 2)],
    );
    expect(result.updated).toEqual(['测试甲']);
    expect(result.added).toEqual([]);
    // 主键从 name: 升级成 uid:，只留一份
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].gameId).toBe(gameIdOf('测试甲'));
  });
});
