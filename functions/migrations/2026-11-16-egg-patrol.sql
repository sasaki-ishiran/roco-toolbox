-- Additive patrol state; historical exchange and legacy records are untouched.
CREATE TABLE IF NOT EXISTS egg_bot_codes (
  group_id TEXT PRIMARY KEY REFERENCES mother_groups(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, consumed_at INTEGER,
  owner_account_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS egg_bot_bindings (
  group_id TEXT PRIMARY KEY REFERENCES mother_groups(id) ON DELETE CASCADE,
  qq_group_id TEXT NOT NULL, bot_id TEXT NOT NULL, binding_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS egg_patrol_cache (
  uid TEXT PRIMARY KEY, next_at INTEGER NOT NULL DEFAULT 0, success_at INTEGER,
  lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
  scene_json TEXT, task_keys_json TEXT NOT NULL DEFAULT '[]',
  pending_task_id TEXT, status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS egg_patrol_quota (
  day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0 AND used<=100)
);
CREATE TABLE IF NOT EXISTS egg_patrol_observations (
  uid TEXT NOT NULL, actor_id TEXT NOT NULL, task_key TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES mother_groups(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL, side TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('produced','ambiguous')),
  observed_at INTEGER NOT NULL, PRIMARY KEY(uid,actor_id,task_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS egg_patrol_one_egg ON egg_patrol_observations(uid,actor_id) WHERE status='produced';
CREATE TABLE IF NOT EXISTS egg_patrol_notifications (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES mother_groups(id) ON DELETE CASCADE,
  binding_version TEXT NOT NULL, trade_id TEXT NOT NULL, side TEXT NOT NULL,
  uid TEXT NOT NULL, actor_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, sent_at INTEGER, error_code TEXT,
  UNIQUE(group_id,trade_id,side,uid,actor_id)
);
CREATE INDEX IF NOT EXISTS egg_patrol_notification_due ON egg_patrol_notifications(status,next_at,lease_until);
