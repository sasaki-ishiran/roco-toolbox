-- 增量迁移：小组收集二期（2026-10-25）
--
-- 只新增三张表与两个索引，不重建、不删除、不修改任何旧表。可重复执行。
-- 与 functions/schema.sql 的 `>>> collection-groups (2026-10-25)` 区块定义必须逐字一致
-- （tools/test/verify-mother-groups-schema.mjs 会逐列比较）。
--
-- 应用（在仓库根执行；旧的三张母本表已存在）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-10-25-collection-groups.sql
-- 本地：
--   npx wrangler d1 execute roco-toolbox-db --local --persist-to <目录> --file functions/migrations/2026-10-25-collection-groups.sql

-- 组配置：一个组只能有一种类型，创建后不可修改；target_revision 由组长改目标时递增
CREATE TABLE IF NOT EXISTS collection_group_configs (
  group_id        TEXT PRIMARY KEY REFERENCES mother_groups(id) ON DELETE CASCADE,
  group_type      TEXT NOT NULL DEFAULT 'mother',
  target_revision INTEGER NOT NULL DEFAULT 0,
  resource_epoch  INTEGER NOT NULL DEFAULT 0,
  target_json     TEXT NOT NULL DEFAULT '',
  updated_at      INTEGER NOT NULL
);

-- 种公摘要：按游戏账号保存已覆盖 / 可迭代槽位；目标修订不同的摘要视为不可比
CREATE TABLE IF NOT EXISTS collection_group_stud_accounts (
  group_id           TEXT NOT NULL,
  game_account_key   TEXT NOT NULL,
  member_account_id  TEXT NOT NULL,
  account_name       TEXT NOT NULL,
  source_exported_at TEXT NOT NULL,
  target_revision    INTEGER NOT NULL,
  slots_json         TEXT NOT NULL,
  PRIMARY KEY (group_id, game_account_key),
  FOREIGN KEY (group_id, member_account_id)
    REFERENCES mother_group_members (group_id, account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collection_group_stud_member
  ON collection_group_stud_accounts (group_id, member_account_id);

-- 认领任务：同一目标修订下每个目标键只有一个未关闭轮次；owner 退出时置空保留历史
CREATE TABLE IF NOT EXISTS collection_group_tasks (
  group_id          TEXT NOT NULL,
  target_revision   INTEGER NOT NULL,
  target_key        TEXT NOT NULL,
  round             INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL,
  owner_account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  version           INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  closed_at         INTEGER,
  PRIMARY KEY (group_id, target_revision, target_key, round),
  FOREIGN KEY (group_id) REFERENCES mother_groups (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collection_group_tasks_owner
  ON collection_group_tasks (group_id, owner_account_id);
