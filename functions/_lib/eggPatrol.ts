import { observeSceneEggs, observeScenePlacements, parsePatrolScene, patrolWindowOpen, type PatrolSpeciesIndex } from '../../src/shared/eggPatrol';
import { activePatrolTasks, patrolTaskKey } from './eggPatrolStore';
import { type Env, newToken } from './util';
import { species as catalogSpecies } from '../../src/data/catalog';
import catalog from '../../src/data/catalog.gen.json';

/** 巡查判定用的图鉴索引：物种→蛋、物种→体型阈值、性格 id→名字（模块级构建一次）。 */
const patrolIndex: PatrolSpeciesIndex = {
  eggGameIdByGameId: new Map(
    catalogSpecies.flatMap(entry => entry.eggGameId != null && entry.eggGameId > 0
      ? [[entry.gameId, entry.eggGameId] as [number, number]] : []),
  ),
  bodySizeByGameId: new Map(
    catalogSpecies.flatMap(entry => entry.bodySize
      ? [[entry.gameId, entry.bodySize] as [number, { small: number; big: number }]] : []),
  ),
  natureNameById: new Map(catalog.natures.map(nature => [nature.id, nature.name])),
};

const INTERVAL = 1800000;
const REMIND_INTERVAL = 7200000;
const REMIND_DAILY_MAX = 4;
const ENDPOINT = 'https://wegame.shallow.ink/api/v1/games/rocom/ingame/';
interface CacheRow { uid: string; next_at: number; scene_json: string | null; task_keys_json: string; pending_task_id: string | null; lease_token: string }

function pendingTask(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || !('data' in raw)) return null;
  const data = raw.data;
  if (!data || typeof data !== 'object' || !('task_id' in data)) return null;
  return typeof data.task_id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.task_id) ? data.task_id : null;
}
function queued(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || !('data' in raw) || !raw.data || typeof raw.data !== 'object') return false;
  return 'status' in raw.data && ['running', 'queued'].includes(String(raw.data.status));
}
function sceneResult(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('data' in raw) || !raw.data || typeof raw.data !== 'object') return raw;
  const data = raw.data;
  if ('result' in data && data.result && typeof data.result === 'object') {
    if ('code' in data.result) return data.result;
    return { code: 0, data: data.result };
  }
  return raw;
}

export async function runEggPatrol(env: Env, now: number, fetcher: typeof fetch = fetch, force = false): Promise<{ queried: number; queued: number; error?: string }> {
  const count: { queried: number; queued: number; error?: string } = { queried: 0, queued: 0 };
  // force 只给内测强刷用：跳过夜间窗口与 30 分钟缓存，但配额、租约、去重照旧
  if ((!force && !patrolWindowOpen(now)) || !env.ROCOM_PATROL_API_KEY) return count;
  const tasks = await activePatrolTasks(env.DB);
  const uids = [...new Set(tasks.map(task => task.uid))];
  for (const uid of uids) await env.DB.prepare('INSERT INTO egg_patrol_cache(uid) VALUES(?) ON CONFLICT(uid) DO NOTHING').bind(uid).run();
  const due = force
    ? await env.DB.prepare('SELECT * FROM egg_patrol_cache WHERE lease_until<=? ORDER BY next_at,uid').bind(now).all<CacheRow>()
    : await env.DB.prepare('SELECT * FROM egg_patrol_cache WHERE next_at<=? AND lease_until<=? ORDER BY next_at,uid').bind(now, now).all<CacheRow>();
  const day = new Date(now + 28800000).toISOString().slice(0, 10);
  for (const cache of due.results.filter(row => uids.includes(row.uid)).slice(0, 3)) {
    const lease = newToken();
    const taken = force
      ? await env.DB.prepare('UPDATE egg_patrol_cache SET lease_token=?,lease_until=? WHERE uid=? AND lease_until<=?')
        .bind(lease, now + 60000, cache.uid, now).run()
      : await env.DB.prepare('UPDATE egg_patrol_cache SET lease_token=?,lease_until=? WHERE uid=? AND next_at<=? AND lease_until<=?')
        .bind(lease, now + 60000, cache.uid, now, now).run();
    if (!taken.meta.changes) continue;
    const quota = await env.DB.prepare(`INSERT INTO egg_patrol_quota(day,used) VALUES(?,1)
      ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<100`).bind(day).run();
    if (!quota.meta.changes) {
      await env.DB.prepare("UPDATE egg_patrol_cache SET lease_until=0,status='quota' WHERE uid=? AND lease_token=?").bind(cache.uid, lease).run();
      continue;
    }
    count.queried++;
    try {
      const url = cache.pending_task_id ? ENDPOINT + 'tasks/' + encodeURIComponent(cache.pending_task_id)
        : ENDPOINT + 'home/scene-info?uid=' + encodeURIComponent(cache.uid) + '&wait_ms=0';
      // Workers 运行时只接受 follow / manual（redirect:'error' 会直接抛错）
      const response = await fetcher(url, { headers: { 'X-API-Key': env.ROCOM_PATROL_API_KEY }, signal: AbortSignal.timeout(10000), redirect: 'manual' });
      if (!response.ok) throw new Error('UPSTREAM_' + response.status);
      const raw: unknown = await response.json();
      if (response.status === 202 || queued(raw)) {
        const taskId = pendingTask(raw) ?? cache.pending_task_id;
        if (!taskId) throw new Error('INVALID_TASK');
        await env.DB.prepare("UPDATE egg_patrol_cache SET pending_task_id=?,next_at=?,lease_until=0,status='queued' WHERE uid=? AND lease_token=?")
          .bind(taskId, now + 60000, cache.uid, lease).run();
        continue;
      }
      const scene = parsePatrolScene(sceneResult(raw), now);
      const latestTasks = (await activePatrolTasks(env.DB)).filter(task => task.uid === cache.uid);
      // 不再按「与上次基线的差集」判定：每轮都看当前还在地上的蛋，收走即停，也不需要重置命令
      const observations = observeSceneEggs(scene, latestTasks, patrolIndex);
      const reminded = new Map((await env.DB.prepare('SELECT actor_id,task_key,day,sent_today,last_sent_at FROM egg_patrol_reminders WHERE uid=?')
        .bind(cache.uid).all<{ actor_id: string; task_key: string; day: string; sent_today: number; last_sent_at: number }>()).results
        .map(row => [row.actor_id + '\n' + row.task_key, row]));
      const statements: D1PreparedStatement[] = [];
      const notificationIndexes: number[] = [];
      // 已上窝只更新任务状态，不产生群提醒；已经产出的同一任务不再回写「上窝」
      const producedKeys = new Set(observations.map(observation => patrolTaskKey(observation.task)));
      for (const task of observeScenePlacements(scene, latestTasks, patrolIndex)) {
        const key = patrolTaskKey(task);
        if (producedKeys.has(key)) continue;
        statements.push(env.DB.prepare(`INSERT INTO egg_patrol_observations(uid,actor_id,task_key,group_id,trade_id,side,status,observed_at)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM egg_patrol_cache WHERE uid=? AND lease_token=?)
          ON CONFLICT(uid,actor_id,task_key) DO UPDATE SET status=excluded.status,observed_at=excluded.observed_at`)
          .bind(cache.uid, '', key, task.groupId, task.tradeId, task.side, 'placed', now, cache.uid, lease));
      }
      for (const observation of observations) {
        const task = latestTasks.find(value => patrolTaskKey(value) === patrolTaskKey(observation.task))!;
        const key = patrolTaskKey(task);
        // 同一颗蛋只允许绑定一笔任务：任务重建（ID 变了）时先让位，避免唯一索引冲突
        if (observation.status === 'produced') {
          statements.push(env.DB.prepare(`DELETE FROM egg_patrol_observations WHERE uid=? AND actor_id=? AND status='produced' AND task_key<>?`)
            .bind(cache.uid, observation.actorId, key));
        }
        statements.push(env.DB.prepare(`INSERT INTO egg_patrol_observations(uid,actor_id,task_key,group_id,trade_id,side,status,observed_at)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM egg_patrol_cache WHERE uid=? AND lease_token=?)
          ON CONFLICT(uid,actor_id,task_key) DO UPDATE SET status=excluded.status,observed_at=excluded.observed_at`)
          .bind(cache.uid, observation.actorId, key, task.groupId, task.tradeId, task.side, observation.status, now, cache.uid, lease));
        if (observation.status !== 'produced') continue;
        // 同一颗蛋 2 小时内只提醒一次、当天最多 4 次；超过 2 小时且未满 4 次继续提醒
        const previous = reminded.get(observation.actorId + '\n' + key);
        const sentToday = previous?.day === day ? previous.sent_today : 0;
        if (previous && now - previous.last_sent_at < REMIND_INTERVAL) continue;
        if (sentToday >= REMIND_DAILY_MAX) continue;
        const id = JSON.stringify([task.groupId, task.tradeId, task.side, cache.uid, observation.actorId, day, sentToday + 1]);
        const payload = { groupId: task.groupId, tradeId: task.tradeId, side: task.side, uid: cache.uid, taskKey: key,
          actorId: observation.actorId, eggName: catalog.species.find(species => species.gameId === task.eggGameId)?.name ?? '任务精灵',
          recipientName: task.recipientName, producerAccountId: task.producerAccountId };
        notificationIndexes.push(statements.length);
        statements.push(env.DB.prepare(`INSERT INTO egg_patrol_notifications(id,group_id,binding_version,trade_id,side,uid,actor_id,payload_json,next_at,created_at)
          SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM egg_patrol_observations WHERE uid=? AND actor_id=? AND task_key=? AND status='produced')
          AND EXISTS(SELECT 1 FROM egg_bot_bindings WHERE group_id=? AND binding_version=? AND enabled=1) ON CONFLICT(id) DO NOTHING`)
          .bind(id, task.groupId, task.bindingVersion, task.tradeId, task.side, cache.uid, observation.actorId, JSON.stringify(payload), now, now,
            cache.uid, observation.actorId, key, task.groupId, task.bindingVersion));
        statements.push(env.DB.prepare(`INSERT INTO egg_patrol_reminders(uid,actor_id,task_key,day,sent_today,last_sent_at)
          SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM egg_patrol_notifications WHERE id=?)
          ON CONFLICT(uid,actor_id,task_key) DO UPDATE SET
            sent_today=CASE WHEN egg_patrol_reminders.day=excluded.day THEN egg_patrol_reminders.sent_today+1 ELSE 1 END,
            day=excluded.day,last_sent_at=excluded.last_sent_at`)
          .bind(cache.uid, observation.actorId, key, day, 1, now, id));
      }
      // 蛋已经收走的排队提醒直接作废，避免收完还收到一条旧消息（手动催办不受影响）
      const present = scene.eggs.map(egg => egg.actorId);
      statements.push(present.length
        ? env.DB.prepare(`DELETE FROM egg_patrol_notifications WHERE uid=? AND side IN ('give','return') AND status='pending'
          AND actor_id NOT IN (${present.map(() => '?').join(',')})`).bind(cache.uid, ...present)
        : env.DB.prepare("DELETE FROM egg_patrol_notifications WHERE uid=? AND side IN ('give','return') AND status='pending'").bind(cache.uid));
      statements.push(env.DB.prepare(`UPDATE egg_patrol_cache SET scene_json=?,task_keys_json=?,success_at=?,next_at=?,lease_until=0,pending_task_id=NULL,status='ok'
        WHERE uid=? AND lease_token=?`).bind(JSON.stringify(scene), JSON.stringify(latestTasks.map(patrolTaskKey)), now, now + INTERVAL, cache.uid, lease));
      const results = await env.DB.batch(statements);
      count.queued += notificationIndexes.reduce((sum, index) => sum + results[index].meta.changes, 0);
    } catch (error) {
      // 强刷时把失败原因带回响应，方便内测排查（正式 tick 不返回，避免泄露上游细节）
      if (force) count.error = error instanceof Error ? error.message : 'UPSTREAM';
      await env.DB.prepare("UPDATE egg_patrol_cache SET next_at=?,lease_until=0,pending_task_id=NULL,status='error' WHERE uid=? AND lease_token=?")
        .bind(now + INTERVAL, cache.uid, lease).run();
    }
  }
  return count;
}
