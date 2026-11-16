import {
  DEMAND_NATURE_LENGTH_MAX, DEMAND_NATURE_MAX, isDemandBody, isDemandVoice,
  type DemandBody, type DemandVoice,
} from './collectionGroups';

/** Pure rules only. Callers must supply authenticated identities and use a DB transaction. */
export interface EggDemand {
  id: string;
  groupId: string;
  demanderAccountId: string;
  eggGameId: number;
  natures: string[];
  body: DemandBody;
  voice: DemandVoice;
  quantity: number;
  fulfilled: number;
  status: 'open' | 'fulfilled' | 'withdrawn';
  greenNest?: boolean;
}

export interface EggRecord {
  /** Stable captured instance ID, scoped by accountId; never name + weight. */
  id: string;
  accountId: string;
  eggGameId: number;
  nature: string;
  body: DemandBody | 'unknown';
  voice: DemandVoice | 'unknown';
  provenance: 'self-bred' | 'external' | 'unknown';
  confidence: 'system' | 'manual' | 'unknown';
  /** Ordinary is the default under the user's 2026-11-16 circulation policy. */
  kind?: 'ordinary' | 'shiny' | 'special';
  status: 'available' | 'reserved' | 'transferred';
}

export interface EggTrade {
  id: string;
  groupId: string;
  demandId: string;
  demanderAccountId: string;
  supplierAccountId: string;
  supplierEgg: EggRecord;
  demanderEgg: EggRecord;
  type: 'spot';
  status: 'proposed' | 'accepted' | 'done' | 'cancelled';
}

export interface EggMatchingState {
  demands: EggDemand[];
  eggs: EggRecord[];
  trades: EggTrade[];
}

type DemandInput = Omit<EggDemand, 'fulfilled' | 'status'> & { fulfilled?: number };
type DemandPatch = Partial<Pick<EggDemand, 'natures' | 'body' | 'voice' | 'quantity'>>;

export function createDemand(input: DemandInput): EggDemand {
  if (!input.id?.trim() || !input.groupId?.trim() || !input.demanderAccountId?.trim() ||
      !Number.isSafeInteger(input.eggGameId) || input.eggGameId <= 0) throw new Error('需求标识无效');
  const fulfilled = input.fulfilled ?? 0;
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99 ||
      !Number.isInteger(fulfilled) || fulfilled < 0 || fulfilled > input.quantity) throw new Error('需求数量无效');
  if (!Array.isArray(input.natures) || input.natures.some(n => typeof n !== 'string' || !n.trim() || n.trim().length > DEMAND_NATURE_LENGTH_MAX)) throw new Error('目标性格无效');
  const natures = [...new Set(input.natures.map(n => n.trim()))];
  if (natures.length > DEMAND_NATURE_MAX) throw new Error('目标性格过多');
  if (!isDemandBody(input.body) || !isDemandVoice(input.voice)) throw new Error('需求奖牌无效');
  if (input.greenNest && !natures.length) throw new Error('绿窝需指定性格');
  // Explicit fields: legacy gender and arbitrary payload properties never enter the new model.
  return { id: input.id, groupId: input.groupId, demanderAccountId: input.demanderAccountId,
    eggGameId: input.eggGameId, natures, body: input.body, voice: input.voice,
    quantity: input.quantity, fulfilled, status: fulfilled === input.quantity ? 'fulfilled' : 'open',
    ...(input.greenNest ? {greenNest:true} : {}) };
}

export function canCirculateEgg(egg: EggRecord): boolean {
  return egg.status === 'available' && egg.kind !== 'shiny' && egg.kind !== 'special';
}

export function canMatchDemand(demand: EggDemand, egg: Pick<EggRecord, 'eggGameId' | 'nature' | 'body' | 'voice'>): boolean {
  if (demand.eggGameId !== egg.eggGameId) return false;
  if (demand.natures.length && !demand.natures.includes(egg.nature)) return false;
  const body = !demand.body || demand.body === egg.body ||
    (demand.body === '大块头' && egg.body === '满体重') ||
    (demand.body === '小不点' && egg.body === '零体重');
  const voice = !demand.voice || demand.voice === egg.voice ||
    (demand.voice === '婉转声' && egg.voice === '+100') ||
    (demand.voice === '粗嗓门' && egg.voice === '-100');
  return body && voice;
}

const copyEgg = (egg: EggRecord): EggRecord => ({ ...egg });
const sameEgg = (a: EggRecord, b: EggRecord): boolean => a.id === b.id && a.accountId === b.accountId;
const getDemand = (state: EggMatchingState, id: string): EggDemand => {
  const value = state.demands.find(d => d.id === id);
  if (!value) throw new Error('需求不存在');
  return value;
};
const getTrade = (state: EggMatchingState, id: string): EggTrade => {
  const value = state.trades.find(t => t.id === id);
  if (!value) throw new Error('换蛋任务不存在');
  return value;
};
const requireDemander = (account: string, expected: string): void => {
  if (account !== expected) throw new Error('仅需求方可以操作');
};
const requireOpen = (demand: EggDemand): void => {
  if (demand.status !== 'open' || demand.fulfilled >= demand.quantity) throw new Error('需求数量已满或已撤回');
};
const availableEgg = (state: EggMatchingState, owner: string, id: string): EggRecord => {
  const egg = state.eggs.find(e => e.accountId === owner && e.id === id);
  if (!egg) throw new Error('供给库存不存在或不属于当前账号');
  if (egg.status !== 'available') throw new Error('库存已占用');
  if (!canCirculateEgg(egg)) throw new Error('异色蛋和特殊蛋不可交换');
  return egg;
};

export function createTrade(state: EggMatchingState, input: {
  id: string; demandId: string; groupId: string; actorAccountId: string;
  supplierEggId: string; demanderEggId: string;
}): EggMatchingState {
  if (!input.id?.trim() || state.trades.some(t => t.id === input.id)) throw new Error('任务标识为空或重复');
  const demand = getDemand(state, input.demandId);
  if (demand.groupId !== input.groupId) throw new Error('小组不匹配');
  if (input.actorAccountId === demand.demanderAccountId) throw new Error('不能与自己换蛋');
  requireOpen(demand);
  const supplierEgg = availableEgg(state, input.actorAccountId, input.supplierEggId);
  const demanderEgg = availableEgg(state, demand.demanderAccountId, input.demanderEggId);
  if (!canMatchDemand(demand, supplierEgg)) throw new Error('供给不符合需求');
  const trade: EggTrade = { id: input.id, groupId: input.groupId, demandId: demand.id,
    demanderAccountId: demand.demanderAccountId, supplierAccountId: input.actorAccountId,
    supplierEgg: copyEgg(supplierEgg), demanderEgg: copyEgg(demanderEgg), type: 'spot', status: 'proposed' };
  return { ...state, trades: [...state.trades, trade] };
}

export function acceptTrade(state: EggMatchingState, id: string, actorAccountId: string): EggMatchingState {
  const trade = getTrade(state, id);
  requireDemander(actorAccountId, trade.demanderAccountId);
  if (trade.status === 'accepted') return state;
  if (trade.status !== 'proposed') throw new Error('任务不能接受');
  const demand = getDemand(state, trade.demandId);
  requireOpen(demand);
  const reserved = state.trades.filter(t => t.demandId === demand.id && t.status === 'accepted').length;
  if (demand.fulfilled + reserved >= demand.quantity) throw new Error('需求剩余数量不足');
  const give = availableEgg(state, trade.supplierAccountId, trade.supplierEgg.id);
  const back = availableEgg(state, trade.demanderAccountId, trade.demanderEgg.id);
  // Reject a changed listing; accepting an old proposal must not silently accept different attributes.
  const unchanged = (a: EggRecord, b: EggRecord) => a.eggGameId === b.eggGameId && a.nature === b.nature && a.body === b.body && a.voice === b.voice;
  if (!canMatchDemand(demand, give) || !unchanged(give, trade.supplierEgg) || !unchanged(back, trade.demanderEgg)) throw new Error('库存属性已变更，请重新提出');
  return { ...state,
    eggs: state.eggs.map(e => sameEgg(e, give) || sameEgg(e, back) ? { ...e, status: 'reserved' } : e),
    trades: state.trades.map(t => t.id === id ? { ...t, status: 'accepted' } : t) };
}

export function completeTrade(state: EggMatchingState, id: string, actorAccountId: string): EggMatchingState {
  const trade = getTrade(state, id);
  requireDemander(actorAccountId, trade.demanderAccountId);
  if (trade.status === 'done') return state;
  if (trade.status !== 'accepted') throw new Error('任务尚未接受');
  const demand = getDemand(state, trade.demandId);
  requireOpen(demand);
  const nextDemand = { ...demand, fulfilled: demand.fulfilled + 1 };
  if (nextDemand.fulfilled === nextDemand.quantity) nextDemand.status = 'fulfilled';
  // Actual inventory reconciliation owns recipient instance IDs. Do not fabricate received inventory.
  // Keep original owner records as transferred; adapters must join receipts to actual captures.
  return { ...state,
    demands: state.demands.map(d => d.id === demand.id ? nextDemand : d),
    eggs: state.eggs.map(e => sameEgg(e, trade.supplierEgg) || sameEgg(e, trade.demanderEgg)
      ? { ...e, provenance: 'external', status: 'transferred' } : e),
    trades: state.trades.map(t => t.id === id ? { ...t, status: 'done' } :
      t.demandId === demand.id && t.status === 'proposed' && nextDemand.status === 'fulfilled'
        ? { ...t, status: 'cancelled' } : t) };
}

function manageableDemand(state: EggMatchingState, id: string, actorAccountId: string): EggDemand {
  const demand = getDemand(state, id);
  requireDemander(actorAccountId, demand.demanderAccountId);
  requireOpen(demand);
  if (state.trades.some(t => t.demandId === id && t.status === 'accepted')) throw new Error('需求已被接受，不能调整或撤回');
  return demand;
}

export function editDemand(state: EggMatchingState, id: string, actorAccountId: string, patch: DemandPatch): EggMatchingState {
  const previous = manageableDemand(state, id, actorAccountId);
  const demand = createDemand({ ...previous, ...patch });
  if (demand.quantity <= demand.fulfilled) throw new Error('需求数量必须大于已收到数量');
  return { ...state, demands: state.demands.map(d => d.id === id ? demand : d),
    trades: state.trades.map(t => t.demandId === id && t.status === 'proposed' ? { ...t, status: 'cancelled' } : t) };
}

export function withdrawDemand(state: EggMatchingState, id: string, actorAccountId: string): EggMatchingState {
  manageableDemand(state, id, actorAccountId);
  return { ...state, demands: state.demands.map(d => d.id === id ? { ...d, status: 'withdrawn' } : d),
    trades: state.trades.map(t => t.demandId === id && t.status === 'proposed' ? { ...t, status: 'cancelled' } : t) };
}
