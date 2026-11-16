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
