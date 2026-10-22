-- 增量迁移：多人母本资源共享（2026-10-23）
--
-- 只新增三张表与两个索引，不重建、不删除任何旧表。可重复执行。
-- 与 functions/schema.sql 的 `>>> mother-groups` 区块定义必须逐字一致
-- （tools/test/verify-mother-groups-schema.mjs 会逐列比较）。
--
-- 应用（在仓库根执行；**先确认 accounts 表已存在**，SQLite 不会替我们拦这个错）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-10-23-mother-groups.sql
-- 本地：
--   npx wrangler d1 execute roco-toolbox-db --local --persist-to <目录> --file functions/migrations/2026-10-23-mother-groups.sql

-- 小组：组主负责重置邀请码和解散；邀请码只存 SHA-256，明文只在创建/重置时返回一次
CREATE TABLE IF NOT EXISTS mother_groups (
  id               TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  invite_hash      TEXT NOT NULL UNIQUE,
  created_at       INTEGER NOT NULL
);

-- 组成员：资源版本留在成员行；write_token 由服务端每次写入生成，永不接受客户端传值
CREATE TABLE IF NOT EXISTS mother_group_members (
  group_id          TEXT NOT NULL REFERENCES mother_groups(id) ON DELETE CASCADE,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name      TEXT NOT NULL,
  joined_at         INTEGER NOT NULL,
  resource_revision INTEGER NOT NULL DEFAULT 0,
  published_at      INTEGER,
  catalog_version   TEXT,
  criteria_id       TEXT,
  write_token       TEXT,
  PRIMARY KEY (group_id, account_id)
);
-- 跨设备发现「我加入的组」
CREATE INDEX IF NOT EXISTS idx_mother_group_members_account
  ON mother_group_members (account_id, group_id);

-- 成员共享的游戏账号：同一游戏 UID 在一个组内只归一位成员
CREATE TABLE IF NOT EXISTS mother_group_accounts (
  group_id          TEXT NOT NULL,
  game_account_key  TEXT NOT NULL,
  member_account_id TEXT NOT NULL,
  account_name      TEXT NOT NULL,
  source_exported_at TEXT NOT NULL,
  egg_game_ids      TEXT NOT NULL,
  PRIMARY KEY (group_id, game_account_key),
  FOREIGN KEY (group_id, member_account_id)
    REFERENCES mother_group_members (group_id, account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mother_group_accounts_member
  ON mother_group_accounts (group_id, member_account_id);
