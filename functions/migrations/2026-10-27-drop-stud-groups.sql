-- 数据迁移：删除旧种公组（2026-10-27）
--
-- 背景：小组只剩一种「收集小组」，不再区分母本组 / 种公组（用户决策 F：不留旧种公组）。
-- 新版本不再允许创建种公组，服务端也会拒绝 groupType = 'stud'；
-- 这里把历史种公组及其成员 / 共享账号 / 种公摘要 / 认领任务 / 需求一并删除。
--
-- 安全措施：先把要删的数据整表复制到 `backup_20261027_stud_*`，
-- 确认线上没问题后再手动 DROP 这些备份表；删除只按备份表里的组 ID 走，
-- 母本组与个人求蛋完全不受影响。
--
-- 建议先额外导出一份离线备份（可选）：
--   npx wrangler d1 export roco-toolbox-db --remote --output backup-20261027.sql
--
-- 执行（在仓库根）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-10-27-drop-stud-groups.sql
--
-- 前置：需先执行 2026-10-26 与 2026-10-27 的需求迁移（本文件会备份需求表）。
-- 本文件可重复执行：备份表用 IF NOT EXISTS，删除按备份表 ID，第二次不会误删新组。

/* ---------- 1. 备份 ---------- */

CREATE TABLE IF NOT EXISTS backup_20261027_stud_groups AS
SELECT g.*
  FROM mother_groups g
  JOIN collection_group_configs c ON c.group_id = g.id
 WHERE c.group_type = 'stud';

CREATE TABLE IF NOT EXISTS backup_20261027_stud_group_configs AS
SELECT c.*
  FROM collection_group_configs c
  JOIN backup_20261027_stud_groups b ON b.id = c.group_id;

CREATE TABLE IF NOT EXISTS backup_20261027_stud_group_members AS
SELECT m.*
  FROM mother_group_members m
  JOIN backup_20261027_stud_groups b ON b.id = m.group_id;

CREATE TABLE IF NOT EXISTS backup_20261027_stud_group_accounts AS
SELECT a.*
  FROM mother_group_accounts a
  JOIN backup_20261027_stud_groups b ON b.id = a.group_id;

CREATE TABLE IF NOT EXISTS backup_20261027_stud_group_stud_accounts AS
SELECT s.*
  FROM collection_group_stud_accounts s
  JOIN backup_20261027_stud_groups b ON b.id = s.group_id;

CREATE TABLE IF NOT EXISTS backup_20261027_stud_group_tasks AS
SELECT t.*
  FROM collection_group_tasks t
  JOIN backup_20261027_stud_groups b ON b.id = t.group_id;

CREATE TABLE IF NOT EXISTS backup_20261027_stud_group_demands AS
SELECT d.*
  FROM collection_group_demands d
  JOIN backup_20261027_stud_groups b ON b.id = d.group_id;

/* ---------- 2. 删除 ----------
 * 逐表删除而不是只删 mother_groups：即使 D1 把外键检查关掉，也不会留下孤儿行。
 * 顺序从子表到父表，最后删组本身。
 */

DELETE FROM collection_group_demands
 WHERE group_id IN (SELECT id FROM backup_20261027_stud_groups);

DELETE FROM collection_group_tasks
 WHERE group_id IN (SELECT id FROM backup_20261027_stud_groups);

DELETE FROM collection_group_stud_accounts
 WHERE group_id IN (SELECT id FROM backup_20261027_stud_groups);

DELETE FROM mother_group_accounts
 WHERE group_id IN (SELECT id FROM backup_20261027_stud_groups);

DELETE FROM collection_group_configs
 WHERE group_id IN (SELECT id FROM backup_20261027_stud_groups);

DELETE FROM mother_group_members
 WHERE group_id IN (SELECT id FROM backup_20261027_stud_groups);

DELETE FROM mother_groups
 WHERE id IN (SELECT id FROM backup_20261027_stud_groups);
