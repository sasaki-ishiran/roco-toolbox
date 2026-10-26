-- 增量迁移：需求承接（2026-10-26）
--
-- 只新增一张表与一个索引，不重建、不删除、不修改任何旧表。可重复执行。
-- 与 functions/schema.sql 的 `>>> collection-demands (2026-10-26)` 区块定义必须逐字一致
-- （tools/test/verify-mother-groups-schema.mjs 会逐列比较）。
--
-- 应用（在仓库根执行）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-10-26-collection-demands.sql
-- 本地：
--   npx wrangler d1 execute roco-toolbox-db --local --persist-to <目录> --file functions/migrations/2026-10-26-collection-demands.sql

-- 成员需求：一颗蛋 + 一个性格算一条；nature 为空串表示不挑性格，撤回即删除
CREATE TABLE IF NOT EXISTS collection_group_demands (
  group_id            TEXT NOT NULL,
  demander_account_id TEXT NOT NULL,
  egg_game_id         INTEGER NOT NULL,
  nature              TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'open',
  claimer_account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  version             INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY (group_id, demander_account_id, egg_game_id, nature),
  FOREIGN KEY (group_id, demander_account_id)
    REFERENCES mother_group_members (group_id, account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collection_group_demands_claimer
  ON collection_group_demands (group_id, claimer_account_id);
