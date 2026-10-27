-- 多人母本共享：增加「同账号产线」字段（2026-10-27）
--
-- 背景：小组共享从「达标母本的蛋」升级为「产线」——同账号、双方同档位、
-- 能产出的 蛋 × 档位 × 性格。旧摘要 lines_json 为 NULL，读取时按「未知」处理，
-- 页面提示重新发布；成员重新发布后自动补齐。
--
-- SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS，本迁移只执行一次。
-- 执行（在仓库根）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-10-27-mother-production-lines.sql
--
-- 注意：必须先执行本迁移，再部署读取 lines_json 的客户端 / Functions。

ALTER TABLE mother_group_accounts ADD COLUMN lines_json TEXT;
