import { observeNewEggs, parsePatrolScene, patrolWindowOpen, type PatrolScene } from '../../src/shared/eggPatrol';
import { activePatrolTasks, patrolTaskKey } from './eggPatrolStore';
import { type Env, newToken } from './util';
import catalog from '../../src/data/catalog.gen.json';

const INTERVAL = 1800000;
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

export async function runEggPatrol(env: Env, now: number, fetcher: typeof fetch = fetch): Promise<{ queried: number; queued: number }> {
  const count = { queried: 0, queued: 0 };
  if (!patrolWindowOpen(now) || !env.ROCOM_PATROL_API_KEY) return count;
  const tasks = await activePatrolTasks(env.DB);
  const uids = [...new Set(tasks.map(task => task.uid))];
  for (const uid of uids) await env.DB.prepare('INSERT INTO egg_patrol_cache(uid) VALUES(?) ON CONFLICT(uid) DO NOTHING').bind(uid).run();
  const due = await env.DB.prepare('SELECT * FROM egg_patrol_cache WHERE next_at<=? AND lease_until<=? ORDER BY next_at,uid').bind(now, now).all<CacheRow>();
  const day = new Date(now + 28800000).toISOString().slice(0, 10);
  for (const cache of due.results.filter(row => uids.includes(row.uid)).slice(0, 3)) {
    const lease = newToken();
    const taken = await env.DB.prepare('UPDATE egg_patrol_cache SET lease_token=?,lease_until=? WHERE uid=? AND next_at<=? AND lease_until<=?')
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
      const response = await fetcher(url, { headers: { 'X-API-Key': env.ROCOM_PATROL_API_KEY }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error('UPSTREAM');
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
      const oldScene = cache.scene_json ? JSON.parse(cache.scene_json) as PatrolScene : null;
      const existingKeys = new Set(JSON.parse(cache.task_keys_json) as string[]);
      const continuing = latestTasks.filter(task => existingKeys.has(patrolTaskKey(task)));
      const observations = observeNewEggs(oldScene?.eggs.map(egg => egg.actorId) ?? null, scene, continuing);
      const statements: D1PreparedStatement[] = [];
      const notificationIndexes: number[] = [];
      for (const observation of observations) {
        const task = latestTasks.find(value => patrolTaskKey(value) === patrolTaskKey(observation.task))!;
        const key = patrolTaskKey(task);
        statements.push(env.DB.prepare(`INSERT INTO egg_patrol_observations(uid,actor_id,task_key,group_id,trade_id,side,status,observed_at)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM egg_patrol_cache WHERE uid=? AND lease_token=?) ON CONFLICT DO NOTHING`)
          .bind(cache.uid, observation.actorId, key, task.groupId, task.tradeId, task.side, observation.status, now, cache.uid, lease));
        if (observation.status !== 'produced') continue;
        const id = JSON.stringify([task.groupId, task.tradeId, task.side, cache.uid, observation.actorId]);
        const payload = { groupId: task.groupId, tradeId: task.tradeId, side: task.side, uid: cache.uid, taskKey: key,
          actorId: observation.actorId, eggName: catalog.species.find(species => species.gameId === task.eggGameId)?.name ?? '任务精灵',
          recipientName: task.recipientName, producerAccountId: task.producerAccountId };
        notificationIndexes.push(statements.length);
        statements.push(env.DB.prepare(`INSERT INTO egg_patrol_notifications(id,group_id,binding_version,trade_id,side,uid,actor_id,payload_json,next_at,created_at)
          SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM egg_patrol_observations WHERE uid=? AND actor_id=? AND task_key=? AND status='produced')
          AND EXISTS(SELECT 1 FROM egg_bot_bindings WHERE group_id=? AND binding_version=? AND enabled=1) ON CONFLICT DO NOTHING`)
          .bind(id, task.groupId, task.bindingVersion, task.tradeId, task.side, cache.uid, observation.actorId, JSON.stringify(payload), now, now,
            cache.uid, observation.actorId, key, task.groupId, task.bindingVersion));
      }
      statements.push(env.DB.prepare(`UPDATE egg_patrol_cache SET scene_json=?,task_keys_json=?,success_at=?,next_at=?,lease_until=0,pending_task_id=NULL,status='ok'
        WHERE uid=? AND lease_token=?`).bind(JSON.stringify(scene), JSON.stringify(latestTasks.map(patrolTaskKey)), now, now + INTERVAL, cache.uid, lease));
      const results = await env.DB.batch(statements);
      count.queued += notificationIndexes.reduce((sum, index) => sum + results[index].meta.changes, 0);
    } catch {
      await env.DB.prepare("UPDATE egg_patrol_cache SET next_at=?,lease_until=0,pending_task_id=NULL,status='error' WHERE uid=? AND lease_token=?")
        .bind(now + INTERVAL, cache.uid, lease).run();
    }
  }
  return count;
}
