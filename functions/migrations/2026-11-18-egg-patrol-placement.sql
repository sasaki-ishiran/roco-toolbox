-- 巡查新增「已上窝」观察状态（2026-11-18）。
-- 只更新任务状态，不产生群提醒；现蛋换现蛋不进入巡查。
-- SQLite 无法直接修改 CHECK，按官方建议重建表并搬数据。

CREATE TABLE IF NOT EXISTS egg_patrol_observations_new (
  uid TEXT NOT NULL, actor_id TEXT NOT NULL, task_key TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES mother_groups(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL, side TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('placed','produced','ambiguous')),
  observed_at INTEGER NOT NULL, PRIMARY KEY(uid,actor_id,task_key)
);

INSERT OR REPLACE INTO egg_patrol_observations_new(uid,actor_id,task_key,group_id,trade_id,side,status,observed_at)
  SELECT uid,actor_id,task_key,group_id,trade_id,side,status,observed_at FROM egg_patrol_observations;

DROP TABLE egg_patrol_observations;
ALTER TABLE egg_patrol_observations_new RENAME TO egg_patrol_observations;
CREATE UNIQUE INDEX IF NOT EXISTS egg_patrol_one_egg ON egg_patrol_observations(uid,actor_id) WHERE status='produced';
