import { describe, expect, test } from 'vitest';
import {
  motherResourceCriteriaIdOf,
  type MotherResourceDraft,
  type SharedMotherAccount,
} from '../shared/motherGroups';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  mother,
  sharedAccount,
  snapshot,
} from '../test/fixtures/motherSharing';
import {
  MotherResourceError,
  assertMotherResourceWithinLimits,
  buildMotherResource,
  diffMotherResources,
  motherResourceSignature,
} from './motherResource';

const build = (
  snapshots: Parameters<typeof buildMotherResource>[0]['snapshots'],
  selectedAccountKeys: string[],
) =>
  buildMotherResource({
    snapshots,
    selectedAccountKeys,
    species: catalog,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    mode: 'perfect',
  });

const draft = (accounts: SharedMotherAccount[]): MotherResourceDraft => ({
  schemaVersion: 1,
  criteriaId: motherResourceCriteriaIdOf('perfect'),
  catalogVersion: FIXTURE_CATALOG_VERSION,
  accounts,
});

const errorOf = (fn: () => unknown): MotherResourceError | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error as MotherResourceError;
  }
};

describe('buildMotherResource：共享全部母本（2026-10-28 去掉小组口径）', () => {
  test('产线：同账号双方大婉才生成，性格取母本和公的并集', () => {
    const resource = build(
      [
        snapshot(1001, '甲', [
          mother(101, { nature: '固执' }),
          mother(101, { gender: '公', nature: '开朗' }),
        ]),
      ],
      ['uid:1001'],
    );
    expect(resource.accounts[0].lines).toHaveLength(1);
    expect(resource.accounts[0].lines?.[0].eggGameId).toBe(101);
    expect(resource.accounts[0].lines?.[0].grade).toBe('大婉');
    expect(new Set(resource.accounts[0].lines?.[0].natures)).toEqual(new Set(['固执', '开朗']));
  });

  test('产线：公不是大婉时不生成', () => {
    const resource = build(
      [
        snapshot(1001, '甲', [
          mother(101, { nature: '固执' }),
          mother(101, { gender: '公', nature: '开朗', medalBody: '', voiceDb: 0 }),
        ]),
      ],
      ['uid:1001'],
    );
    expect(resource.accounts[0].lines).toEqual([]);
  });

  test('进化形态归蛋且重名账号保留不同来源', () => {
    const resource = build(
      [snapshot(1001, '同名', [mother(102)]), snapshot(1002, '同名', [mother(101)])],
      ['uid:1001', 'uid:1002'],
    );
    expect(resource.accounts.map((account) => [account.accountKey, account.eggGameIds])).toEqual([
      ['uid:1001', [101]],
      ['uid:1002', [101]],
    ]);
    // 重名不合并：两个来源账号各自保留，名字相同也不影响身份
    expect(resource.accounts.map((account) => account.accountName)).toEqual(['同名', '同名']);
    expect(resource.schemaVersion).toBe(1);
    expect(resource.criteriaId).toBe(motherResourceCriteriaIdOf('perfect'));
    expect(resource.catalogVersion).toBe(FIXTURE_CATALOG_VERSION);
  });

  test('只排除非母：体型 / 声音 / 性格不再过滤', () => {
    const resource = build(
      [
        snapshot(1001, '甲', [
          mother(201, { gender: '公' }),
          mother(201, { gender: '未知' }),
          mother(201, { medalBody: '小不点' }),
          mother(201, { voiceDb: 99 }),
          mother(101, { nature: '沉默' }),
        ]),
      ],
      ['uid:1001'],
    );
    expect(resource.accounts[0].eggGameIds).toEqual([101, 201]);
  });

  test('纯母物种计入，未发现组 / 无蛋血脉 / 图鉴未知不计入', () => {
    const resource = build(
      [snapshot(1001, '甲', [mother(301), mother(401), mother(501), mother(999)])],
      ['uid:1001'],
    );
    // 301 是纯母物种：母本收集不是种公网络，不能按「能出公」过滤
    expect(resource.accounts[0].eggGameIds).toEqual([301]);
  });

  test('同一颗蛋的重复个体与多个进化形态只算一次，ID 升序', () => {
    const resource = build(
      [snapshot(1001, '甲', [mother(201), mother(102), mother(101), mother(201)])],
      ['uid:1001'],
    );
    expect(resource.accounts[0].eggGameIds).toEqual([101, 201]);
  });

  test('选中的账号一个达标母本都没有时是有效的空摘要', () => {
    const resource = build([snapshot(1001, '甲', [mother(201, { gender: '公' })])], ['uid:1001']);
    expect(resource.accounts).toHaveLength(1);
    expect(resource.accounts[0].eggGameIds).toEqual([]);
  });

  test('没有选中账号 / 账号不存在 / 非规范 UID / 导出时间无效都报错', () => {
    const snapshots = [
      snapshot(1001, '甲', [mother(101)]),
      snapshot(0, '无UID', [mother(101)], ''),
    ];
    expect(errorOf(() => build(snapshots, []))?.code).toBe('NO_SELECTED_ACCOUNTS');
    expect(errorOf(() => build(snapshots, ['uid:2002']))?.code).toBe('ACCOUNT_NOT_FOUND');
    expect(errorOf(() => build(snapshots, ['name:甲']))?.code).toBe('INVALID_ACCOUNT_KEY');
    expect(errorOf(() => build(snapshots, ['uid:0']))?.code).toBe('INVALID_ACCOUNT_KEY');
    expect(errorOf(() => build(snapshots, ['uid:1001']))).toBeNull();
    expect(errorOf(() => build([snapshot(0, '无UID', [mother(101)])], ['uid:0']))?.code).toBe(
      'INVALID_ACCOUNT_KEY',
    );
  });

  test('旧的自选口径参数不再参与过滤，criteriaId 由目标模式派生', () => {
    const resource = buildMotherResource({
      snapshots: [
        snapshot(1001, '甲', [
          mother(101, { medalBody: '小不点', voiceDb: 98 }),
          mother(102, { medalBody: '大块头', voiceDb: 100 }),
        ]),
      ],
      selectedAccountKeys: ['uid:1001'],
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
      criteria: { bodies: ['小不点'], voices: ['婉转声'] },
      mode: 'medal',
    });
    expect(resource.criteriaId).toBe(motherResourceCriteriaIdOf('medal'));
    expect(resource.accounts[0].eggGameIds).toEqual([101]);
  });

  test('模式不同 → criteriaId 不同，摘要不可混用（2026-10-29 B2-H01）', () => {
    const snapshots = [snapshot(1001, '甲', [mother(101)])];
    const perfect = buildMotherResource({
      snapshots,
      selectedAccountKeys: ['uid:1001'],
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
      mode: 'perfect',
    });
    const medal = buildMotherResource({
      snapshots,
      selectedAccountKeys: ['uid:1001'],
      species: catalog,
      catalogVersion: FIXTURE_CATALOG_VERSION,
      mode: 'medal',
    });
    expect(perfect.criteriaId).toBe('all-mothers-v3-perfect');
    expect(medal.criteriaId).toBe('all-mothers-v3-medal');
    expect(diffMotherResources(perfect, medal).unchanged).toBe(false);
  });

  test('发布前预检：产线数 / 性格数 / 请求体超限都给出可读错误', () => {
    const manyLines = draft([
      sharedAccount(1, [101], {
        lines: Array.from({ length: 1025 }, (_, index) => ({
          eggGameId: 100000 + index,
          grade: '大婉' as const,
          natures: ['固执'],
        })),
      }),
    ]);
    expect(errorOf(() => assertMotherResourceWithinLimits(manyLines))?.code).toBe('TOO_MANY_LINES');

    const manyNatures = draft([
      sharedAccount(1, [101], {
        lines: [
          {
            eggGameId: 101,
            grade: '大婉',
            natures: Array.from({ length: 31 }, (_, index) => `性格${index}`),
          },
        ],
      }),
    ]);
    expect(errorOf(() => assertMotherResourceWithinLimits(manyNatures))?.code).toBe(
      'TOO_MANY_NATURES',
    );

    const huge = draft(
      Array.from({ length: 50 }, (_, index) =>
        sharedAccount(index + 1, Array.from({ length: 1024 }, (_, slot) => 1000 + slot)),
      ),
    );
    expect(errorOf(() => assertMotherResourceWithinLimits(huge))?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('导出时间为空或非 ISO 时拒绝，不产出半份摘要', () => {
    expect(errorOf(() => build([snapshot(1001, '甲', [mother(101)], '')], ['uid:1001']))?.code).toBe(
      'INVALID_EXPORTED_AT',
    );
    expect(
      errorOf(() => build([snapshot(1001, '甲', [mother(101)], '昨天')], ['uid:1001']))?.code,
    ).toBe('INVALID_EXPORTED_AT');
  });
});

describe('motherResourceSignature / diffMotherResources：稳定序列化与变化比较', () => {
  test('签名与账号顺序、蛋 ID 顺序无关', () => {
    const a = draft([sharedAccount(2, [301, 101]), sharedAccount(1, [201])]);
    const b = draft([sharedAccount(1, [201]), sharedAccount(2, [101, 301])]);
    expect(motherResourceSignature(a)).toBe(motherResourceSignature(b));
  });

  test('覆盖变化按人汇总：新增/移除蛋与被改动的账号', () => {
    const previous = draft([sharedAccount(1, [101, 201]), sharedAccount(2, [301])]);
    const next = draft([sharedAccount(1, [101]), sharedAccount(2, [301, 401])]);
    const diff = diffMotherResources(previous, next);
    expect(diff.addedEggGameIds).toEqual([401]);
    expect(diff.removedEggGameIds).toEqual([201]);
    expect(diff.addedAccounts).toEqual([]);
    expect(diff.removedAccounts).toEqual([]);
    expect(diff.changedAccounts).toEqual([
      {
        accountKey: 'uid:1',
        addedEggGameIds: [],
        removedEggGameIds: [201],
        addedLines: [],
        removedLines: [],
      },
      {
        accountKey: 'uid:2',
        addedEggGameIds: [401],
        removedEggGameIds: [],
        addedLines: [],
        removedLines: [],
      },
    ]);
    expect(diff.unchanged).toBe(false);
  });

  test('只改账号名或导出时间、覆盖没变时不算摘要变化', () => {
    const previous = draft([sharedAccount(1, [101, 201])]);
    const next = draft([
      sharedAccount(1, [201, 101], {
        accountName: '改了名',
        sourceExportedAt: '2026-10-24T00:00:00.000Z',
      }),
    ]);
    const diff = diffMotherResources(previous, next);
    expect(diff).toEqual({
      addedEggGameIds: [],
      removedEggGameIds: [],
      addedAccounts: [],
      removedAccounts: [],
      changedAccounts: [],
      addedLines: [],
      removedLines: [],
      unchanged: true,
    });
  });

  test('产线变化也算变化，并能单独列出', () => {
    const previous = draft([sharedAccount(1, [101], { lines: [] })]);
    const next = draft([
      sharedAccount(1, [101], {
        lines: [{ eggGameId: 101, grade: '大婉', natures: ['固执'] }],
      }),
    ]);
    const diff = diffMotherResources(previous, next);
    expect(diff.addedLines).toEqual(['101|大婉|固执']);
    expect(diff.removedLines).toEqual([]);
    expect(diff.changedAccounts).toEqual([
      {
        accountKey: 'uid:1',
        addedEggGameIds: [],
        removedEggGameIds: [],
        addedLines: ['101|大婉|固执'],
        removedLines: [],
      },
    ]);
    expect(diff.unchanged).toBe(false);
  });

  test('账号增加与移除单独列出', () => {
    const previous = draft([sharedAccount(1, [101]), sharedAccount(2, [201])]);
    const next = draft([sharedAccount(1, [101]), sharedAccount(3, [301])]);
    const diff = diffMotherResources(previous, next);
    expect(diff.addedAccounts).toEqual(['uid:3']);
    expect(diff.removedAccounts).toEqual(['uid:2']);
    expect(diff.addedEggGameIds).toEqual([301]);
    expect(diff.removedEggGameIds).toEqual([201]);
  });
});
