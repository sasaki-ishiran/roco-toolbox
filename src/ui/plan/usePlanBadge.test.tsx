import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { saveLastGroupId } from '../collectionGroupStore';
import { usePlanBadge } from './usePlanBadge';
import { emptyEggWorkflow } from '../../shared/eggWorkflow';
import { getPlanAlertBadge, publishPlanAlertBadge } from './planAlertsStore';

const getEggMatching = vi.hoisted(() => vi.fn());

vi.mock('../../api/eggMatching', () => ({ getEggMatching }));
vi.mock('../../api/session', () => ({
  readAccountId: () => 'acc1',
  subscribeSession: () => () => {},
}));

function Harness() {
  usePlanBadge();
  return null;
}

describe('页签红点跟随当前小组', () => {
  beforeEach(() => {
    window.localStorage.clear();
    publishPlanAlertBadge(0);
    getEggMatching.mockReset();
    getEggMatching.mockResolvedValue({version:0,state:emptyEggWorkflow()});
  });

  afterEach(() => cleanup());

  test('切组后按新组重新拉取，不再按旧组算', async () => {
    saveLastGroupId('acc1', 'mother', 'g1');
    render(<Harness />);
    await waitFor(() => expect(getEggMatching).toHaveBeenCalledWith('g1', expect.anything()));

    act(() => {
      saveLastGroupId('acc1', 'mother', 'g2');
    });

    await waitFor(() => expect(getEggMatching).toHaveBeenCalledWith('g2', expect.anything()));
  });

  test('counts actionable tasks from the new workflow',async()=>{
    saveLastGroupId('acc1','mother','g1');
    getEggMatching.mockResolvedValue({version:1,state:{...emptyEggWorkflow(),trades:[{id:'t',demanderAccountId:'acc1',supplierAccountId:'other',status:'accepted',type:'spot'}]}});
    render(<Harness/>);
    await waitFor(()=>expect(getPlanAlertBadge()).toBe(1));
  });

  test('a demander must place the return line before waiting for receipt',async()=>{
    saveLastGroupId('acc1','mother','g1');
    getEggMatching.mockResolvedValue({version:1,state:{...emptyEggWorkflow(),trades:[{id:'t',demanderAccountId:'acc1',supplierAccountId:'other',status:'accepted',type:'custom',line:{},placed:false,returnLine:{},returnPlaced:false}]}});
    render(<Harness/>);
    await waitFor(()=>expect(getPlanAlertBadge()).toBe(1));
  });

  test('receipt is not actionable while the supplier line remains unplaced',async()=>{
    saveLastGroupId('acc1','mother','g1');
    getEggMatching.mockResolvedValue({version:1,state:{...emptyEggWorkflow(),trades:[{id:'t',demanderAccountId:'acc1',supplierAccountId:'other',status:'accepted',type:'custom',line:{},placed:true,giveEggId:'g',returnLine:{},returnPlaced:true,returnEggId:'r'}]}});
    const view=render(<Harness/>);
    await waitFor(()=>expect(getPlanAlertBadge()).toBe(1));
    view.unmount();
    publishPlanAlertBadge(99);
    getEggMatching.mockResolvedValue({version:2,state:{...emptyEggWorkflow(),trades:[{id:'t',demanderAccountId:'acc1',supplierAccountId:'other',status:'accepted',type:'custom',line:{},placed:false,giveEggId:'g',returnLine:{},returnPlaced:true,returnEggId:'r'}]}});
    render(<Harness/>);
    await waitFor(()=>expect(getPlanAlertBadge()).toBe(0));
  });
});
