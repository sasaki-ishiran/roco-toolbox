import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useEggMatching } from './useEggMatching';
import { emptyEggWorkflow } from '../../shared/eggWorkflow';
import { getEggMatching,mutateEggMatching } from '../../api/eggMatching';
import { getPlanAlertBadge, publishPlanAlertBadge } from './planAlertsStore';
vi.mock('../../api/eggMatching',async original=>({...await original<typeof import('../../api/eggMatching')>(),getEggMatching:vi.fn(),mutateEggMatching:vi.fn()}));
const response=()=>({version:0,state:emptyEggWorkflow()});
beforeEach(()=>{vi.mocked(getEggMatching).mockReset().mockResolvedValue(response());vi.mocked(mutateEggMatching).mockReset();});
test('changing identity cannot leave the new group busy or install an old mutation response',async()=>{
  let resolve!:(value:ReturnType<typeof response>)=>void;
  vi.mocked(mutateEggMatching).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const hook=renderHook(({group,me})=>useEggMatching(group,me),{initialProps:{group:'g',me:'a'}});
  await waitFor(()=>expect(hook.result.current.data).toBeTruthy());
  let writing!:Promise<unknown>;
  act(()=>{writing=hook.result.current.mutate({type:'order',ids:[]});});
  expect(hook.result.current.busy).toBe(true);
  hook.rerender({group:'h',me:'b'});
  await waitFor(()=>expect(getEggMatching).toHaveBeenCalledWith('h'));
  await act(async()=>{resolve({...response(),version:9});await writing;});
  await waitFor(()=>expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.data?.version).toBe(0);
});

test('committed mutations immediately clear resolved task alerts',async()=>{
  const ready={...response(),state:{...emptyEggWorkflow(),trades:[{id:'t',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',give:{id:'e',accountId:'b',eggGameId:3227,nature:'',body:'' as const,voice:'' as const,status:'reserved' as const,confidence:'manual' as const,provenance:'unknown' as const},receive:null,type:'spot' as const,status:'accepted' as const,placed:false,createdAt:1}]}};
  vi.mocked(getEggMatching).mockResolvedValue(ready);
  vi.mocked(mutateEggMatching).mockResolvedValue({...response(),version:1});
  const hook=renderHook(()=>useEggMatching('g','a'));
  await waitFor(()=>expect(hook.result.current.data).toBeTruthy());
  publishPlanAlertBadge(1);
  await act(async()=>{await hook.result.current.mutate({type:'receive',id:'t'});});
  expect(getPlanAlertBadge()).toBe(0);
});
