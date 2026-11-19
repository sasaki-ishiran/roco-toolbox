import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { clearEggMatchingCache, useEggMatching } from './useEggMatching';
import { emptyEggWorkflow } from '../../shared/eggWorkflow';
import { getEggMatching,mutateEggMatching } from '../../api/eggMatching';
import { getPlanAlertBadge, publishPlanAlertBadge } from './planAlertsStore';
vi.mock('../../api/eggMatching',async original=>({...await original<typeof import('../../api/eggMatching')>(),getEggMatching:vi.fn(),mutateEggMatching:vi.fn()}));
const response=()=>({version:0,state:emptyEggWorkflow()});
beforeEach(()=>{clearEggMatchingCache();vi.mocked(getEggMatching).mockReset().mockResolvedValue(response());vi.mocked(mutateEggMatching).mockReset();});
test('re-entering the demand center reuses the last loaded data instead of loading again',async()=>{
  vi.mocked(getEggMatching).mockResolvedValueOnce({...response(),version:3});
  const first=renderHook(()=>useEggMatching('g','a'));
  await waitFor(()=>expect(first.result.current.data?.version).toBe(3));
  first.unmount();
  let resolve!:(value:ReturnType<typeof response>)=>void;
  vi.mocked(getEggMatching).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const second=renderHook(()=>useEggMatching('g','a'));
  expect(second.result.current.data?.version).toBe(3);
  expect(second.result.current.loading).toBe(false);
  await act(async()=>{resolve({...response(),version:3});});
});
test('a stale background response never replaces newer cached data',async()=>{
  vi.mocked(getEggMatching).mockResolvedValueOnce({...response(),version:5});
  const first=renderHook(()=>useEggMatching('g','a'));
  await waitFor(()=>expect(first.result.current.data?.version).toBe(5));
  first.unmount();
  vi.mocked(getEggMatching).mockResolvedValueOnce({...response(),version:4});
  const second=renderHook(()=>useEggMatching('g','a'));
  expect(second.result.current.data?.version).toBe(5);
  await waitFor(()=>expect(getEggMatching).toHaveBeenCalledTimes(2));
  expect(second.result.current.data?.version).toBe(5);
});
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
