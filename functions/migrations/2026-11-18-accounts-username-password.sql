-- 账号改为「用户名 + 密码」登录（2026-11-18）。
--
-- 只执行一次：SQLite 的 ADD COLUMN 没有 IF NOT EXISTS，重复执行会报 duplicate column。
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/migrations/2026-11-18-accounts-username-password.sql
--
-- 老账号这三列保持 NULL，仍可凭令牌继续使用；在应用里设置用户名密码后即完成迁移。
-- recovery_hash 保留不动（老账号的恢复码仍可用于找回，新账号写随机占位）。

ALTER TABLE accounts ADD COLUMN username TEXT;
ALTER TABLE accounts ADD COLUMN username_lower TEXT;
ALTER TABLE accounts ADD COLUMN password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username_lower
  ON accounts (username_lower) WHERE username_lower IS NOT NULL;
