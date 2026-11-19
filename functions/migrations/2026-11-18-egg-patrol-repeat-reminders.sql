-- 家园巡查提醒改为「蛋还在地上就重复提醒」：
--   同一颗蛋 2 小时内不重复 @，当天最多 4 次，蛋收走即停。
-- 旧实现用 egg_patrol_one_egg 与 UNIQUE(group_id,trade_id,side,uid,actor_id) 保证一颗蛋只提醒一次，
-- 这里去掉这两个约束，让同一颗蛋可以按「天 + 序号」产生多条提醒；已有通知原样保留。
-- 只在旧库执行一次；新库直接跑 functions/schema.sql，已包含同样的表结构。

DROP INDEX IF EXISTS egg_patrol_one_egg;

CREATE TABLE IF NOT EXISTS egg_patrol_reminders (
  uid TEXT NOT NULL, actor_id TEXT NOT NULL, task_key TEXT NOT NULL,
  day TEXT NOT NULL, sent_today INTEGER NOT NULL DEFAULT 0, last_sent_at INTEGER NOT NULL,
  PRIMARY KEY(uid,actor_id,task_key)
);

DROP TABLE IF EXISTS egg_patrol_notifications_repeat;
CREATE TABLE egg_patrol_notifications_repeat (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES mother_groups(id) ON DELETE CASCADE,
  binding_version TEXT NOT NULL, trade_id TEXT NOT NULL, side TEXT NOT NULL,
  uid TEXT NOT NULL, actor_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, sent_at INTEGER, error_code TEXT
);
INSERT INTO egg_patrol_notifications_repeat
  SELECT id,group_id,binding_version,trade_id,side,uid,actor_id,payload_json,status,attempts,next_at,lease_token,lease_until,created_at,sent_at,error_code
  FROM egg_patrol_notifications;
DROP TABLE egg_patrol_notifications;
ALTER TABLE egg_patrol_notifications_repeat RENAME TO egg_patrol_notifications;
CREATE INDEX IF NOT EXISTS egg_patrol_notification_due ON egg_patrol_notifications(status,next_at,lease_until);
