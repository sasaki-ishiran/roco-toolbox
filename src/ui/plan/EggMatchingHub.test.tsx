import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { EggMatchingHub } from './EggMatchingHub';
import { createDemand } from '../../shared/eggMatching';
import { act } from '@testing-library/react';
import { emptyEggWorkflow } from '../../shared/eggWorkflow';
const mutate = vi.fn().mockResolvedValue(undefined);
const state = { ...emptyEggWorkflow(), demands: [createDemand({ id: 'd', groupId: 'g', demanderAccountId: 'a',
  eggGameId: 3227, natures: ['固执','保守'], body: '大块头', voice: '婉转声', quantity: 2 })] };
vi.mock('./useEggMatching', () => ({ useEggMatching: () => ({ data: { version: 0, state }, loading: false,
  busy: false, error: null, refresh: vi.fn(), mutate }) }));
const props = { groupId: 'g', viewerAccountId: 'a', species: [{ gameId: 3227, eggGameId: 3227, name: '菊花梨',
  key: '3227', number: '1', eggGroups: [2] }], members: [{ accountId: 'a', displayName: '我' }], snapshots: [] };
test('uses approved hub levels and species names, with stock and tasks as utility entries', () => {
  render(<EggMatchingHub {...props} />);
  expect(screen.getByText('我的收集')).toBeTruthy();
  expect(screen.getByText('组内广场')).toBeTruthy();
  expect(screen.getByText('蛋仓')).toBeTruthy();
  expect(screen.getByText('菊花梨')).toBeTruthy();
  expect(screen.queryByText('菊花梨蛋')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /菊花梨/ }));
  expect(screen.getByRole('dialog', { name: '需求详情' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '调整需求' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '撤回' })).toBeTruthy();
  expect(screen.queryByText('去旧需求中心')).toBeNull();
  expect(screen.getAllByRole('img',{name:'大块头'}).length).toBeGreaterThan(1);
});

test('a home scene alone syncs its eggs with homeComplete',async()=>{
  mutate.mockClear();mutate.mockResolvedValue(undefined);
  const home={schemaVersion:1 as const,gameId:'1001',capturedAt:'2026-11-17T23:00:00+08:00',
    residents:[{instanceId:'11',baseId:'b',confId:10009,furnitureGuid:'nest1',actorId:'a1',name:'菊花梨',gender:'母' as const}],
    nests:[{furnitureGuid:'nest1',configId:1,nestType:'ordinary' as const,nestName:'普通小窝',residentIds:[]}],
    layEggCouples:[],sceneEggs:[{actorId:'e1',furnitureGuid:'nest1'}],couplesStale:false,snapshotKind:'full' as const};
  const snapshots=[{accountName:'甲',gameId:1001,exportedAt:'2026-11-17T14:00:00Z',importedAt:'2026-11-17T14:00:01Z',pets:[],eggs:[],eggInventoryComplete:true,home}];
  render(<EggMatchingHub {...props} snapshots={snapshots}/>);
  await waitFor(()=>expect(mutate).toHaveBeenCalledTimes(1));
  const action=mutate.mock.calls[0][0];
  expect(action).toMatchObject({type:'stock-sync',complete:true,homeComplete:true});
  expect(action.eggs).toHaveLength(1);
  expect(action.eggs[0]).toMatchObject({location:'home',eggGameId:3011,lastConfirmedAt:Date.parse('2026-11-17T23:00:00+08:00')});
});

test('a failed capture sync is attempted once until the user retries',async()=>{
  mutate.mockClear();mutate.mockRejectedValue(new Error('网络失败'));
  const snapshots=[{accountName:'甲',gameId:1001,exportedAt:'2026-11-16T00:00:00Z',importedAt:'2026-11-16T00:00:01Z',pets:[],eggs:[],eggInventoryComplete:true}];
  const view=render(<EggMatchingHub {...props} snapshots={snapshots}/>);
  await waitFor(()=>expect(mutate).toHaveBeenCalledTimes(1));
  view.rerender(<EggMatchingHub {...props} snapshots={[...snapshots]}/>);
  await new Promise(r=>setTimeout(r,30));
  expect(mutate).toHaveBeenCalledTimes(1);
  mutate.mockResolvedValue(undefined);
});

test('my demand lists who has eggs and who can hatch, then opens their needs',()=>{
  const line={id:'l',accountId:'b',eggGameId:3227,nature:'固执',body:'大块头' as const,voice:'婉转声' as const,gameAccountKey:'uid:2',motherId:'m',fatherId:'f'};
  const data=state as typeof state & {lines:typeof line[]};data.lines=[line];
  render(<EggMatchingHub {...props} members={[...props.members,{accountId:'b',displayName:'乙'}]}/>);
  fireEvent.click(screen.getByRole('button',{name:/菊花梨/}));
  expect(screen.getByText('组内现蛋')).toBeTruthy();
  expect(screen.getByText('组内能帮我孵')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'看他的需求'}));
  expect(screen.getByRole('dialog',{name:'我能满足他的需求'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'我的收集'}).getAttribute('aria-pressed')).toBe('true');
  data.lines=[];
});

test('square cards show whether I can supply and can be filtered to affordable only',()=>{
  state.demands.push({...createDemand({id:'d2',groupId:'g',demanderAccountId:'b',eggGameId:3227,natures:['固执'],body:'大块头',voice:'婉转声',quantity:1}),});
  state.demands.push(createDemand({id:'d3',groupId:'g',demanderAccountId:'b',eggGameId:9999,natures:['固执'],body:'',voice:'',quantity:1}));
  const egg={id:'e1',accountId:'a',gameAccountKey:'uid:1',eggGameId:3227,nature:'固执',body:'大块头' as const,voice:'婉转声' as const,
    kind:'ordinary' as const,status:'available' as const,listed:true,provenance:'unknown' as const,confidence:'manual' as const,labelSource:'unknown' as const};
  const data=state as typeof state & {eggs:(typeof egg)[]};data.eggs=[egg];
  render(<EggMatchingHub {...props} members={[...props.members,{accountId:'b',displayName:'乙'}]}/>);
  fireEvent.click(screen.getByText('组内广场'));
  expect(screen.getAllByText('我能给蛋').length).toBeGreaterThan(0);
  expect(screen.getByText('接不了')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'只看我能接'}));
  expect(screen.getByRole('button',{name:'只看我能接'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText('接不了')).toBeNull();
  data.eggs=[];state.demands.length=1;
});

test('demander picks my own egg for the peer and confirms before the trade is sent',()=>{
  mutate.mockClear();
  state.demands.push(createDemand({id:'d2',groupId:'g',demanderAccountId:'b',eggGameId:3227,natures:['固执'],body:'',voice:'',quantity:1}));
  const base={eggGameId:3227,nature:'固执',body:'大块头' as const,voice:'婉转声' as const,
    kind:'ordinary' as const,status:'available' as const,listed:true,provenance:'unknown' as const,confidence:'manual' as const,labelSource:'unknown' as const};
  const data=state as typeof state & {eggs:(typeof base & {id:string;accountId:string;gameAccountKey:string})[]};
  data.eggs=[{...base,id:'mine',accountId:'a',gameAccountKey:'uid:1'},{...base,id:'theirs',accountId:'b',gameAccountKey:'uid:2'}];
  render(<EggMatchingHub {...props} members={[...props.members,{accountId:'b',displayName:'乙'}]}/>);
  fireEvent.click(screen.getByRole('button',{name:/菊花梨/}));
  fireEvent.click(screen.getByRole('button',{name:'看他的需求'}));
  expect(screen.getByRole('dialog',{name:'我能满足他的需求'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'选这颗'}));
  expect(screen.getByRole('dialog',{name:'发起换蛋'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'确认发起'}));
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate.mock.calls[0][0]).toMatchObject({type:'request',supplierAccountId:'b'});
  data.eggs=[];state.demands.length=1;
});

test('completed collections remain accessible in a collapsed history',()=>{
  state.demands.push({...state.demands[0],id:'done',quantity:1,fulfilled:1,status:'fulfilled'});
  const view=render(<EggMatchingHub {...props}/>);
  const history=screen.getByText('已完成 · 1').closest('details');
  expect(history).toBeTruthy();
  expect(history?.open).toBe(false);
  expect(history?.querySelector('[data-demand-id="done"]')).toBeTruthy();
  view.unmount();state.demands.pop();
});

test('retry also retries a failed published-line sync',async()=>{
  mutate.mockClear();mutate.mockRejectedValueOnce(new Error('产线网络失败')).mockResolvedValue(undefined);
  const data=state as typeof state & {lines:{id:string;accountId:string}[]};data.lines=[{id:'old',accountId:'a',eggGameId:3227,nature:'',body:'',voice:'',gameAccountKey:'uid:1',motherId:'m',fatherId:'f'}];
  const view=render(<EggMatchingHub {...props}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'重试同步'})).toBeTruthy());
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'重试同步'})));
  await waitFor(()=>expect(mutate).toHaveBeenCalledTimes(2));
  view.unmount();data.lines=[];
});
