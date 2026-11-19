import { activePatrolTasks, patrolTaskKey, readPatrolStatus, type ActivePatrolTask } from './eggPatrolStore';
import { runEggPatrol } from './eggPatrol';
import { reminderCurrent, type ReminderPayload } from './eggReminders';
import { type Env, json, newToken, newRecoveryCode, sha256Hex, rateLimit } from './util';

type Row = Record<string, unknown>;
const validId = (value: unknown): value is string => typeof value === 'string' && /^\d{5,24}$/.test(value);
async function body(request: Request): Promise<Row | null> {
  const raw = await request.text();
  if (raw.length > 8192) return null;
  try { const value: unknown = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null; } catch { return null; }
}
const invalid = (status: number, error: string, origin: string | null = null) => json({ ok: false, error }, status, origin);

export async function handleEggBotSettings(request: Request, env: Env, origin: string | null,
  accountId: string, groupId: string, now = Date.now()): Promise<Response> {
  const member = await env.DB.prepare('SELECT 1 FROM mother_group_members WHERE group_id=? AND account_id=?').bind(groupId, accountId).first();
  if (!member) return invalid(403, '不是该组成员', origin);
  if (request.method === 'GET') {
    const binding = await env.DB.prepare('SELECT qq_group_id AS qqGroupId,updated_at AS updatedAt FROM egg_bot_bindings WHERE group_id=? AND enabled=1').bind(groupId).first();
    const day = new Date(now + 28800000).toISOString().slice(0, 10);
    const quota = await env.DB.prepare('SELECT used FROM egg_patrol_quota WHERE day=?').bind(day).first<{used:number}>();
    return json({ ok: true, binding, quotaUsed:quota?.used??0,patrol:await readPatrolStatus(env.DB,groupId,accountId,now) }, 200, origin);
  }
  const owner = await env.DB.prepare('SELECT 1 FROM mother_groups WHERE id=? AND owner_account_id=?').bind(groupId, accountId).first();
  if (!owner) return invalid(403, '仅组主可管理机器人接入', origin);
  if (!['POST', 'DELETE'].includes(request.method)) return invalid(405, '不支持的请求', origin);
  if (!(await rateLimit(env, `egg-bot-settings:${accountId}`, 30, 3600000))) return invalid(429, '操作太快，请稍后重试', origin);
  if (request.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('UPDATE egg_bot_bindings SET enabled=0,binding_version=?,updated_at=? WHERE group_id=?').bind(newToken(), now, groupId),
      env.DB.prepare('UPDATE egg_bot_codes SET consumed_at=? WHERE group_id=?').bind(now, groupId),
    ]);
    return json({ ok: true, binding: null }, 200, origin);
  }
  const code = newRecoveryCode();
  const hash = await sha256Hex(code.replace(/-/g, ''));
  await env.DB.prepare(`INSERT INTO egg_bot_codes(group_id,code_hash,expires_at,owner_account_id) VALUES(?,?,?,?)
    ON CONFLICT(group_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,owner_account_id=excluded.owner_account_id,consumed_at=NULL`)
    .bind(groupId, hash, now + 600000, accountId).run();
  return json({ ok: true, code, expiresAt: now + 600000 }, 200, origin);
}

interface NotificationRow { id: string; group_id: string; binding_version: string; trade_id: string; side: string; payload_json: string; attempts: number; lease_token: string; lease_until: number; status: string }
async function currentNotification(db: D1Database, row: NotificationRow, tasks: ActivePatrolTask[]): Promise<boolean> {
  const payload = JSON.parse(row.payload_json) as Row;
  if (payload.kind === 'reminder') return reminderCurrent(db, row.group_id, row.trade_id, payload as unknown as ReminderPayload);
  return tasks.some(task => task.groupId === row.group_id && task.tradeId === row.trade_id && task.side === row.side &&
    task.bindingVersion === row.binding_version && patrolTaskKey(task) === payload.taskKey);
}

export async function handleEggBotBridge(request: Request, env: Env, now = Date.now(), fetcher: typeof fetch = fetch): Promise<Response> {
  const secret = env.EGG_BOT_BRIDGE_TOKEN;
  const provided = request.headers.get('Authorization') ?? '';
  if (!secret || secret.length < 24 || await sha256Hex(provided) !== await sha256Hex(`Bearer ${secret}`)) return invalid(401, '机器人凭据无效');
  if (request.method !== 'POST') return invalid(405, '不支持的请求');
  const action = new URL(request.url).pathname.split('/').at(-1);
  const input = await body(request);
  if (!input) return invalid(400, '参数无效');
  if (action === 'tick') {
    const force = input.force === true || input.force === '1';
    // 强刷只在内测部署生效（正式部署 CF_PAGES_BRANCH=main）
    if (force && env.CF_PAGES_BRANCH !== 'test') return invalid(403, '强制巡查仅内测可用');
    return json({ ok: true, ...await runEggPatrol(env, now, fetcher, force) }, 200, null);
  }
  if (action === 'redeem') {
    if (typeof input.code !== 'string' || input.code.length > 64 || !validId(input.qqGroupId) || !validId(input.botId) || !validId(input.operatorQq)) return invalid(400, '接入参数无效');
    const codeHash = await sha256Hex(input.code.replace(/[-\s]/g, '').toUpperCase());
    const version = newToken();
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT INTO egg_bot_bindings(group_id,qq_group_id,bot_id,binding_version,updated_at)
        SELECT c.group_id,?,?,?,? FROM egg_bot_codes c JOIN mother_groups g ON g.id=c.group_id AND g.owner_account_id=c.owner_account_id
        WHERE c.code_hash=? AND c.consumed_at IS NULL AND c.expires_at>?
        ON CONFLICT(group_id) DO UPDATE SET qq_group_id=excluded.qq_group_id,bot_id=excluded.bot_id,binding_version=excluded.binding_version,enabled=1,updated_at=excluded.updated_at`)
        .bind(input.qqGroupId, input.botId, version, now, codeHash, now),
      env.DB.prepare(`UPDATE egg_bot_codes SET consumed_at=? WHERE code_hash=? AND EXISTS
        (SELECT 1 FROM egg_bot_bindings WHERE group_id=egg_bot_codes.group_id AND binding_version=?)`).bind(now, codeHash, version),
    ]);
    if (!result[0].meta.changes) return invalid(409, '接入码已失效，请组主重新生成');
    const row = await env.DB.prepare(`SELECT b.group_id AS groupId,g.name AS groupName,b.qq_group_id AS qqGroupId,b.binding_version AS bindingVersion
      FROM egg_bot_bindings b JOIN mother_groups g ON g.id=b.group_id WHERE b.binding_version=?`).bind(version).first();
    return json({ ok: true, ...row }, 200, null);
  }
  if (action === 'disable') {
    if (!validId(input.botId) || !validId(input.qqGroupId) || typeof input.groupId !== 'string') return invalid(400, '参数无效');
    await env.DB.prepare('UPDATE egg_bot_bindings SET enabled=0,binding_version=?,updated_at=? WHERE group_id=? AND bot_id=? AND qq_group_id=?')
      .bind(newToken(), now, input.groupId, input.botId, input.qqGroupId).run();
    return json({ ok: true }, 200, null);
  }
  if (action === 'claim') {
    if (!validId(input.botId) || !validId(input.qqGroupId)) return invalid(400, '参数无效');
    const tasks = await activePatrolTasks(env.DB);
    const rows = await env.DB.prepare(`SELECT n.* FROM egg_patrol_notifications n JOIN egg_bot_bindings b
      ON b.group_id=n.group_id AND b.binding_version=n.binding_version AND b.enabled=1
      WHERE b.bot_id=? AND b.qq_group_id=? AND n.status IN ('pending','leased') AND n.next_at<=? AND n.lease_until<=? ORDER BY n.created_at LIMIT 20`)
      .bind(input.botId, input.qqGroupId, now, now).all<NotificationRow>();
    const events: Row[] = [];
    for (const row of rows.results) {
      if (typeof input.groupId === 'string' && row.group_id !== input.groupId) continue;
      if (typeof input.bindingVersion === 'string' && row.binding_version !== input.bindingVersion) continue;
      if (row.side === 'reminder' && row.status !== 'pending') continue;
      if (!(await currentNotification(env.DB, row, tasks))) continue;
      const lease = newToken();
      const result = await env.DB.prepare(`UPDATE egg_patrol_notifications SET status='leased',lease_token=?,lease_until=?
        WHERE id=? AND status IN ('pending','leased') AND lease_until<=?`).bind(lease, now + 120000, row.id, now).run();
      if (result.meta.changes) events.push({ ...JSON.parse(row.payload_json) as Row, id: row.id, leaseToken: lease, bindingVersion: row.binding_version });
    }
    return json({ ok: true, events }, 200, null);
  }
  if (action === 'validate') {
    if (typeof input.id !== 'string' || typeof input.leaseToken !== 'string' || !validId(input.botId) || !validId(input.qqGroupId)) return invalid(400, '参数无效');
    const row = await env.DB.prepare(`SELECT n.* FROM egg_patrol_notifications n JOIN egg_bot_bindings b
      ON b.group_id=n.group_id AND b.binding_version=n.binding_version AND b.enabled=1
      WHERE n.id=? AND n.lease_token=? AND n.status='leased' AND n.lease_until>? AND b.bot_id=? AND b.qq_group_id=?`)
      .bind(input.id, input.leaseToken, now, input.botId, input.qqGroupId).first<NotificationRow>();
    const tasks = row ? await activePatrolTasks(env.DB) : [];
    const valid = !!row && await currentNotification(env.DB, row, tasks);
    return json({ ok: true, valid }, 200, null);
  }
  if (action === 'ack') {
    if (typeof input.id !== 'string' || typeof input.leaseToken !== 'string' || !['sent','failed','unbound'].includes(String(input.outcome))) return invalid(400, '参数无效');
    const row = await env.DB.prepare('SELECT * FROM egg_patrol_notifications WHERE id=? AND lease_token=?').bind(input.id, input.leaseToken).first<NotificationRow>();
    if (!row) return invalid(409, '提醒租约已失效');
    if (row.status === 'sent') return json({ ok: true }, 200, null);
    const tasks = await activePatrolTasks(env.DB);
    if (!(await currentNotification(env.DB, row, tasks))) return invalid(409, '任务或群关联已变化');
    const sent = input.outcome === 'sent';
    if (row.side === 'reminder') {
      if (row.status !== 'leased') return json({ ok: true }, 200, null);
      await env.DB.prepare("UPDATE egg_patrol_notifications SET status=?,attempts=attempts+1,lease_until=0,sent_at=?,error_code=? WHERE id=? AND lease_token=? AND status='leased'")
        .bind(sent ? 'sent' : 'failed', sent ? now : null, sent ? null : input.outcome, row.id, input.leaseToken).run();
      return json({ ok: true }, 200, null);
    }
    await env.DB.prepare(`UPDATE egg_patrol_notifications SET status=?,attempts=attempts+1,next_at=?,lease_until=0,sent_at=?,error_code=? WHERE id=? AND lease_token=?`)
      .bind(sent ? 'sent' : 'pending', now + Math.min(3600000, 60000 * 2 ** Math.min(row.attempts, 6)), sent ? now : null, sent ? null : input.outcome, row.id, input.leaseToken).run();
    return json({ ok: true }, 200, null);
  }
  return invalid(404, '没有这个接口');
}
