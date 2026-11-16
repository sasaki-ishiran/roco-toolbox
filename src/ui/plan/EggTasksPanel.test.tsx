import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { EggTasksPanel } from './EggTasksPanel';
import { emptyEggWorkflow, type WorkflowTrade } from '../../shared/eggWorkflow';

test('cancelled legacy obligations remain in private history without invented species or actions',()=>{
  render(<EggTasksPanel state={{...emptyEggWorkflow(),legacyHistory:[{id:'old',groupId:'g',demanderAccountId:'a',supplierAccountId:'b',eggGroupId:4,nature:'开朗',body:'',voice:'',status:'cancelled',createdAt:1}]}} me="a" members={[]} species={[]} busy={false} mutate={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'已取消'}));
  expect(screen.getByText(/昆虫组/)).toBeTruthy();
  expect(screen.getByText('开朗')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'已收到'})).toBeNull();
});
test('real patrol observation is shown inline without changing task progress',()=>{
  const egg={id:'e',accountId:'b',eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,provenance:'unknown' as const,confidence:'manual' as const,status:'reserved' as const};
  const trade:WorkflowTrade={id:'t',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give:egg,receive:null,type:'custom',status:'accepted',placed:true,createdAt:1,
    line:{eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:293143',motherId:'capture_293143_1',fatherId:'capture_293143_2'}};
  render(<EggTasksPanel state={{...emptyEggWorkflow(),trades:[trade],patrol:[{tradeId:'t',side:'give',status:'produced',checkedAt:1,notification:'sent'}]}} me="b" members={[]} species={[]} busy={false} mutate={vi.fn()}/>);
  expect(screen.getByText(/发现产出 · 已提醒/)).toBeTruthy();
  expect(screen.getByRole('button',{name:'分配现蛋'})).toBeTruthy();
});
test('task progress and receipt are inline, with no supplier receipt action', async () => {
  const egg={id:'e',accountId:'b',eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,provenance:'unknown' as const,confidence:'manual' as const,status:'reserved' as const};
  const trade: WorkflowTrade={id:'t',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give:egg,receive:{...egg,id:'back',accountId:'a'},type:'spot',status:'accepted',placed:false,createdAt:1};
  const mutate=vi.fn().mockResolvedValue(undefined);
  const props={state:{...emptyEggWorkflow(),trades:[trade]},me:'a',members:[{accountId:'b',displayName:'乙'}],species:[{gameId:3227,key:'p',name:'菊花梨',number:'1',eggGroups:[2]}],busy:false,mutate};
  const view=render(<EggTasksPanel {...props}/>);
  expect(screen.getByRole('list',{name:'换蛋进度'})).toBeTruthy();
  expect(screen.getAllByRole('img',{name:'菊花梨的蛋'})).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'已收到'}));
  expect(screen.getByRole('dialog',{name:'确认收货'})).toBeTruthy();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'确认已收到'}));});
  expect(mutate).toHaveBeenCalledWith({type:'receive',id:'t'});
  view.rerender(<EggTasksPanel {...props} me="b"/>);
  expect(screen.queryByRole('button',{name:'已收到'})).toBeNull();
});

test('sorting requires 300ms and movement above 8px, excludes buttons, and persists on release',async()=>{
  vi.spyOn(window,'scrollBy').mockImplementation(()=>{});
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});
  const give={id:'e',accountId:'b',eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,provenance:'unknown' as const,confidence:'manual' as const,status:'reserved' as const};
  const trade:WorkflowTrade={id:'t1',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give,receive:null,type:'spot',status:'accepted',placed:false,createdAt:2};
  const mutate=vi.fn().mockResolvedValue(undefined);
  const view=render(<EggTasksPanel state={{...emptyEggWorkflow(),trades:[trade,{...trade,id:'t2',createdAt:1}]}} me="a" members={[]} species={[]} busy={false} mutate={mutate}/>);
  const cards=view.container.querySelectorAll<HTMLElement>('[data-task-id]');
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>cards[1]});
  fireEvent.mouseDown(cards[0],{button:0,clientX:10,clientY:10});
  act(()=>vi.advanceTimersByTime(301));
  fireEvent.mouseMove(window,{clientX:10,clientY:17});
  expect(cards[0].className).not.toContain('border-emerald-500');
  fireEvent.mouseMove(window,{clientX:10,clientY:50});
  expect(cards[0].className).toContain('border-emerald-500');
  await act(async()=>{fireEvent.mouseUp(window);});
  expect(mutate).toHaveBeenCalledWith({type:'order',ids:['t2','t1']});
  mutate.mockClear();
  fireEvent.mouseDown(cards[0].querySelector('button')!,{button:0,clientX:10,clientY:10});
  act(()=>vi.advanceTimersByTime(301));
  fireEvent.mouseMove(window,{clientX:10,clientY:50});fireEvent.mouseUp(window);
  expect(mutate).not.toHaveBeenCalled();
  view.unmount();vi.useRealTimers();
});

test('accepted custom tasks retain their actual parent instructions inline',()=>{
  const give={id:'e',accountId:'b',eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,provenance:'unknown' as const,confidence:'manual' as const,status:'reserved' as const};
  const trade:WorkflowTrade={id:'t',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give,receive:null,type:'custom',status:'accepted',placed:false,createdAt:1,line:{eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:11',motherId:'cap_m',fatherId:'cap_f',greenParentId:'cap_m'}};
  render(<EggTasksPanel state={{...emptyEggWorkflow(),trades:[trade]}} me="b" members={[]} species={[]} busy={false} mutate={vi.fn()}/>);
  expect(screen.getByRole('img',{name:'进学院小窝'})).toBeTruthy();
  expect(screen.getAllByText('亲本待更新')).toHaveLength(2);
  expect(screen.queryByText('cap_m')).toBeNull();
});

test('a demander with a return production line places their own line before receipt',async()=>{
  const egg={id:'e',accountId:'b',eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,provenance:'unknown' as const,confidence:'manual' as const,status:'reserved' as const};
  const line={eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,gameAccountKey:'uid:1',motherId:'m',fatherId:'f'};
  const trade:WorkflowTrade={id:'t',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give:egg,receive:{...egg,accountId:'a'},returnLine:line,type:'custom',status:'accepted',placed:false,returnPlaced:false,createdAt:1};
  const mutate=vi.fn().mockResolvedValue(undefined);
  render(<EggTasksPanel state={{...emptyEggWorkflow(),trades:[trade]}} me="a" members={[]} species={[]} busy={false} mutate={mutate}/>);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'已上窝'})));
  expect(mutate).toHaveBeenCalledWith({type:'place',id:'t'});
  expect(screen.queryByRole('button',{name:'已收到'})).toBeNull();
});

test('a placed producer allocates a matching captured egg in a compact modal',async()=>{
  const egg={id:'egg',accountId:'b',gameAccountKey:'uid:2',listed:false,eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,provenance:'unknown' as const,confidence:'manual' as const,status:'available' as const};
  const line={eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,gameAccountKey:'uid:2',motherId:'m',fatherId:'f'};
  const trade:WorkflowTrade={id:'t',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give:egg,receive:null,line,type:'custom',status:'accepted',placed:true,createdAt:1};
  const mutate=vi.fn().mockResolvedValue(undefined);
  render(<EggTasksPanel state={{...emptyEggWorkflow(),eggs:[egg],trades:[trade]}} me="b" members={[]} species={[]} busy={false} mutate={mutate}/>);
  fireEvent.click(screen.getByRole('button',{name:'分配现蛋'}));
  expect(screen.getByRole('dialog',{name:'分配现蛋'})).toBeTruthy();
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'分配这颗'})));
  expect(mutate).toHaveBeenCalledWith({type:'allocate',id:'t',eggId:'egg'});
});


test('a placed custom task shows the placement step while waiting for actual egg allocation',()=>{
 const give={id:'planned',accountId:'b',eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,provenance:'unknown' as const,confidence:'manual' as const,status:'available' as const};
 const line={eggGameId:3227,nature:'固执',body:'' as const,voice:'' as const,gameAccountKey:'uid:1',motherId:'m',fatherId:'f'};
 const trade:WorkflowTrade={id:'t',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give,receive:null,line,type:'custom',status:'accepted',placed:true,createdAt:1};
 render(<EggTasksPanel state={{...emptyEggWorkflow(),trades:[trade]}} me="b" members={[]} species={[]} busy={false} mutate={vi.fn()}/>);
 expect(screen.getByRole('list',{name:'换蛋进度'}).querySelector('[aria-current=step]')?.textContent).toBe('已上窝');
 expect(screen.getByRole('button',{name:'分配现蛋'})).toBeTruthy();
});
