import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { EggStockPanel, EggArt } from './EggStockPanel';
import type { WorkflowEgg } from '../../shared/eggWorkflow';
const ordinary: WorkflowEgg = { id:'e', accountId:'a', gameAccountKey:'uid:1', eggGameId:3227,nature:'固执',body:'大块头',voice:'婉转声',provenance:'external',confidence:'system',kind:'ordinary',status:'available',listed:false };
test('stock uses egg art, keeps special eggs last, and opens details in a dialog', () => {
  const mutate=vi.fn().mockResolvedValue(undefined);
  render(<EggStockPanel eggs={[{...ordinary,id:'s',kind:'special'},ordinary]} species={[{gameId:3227,key:'p',name:'菊花梨',number:'1',eggGroups:[2]}]} busy={false} mutate={mutate}/>);
  const cards=screen.getAllByTestId('stock-card');
  expect(cards[0].getAttribute('data-egg-id')).toBe('e');
  fireEvent.click(cards[0]);
  expect(screen.getByRole('dialog',{name:'蛋详情'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'挂出'}));
  expect(mutate).toHaveBeenCalledWith({type:'list',id:'e',listed:true});
  expect(screen.queryByText('已失效')).toBeNull();
});

test('stock detail omits precise egg weight',()=>{
  render(<EggStockPanel eggs={[{...ordinary,weightGrams:123456}]} species={[{gameId:3227,key:'p',name:'菊花梨',number:'1',eggGroups:[2]}]} busy={false} mutate={vi.fn()}/>);
  fireEvent.click(screen.getByTestId('stock-card'));
  expect(screen.queryByText(/123456/)).toBeNull();
});

test('egg artwork recovers when the selected species changes',()=>{
  const view=render(<EggArt eggGameId={3227} name="菊花梨"/>);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByText('暂无蛋图')).toBeTruthy();
  view.rerender(<EggArt eggGameId={3436} name="柴渣虫"/>);
  expect(screen.getByRole('img').tagName).toBe('IMG');
});

test('stock details show egg groups and do not invent missing actual parents',()=>{
  render(<EggStockPanel eggs={[ordinary]} species={[{gameId:3227,key:'p',name:'菊花梨',number:'1',eggGroups:[2]}]} busy={false} mutate={vi.fn()}/>);
  fireEvent.click(screen.getByTestId('stock-card'));
  expect(screen.getByText('实际父母')).toBeTruthy();
  expect(screen.getByText('暂无亲本记录')).toBeTruthy();
  expect(screen.getByText('蛋组')).toBeTruthy();
});

test('stock card shows the obtained time and the detail shows it in full',()=>{
  const egg={...ordinary,obtainedAt:'2026-11-17T22:31:00'};
  render(<EggStockPanel eggs={[egg]} species={[{gameId:3227,key:'p',name:'菊花梨',number:'1',eggGroups:[2]}]} busy={false} mutate={vi.fn()}/>);
  expect(screen.getByTestId('stock-time').textContent).toBe('11-17 22:31');
  fireEvent.click(screen.getByTestId('stock-card'));
  expect(screen.getByTestId('detail-obtained-at').textContent).toBe('2026-11-17 22:31');
});

test('eggs without a captured time omit the card row and say so in the detail',()=>{
  render(<EggStockPanel eggs={[ordinary]} species={[{gameId:3227,key:'p',name:'菊花梨',number:'1',eggGroups:[2]}]} busy={false} mutate={vi.fn()}/>);
  expect(screen.queryByTestId('stock-time')).toBeNull();
  fireEvent.click(screen.getByTestId('stock-card'));
  expect(screen.getByTestId('detail-obtained-at').textContent).toBe('采集数据里没有获得时间');
});

test('home eggs show a home badge, last-confirmed time, real parents and cannot be listed',()=>{
  const home={...ordinary,id:'h',location:'home' as const,lastConfirmedAt:Date.parse('2026-11-17T23:02:00+08:00'),
    nature:'',confidence:'system' as const,labelSource:'system' as const,
    parents:{mother:{id:'m',gameId:3227,name:'菊花梨',nature:'保守',body:'大块头',voice:'+100',nestName:'普通小窝'},
      fathers:[{id:'f',gameId:3215,name:'海豹战士',nature:'胆小',body:'大块头',voice:'婉转声'}],confirmed:false}};
  render(<EggStockPanel eggs={[home]} species={[{gameId:3227,key:'p',name:'菊花梨',number:'1',eggGroups:[2]},
    {gameId:3215,key:'s',name:'海豹战士',number:'2',eggGroups:[3]}]} busy={false} mutate={vi.fn()}/>);
  expect(screen.getByTestId('stock-home-badge').textContent).toBe('家园');
  expect(screen.getByTestId('stock-confirmed').textContent).toBe('11-17 23:02');
  fireEvent.click(screen.getByTestId('stock-card'));
  expect(screen.getByTestId('detail-confirmed-at').textContent).toBe('2026-11-17 23:02');
  expect(screen.getByText('海豹战士')).toBeTruthy();
  expect(screen.getByText('可能性格：保守 / 胆小（各 30%，其余随机）')).toBeTruthy();
  expect(screen.getByText('满重 约 1/18（收进背包后确定）')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'挂出'})).toBeNull();
  expect(screen.getByText('在地家园，收进背包后才能挂出')).toBeTruthy();
});
