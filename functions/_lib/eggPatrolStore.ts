import type { EggWorkflowState } from '../../src/shared/eggWorkflow';
import { tradeLines } from '../../src/shared/eggWorkflow';
import { patrolWindowOpen, type PatrolTask, type PatrolTaskStatus } from '../../src/shared/eggPatrol';

export interface ActivePatrolTask extends PatrolTask {
  bindingVersion: string; qqGroupId: string; botId: string;
  recipientName: string; eggName: string;
}
export const patrolTaskKey = (task: PatrolTask): string => JSON.stringify([task.groupId, task.tradeId, task.side, task.uid,
  task.producerAccountId, task.recipientAccountId, task.motherId, task.fatherId, task.eggGameId]);

/** Read current parties and group binding again before delivering queued observations. */
export async function activePatrolTasks(db: D1Database): Promise<ActivePatrolTask[]> {
  const rows = await db.prepare(`SELECT e.group_id,e.state_json,b.binding_version,b.qq_group_id,b.bot_id
    FROM egg_matching_groups e JOIN egg_bot_bindings b ON b.group_id=e.group_id AND b.enabled=1`).all<{
    group_id: string; state_json: string; binding_version: string; qq_group_id: string; bot_id: string;
  }>();
  const tasks: ActivePatrolTask[] = [];
  for (const row of rows.results) {
    const state = JSON.parse(row.state_json) as EggWorkflowState;
    const members = await db.prepare('SELECT account_id,display_name FROM mother_group_members WHERE group_id=?')
      .bind(row.group_id).all<{ account_id: string; display_name: string }>();
    const names = new Map(members.results.map(member => [member.account_id, member.display_name]));
    for (const trade of state.trades) {
      if (trade.status !== 'accepted' || !names.has(trade.supplierAccountId) || !names.has(trade.demanderAccountId)) continue;
      for (const entry of tradeLines(trade)) {
        if (entry.side === 'give' ? !!trade.giveEggId : !!trade.returnEggId) continue;
        const match = /^uid:(\d{6,24})$/.exec(entry.line.gameAccountKey);
        if (!match) continue;
        const recipientAccountId = entry.side === 'give' ? trade.demanderAccountId : trade.supplierAccountId;
        tasks.push({ groupId: row.group_id, tradeId: trade.id, side: entry.side, uid: match[1],
          producerAccountId: entry.accountId, recipientAccountId, motherId: entry.line.motherId, fatherId: entry.line.fatherId,
          eggGameId: entry.line.eggGameId, bindingVersion: row.binding_version, qqGroupId: row.qq_group_id, botId: row.bot_id,
          recipientName: names.get(recipientAccountId)!, eggName: '' });
      }
    }
  }
  return tasks;
}

export async function readPatrolStatus(db: D1Database, groupId: string, accountId: string, now: number): Promise<PatrolTaskStatus[]> {
  const tasks = (await activePatrolTasks(db)).filter(task => task.groupId === groupId && [task.producerAccountId, task.recipientAccountId].includes(accountId));
  const result: PatrolTaskStatus[] = [];
  for (const task of tasks) {
    const cache = await db.prepare('SELECT success_at,status FROM egg_patrol_cache WHERE uid=?').bind(task.uid).first<{success_at:number|null;status:PatrolTaskStatus['status']}>();
    const observation = await db.prepare('SELECT status FROM egg_patrol_observations WHERE task_key=? ORDER BY observed_at DESC LIMIT 1')
      .bind(patrolTaskKey(task)).first<{status:'produced'|'ambiguous'}>();
    const notification = await db.prepare(`SELECT status,error_code FROM egg_patrol_notifications WHERE group_id=? AND trade_id=? AND side=? AND binding_version=?
      AND json_extract(payload_json,'$.taskKey')=? ORDER BY created_at DESC LIMIT 1`)
      .bind(groupId, task.tradeId, task.side, task.bindingVersion, patrolTaskKey(task)).first<{status:'pending'|'leased'|'sent';error_code:'failed'|'unbound'|null}>();
    result.push({tradeId:task.tradeId,side:task.side,checkedAt:cache?.success_at??null,
      status:observation?.status??(!patrolWindowOpen(now)?'quiet':cache?.status??'pending'),notification:notification?.status==='sent'?'sent':notification?.error_code??notification?.status??null});
  }
  return result;
}
