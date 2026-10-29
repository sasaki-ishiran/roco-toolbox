-- 已完成需求归档（2026-10-29，代码审查 B3-H01 / B3-U02）
--
-- 背景：需求行原来挂在 (group_id, demander_account_id) → mother_group_members 的外键上，
-- 且是 ON DELETE CASCADE。需求方退出 / 被移除 / 注销账号时，他「已完成」的需求行被级联删掉，
-- 承接人的「已结单」计数会倒退，与产品交互规范「已完成保留」冲突。
--
-- 做法：新增归档表，与成员行解耦；需求表只保留 open / claimed。
-- 完成时把整行搬到归档表，因此同一颗蛋结单后可以再次发布。
-- 归档行不引用 accounts / mother_group_members，成员或账号删除都不会影响历史计数。
--
-- 可重复执行：建表用 IF NOT EXISTS；搬移只处理仍留在需求表里的 done 行，
-- 搬完之后再跑不会重复插入。
-- 执行（在仓库根）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-10-29-collection-demand-completions.sql
--
-- 注意：先执行本迁移，再部署读写归档表的 Functions；旧 Functions 仍能读需求表（只剩未完成的单）。

CREATE TABLE IF NOT EXISTS collection_group_demand_completions (
  group_id            TEXT NOT NULL,
  demander_account_id TEXT NOT NULL,
  claimer_account_id  TEXT NOT NULL,
  egg_game_id         INTEGER NOT NULL,
  nature              TEXT NOT NULL DEFAULT '',
  gender              TEXT NOT NULL DEFAULT '母',
  body                TEXT NOT NULL DEFAULT '大块头',
  voice               TEXT NOT NULL DEFAULT '+100',
  created_at          INTEGER NOT NULL,
  completed_at        INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES mother_groups (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collection_group_demand_completions_claimer
  ON collection_group_demand_completions (group_id, claimer_account_id);

CREATE INDEX IF NOT EXISTS idx_collection_group_demand_completions_demand
  ON collection_group_demand_completions
    (group_id, demander_account_id, egg_game_id, nature, gender, body, voice);

INSERT INTO collection_group_demand_completions
  (group_id, demander_account_id, claimer_account_id, egg_game_id, nature,
   gender, body, voice, created_at, completed_at)
SELECT
  group_id, demander_account_id, claimer_account_id, egg_game_id, nature,
  gender, body, voice, created_at, updated_at
FROM collection_group_demands
WHERE status = 'done' AND claimer_account_id IS NOT NULL;

-- 承接人已注销（claimer 为 NULL）的 done 行本来就不计入任何人的已结单，直接清掉。
DELETE FROM collection_group_demands WHERE status = 'done';
