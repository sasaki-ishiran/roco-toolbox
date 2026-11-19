import { expect, test } from 'vitest';
import { createDemand } from './eggMatching';
import { applyEggAction, emptyEggWorkflow, type EggWorkflowState } from './eggWorkflow';

const initial = (): EggWorkflowState => ({ ...emptyEggWorkflow(), demands: [createDemand({
  id: 'd', groupId: 'g', demanderAccountId: 'a', eggGameId: 3227, natures: ['固执'], body: '', voice: '', quantity: 1 })] });
const stock = (id: string, game: number) => ({ id, eggGameId: game, nature: '固执', body: '', voice: '', kind: 'ordinary', gameAccountKey: 'uid:1' });
const sync = (state: EggWorkflowState, actor: string, id: string, game: number) =>
  applyEggAction(state, 'g', actor, { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: true, eggs: [stock(id, game)] }, 1);
test('authenticated spot flow reserves only after accepting and receipt is demander-only/idempotent', () => {
  let state = sync(sync(initial(), 'a', 'back', 3436), 'b', 'give', 3227);
  state = applyEggAction(state, 'g', 'a', { type: 'list', id: 'back', listed: true }, 2);
  state = applyEggAction(state, 'g', 'b', { type: 'propose', id: 't', demandId: 'd', giveId: 'give', receiveId: 'back' }, 3);
  expect(state.eggs.every(e => e.status === 'available')).toBe(true);
  expect(() => applyEggAction(state, 'g', 'b', { type: 'accept', id: 't' }, 4)).toThrow();
  state = applyEggAction(state, 'g', 'a', { type: 'accept', id: 't' }, 4);
  expect(state.eggs.every(e => e.status === 'reserved')).toBe(true);
  expect(() => applyEggAction(state, 'g', 'b', { type: 'receive', id: 't' }, 5)).toThrow();
  state = applyEggAction(state, 'g', 'a', { type: 'receive', id: 't' }, 5);
  expect(state.demands[0].fulfilled).toBe(1);
  expect(applyEggAction(state, 'g', 'a', { type: 'receive', id: 't' }, 6).demands[0].fulfilled).toBe(1);
});
test('custom offer carries actual parent IDs; no receipt before placement, no special return egg', () => {
  let state = sync(initial(), 'a', 'back', 3436);
  state = applyEggAction(state, 'g', 'a', { type: 'list', id: 'back', listed: true }, 2);
  state = applyEggAction(state, 'g', 'b', { type: 'propose', id: 't', demandId: 'd', receiveId: 'back',
    line: { eggGameId: 3227, nature: '固执', body: '', voice: '', gameAccountKey: 'uid:2', motherId: 'm', fatherId: 'f' } }, 3);
  state = applyEggAction(state, 'g', 'a', { type: 'accept', id: 't' }, 4);
  expect(() => applyEggAction(state, 'g', 'a', { type: 'receive', id: 't' }, 5)).toThrow(/上窝/);
  state = applyEggAction(state, 'g', 'b', { type: 'place', id: 't' }, 5);
  state=sync(state,'b','hatched',3227);
  state=applyEggAction(state,'g','b',{type:'allocate',id:'t',eggId:'hatched'},6);
  expect(applyEggAction(state, 'g', 'a', { type: 'receive', id: 't' }, 6).demands[0].status).toBe('fulfilled');
});
test('cross-group actions, special eggs and spoofed owners cannot mutate state', () => {
  const state = sync(sync(initial(), 'a', 'back', 3436), 'b', 'give', 3227);
  const action = { type: 'propose', id: 't', demandId: 'd', giveId: 'give', receiveId: 'back' };
  expect(() => applyEggAction(state, 'other', 'b', action, 2)).toThrow(/小组/);
  expect(() => applyEggAction(state, 'g', 'c', { type: 'list', id: 'back', listed: true }, 2)).toThrow();
  const special = applyEggAction(state, 'g', 'b', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 2, complete: true,
    eggs: [{ ...stock('give', 3227), kind: 'shiny' }] }, 2);
  expect(() => applyEggAction(special, 'g', 'b', { type: 'list', id: 'give', listed: true }, 3)).toThrow();
});
test('cancelling a competing proposal never unlocks stock reserved by an accepted task', () => {
  let state = sync(sync(initial(), 'a', 'back', 3436), 'b', 'give', 3227);
  state.demands[0].quantity = 2;
  state = applyEggAction(state, 'g', 'a', { type: 'list', id: 'back', listed: true }, 2);
  for (const id of ['t1', 't2']) state = applyEggAction(state, 'g', 'b', { type: 'propose', id, demandId: 'd', giveId: 'give', receiveId: 'back' }, 3);
  state = applyEggAction(state, 'g', 'a', { type: 'accept', id: 't1' }, 4);
  state = applyEggAction(state, 'g', 'b', { type: 'cancel', id: 't2' }, 5);
  expect(state.eggs.every(e => e.status === 'reserved')).toBe(true);
});
test('the exact same parent pair is not reserved twice', () => {
  let state = sync(initial(), 'a', 'back', 3436);
  state.demands[0].quantity = 2;
  state.eggs.push({ ...state.eggs[0], id: 'back2' });
  for (const id of ['back', 'back2']) state = applyEggAction(state, 'g', 'a', { type: 'list', id, listed: true }, 2);
  const line = { eggGameId: 3227, nature: '固执', body: '', voice: '', gameAccountKey: 'uid:2', motherId: 'm', fatherId: 'f' };
  for (const [id, receiveId] of [['t1', 'back'], ['t2', 'back2']]) state = applyEggAction(state, 'g', 'b', { type: 'propose', id, demandId: 'd', receiveId, line }, 3);
  state = applyEggAction(state, 'g', 'a', { type: 'accept', id: 't1' }, 4);
  expect(() => applyEggAction(state, 'g', 'a', { type: 'accept', id: 't2' }, 5)).toThrow(/亲本/);
});

test('bilateral custom trades wait for both owners to place and only the demander receives',()=>{
  let state=initial();
  state.demands.push(createDemand({id:'return',groupId:'g',demanderAccountId:'b',eggGameId:3436,natures:['固执'],body:'',voice:'',quantity:1}));
  const line={eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:2',motherId:'m',fatherId:'f'};
  const returnLine={...line,eggGameId:3436,gameAccountKey:'uid:1',motherId:'m1',fatherId:'f1'};
  state=applyEggAction(state,'g','a',{type:'line-sync',lines:[{...returnLine,id:'offer-a'}]},1);
  state=applyEggAction(state,'g','b',{type:'propose',id:'t',demandId:'d',line,returnLineId:'offer-a',returnDemandId:'return'},2);
  state=applyEggAction(state,'g','a',{type:'accept',id:'t'},3);
  state=applyEggAction(state,'g','b',{type:'place',id:'t'},4);
  expect(()=>applyEggAction(state,'g','a',{type:'receive',id:'t'},5)).toThrow(/上窝/);
  state=applyEggAction(state,'g','a',{type:'place',id:'t'},5);
  expect(()=>applyEggAction(state,'g','b',{type:'receive',id:'t'},6)).toThrow(/需求方/);
  state=sync(state,'b','hatched-b',3227);state=sync(state,'a','hatched-a',3436);
  state=applyEggAction(state,'g','b',{type:'allocate',id:'t',eggId:'hatched-b'},6);state=applyEggAction(state,'g','a',{type:'allocate',id:'t',eggId:'hatched-a'},6);
  state=applyEggAction(state,'g','a',{type:'receive',id:'t'},6);
  expect(state.demands.map(d=>d.status)).toEqual(['fulfilled','fulfilled']);
});

test('a demander requests a published custom line and stale line withdrawals invalidate proposals',()=>{
  let state=sync(initial(),'a','back',3436);
  const line={eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:2',motherId:'m',fatherId:'f'};
  state=applyEggAction(state,'g','b',{type:'line-sync',lines:[{...line,id:'offer'}]},1);
  state=applyEggAction(state,'g','a',{type:'request',id:'t',demandId:'d',supplierAccountId:'b',lineId:'offer',receiveId:'back'},2);
  const before=state;
  state=applyEggAction(state,'g','b',{type:'accept',id:'t'},3);
  expect(state.trades[0].line?.motherId).toBe('m');
  const removed=applyEggAction(before,'g','b',{type:'line-sync',lines:[]},3);
  expect(()=>applyEggAction(removed,'g','b',{type:'accept',id:'t'},4)).toThrow(/产线/);
});

test('one academy parent supports two distinct partners, a second academy parent is rejected',()=>{
  let state=sync(initial(),'a','back',3436);state.demands[0].quantity=4;
  state.eggs.push(...['2','3','4'].map(i=>({...state.eggs[0],id:'back'+i})));
  state.eggs.forEach(e=>e.listed=true);
  const line={eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:2',motherId:'m',fatherId:'f',greenParentId:'f'};
  for(const [id,receiveId,motherId,fatherId] of [['t1','back','m1','f'],['t2','back2','m2','f'],['t3','back3','m3','f'],['t4','back4','m4','other']]){
    state=applyEggAction(state,'g','b',{type:'propose',id,demandId:'d',receiveId,line:{...line,motherId,fatherId,greenParentId:fatherId}},2);
  }
  state=applyEggAction(state,'g','a',{type:'accept',id:'t1'},3);
  state=applyEggAction(state,'g','a',{type:'accept',id:'t2'},4);
  expect(()=>applyEggAction(state,'g','a',{type:'accept',id:'t3'},5)).toThrow(/亲本|配对/);
  expect(()=>applyEggAction(state,'g','a',{type:'accept',id:'t4'},5)).toThrow(/学院/);
});
test('accepting rejects either egg changed since proposal', () => {
  let state = sync(sync(initial(), 'a', 'back', 3436), 'b', 'give', 3227);
  state = applyEggAction(state, 'g', 'a', { type: 'list', id: 'back', listed: true }, 2);
  state = applyEggAction(state, 'g', 'b', { type: 'propose', id: 't', demandId: 'd', giveId: 'give', receiveId: 'back' }, 3);
  state = applyEggAction(state, 'g', 'a', { type: 'label', id: 'back', nature: '开朗', body: '', voice: '' }, 4);
  expect(() => applyEggAction(state, 'g', 'a', { type: 'accept', id: 't' }, 5)).toThrow(/属性/);
});

test('a demander can request listed supply; only the other member accepts and the demander receives', () => {
  let state = sync(sync(initial(), 'a', 'back', 3436), 'b', 'give', 3227);
  state = applyEggAction(state, 'g', 'b', { type: 'list', id: 'give', listed: true }, 2);
  state = applyEggAction(state, 'g', 'a', { type: 'request', id: 't', demandId: 'd', supplierAccountId: 'b', giveId: 'give', receiveId: 'back' }, 3);
  expect(() => applyEggAction(state, 'g', 'a', { type: 'accept', id: 't' }, 4)).toThrow();
  state = applyEggAction(state, 'g', 'b', { type: 'accept', id: 't' }, 4);
  expect(state.eggs.every(e => e.status === 'reserved')).toBe(true);
  expect(applyEggAction(state, 'g', 'a', { type: 'receive', id: 't' }, 5).demands[0].fulfilled).toBe(1);
});

test('a request must match the supplier return demand when one is selected', () => {
  let state = sync(sync(initial(), 'a', 'back', 3436), 'b', 'give', 3227);
  state.demands.push(createDemand({ id: 'peer', groupId: 'g', demanderAccountId: 'b', eggGameId: 3001, natures: [], body: '', voice: '', quantity: 1 }));
  state = applyEggAction(state, 'g', 'b', { type: 'list', id: 'give', listed: true }, 2);
  expect(() => applyEggAction(state, 'g', 'a', { type: 'request', id: 't', demandId: 'd', supplierAccountId: 'b', giveId: 'give', receiveId: 'back', returnDemandId: 'peer' }, 3)).toThrow(/需求/);
});

test('a special egg cannot be downgraded by a later ordinary import', () => {
  let state = sync(initial(), 'a', 'e', 3227);
  state.eggs[0].kind = 'special';
  state = applyEggAction(state, 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 2, complete: true, eggs: [stock('e',3227)] }, 2);
  expect(state.eggs[0].kind).toBe('special');
});

test('batch publishing is atomic and marks green nest only with a chosen nature',()=>{
  const draft={id:'one',eggGameId:3227,natures:['固执'],body:'大块头',voice:'婉转声',quantity:2,greenNest:true};
  const state=applyEggAction(emptyEggWorkflow(),'g','a',{type:'publish-batch',demands:[draft,{...draft,id:'two',eggGameId:3436}]},1);
  expect(state.demands).toHaveLength(2);
  expect(state.demands[0].greenNest).toBe(true);
  expect(()=>applyEggAction(emptyEggWorkflow(),'g','a',{type:'publish-batch',demands:[draft,{...draft,id:'two',natures:[]}]},1)).toThrow(/性格/);
});

test('accepted obligations lock either linked demand against edits and cancelling requires a fresh capture before relisting removed eggs',()=>{
  let state=sync(sync(initial(),'a','back',3436),'b','give',3227);
  state.demands.push(createDemand({id:'return',groupId:'g',demanderAccountId:'b',eggGameId:3436,natures:[],body:'',voice:'',quantity:1}));
  state=applyEggAction(state,'g','a',{type:'list',id:'back',listed:true},2);
  state=applyEggAction(state,'g','b',{type:'propose',id:'t',demandId:'d',giveId:'give',receiveId:'back',returnDemandId:'return'},3);
  state=applyEggAction(state,'g','a',{type:'accept',id:'t'},4);
  expect(()=>applyEggAction(state,'g','b',{type:'withdraw',id:'return'},5)).toThrow();
});

test('raw special-item evidence overrides an ordinary kind claim',()=>{
  const state=applyEggAction(initial(),'g','a',{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:1,complete:true,eggs:[{...stock('s',3227),itemConfId:150727,preciousEggType:2}]},1);
  expect(()=>applyEggAction(state,'g','a',{type:'list',id:'s',listed:true},2)).toThrow();
});

test('a reserved egg absent from a full capture is removed on cancellation, not resurrected',()=>{
  let state=sync(sync(initial(),'a','back',3436),'b','give',3227);
  state=applyEggAction(state,'g','a',{type:'list',id:'back',listed:true},2);
  state=applyEggAction(state,'g','b',{type:'propose',id:'t',demandId:'d',giveId:'give',receiveId:'back'},3);
  state=applyEggAction(state,'g','a',{type:'accept',id:'t'},4);
  state=applyEggAction(state,'g','b',{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:5,complete:true,eggs:[]},5);
  state=applyEggAction(state,'g','a',{type:'cancel',id:'t'},6);
  expect(state.eggs.find(e=>e.id==='give')).toBeUndefined();
  expect(state.eggs.find(e=>e.id==='back')?.status).toBe('available');
});

test('a hatched egg is allocated once and cannot circulate again after custom receipt',()=>{
  let state=sync(initial(),'a','back',3436);
  state=applyEggAction(state,'g','a',{type:'list',id:'back',listed:true},2);
  state=applyEggAction(state,'g','b',{type:'propose',id:'t',demandId:'d',receiveId:'back',line:{eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:2',motherId:'m',fatherId:'f'}},3);
  state=applyEggAction(state,'g','a',{type:'accept',id:'t'},4);
  state=applyEggAction(state,'g','b',{type:'place',id:'t'},5);
  state=sync(state,'b','hatched',3227);
  state=applyEggAction(state,'g','b',{type:'allocate',id:'t',eggId:'hatched'},6);
  expect(state.eggs.find(e=>e.id==='hatched')?.status).toBe('reserved');
  expect(state.trades[0].give.id).toBe('hatched');
  state=applyEggAction(state,'g','a',{type:'receive',id:'t'},7);
  expect(state.eggs.find(e=>e.id==='hatched')?.status).toBe('transferred');
  expect(()=>applyEggAction(state,'g','b',{type:'list',id:'hatched',listed:true},8)).toThrow();
});

test('a custom task waits for actual egg allocation and rejects mismatched or special eggs',()=>{
  let state=sync(initial(),'a','back',3436);
  state=applyEggAction(state,'g','a',{type:'list',id:'back',listed:true},2);
  state=applyEggAction(state,'g','b',{type:'propose',id:'t',demandId:'d',receiveId:'back',line:{eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:2',motherId:'m',fatherId:'f'}},3);
  state=applyEggAction(state,'g','a',{type:'accept',id:'t'},4);
  state=applyEggAction(state,'g','b',{type:'place',id:'t'},5);
  expect(()=>applyEggAction(state,'g','a',{type:'receive',id:'t'},6)).toThrow(/现蛋/);
  state=sync(state,'b','wrong',3436);
  expect(()=>applyEggAction(state,'g','b',{type:'allocate',id:'t',eggId:'wrong'},6)).toThrow(/不符合/);
  state=applyEggAction(state,'g','b',{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:2,complete:true,eggs:[stock('special',3227)]},6);state.eggs.find(e=>e.id==='special')!.kind='shiny';
  expect(()=>applyEggAction(state,'g','b',{type:'allocate',id:'t',eggId:'special'},6)).toThrow();
});

test('fulfilling a linked return demand cancels its obsolete proposals',()=>{
  let state=sync(sync(initial(),'a','back',3436),'b','give',3227);
  state.demands.push(createDemand({id:'return',groupId:'g',demanderAccountId:'b',eggGameId:3436,natures:[],body:'',voice:'',quantity:1}));
  state=applyEggAction(state,'g','a',{type:'list',id:'back',listed:true},2);
  for(const id of ['t1','t2'])state=applyEggAction(state,'g','b',{type:'propose',id,demandId:'d',giveId:'give',receiveId:'back',returnDemandId:'return'},3);
  state=applyEggAction(state,'g','a',{type:'accept',id:'t1'},4);
  state=applyEggAction(state,'g','a',{type:'receive',id:'t1'},5);
  expect(state.trades.find(t=>t.id==='t2')?.status).toBe('cancelled');
});


test('manual reminders allow exactly the half-hour boundary and never renew themselves', () => {
  let state = sync(sync(initial(), 'a', 'back', 3436), 'b', 'give', 3227);
  state = applyEggAction(state, 'g', 'a', { type: 'list', id: 'back', listed: true }, 2);
  state = applyEggAction(state, 'g', 'b', { type: 'propose', id: 't', demandId: 'd', giveId: 'give', receiveId: 'back' }, 3);
  state = applyEggAction(state, 'g', 'a', { type: 'remind', id: 't' }, 1000);
  expect(() => applyEggAction(state, 'g', 'b', { type: 'remind', id: 't' }, 1800999)).toThrow(/已经催过/);
  const next = applyEggAction(state, 'g', 'b', { type: 'remind', id: 't' }, 1801000);
  expect(next.trades[0].reminderAt).toBe(1801000);
  expect(next.trades[0].reminderBy).toBe('b');
  expect(state.trades[0].reminderAt).toBe(1000);
});

test('captured obtained time is kept by stock sync and survives a later capture without it', () => {
  let state = applyEggAction(emptyEggWorkflow(), 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: true,
    eggs: [{ ...stock('e', 3227), obtainedAt: '2026-11-17T22:31:00' }] }, 1);
  expect(state.eggs[0].obtainedAt).toBe('2026-11-17T22:31:00');
  state = applyEggAction(state, 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 2, complete: true, eggs: [stock('e', 3227)] }, 2);
  expect(state.eggs[0].obtainedAt).toBe('2026-11-17T22:31:00');
});

test('old records without obtained time stay valid and unusable values are dropped', () => {
  const old = applyEggAction(emptyEggWorkflow(), 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: true, eggs: [stock('e', 3227)] }, 1);
  expect(old.eggs[0].obtainedAt).toBeUndefined();
  const bad = applyEggAction(emptyEggWorkflow(), 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: true,
    eggs: [{ ...stock('e', 3227), obtainedAt: '不是时间' }] }, 1);
  expect(bad.eggs[0].obtainedAt).toBeUndefined();
});

const parents = { mother: { id: 'm', gameId: 3227, name: '菊花梨', nature: '保守', body: '大块头', voice: '+100', nestName: '普通小窝' },
  fathers: [{ id: 'f', gameId: 3215, name: '海豹战士', nature: '胆小', body: '大块头', voice: '婉转声' }], confirmed: false };
const homeEgg = (over: Record<string, unknown>) => ({ ...stock('home1', 3227), location: 'home', labelSource: 'system',
  parents, lastConfirmedAt: 1763391600000, ...over });

test('homeComplete removes only home eggs and keeps bag stock', () => {
  let state = sync(initial(), 'a', 'bag1', 3436);
  state = applyEggAction(state, 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 2, complete: false, homeComplete: true,
    eggs: [stock('bag1', 3436), homeEgg({})] }, 2);
  expect(state.eggs).toHaveLength(2);
  expect(state.eggs.find(e => e.id === 'home1')).toMatchObject({ location: 'home', labelSource: 'system', confidence: 'system', lastConfirmedAt: 1763391600000 });
  state = applyEggAction(state, 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 3, complete: false, homeComplete: true,
    eggs: [stock('bag1', 3436)] }, 3);
  expect(state.eggs.map(e => e.id)).toEqual(['bag1']);
});

test('bag complete never deletes home eggs, and a home egg without parents cannot claim system', () => {
  let state = applyEggAction(emptyEggWorkflow(), 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: false,
    homeComplete: true, eggs: [homeEgg({})] }, 1);
  state = applyEggAction(state, 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 2, complete: true, homeComplete: false,
    eggs: [] }, 2);
  expect(state.eggs.map(e => e.id)).toEqual(['home1']);
  const bare = applyEggAction(emptyEggWorkflow(), 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: true,
    eggs: [homeEgg({ parents: undefined })] }, 1);
  expect(bare.eggs[0].labelSource).toBe('unknown');
  expect(bare.eggs[0].confidence).toBe('unknown');
});

test('manual labels survive later home captures and stay manual', () => {
  let state = applyEggAction(emptyEggWorkflow(), 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: false,
    homeComplete: true, eggs: [homeEgg({})] }, 1);
  state = applyEggAction(state, 'g', 'a', { type: 'label', id: 'home1', nature: '保守', body: '大块头', voice: '婉转声' }, 2);
  state = applyEggAction(state, 'g', 'a', { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 3, complete: false,
    homeComplete: true, eggs: [homeEgg({ nature: '' })] }, 3);
  expect(state.eggs[0]).toMatchObject({ nature: '保守', labelSource: 'manual', confidence: 'manual' });
});
