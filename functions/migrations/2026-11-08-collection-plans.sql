-- 收集计划（2026-11-08，整合重构第一批 C1）
--
-- 背景：小组页从「我缺的 / 需求中心 / 共同寻找」重构为「我的收集 / 组内广场」两层。
-- 新概念「收集计划」是成员在组内的收集心愿：按蛋（物种 / 进化链）粗粒度，
-- 同一成员在同一组同一颗蛋只有一条；状态 backlog（想收）/ active（进行中）/ done（已完成）。
-- 「我能提供」是别人对某条计划的标记 + 自由备注，一位成员对一条计划最多一条。
--
-- 可重复执行：两张表都用 IF NOT EXISTS 建表，重复跑不会改动已有数据。
-- 执行（在仓库根）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-11-08-collection-plans.sql
--
-- 与 functions/schema.sql 的 `>>> collection-plans (2026-11-08)` 区块保持一致
-- （tools/test/verify-mother-groups-schema.mjs 会逐列比较并存档）。

CREATE TABLE IF NOT EXISTS collection_plans (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL,
  member_account_id TEXT NOT NULL,
  egg_game_id       INTEGER NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'backlog',
  version           INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (group_id, member_account_id, egg_game_id),
  FOREIGN KEY (group_id, member_account_id)
    REFERENCES mother_group_members (group_id, account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collection_plans_group_status
  ON collection_plans (group_id, status);
CREATE INDEX IF NOT EXISTS idx_collection_plans_member
  ON collection_plans (group_id, member_account_id);

CREATE TABLE IF NOT EXISTS plan_offers (
  id               TEXT PRIMARY KEY,
  group_id         TEXT NOT NULL,
  plan_id          TEXT NOT NULL REFERENCES collection_plans (id) ON DELETE CASCADE,
  offer_account_id TEXT NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (plan_id, offer_account_id),
  FOREIGN KEY (group_id, offer_account_id)
    REFERENCES mother_group_members (group_id, account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plan_offers_account
  ON plan_offers (group_id, offer_account_id);
