-- 洛克工具箱后端表结构（Cloudflare Pages Functions + D1）
--
-- 应用（在仓库根执行，库名见根 wrangler.toml 的 [[d1_databases]]）：
--   npx wrangler d1 execute roco-toolbox-db --remote --file functions/schema.sql
-- 本地预览库：把 --remote 换成 --local
--
-- 全部用 IF NOT EXISTS，可重复执行；表已存在时不会改动线上数据。

-- 账号：免密，凭「恢复码」找回；恢复码只存 SHA-256 哈希，明文只在注册/轮换时返回一次
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,      -- crypto.randomUUID()
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  recovery_hash TEXT NOT NULL,         -- sha256(标准化后的恢复码)
  label         TEXT                   -- 用户自填备注，可空
);

-- 会话令牌：明文不落库，只存 SHA-256
CREATE TABLE IF NOT EXISTS tokens (
  token_hash   TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_account ON tokens (account_id);

-- 设备：匿名 deviceId（前端随机生成）→ 用于「设备数 / 同账号几台设备」统计
CREATE TABLE IF NOT EXISTS devices (
  device_id     TEXT PRIMARY KEY,
  account_id    TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_account ON devices (account_id);

-- 云同步快照：一个账号一行，整份全量覆盖
-- account_id 为主键 → PUT 里的 `ON CONFLICT(account_id)` 与条件更新（乐观锁）都依赖它
CREATE TABLE IF NOT EXISTS snapshots (
  account_id TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0,  -- 乐观锁版本号，每次成功写入 +1
  updated_at INTEGER NOT NULL,
  device_id  TEXT,
  payload    TEXT NOT NULL,               -- gzip + base64 的整份快照
  bytes      INTEGER NOT NULL
);

-- 匿名埋点：只记事件名与少量参数，不记精灵内容
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT NOT NULL,
  account_id  TEXT,
  name        TEXT NOT NULL,
  props       TEXT,
  app_version TEXT,
  platform    TEXT,
  client_ts   INTEGER NOT NULL,
  server_ts   INTEGER NOT NULL
);
-- /api/stats 的按天聚合、留存 CTE 都按 server_ts 过滤
CREATE INDEX IF NOT EXISTS idx_events_server_ts ON events (server_ts);
CREATE INDEX IF NOT EXISTS idx_events_device ON events (device_id);
CREATE INDEX IF NOT EXISTS idx_events_name ON events (name);

-- 固定窗口限流计数（见 _lib/util.ts 的 rateLimit）：按 bucket 复用同一行，
-- 行数上限 = 不同 bucket 数（IP / deviceId），不会无限增长
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,   -- 形如 'register:1.2.3.4' / 'event:<deviceId>'
  window_start INTEGER NOT NULL,   -- 当前窗口起点（毫秒）
  count        INTEGER NOT NULL    -- 本窗口内已放行次数
);

-- 两人共享的「互换清单」：分享码即权限（随机 8 位，可重置）
-- payload = JSON 字符串：{ lists, items, mineAccounts, catalogVersion }
CREATE TABLE IF NOT EXISTS shared_lists (
  code       TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  bytes      INTEGER NOT NULL
);

-- >>> mother-groups (2026-10-23)
-- 多人母本资源共享：小组 / 组成员 / 成员共享的游戏账号。
-- 增量文件 functions/migrations/2026-10-23-mother-groups.sql 必须与本区块定义一致
-- （tools/test/verify-mother-groups-schema.mjs 会逐列比较）。

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
-- <<< mother-groups (2026-10-23)
