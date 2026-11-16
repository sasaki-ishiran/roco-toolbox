-- 2026-11-08：需求新增「已上窝」时间戳（整合重构第一批 C1）。
--
-- 背景：认领人把学院精灵放进家园后，发布人原来只能在本地标记「已上窝」，
-- 换一台设备就看不到，需求被认领后从发布人视野里漂走。
-- 现在把标记同步到服务端：placed_at 非空 = 已上窝，发布人据此看到「待我确认」。
--
-- 只加列、不动主键与状态：status 仍是 open / claimed，完成时整行照旧搬进归档表。
-- ADD COLUMN 不支持 IF NOT EXISTS，**只能执行一次**（门禁脚本里标 repeat: 1）。
-- 执行（在仓库根）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-11-08-collection-demand-placed-at.sql
--
-- 与 functions/schema.sql 的 `>>> collection-demands (2026-10-26)` 区块保持一致。

ALTER TABLE collection_group_demands
  ADD COLUMN placed_at INTEGER;

-- 上窝用的游戏账号（uid:<gameId>）：多账号时发布人要知道是谁放的。
-- 只做标识，别人的视图里不展示完整账号名。
ALTER TABLE collection_group_demands
  ADD COLUMN placed_by_account_key TEXT;
