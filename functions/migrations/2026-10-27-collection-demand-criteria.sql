-- 增量迁移：需求单增加性别 / 体型 / 声音（2026-10-27）
--
-- 目标：一条需求 = 蛋 + 性格 + 性别 + 体型 + 声音。
-- 旧需求统一迁移为「母 / 大块头 / +100」，与用户已确认的口径一致。
--
-- 旧表主键只有 (group, demander, egg, nature)，无法并存同蛋同性格的母/公两条，
-- 因此重建表，并把主键扩到五个字段。**本文件只执行一次。**
--
-- 应用：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-10-27-collection-demand-criteria.sql
-- 本地：
--   npx wrangler d1 execute roco-toolbox-db --local --persist-to <目录> --file functions/migrations/2026-10-27-collection-demand-criteria.sql

CREATE TABLE collection_group_demands_v2 (
  group_id            TEXT NOT NULL,
  demander_account_id TEXT NOT NULL,
  egg_game_id         INTEGER NOT NULL,
  nature              TEXT NOT NULL DEFAULT '',
  gender              TEXT NOT NULL DEFAULT '母',
  body                TEXT NOT NULL DEFAULT '大块头',
  voice               TEXT NOT NULL DEFAULT '+100',
  status              TEXT NOT NULL DEFAULT 'open',
  claimer_account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  version             INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY (group_id, demander_account_id, egg_game_id, nature, gender, body, voice),
  FOREIGN KEY (group_id, demander_account_id)
    REFERENCES mother_group_members (group_id, account_id) ON DELETE CASCADE
);

INSERT INTO collection_group_demands_v2
  (group_id, demander_account_id, egg_game_id, nature, gender, body, voice,
   status, claimer_account_id, version, created_at, updated_at)
SELECT group_id, demander_account_id, egg_game_id, nature, '母', '大块头', '+100',
       status, claimer_account_id, version, created_at, updated_at
  FROM collection_group_demands;

DROP TABLE collection_group_demands;
ALTER TABLE collection_group_demands_v2 RENAME TO collection_group_demands;

CREATE INDEX IF NOT EXISTS idx_collection_group_demands_claimer
  ON collection_group_demands (group_id, claimer_account_id);
