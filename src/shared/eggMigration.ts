import { createDemand, type EggDemand, type EggRecord } from './eggMatching';
import { isDemandBody, isDemandVoice } from './collectionGroups';

export interface LegacyDemandRow {
  group_id: string; demander_account_id: string; egg_game_id: number; nature: string;
  gender: string; body: string; voice: string; status: string; claimer_account_id: string | null;
  placed_at: number | null; created_at: number;
  require_green_nest?:number;
}
export interface LegacyPlanRow {
  id: string; group_id: string; member_account_id: string; egg_game_id: number; status: string;
}
export interface LegacyCompletionRow extends LegacyDemandRow { completed_at:number }
/** A carried obligation, not an invented egg exchange or received inventory. */
export interface LegacyEggTask {
  id: string; demandId: string; groupId: string; supplierAccountId: string; demanderAccountId: string;
  status: 'accepted' | 'done'; type: 'custom'; placed: boolean;
  createdAt:number; completedAt?:number;
}
export interface LegacyEggHistory {
  id:string; groupId:string; demanderAccountId:string; supplierAccountId?:string;
  eggGroupId:number; nature:string; body:string; voice:string;
  status:'cancelled'|'done'|'needs-species'; createdAt:number; completedAt?:number;
}
export interface MigratedEggState { demands: EggDemand[]; eggs: EggRecord[]; trades: LegacyEggTask[]; legacyHistory:LegacyEggHistory[] }

export function migrateEggDemands(rows: readonly LegacyDemandRow[], plans: readonly LegacyPlanRow[], completions: readonly LegacyCompletionRow[] = []): MigratedEggState {
  const demands = new Map<string, EggDemand>();
  const trades: LegacyEggTask[] = [];
  const legacyHistory:LegacyEggHistory[]=[];
  for (const row of rows) {
    if (!['open', 'claimed'].includes(row.status)) continue;
    if(row.egg_game_id<0){
      legacyHistory.push({id:'legacy-untyped:'+JSON.stringify([row.group_id,row.demander_account_id,row.egg_game_id,row.nature,row.gender,row.body,row.voice,row.created_at]),
        groupId:row.group_id,demanderAccountId:row.demander_account_id,...(row.claimer_account_id?{supplierAccountId:row.claimer_account_id}:{}),
        eggGroupId:-row.egg_game_id,nature:row.nature,body:row.body,voice:row.voice,status:'cancelled',createdAt:row.created_at});
      continue;
    }
    if (!isDemandBody(row.body) || !isDemandVoice(row.voice)) throw new Error('旧需求条件无法迁移，请核对档位');
    const key = JSON.stringify([row.group_id, row.demander_account_id, row.egg_game_id, row.nature, row.body, row.voice,row.require_green_nest===1]);
    const id = `legacy:${key}`;
    let demand = demands.get(key);
    if (!demand) {
      demand = createDemand({ id, groupId: row.group_id, demanderAccountId: row.demander_account_id,
        eggGameId: row.egg_game_id, natures: row.nature ? [row.nature] : [], body: row.body, voice: row.voice, quantity: 1,greenNest:row.require_green_nest===1 });
      demands.set(key, demand);
    } else {
      demand.quantity++;
      if (demand.quantity > 99) throw new Error('旧需求合并数量超过99，请核对');
    }
    if (row.status === 'claimed' && row.claimer_account_id) {
      trades.push({ id: `legacy-task:${JSON.stringify([key, row.gender, row.created_at])}`, demandId: id, groupId: row.group_id,
        supplierAccountId: row.claimer_account_id, demanderAccountId: row.demander_account_id,
        status: 'accepted', type: 'custom', placed: row.placed_at != null,createdAt:row.created_at });
    }
  }
  for (const plan of plans) {
    if(plan.egg_game_id<0){
      legacyHistory.push({id:'legacy-untyped-plan:'+plan.id,groupId:plan.group_id,demanderAccountId:plan.member_account_id,
        eggGroupId:-plan.egg_game_id,nature:'',body:'',voice:'',status:plan.status==='done'?'done':'needs-species',createdAt:0});
      continue;
    }
    const related = [...demands.values()].some(d => d.groupId === plan.group_id &&
      d.demanderAccountId === plan.member_account_id && d.eggGameId === plan.egg_game_id);
    if (related) continue;
    const demand = createDemand({ id: `legacy-plan:${plan.id}`, groupId: plan.group_id,
      demanderAccountId: plan.member_account_id, eggGameId: plan.egg_game_id, natures: [], body: '', voice: '',
      quantity: 1, fulfilled: plan.status === 'done' ? 1 : 0 });
    demands.set(demand.id, demand);
  }
  completions.forEach((row,index) => {
    if(row.egg_game_id<0){
      legacyHistory.push({id:'legacy-untyped-completed:'+JSON.stringify([row.group_id,row.demander_account_id,row.egg_game_id,row.nature,row.gender,row.created_at,row.completed_at,index]),
        groupId:row.group_id,demanderAccountId:row.demander_account_id,...(row.claimer_account_id?{supplierAccountId:row.claimer_account_id}:{}),
        eggGroupId:-row.egg_game_id,nature:row.nature,body:row.body,voice:row.voice,status:'done',createdAt:row.created_at,completedAt:row.completed_at});
      return;
    }
    if (!row.claimer_account_id || !isDemandBody(row.body) || !isDemandVoice(row.voice)) throw new Error('旧收货记录无法迁移');
    const id='legacy-completed:'+JSON.stringify([row.group_id,row.demander_account_id,row.egg_game_id,row.nature,row.gender,row.body,row.voice,row.created_at,row.completed_at,index]);
    demands.set(id,createDemand({id,groupId:row.group_id,demanderAccountId:row.demander_account_id,eggGameId:row.egg_game_id,natures:row.nature?[row.nature]:[],body:row.body,voice:row.voice,quantity:1,fulfilled:1,greenNest:row.require_green_nest===1}));
    trades.push({id:'task:'+id,demandId:id,groupId:row.group_id,supplierAccountId:row.claimer_account_id,demanderAccountId:row.demander_account_id,status:'done',type:'custom',placed:true,createdAt:row.created_at,completedAt:row.completed_at});
  });
  return { demands: [...demands.values()], eggs: [], trades, legacyHistory };
}
