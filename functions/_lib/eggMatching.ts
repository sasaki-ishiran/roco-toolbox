import { applyEggAction, emptyEggWorkflow, tradeLines, type EggWorkflowState } from '../../src/shared/eggWorkflow';
import { migrateEggDemands, type LegacyDemandRow, type LegacyPlanRow, type LegacyCompletionRow } from '../../src/shared/eggMigration';
import { isMember } from './motherGroupsStore';
import { failCode, okJson } from './collectionGroupsHttp';
import { rateLimit, type Env } from './util';
import type { CollectionDemand, CollectionDemandFeed } from '../../src/shared/collectionGroups';
import { readPatrolStatus } from './eggPatrolStore';

interface StateRow { version: number; state_json: string }

/** Compatibility projection only: all post-migration writes use egg-matching. */
export async function readMigratedDemandFeed(db:D1Database,groupId:string,viewer:string):Promise<CollectionDemandFeed|null>{
  const row=await db.prepare('SELECT version,state_json FROM egg_matching_groups WHERE group_id=?').bind(groupId).first<StateRow>();
  if(!row)return null;
  const state=JSON.parse(row.state_json) as EggWorkflowState;
  const demands:CollectionDemand[]=[];
  const completedCounts:Record<string,number>={};
  const myRecentCompleted:CollectionDemand[]=[];
  for(const demand of state.demands){
    const trades=state.trades.filter(t=>t.demandId===demand.id&&t.status==='accepted');
    const base={groupId,demanderAccountId:demand.demanderAccountId,eggGameId:demand.eggGameId,nature:demand.natures.join(' / '),gender:'' as const,body:demand.body,voice:demand.voice,version:row.version,createdAt:0,updatedAt:0,requireGreenNest:demand.greenNest};
    if(demand.status==='open'){
      if(demand.quantity-demand.fulfilled>trades.length)demands.push({...base,status:'open',claimerAccountId:null});
      for(const t of trades)demands.push({...base,nature:t.give.nature,status:'claimed',claimerAccountId:t.supplierAccountId,createdAt:t.createdAt,updatedAt:t.createdAt,placedAt:t.placed?t.createdAt:null});
    }
  }
  for(const t of state.trades.filter(t=>t.status==='done')){
    completedCounts[t.supplierAccountId]=(completedCounts[t.supplierAccountId]??0)+1;
    if(t.supplierAccountId===viewer)myRecentCompleted.push({groupId,demanderAccountId:t.demanderAccountId,eggGameId:t.give.eggGameId,nature:t.give.nature,gender:'',body:t.give.body==='unknown'?'':t.give.body,voice:t.give.voice==='unknown'?'':t.give.voice,status:'done',claimerAccountId:t.supplierAccountId,version:row.version,createdAt:t.createdAt,updatedAt:t.completedAt??t.createdAt});
  }
  return {demands,completedCounts,myRecentCompleted:myRecentCompleted.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,20)};
}

async function readState(db: D1Database, groupId: string): Promise<{ version: number; state: EggWorkflowState }> {
  let row = await db.prepare('SELECT version,state_json FROM egg_matching_groups WHERE group_id=?').bind(groupId).first<StateRow>();
  for(let attempt=0;!row&&attempt<4;attempt++){
    const revision=await db.prepare('SELECT revision FROM egg_matching_legacy_revisions WHERE group_id=?').bind(groupId).first<{revision:number}>();
    const [demands, plans, completions] = await Promise.all([
      db.prepare('SELECT group_id,demander_account_id,egg_game_id,nature,gender,body,voice,status,claimer_account_id,placed_at,created_at,require_green_nest FROM collection_group_demands WHERE group_id=?').bind(groupId).all<LegacyDemandRow>(),
      db.prepare('SELECT id,group_id,member_account_id,egg_game_id,status FROM collection_plans WHERE group_id=?').bind(groupId).all<LegacyPlanRow>(),
      db.prepare("SELECT group_id,demander_account_id,claimer_account_id,egg_game_id,nature,gender,body,voice,created_at,completed_at,require_green_nest,'done' AS status,NULL AS placed_at FROM collection_group_demand_completions WHERE group_id=? ORDER BY completed_at,created_at,demander_account_id,egg_game_id,nature,gender,body,voice").bind(groupId).all<LegacyCompletionRow>(),
    ]);
    const migrated = migrateEggDemands(demands.results, plans.results, completions.results);
    const state = emptyEggWorkflow();
    state.demands = migrated.demands;
    state.legacyHistory = migrated.legacyHistory;
    state.trades = migrated.trades.map(task => {
      const demand = state.demands.find(d => d.id === task.demandId)!;
      return { ...task, legacy: true, receive: null, give: {
        id: task.id, accountId: task.supplierAccountId, eggGameId: demand.eggGameId,
        nature: demand.natures[0] ?? '', body: demand.body, voice: demand.voice,
        provenance: 'unknown', confidence: 'unknown', status: 'reserved',
      } };
    });
    await db.prepare('INSERT INTO egg_matching_groups (group_id,state_json,updated_at) SELECT ?,?,? WHERE COALESCE((SELECT revision FROM egg_matching_legacy_revisions WHERE group_id=?),0)=? ON CONFLICT(group_id) DO NOTHING').bind(groupId, JSON.stringify(state), Date.now(),groupId,revision?.revision??0).run();
    row = await db.prepare('SELECT version,state_json FROM egg_matching_groups WHERE group_id=?').bind(groupId).first<StateRow>();
  }
  if (!row) throw new Error('换蛋数据初始化失败');
  return { version: row.version, state: JSON.parse(row.state_json) as EggWorkflowState };
}

/** Expose only listed group supplies and each participant's own task/inventory. */
function visibleState(state: EggWorkflowState, accountId: string, members: Set<string>): EggWorkflowState {
  return { ...state,
    demands: state.demands.filter(d => members.has(d.demanderAccountId)),
    legacyHistory:(state.legacyHistory??[]).filter(row=>[row.demanderAccountId,row.supplierAccountId].includes(accountId)),
    lines:(state.lines??[]).filter(l=>members.has(l.accountId)),
    eggs: state.eggs.filter(e => e.accountId === accountId || (members.has(e.accountId) && e.listed && e.status === 'available')),
    trades: state.trades.filter(t => [t.demanderAccountId, t.supplierAccountId].includes(accountId)),
    orders: { [JSON.stringify(accountId)]: state.orders[JSON.stringify(accountId)] ?? [] },
    watermarks: Object.fromEntries(Object.entries(state.watermarks).filter(([key]) => {
      try { return JSON.parse(key)[0] === accountId; } catch { return false; }
    })),
  };
}

/** Caller authenticates once; membership is checked inside every conditional write too. */
export async function handleEggMatching(request: Request, env: Env, origin: string | null, accountId: string, groupId: string): Promise<Response> {
  if (!(await isMember(env.DB, groupId, accountId))) return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
  const method = request.method.toUpperCase();
  if (!['GET', 'POST'].includes(method)) return failCode(origin, 405, 'METHOD_NOT_ALLOWED', '不支持的请求');
  try {
    if (!(await rateLimit(env, `egg:${accountId}:${method}`, method === 'GET' ? 1800 : 240, 3_600_000))) return failCode(origin, 429, 'RATE_LIMIT', '操作太快，请稍后重试');
    const current = await readState(env.DB, groupId);
    const memberRows = await env.DB.prepare('SELECT account_id FROM mother_group_members WHERE group_id=?').bind(groupId).all<{ account_id: string }>();
    const members = new Set(memberRows.results.map(m => m.account_id));
    if (method === 'GET') return okJson(origin, { version: current.version, state: {...visibleState(current.state, accountId, members),patrol:await readPatrolStatus(env.DB,groupId,accountId,Date.now())} });
    const raw = await request.text();
    if (raw.length > 1_000_000) return failCode(origin, 413, 'PAYLOAD_TOO_LARGE', '数据过大');
    let body: { baseVersion?: unknown; action?: unknown };
    try { body = JSON.parse(raw); } catch { return failCode(origin, 400, 'INVALID_INPUT', '请求格式无效'); }
    if (!body || !Number.isSafeInteger(body.baseVersion) || !body.action) return failCode(origin, 400, 'INVALID_INPUT', '缺少数据版本或操作');
    if (body.baseVersion !== current.version) return failCode(origin, 409, 'REVISION_CONFLICT', '小组数据已变化，请刷新后重试');
    const action=body.action as {type?:string;id?:string;demandId?:string;supplierAccountId?:string};
    // Check only the parties touched by this operation; an abandoned proposal must not freeze all members.
    const touchedDemand=current.state.demands.find(d=>d.id===action.demandId);
    const touchedTrade=current.state.trades.find(t=>t.id===action.id);
    const parties=action.type==='propose'?[accountId,touchedDemand?.demanderAccountId]:action.type==='request'?[accountId,action.supplierAccountId]:
      ['accept','place','allocate','receive','remind'].includes(action.type??'')&&touchedTrade?[touchedTrade.demanderAccountId,touchedTrade.supplierAccountId]:[];
    if(parties.some(id=>!id||!members.has(id)))return failCode(origin,409,'NOT_MEMBER','换蛋成员已退出小组');
    const next = applyEggAction(current.state, groupId, accountId, body.action, Date.now());
    const stateJson=JSON.stringify(next);
    if(new TextEncoder().encode(stateJson).byteLength>1_500_000)return failCode(origin,413,'STATE_CAPACITY','小组换蛋记录已达容量，请联系管理员扩容；原记录未改变');
    const version = current.version + 1;
    const mutation = crypto.randomUUID();
    const statements = [env.DB.prepare(`UPDATE egg_matching_groups SET state_json=?,version=?,mutation_id=?,updated_at=?
      WHERE group_id=? AND version=? AND EXISTS (SELECT 1 FROM mother_group_members WHERE group_id=? AND account_id=?)`)
      .bind(stateJson, version, mutation, Date.now(), groupId, current.version, groupId, accountId),
      env.DB.prepare(`DELETE FROM egg_matching_locks WHERE group_id=? AND status='reserved' AND EXISTS
        (SELECT 1 FROM egg_matching_groups WHERE group_id=? AND mutation_id=?)`).bind(groupId, groupId, mutation)];
    const locks = new Map<string, { accountId: string; resourceId: string; tradeId: string; status: string }>();
    for (const trade of next.trades.filter(t => t.status === 'accepted' || t.status === 'done')) {
      const status = trade.status === 'done' ? 'transferred' : 'reserved';
      for (const egg of [(!trade.line||trade.giveEggId) && !trade.legacy ? trade.give : null, (!trade.returnLine||trade.returnEggId) ? trade.receive : null]) if (egg) {
        locks.set(JSON.stringify([egg.accountId, egg.id]), { accountId: egg.accountId, resourceId: `egg:${egg.id}`, tradeId: trade.id, status });
      }

    }
    const lockRows=[...locks.values()];
    statements.push(env.DB.prepare('DELETE FROM egg_matching_parent_reservations WHERE group_id=? AND EXISTS (SELECT 1 FROM egg_matching_groups WHERE group_id=? AND mutation_id=?)').bind(groupId,groupId,mutation));
    const parentRows=next.trades.filter(t=>t.status==='accepted').flatMap(t=>tradeLines(t).map(p=>({...p.line,accountId:p.accountId,tradeId:t.id})));
    if(parentRows.length)statements.push(env.DB.prepare(`INSERT INTO egg_matching_parent_reservations(account_id,game_account_key,mother_id,father_id,green_parent_id,group_id,trade_id)
      SELECT json_extract(value,'$.accountId'),json_extract(value,'$.gameAccountKey'),json_extract(value,'$.motherId'),json_extract(value,'$.fatherId'),json_extract(value,'$.greenParentId'),?,json_extract(value,'$.tradeId')
      FROM json_each(?) WHERE EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=? AND mutation_id=?)`).bind(groupId,JSON.stringify(parentRows),groupId,mutation));
    if(lockRows.length){
      statements.push(env.DB.prepare(`INSERT INTO egg_matching_locks(account_id,resource_id,group_id,trade_id,status)
        SELECT json_extract(value,'$.accountId'),json_extract(value,'$.resourceId'),?,json_extract(value,'$.tradeId'),json_extract(value,'$.status') FROM json_each(?)
        WHERE EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=? AND mutation_id=?)
        ON CONFLICT(account_id,resource_id) DO UPDATE SET status=excluded.status
        WHERE egg_matching_locks.group_id=excluded.group_id AND egg_matching_locks.trade_id=excluded.trade_id`).bind(groupId,JSON.stringify(lockRows),groupId,mutation));
      statements.push(env.DB.prepare(`INSERT INTO egg_matching_locks(account_id,resource_id,group_id,trade_id,status)
        SELECT NULL,json_extract(value,'$.resourceId'),?,json_extract(value,'$.tradeId'),json_extract(value,'$.status') FROM json_each(?)
        WHERE EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=? AND mutation_id=?) AND NOT EXISTS(
          SELECT 1 FROM egg_matching_locks l WHERE l.account_id=json_extract(value,'$.accountId') AND l.resource_id=json_extract(value,'$.resourceId') AND l.group_id=? AND l.trade_id=json_extract(value,'$.tradeId'))`).bind(groupId,JSON.stringify(lockRows),groupId,mutation,groupId));
    }
    const result = await env.DB.batch(statements);
    if (!result[0].meta.changes) return failCode(origin, 409, 'REVISION_CONFLICT', '小组数据已变化或成员权限失效，请刷新');
    return okJson(origin, { version, state: visibleState(next, accountId, members) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '操作失败';
    if (/constraint|UNIQUE|NOT NULL/i.test(message)) return failCode(origin, 409, 'STOCK_TAKEN', '蛋或亲本已被其他任务占用，请刷新');
    if (/no such table|SQLITE|D1_ERROR/i.test(message)) {
      console.error('egg-matching storage:', error);
      return failCode(origin, 503, 'STORAGE_UNAVAILABLE', '换蛋服务暂不可用，请稍后重试');
    }
    return failCode(origin, 400, 'INVALID_ACTION', message);
  }
}
