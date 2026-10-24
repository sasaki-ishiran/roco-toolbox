/**
 * 校验多人母本共享 + 小组收集二期的表：建表、增量迁移、约束与级联。
 *
 * 只用本机内存 SQLite（`node:sqlite`，Node 23.4+ 已内置），**不连接远端、不读线上库**。
 * 这个脚本不经过 wrangler：它验证的是 SQL 定义本身；真实的 D1 行为由
 * `tools/test/run-mother-groups-local.mjs` 启动的本地 Pages Functions 验证。
 *
 * 运行：node tools/test/verify-mother-groups-schema.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_FILE = path.join(root, 'functions/schema.sql');
const MIGRATIONS = [
  {
    label: 'mother-groups',
    file: path.join(root, 'functions/migrations/2026-10-23-mother-groups.sql'),
    start: '-- >>> mother-groups (2026-10-23)',
    end: '-- <<< mother-groups (2026-10-23)',
    tables: ['mother_groups', 'mother_group_members', 'mother_group_accounts'],
  },
  {
    label: 'collection-groups',
    file: path.join(root, 'functions/migrations/2026-10-25-collection-groups.sql'),
    start: '-- >>> collection-groups (2026-10-25)',
    end: '-- <<< collection-groups (2026-10-25)',
    tables: [
      'collection_group_configs',
      'collection_group_stud_accounts',
      'collection_group_tasks',
    ],
  },
];
const NEW_TABLES = MIGRATIONS.flatMap((item) => item.tables);

const [schemaSql, ...migrationSqls] = await Promise.all([
  readFile(SCHEMA_FILE, 'utf8'),
  ...MIGRATIONS.map((item) =>
    readFile(item.file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`缺少增量迁移文件：${item.file}`);
      throw error;
    }),
  ),
]);

const tableNames = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

/** SQLite 允许外键引用不存在的父表；所以迁移前必须自己确认旧 schema 已建好。 */
function requireLegacySchema(db, label) {
  if (!tableNames(db).includes('accounts')) {
    throw new Error(`${label}：缺少 accounts 表，拒绝执行增量迁移`);
  }
}

function columnsOf(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => [row.name, row.type, row.notnull, row.dflt_value, row.pk]);
}

function indexNamesOf(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

/* ---------- 1. 完整 schema 初始化 ---------- */
const full = new DatabaseSync(':memory:');
full.exec(schemaSql);
assert.equal(full.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, '本地 SQLite 应默认开启外键');
for (const table of NEW_TABLES) {
  assert.ok(tableNames(full).includes(table), `完整 schema 缺少 ${table}`);
}

/* ---------- 2. 旧 schema（去掉两期新表）+ 增量迁移两次 ---------- */
let legacySql = schemaSql;
for (const item of MIGRATIONS) {
  const start = legacySql.indexOf(item.start);
  const end = legacySql.indexOf(item.end);
  assert.ok(start >= 0 && end > start, `schema.sql 里缺少 ${item.label} 区块标记`);
  legacySql = `${legacySql.slice(0, start)}${legacySql.slice(end + item.end.length)}`;
}
for (const table of NEW_TABLES) {
  assert.ok(!legacySql.includes(table), `旧 schema 不应包含新表 ${table}`);
}

const migrated = new DatabaseSync(':memory:');
migrated.exec(legacySql);
requireLegacySchema(migrated, '旧 schema 初始化');
for (const table of NEW_TABLES) {
  assert.ok(!tableNames(migrated).includes(table), `旧 schema 不应预先包含 ${table}`);
}
for (const sql of migrationSqls) {
  migrated.exec(sql);
  migrated.exec(sql); // 必须可重复执行
}

for (const table of NEW_TABLES) {
  assert.deepEqual(
    columnsOf(migrated, table),
    columnsOf(full, table),
    `${table} 在 schema.sql 与增量迁移里的定义必须一致`,
  );
}
assert.deepEqual(indexNamesOf(migrated), indexNamesOf(full), '索引定义必须一致');

/* ---------- 3. 空库不能悄悄执行迁移 ---------- */
const empty = new DatabaseSync(':memory:');
assert.throws(() => requireLegacySchema(empty, '空库'), /accounts/);

/* ---------- 4. 约束与级联 ---------- */
const now = Date.now();
const insertAccount = full.prepare(
  'INSERT INTO accounts (id, created_at, last_seen_at, recovery_hash, label) VALUES (?, ?, ?, ?, ?)',
);
insertAccount.run('acc-a', now, now, 'hash-a', null);
insertAccount.run('acc-b', now, now, 'hash-b', null);
insertAccount.run('acc-d', now, now, 'hash-d', null);

const insertGroup = full.prepare(
  'INSERT INTO mother_groups (id, owner_account_id, name, invite_hash, created_at) VALUES (?, ?, ?, ?, ?)',
);
insertGroup.run('g1', 'acc-a', '组一', 'hash-1', now);
insertGroup.run('g2', 'acc-a', '组二', 'hash-2', now);

const insertMember = full.prepare(
  'INSERT INTO mother_group_members (group_id, account_id, display_name, joined_at) VALUES (?, ?, ?, ?)',
);
insertMember.run('g1', 'acc-a', 'A', now);
insertMember.run('g1', 'acc-b', 'B', now);
insertMember.run('g2', 'acc-a', 'A', now);

// 外键开启时，不存在的组不能插成员
assert.throws(() => insertMember.run('missing', 'acc-d', 'D', now), /FOREIGN KEY|constraint/i);

const insertShared = full.prepare(
  `INSERT INTO mother_group_accounts
     (group_id, game_account_key, member_account_id, account_name, source_exported_at, egg_game_ids)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
insertShared.run('g1', 'uid:1001', 'acc-a', '甲', '2026-10-23T00:00:00.000Z', '[101]');
insertShared.run('g1', 'uid:2001', 'acc-b', '乙', '2026-10-23T00:00:00.000Z', '[201]');
// 同一个游戏 UID 在同一组只能归一位成员
assert.throws(
  () => insertShared.run('g1', 'uid:1001', 'acc-b', '甲', '2026-10-23T00:00:00.000Z', '[101]'),
  /UNIQUE|constraint/i,
);
// 不同组可以各自共享同一个 UID
insertShared.run('g2', 'uid:1001', 'acc-a', '甲', '2026-10-23T00:00:00.000Z', '[101]');

// 组配置：一个组只有一行；不存在的组不能建配置
const insertConfig = full.prepare(
  `INSERT INTO collection_group_configs
     (group_id, group_type, target_revision, resource_epoch, target_json, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
insertConfig.run('g1', 'mother', 0, 0, '', now);
assert.throws(() => insertConfig.run('g1', 'stud', 0, 0, '', now), /UNIQUE|constraint/i);
assert.throws(() => insertConfig.run('missing', 'mother', 0, 0, '', now), /FOREIGN KEY|constraint/i);

// 种公摘要：同组同游戏 UID 只能归一位成员
const insertStud = full.prepare(
  `INSERT INTO collection_group_stud_accounts
     (group_id, game_account_key, member_account_id, account_name,
      source_exported_at, target_revision, slots_json)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
insertStud.run('g1', 'uid:3001', 'acc-a', '甲', '2026-10-23T00:00:00.000Z', 0, '{}');
assert.throws(
  () => insertStud.run('g1', 'uid:3001', 'acc-b', '乙', '2026-10-23T00:00:00.000Z', 0, '{}'),
  /UNIQUE|constraint/i,
);

// 任务：同目标修订 + 目标键 + 轮次唯一；owner 注销时置空但任务保留
const insertTask = full.prepare(
  `INSERT INTO collection_group_tasks
     (group_id, target_revision, target_key, round, status, owner_account_id,
      version, created_at, updated_at, closed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
insertTask.run('g1', 0, 'mother:101', 0, 'claimed', 'acc-b', 1, now, now, null);
assert.throws(
  () => insertTask.run('g1', 0, 'mother:101', 0, 'open', null, 1, now, now, null),
  /UNIQUE|constraint/i,
);

const count = (sql, ...params) => full.prepare(sql).get(...params).count;
assert.equal(count('SELECT COUNT(*) AS count FROM mother_group_accounts'), 3);

// 删普通成员 → 其共享账号与种公摘要级联删除，别的成员不受影响
full.prepare('DELETE FROM mother_group_members WHERE group_id = ? AND account_id = ?').run('g1', 'acc-b');
assert.equal(count('SELECT COUNT(*) AS count FROM mother_group_accounts WHERE member_account_id = ?', 'acc-b'), 0);
assert.equal(count('SELECT COUNT(*) AS count FROM mother_group_accounts WHERE member_account_id = ?', 'acc-a'), 2);
assert.equal(count('SELECT COUNT(*) AS count FROM collection_group_stud_accounts WHERE member_account_id = ?', 'acc-b'), 0);

// 注销账号 → 自己创建的组、组成员、组内共享账号、组配置、任务 owner 全部处理
full.prepare('DELETE FROM accounts WHERE id = ?').run('acc-b');
assert.equal(count('SELECT COUNT(*) AS count FROM collection_group_tasks WHERE owner_account_id IS NULL'), 1);
full.prepare('DELETE FROM accounts WHERE id = ?').run('acc-a');
assert.equal(count('SELECT COUNT(*) AS count FROM mother_groups'), 0);
assert.equal(count('SELECT COUNT(*) AS count FROM mother_group_members'), 0);
assert.equal(count('SELECT COUNT(*) AS count FROM mother_group_accounts'), 0);
assert.equal(count('SELECT COUNT(*) AS count FROM collection_group_configs'), 0);
assert.equal(count('SELECT COUNT(*) AS count FROM collection_group_stud_accounts'), 0);
assert.equal(count('SELECT COUNT(*) AS count FROM collection_group_tasks'), 0);

const fkCheck = full.prepare('PRAGMA foreign_key_check').all();
assert.deepEqual(fkCheck, [], 'foreign_key_check 应无结果');

console.log('schema 校验通过：');
console.log('  - 完整 schema 与两期增量迁移的表/索引定义一致，迁移可重复执行');
console.log('  - 空库迁移被拒绝（不依赖 SQLite 的外键报错）');
console.log('  - 同组重复游戏 UID 被拒绝，不同组同 UID 允许');
console.log('  - 组配置唯一、任务按「修订 + 目标键 + 轮次」唯一');
console.log('  - 删成员 / 注销账号的级联行为正确，foreign_key_check 无结果');
