import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { EggDemandEditor } from './EggDemandEditor';
import { createDemand } from '../../shared/eggMatching';

test('publishes several selected species in one batch, with OR natures and no gender field',async()=>{
  const save=vi.fn().mockResolvedValue(undefined);
  render(<EggDemandEditor demand={null} species={[{gameId:3227,eggGameId:3227,key:'pear',name:'菊花梨',number:'1',eggGroups:[2]},{gameId:3436,eggGameId:3436,key:'bug',name:'柴渣虫',number:'2',eggGroups:[2]}]} busy={false} onSave={save} onClose={()=>{}}/>);
  const rows=screen.getAllByTestId('publish-egg');
  fireEvent.click(rows[0].querySelector('button[aria-label="固执"]')!);
  fireEvent.click(rows[0].querySelector('button[aria-label="保守"]')!);
  fireEvent.click(rows[1].querySelector('button[aria-label="固执"]')!);
  fireEvent.click(screen.getByRole('button',{name:/发布需求/}));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
  const drafts=save.mock.calls[0][0];
  expect(drafts).toHaveLength(2);
  expect(drafts[0].natures).toEqual(['固执','保守']);
  expect(screen.queryByLabelText('性别')).toBeNull();
});

test('editing a migrated demand preserves the no-nature condition',async()=>{
  const save=vi.fn().mockResolvedValue(undefined);
  render(<EggDemandEditor demand={createDemand({id:'d',groupId:'g',demanderAccountId:'a',eggGameId:3227,natures:[],body:'',voice:'',quantity:1})} species={[{gameId:3227,eggGameId:3227,key:'pear',name:'菊花梨',number:'1',eggGroups:[2]}]} busy={false} onSave={save} onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'保存调整'}));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0][0].natures).toEqual([]);
});
