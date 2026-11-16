import type { LegacyEggHistory } from './eggMigration';
import type { PatrolTaskStatus } from './eggPatrol';
import { isDemandBody, isDemandVoice } from './collectionGroups';
import { canCirculateEgg, canMatchDemand, createDemand, type EggDemand, type EggRecord } from './eggMatching';

export interface WorkflowEgg extends EggRecord {
  gameAccountKey: string;
  accountName?: string;
  listed: boolean;
  itemConfId?: number;
  weightGrams?: number;
  /** Last complete capture no longer contains this reserved instance. */
  missingFromCapture?: boolean;
}
export interface EggLine {
  eggGameId: number; nature: string; body: EggRecord['body']; voice: EggRecord['voice'];
  gameAccountKey: string; motherId: string; fatherId: string;
  greenParentId?: string; natureChance?: number;
  parents?:{id:string;gameId:number;name:string;nature:string;body:string;voice:string}[];
}
export interface PublishedEggLine extends EggLine { id:string; accountId:string }
export interface WorkflowTrade {
  id: string; groupId: string; demandId: string; supplierAccountId: string; demanderAccountId: string;
  give: EggRecord; receive: EggRecord | null; line?: EggLine; type: 'spot' | 'custom';
  status: 'proposed' | 'accepted' | 'done' | 'cancelled'; placed: boolean;
  createdAt: number; reminderAt?: number; reminderBy?: string; legacy?: boolean;
  initiatorAccountId?: string; returnDemandId?: string;
  returnLine?:EggLine; returnPlaced?:boolean;
  lineOfferId?:string; returnLineOfferId?:string;
  completedAt?:number; giveEggId?:string; returnEggId?:string;
}
export interface EggWorkflowState {
  demands: EggDemand[]; eggs: WorkflowEgg[]; trades: WorkflowTrade[];
  watermarks: Record<string, number>; orders: Record<string, string[]>;
  lines?:PublishedEggLine[];
  legacyHistory?:LegacyEggHistory[];
  patrol?:PatrolTaskStatus[];
}
export const emptyEggWorkflow = (): EggWorkflowState => ({ demands: [], eggs: [], trades: [], watermarks: {}, orders: {} });

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数无效');
  return value as Record<string, unknown>;
};
const str = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('标识无效');
  return value;
};
function normalizeEgg(value: unknown, accountId: string, gameAccountKey: string): WorkflowEgg {
  const raw = record(value);
  if (!Number.isSafeInteger(raw.eggGameId) || Number(raw.eggGameId) <= 0) throw new Error('蛋物种无效');
  const kind = raw.isShiny === true || raw.preciousEggType === 2 ? 'shiny' :
    raw.isOrdinary === false || (typeof raw.preciousEggType==='number' && raw.preciousEggType!==0) ||
    ['specialEggConfId','appearanceType','extensionType'].some(key=>typeof raw[key]==='number' && Number(raw[key])!==0) ||
    (typeof raw.itemConfId==='number' && (raw.itemConfId<107000 || raw.itemConfId>107999)) ? 'special' : raw.kind ?? 'ordinary';
  if (!['ordinary', 'shiny', 'special'].includes(String(kind))) throw new Error('蛋分类无效');
  return { id: str(raw.id), accountId, gameAccountKey, eggGameId: Number(raw.eggGameId),
    accountName: typeof raw.accountName === 'string' ? raw.accountName.slice(0, 64) : undefined,
    nature: typeof raw.nature === 'string' && raw.nature.length <= 32 ? raw.nature : '',
    body: isDemandBody(raw.body) ? raw.body : 'unknown', voice: isDemandVoice(raw.voice) ? raw.voice : 'unknown',
    kind: kind as WorkflowEgg['kind'], provenance: raw.provenance === 'external' ? 'external' : 'unknown',
    // Browser imports/manual labels are not server-verified game evidence.
    confidence: 'manual', status: 'available', listed: false,
    itemConfId: Number.isSafeInteger(raw.itemConfId) ? Number(raw.itemConfId) : undefined,
    weightGrams: typeof raw.weightGrams === 'number' && Number.isFinite(raw.weightGrams) ? raw.weightGrams : undefined };
}
const active = (trade: WorkflowTrade) => trade.status === 'accepted';
const ownEgg = (state: EggWorkflowState, accountId: string, id: string) => {
  const egg = state.eggs.find(e => e.accountId === accountId && e.id === id);
  if (!egg) throw new Error('蛋不存在或不属于当前账号');
  return egg;
};
const available = (egg: WorkflowEgg) => {
  if (!canCirculateEgg(egg)) throw new Error('蛋已占用或为不可交换的异色/特殊蛋');
};
const locked = (state: EggWorkflowState, id: string) => state.trades.some(t => (t.demandId === id || t.returnDemandId===id) && active(t));
const same = (a: EggRecord, b: EggRecord) => a.id === b.id && a.accountId === b.accountId;
const unchanged = (a: EggRecord, b: EggRecord) => a.eggGameId === b.eggGameId && a.nature === b.nature && a.body === b.body && a.voice === b.voice;
const normalizeLine=(value:unknown,owner:string,id:string):{line:EggLine;egg:WorkflowEgg}=>{
  const raw=record(value);
  const egg=normalizeEgg({...raw,id:'line:'+id,kind:'ordinary'},owner,str(raw.gameAccountKey));
  const line:EggLine={eggGameId:egg.eggGameId,nature:egg.nature,body:egg.body,voice:egg.voice,gameAccountKey:egg.gameAccountKey,motherId:str(raw.motherId),fatherId:str(raw.fatherId)};
  if(line.motherId===line.fatherId)throw new Error('亲本不能是同一个体');
  if(raw.greenParentId){
    line.greenParentId=str(raw.greenParentId);
    if(![line.motherId,line.fatherId].includes(line.greenParentId))throw new Error('学院小窝亲本无效');
  }
  if(typeof raw.natureChance==='number'&&raw.natureChance>=0&&raw.natureChance<=1)line.natureChance=raw.natureChance;
  if(Array.isArray(raw.parents)&&raw.parents.length===2){
    line.parents=raw.parents.map(value=>{
      const p=record(value),parentId=str(p.id);
      if(![line.motherId,line.fatherId].includes(parentId)||!Number.isSafeInteger(p.gameId)||Number(p.gameId)<=0)throw new Error('亲本信息无效');
      return {id:parentId,gameId:Number(p.gameId),name:str(p.name).slice(0,80),nature:typeof p.nature==='string'?p.nature.slice(0,32):'',body:isDemandBody(p.body)?p.body:'',voice:isDemandVoice(p.voice)?p.voice:''};
    });
    if(new Set(line.parents.map(p=>p.id)).size!==2)throw new Error('亲本信息重复');
  }
  return {line,egg};
};
export const tradeLines=(trade:WorkflowTrade)=>[
  ...(trade.line?[{accountId:trade.supplierAccountId,line:trade.line,side:'give' as const}]:[]),
  ...(trade.returnLine?[{accountId:trade.demanderAccountId,line:trade.returnLine,side:'return' as const}]:[]),
];
function checkParentCapacity(state:EggWorkflowState,trade:WorkflowTrade){
  const existing=state.trades.filter(t=>active(t)&&t.id!==trade.id).flatMap(tradeLines);
  for(const current of tradeLines(trade)){
    const peers=existing.filter(p=>p.accountId===current.accountId&&p.line.gameAccountKey===current.line.gameAccountKey).map(p=>p.line);
    const line=current.line, ids=[line.motherId,line.fatherId];
    if(peers.some(p=>p.motherId===line.motherId&&p.fatherId===line.fatherId))throw new Error('亲本配对已被任务占用');
    for(const id of ids)if(peers.filter(p=>[p.motherId,p.fatherId].includes(id)).length>=2)throw new Error('亲本最多参与两条配对');
    const academy=peers.find(p=>p.greenParentId)?.greenParentId;
    if(academy&&line.greenParentId&&academy!==line.greenParentId)throw new Error('该账号学院小窝已占用');
    for(const p of peers)if(ids.some(id=>[p.motherId,p.fatherId].includes(id))){
      if(!!p.greenParentId!==!!line.greenParentId)throw new Error('学院亲本不能同时用于普通配对');
      if(line.greenParentId&&ids.some(id=>[p.motherId,p.fatherId].includes(id)&&id!==line.greenParentId))throw new Error('学院配对方已占用');
    }
    if(new Set([...peers.flatMap(p=>[p.motherId,p.fatherId]),...ids]).size>11)throw new Error('该账号窝位不足');
  }
}

/** All identity arguments come from authenticated API; rejects raw field/role spoofing. */
export function applyEggAction(previous: EggWorkflowState, groupId: string, actor: string, input: unknown, now: number): EggWorkflowState {
  const action = record(input);
  const state: EggWorkflowState = structuredClone(previous);
  if(action.type==='line-sync'){
    if(!Array.isArray(action.lines)||action.lines.length>1024)throw new Error('产线数量无效');
    const lines=action.lines.map(raw=>{const item=record(raw);return {...normalizeLine(item,actor,str(item.id)).line,id:str(item.id),accountId:actor};});
    if(new Set(lines.map(l=>l.id)).size!==lines.length)throw new Error('产线标识重复');
    state.lines=[...(state.lines??[]).filter(l=>l.accountId!==actor),...lines];
    return state;
  }
  if (action.type === 'publish-batch') {
    if (!Array.isArray(action.demands) || !action.demands.length || action.demands.length > 50) throw new Error('每批请选择1至50项需求');
    return action.demands.reduce((next,demand)=>applyEggAction(next,groupId,actor,{type:'publish',demand},now),state);
  }
  const getDemand = (id: unknown) => {
    const demand = state.demands.find(d => d.id === str(id));
    if (!demand || demand.groupId !== groupId) throw new Error('需求不存在或小组不匹配');
    return demand;
  };
  if (action.type === 'stock-sync') {
    const key = str(action.gameAccountKey);
    const timestamp = Number(action.capturedAt);
    if (!Number.isFinite(timestamp) || timestamp < 0 || typeof action.complete !== 'boolean' || !Array.isArray(action.eggs) || action.eggs.length > 2000) throw new Error('库存快照无效');
    const watermark = JSON.stringify([actor, key]);
    if (timestamp <= (state.watermarks[watermark] ?? -1)) return previous;
    const incoming = action.eggs.map(e => normalizeEgg(e, actor, key));
    if (new Set(incoming.map(e => e.id)).size !== incoming.length) throw new Error('库存实例重复');
    const old = state.eggs.filter(e => e.accountId === actor && e.gameAccountKey === key);
    for (const egg of incoming) {
      const before = old.find(e => e.id === egg.id);
      if (before) {
        egg.status = before.status;
        if (before.kind === 'special' || before.kind === 'shiny') egg.kind = before.kind;
        // Missing captured attributes do not erase the user's label.
        if (!egg.nature) egg.nature = before.nature;
        if (egg.body === 'unknown') egg.body = before.body;
        if (egg.voice === 'unknown') egg.voice = before.voice;
        egg.listed = before.listed && canCirculateEgg(egg);
      }
    }
    if (action.complete) for (const egg of old) {
      if (!incoming.some(n => n.id === egg.id)) { egg.missingFromCapture = true; egg.listed = false; }
    }
    state.eggs = state.eggs.filter(e => !(e.accountId === actor && e.gameAccountKey === key) ||
      (!incoming.some(n => n.id === e.id) && (!action.complete || e.status === 'reserved' || e.status === 'transferred')));
    state.eggs.push(...incoming);
    state.watermarks[watermark] = timestamp;
    return state;
  }
  if (action.type === 'list' || action.type === 'label') {
    const egg = ownEgg(state, actor, str(action.id));
    if (action.type === 'list') {
      if (typeof action.listed !== 'boolean') throw new Error('挂出状态无效');
      if (action.listed) available(egg);
      egg.listed = action.listed;
    } else {
      available(egg);
      if (typeof action.nature !== 'string' || action.nature.length > 32 || !isDemandBody(action.body) || !isDemandVoice(action.voice)) throw new Error('标注无效');
      Object.assign(egg, { nature: action.nature, body: action.body, voice: action.voice, confidence: 'manual' });
    }
    return state;
  }
  if (action.type === 'publish' || action.type === 'edit') {
    const draft = record(action.demand);
    const old = action.type === 'edit' ? getDemand(draft.id) : undefined;
    if (old && (old.demanderAccountId !== actor || old.status !== 'open' || locked(state, old.id))) throw new Error('需求已被接单或无权调整');
    const demand = createDemand({ id: str(draft.id), groupId, demanderAccountId: actor,
      eggGameId: Number(draft.eggGameId), natures: draft.natures as string[], body: draft.body as EggDemand['body'],
      voice: draft.voice as EggDemand['voice'], quantity: Number(draft.quantity), fulfilled: old?.fulfilled ?? 0, greenNest: draft.greenNest === true });
    if (!old && state.demands.some(d => d.id === demand.id)) throw new Error('需求编号重复');
    if (state.demands.filter(d => d.demanderAccountId === actor && d.status === 'open').length >= 500) throw new Error('进行中需求过多');
    if (old) {
      if (demand.quantity <= old.fulfilled) throw new Error('需求数量不能低于已收数量');
      state.demands = state.demands.map(d => d.id === old.id ? demand : d);
      state.trades.filter(t => (t.demandId === old.id || t.returnDemandId===old.id) && t.status === 'proposed').forEach(t => { t.status = 'cancelled'; });
    } else state.demands.push(demand);
    return state;
  }
  if (action.type === 'withdraw') {
    const demand = getDemand(action.id);
    if (demand.demanderAccountId !== actor || demand.status !== 'open' || locked(state, demand.id)) throw new Error('需求已被接单或无权撤回');
    demand.status = 'withdrawn';
    state.trades.filter(t => (t.demandId === demand.id || t.returnDemandId===demand.id) && t.status === 'proposed').forEach(t => { t.status = 'cancelled'; });
    return state;
  }
  if (action.type === 'propose' || action.type === 'request') {
    const demand = getDemand(action.demandId);
    const requesting = action.type === 'request';
    const supplier = requesting ? str(action.supplierAccountId) : actor;
    if (demand.status !== 'open' || supplier === demand.demanderAccountId || (requesting && actor !== demand.demanderAccountId)) throw new Error('需求已关闭或无权发起');
    const id = str(action.id);
    if (state.trades.some(t => t.id === id)) throw new Error('任务编号重复');
    let returnLine:EggLine|undefined;
    let receive:EggRecord;
    if(action.returnLine||action.returnLineId){
      const published=action.returnLineId?(state.lines??[]).find(l=>l.id===action.returnLineId&&l.accountId===demand.demanderAccountId):undefined;
      if(action.returnLineId&&!published)throw new Error('对方产线已停止共享');
      if(!requesting&&!published)throw new Error('只能选择对方已共享的产线');
      const parsed=normalizeLine(published??action.returnLine,demand.demanderAccountId,id+':return');
      returnLine=parsed.line;receive=parsed.egg;
    }else{
      receive=ownEgg(state,demand.demanderAccountId,str(action.receiveId));
      available(receive as WorkflowEgg);
      if(!requesting&&!(receive as WorkflowEgg).listed)throw new Error('对方尚未挂出这颗蛋');
    }
    let line:EggLine|undefined;
    let give:EggRecord;
    if(action.line||action.lineId){
      const published=action.lineId?(state.lines??[]).find(l=>l.id===action.lineId&&l.accountId===supplier):undefined;
      if(action.lineId&&!published)throw new Error('对方产线已停止共享');
      if(requesting&&!published)throw new Error('只能选择对方已共享的产线');
      const parsed=normalizeLine(published??action.line,supplier,id);line=parsed.line;give=parsed.egg;
      if(demand.greenNest&&!line.greenParentId)throw new Error('请选择学院小窝里的亲本');
    }else{
      give=ownEgg(state,supplier,str(action.giveId));available(give as WorkflowEgg);
      if(requesting&&!(give as WorkflowEgg).listed)throw new Error('供给已停止挂出');
    }
    if (!canMatchDemand(demand, give)) throw new Error('提供的蛋不符合需求');
    let returnDemandId: string | undefined;
    if (action.returnDemandId) {
      const backDemand = getDemand(action.returnDemandId);
      if (backDemand.demanderAccountId !== supplier || backDemand.status !== 'open' || !canMatchDemand(backDemand, receive)) throw new Error('换回的蛋不符合对方需求');
      if(returnLine&&backDemand.greenNest&&!returnLine.greenParentId)throw new Error('换回产线需要学院小窝亲本');
      returnDemandId = backDemand.id;
    }
    state.trades.push({ id, groupId, demandId: demand.id, supplierAccountId: supplier, demanderAccountId: demand.demanderAccountId, initiatorAccountId: actor, returnDemandId,
      give: { ...give }, receive: { ...receive }, line, returnLine, lineOfferId:typeof action.lineId==='string'?action.lineId:undefined, returnLineOfferId:typeof action.returnLineId==='string'?action.returnLineId:undefined, type: line||returnLine ? 'custom' : 'spot', status: 'proposed', placed: false, returnPlaced:false, createdAt: now });
    return state;
  }
  if (action.type === 'order') {
    if (!Array.isArray(action.ids) || action.ids.some(id => typeof id !== 'string' || !state.trades.some(t => t.id === id && [t.supplierAccountId, t.demanderAccountId].includes(actor)))) throw new Error('排序无效');
    state.orders[JSON.stringify(actor)] = [...new Set(action.ids as string[])];
    return state;
  }
  const trade = state.trades.find(t => t.id === str(action.id));
  if (!trade || trade.groupId !== groupId || ![trade.supplierAccountId, trade.demanderAccountId].includes(actor)) throw new Error('任务不存在或无权操作');
  const demand = getDemand(trade.demandId);
  if (action.type === 'remind') {
    if (['done', 'cancelled'].includes(trade.status)) throw new Error('任务已结束');
    if (trade.reminderAt != null && now - trade.reminderAt < 3_600_000) throw new Error('已经催过，稍后再试');
    trade.reminderAt = now; trade.reminderBy = actor;
  } else if (action.type === 'accept') {
    if (actor !== (trade.initiatorAccountId === trade.demanderAccountId ? trade.supplierAccountId : trade.demanderAccountId)) throw new Error('仅对方可以接受');
    if (trade.status === 'accepted') return previous;
    const hasCapacity = (d: EggDemand) => d.status === 'open' && d.fulfilled + state.trades.filter(t => active(t) && (t.demandId === d.id || t.returnDemandId === d.id)).length < d.quantity;
    if (trade.status !== 'proposed' || !hasCapacity(demand) || (trade.returnDemandId && !hasCapacity(getDemand(trade.returnDemandId)))) throw new Error('需求已满或任务不能接受');
    for(const [offerId,owner,line] of [[trade.lineOfferId,trade.supplierAccountId,trade.line],[trade.returnLineOfferId,trade.demanderAccountId,trade.returnLine]] as const){
      if(offerId){const current=(state.lines??[]).find(l=>l.accountId===owner&&l.id===offerId);
        if(!current||JSON.stringify(normalizeLine(current,owner,'compare').line)!==JSON.stringify(line))throw new Error('产线已调整，请重新发起');}
    }
    if(!trade.returnLine&&trade.receive){
      const back=ownEgg(state,trade.demanderAccountId,trade.receive.id);available(back);
      if(trade.initiatorAccountId!==trade.demanderAccountId&&!back.listed)throw new Error('换回的蛋已停止挂出');
      if(!unchanged(back,trade.receive))throw new Error('换回库存属性已变化，请重新发起');
      if(trade.returnDemandId&&!canMatchDemand(getDemand(trade.returnDemandId),back))throw new Error('换回的蛋不符合需求');
      back.status='reserved';back.listed=false;
    }
    if(!trade.line&&!trade.legacy){
      const give=ownEgg(state,trade.supplierAccountId,trade.give.id);available(give);
      if(trade.initiatorAccountId===trade.demanderAccountId&&!give.listed)throw new Error('供给已停止挂出');
      if(!canMatchDemand(demand,give)||!unchanged(give,trade.give))throw new Error('库存属性已变化');
      give.status='reserved';give.listed=false;
    }
    checkParentCapacity(state,trade);
    trade.status='accepted';
  } else if (action.type === 'place') {
    if(trade.status!=='accepted')throw new Error('任务尚未接受');
    if(actor===trade.supplierAccountId&&(trade.line||trade.legacy))trade.placed=true;
    else if(actor===trade.demanderAccountId&&trade.returnLine)trade.returnPlaced=true;
    else throw new Error('仅现孵方可标记上窝');
  } else if(action.type==='allocate'){
    if(trade.status!=='accepted')throw new Error('任务尚未接受');
    const supplier=actor===trade.supplierAccountId;
    const line=supplier?trade.line:trade.returnLine;
    if(!line||!(supplier?trade.placed:trade.returnPlaced))throw new Error('请先完成当前现孵上窝');
    const egg=ownEgg(state,actor,str(action.eggId));available(egg);
    const expected=supplier?trade.give:trade.receive!;
    if(!canMatchDemand({eggGameId:expected.eggGameId,natures:expected.nature?[expected.nature]:[],body:expected.body==='unknown'?'':expected.body,voice:expected.voice==='unknown'?'':expected.voice} as EggDemand,egg))throw new Error('现蛋不符合约定条件');
    const prior=supplier?trade.giveEggId:trade.returnEggId;
    if(prior){const old=state.eggs.find(e=>e.accountId===actor&&e.id===prior);if(old&&old.status==='reserved')old.status='available';}
    egg.status='reserved';egg.listed=false;
    if(supplier){trade.give={...egg};trade.giveEggId=egg.id;}else{trade.receive={...egg};trade.returnEggId=egg.id;}
    state.eggs=state.eggs.filter(e=>!(e.status==='available'&&e.missingFromCapture));
  } else if (action.type === 'receive') {
    if (actor !== trade.demanderAccountId) throw new Error('仅需求方可以确认收到');
    if (trade.status === 'done') return previous;
    if (trade.status !== 'accepted') throw new Error('任务尚未接受');
    if (((trade.line||trade.legacy)&&!trade.placed)||(trade.returnLine&&!trade.returnPlaced)) throw new Error('现孵任务尚未上窝');
    if((trade.line&&!trade.giveEggId)||(trade.returnLine&&!trade.returnEggId))throw new Error('请现孵方先分配现蛋');
    trade.status = 'done';trade.completedAt=now; demand.fulfilled++;
    if (trade.returnDemandId) {
      const backDemand = getDemand(trade.returnDemandId);
      backDemand.fulfilled++;
      if (backDemand.fulfilled >= backDemand.quantity) {
        backDemand.status = 'fulfilled';
        state.trades.filter(t => (t.demandId === backDemand.id || t.returnDemandId === backDemand.id) && t.status === 'proposed').forEach(t => { t.status = 'cancelled'; });
      }
    }
    if (demand.fulfilled >= demand.quantity) {
      demand.status = 'fulfilled';
      state.trades.filter(t => (t.demandId === demand.id || t.returnDemandId === demand.id) && t.status === 'proposed').forEach(t => { t.status = 'cancelled'; });
    }
    for (const egg of state.eggs) if (same(egg, trade.give) || (trade.receive && same(egg, trade.receive))) { egg.status = 'transferred'; egg.listed = false; }
  } else if (action.type === 'cancel') {
    if (trade.status === 'done') throw new Error('已完成任务不可取消');
    trade.status = 'cancelled';
    for (const egg of state.eggs) if (egg.status === 'reserved' && (same(egg, trade.give) || (trade.receive && same(egg, trade.receive))) &&
      !state.trades.some(t => active(t) && (same(egg, t.give) || (t.receive && same(egg, t.receive))))) egg.status = 'available';
    state.eggs = state.eggs.filter(egg => !(egg.status === 'available' && egg.missingFromCapture));
  } else throw new Error('不支持的操作');
  return state;
}
