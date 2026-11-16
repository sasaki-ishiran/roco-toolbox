import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CollectionDemand, CollectionGroupSummary } from '../shared/collectionGroups';
import { getCollectionDemands, listCollectionGroups } from '../api/collectionGroups';
import { markSynced } from '../api/session';
import { useClaimedDemands } from './useClaimedDemands';
import { getEggMatching, type EggMatchingResponse } from '../api/eggMatching';
import { emptyEggWorkflow } from '../shared/eggWorkflow';

vi.mock('../api/collectionGroups', () => ({
  listCollectionGroups: vi.fn(),
  getCollectionDemands: vi.fn(),
}));
vi.mock('../api/eggMatching',()=>({getEggMatching:vi.fn()}));
const matchingMock=vi.mocked(getEggMatching);

const listMock = vi.mocked(listCollectionGroups);
const demandMock = vi.mocked(getCollectionDemands);

const group = (id: string): CollectionGroupSummary => ({
  id,
  name: `组${id}`,
  ownerAccountId: 'owner',
  memberCount: 1,
  groupType: 'mother',
  targetRevision: 1,
  targetReady: true,
});

const claimed = (over: Partial<CollectionDemand> = {}): CollectionDemand => ({
  groupId: 'g1',
  demanderAccountId: 'm1',
  eggGameId: 100,
  nature: '固执',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'claimed',
  claimerAccountId: 'me',
  version: 1,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});
const workflow=(rows:CollectionDemand[]):EggMatchingResponse=>({version:1,state:{...emptyEggWorkflow(),trades:rows.map((d,i)=>({id:'t'+i,groupId:d.groupId,demandId:'d',supplierAccountId:d.claimerAccountId!,demanderAccountId:d.demanderAccountId,give:{id:'planned'+i,accountId:d.claimerAccountId!,eggGameId:d.eggGameId,nature:d.nature,body:d.body,voice:d.voice,status:'available',confidence:'manual',provenance:'unknown'},receive:null,type:'custom',status:'accepted',placed:false,createdAt:d.createdAt}))}});

beforeEach(() => {
  window.localStorage.clear();
  listMock.mockReset();
  demandMock.mockReset();
  matchingMock.mockReset();
  matchingMock.mockResolvedValue({version:0,state:emptyEggWorkflow()});
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('useClaimedDemands', () => {
  test('a committed exchange invalidates home tasks even within the cache lifetime',async()=>{
    window.localStorage.setItem('roco.accountId','cache-update-user');
    listMock.mockResolvedValue([group('g1')]);
    matchingMock.mockResolvedValue(workflow([claimed({claimerAccountId:'cache-update-user'})]));
    const first=renderHook(()=>useClaimedDemands());
    await waitFor(()=>expect(first.result.current.items).toHaveLength(1));
    first.unmount();
    matchingMock.mockResolvedValue(workflow([]));
    act(()=>window.dispatchEvent(new Event('roco:egg-workflow-changed')));
    const second=renderHook(()=>useClaimedDemands());
    await waitFor(()=>expect(second.result.current.items).toHaveLength(0));
    expect(listMock).toHaveBeenCalledTimes(2);
  });
  test('includes my return production line in home placement with its own attributes',async()=>{
    window.localStorage.setItem('roco.accountId','return-user');listMock.mockResolvedValue([group('g1')]);
    const data=workflow([claimed({claimerAccountId:'b',demanderAccountId:'return-user'})]);
    const trade=data.state.trades[0];
    trade.returnLine={eggGameId:3436,nature:'保守',body:'小不点',voice:'粗嗓门',gameAccountKey:'uid:9',motherId:'m9',fatherId:'f9'};
    trade.receive={...trade.give,accountId:'return-user',eggGameId:3436,nature:'保守',body:'小不点',voice:'粗嗓门'};
    trade.returnPlaced=true;matchingMock.mockResolvedValue(data);
    const view=renderHook(()=>useClaimedDemands());
    await waitFor(()=>expect(view.result.current.items).toHaveLength(1));
    expect(view.result.current.items[0]).toMatchObject({eggGameId:3436,nature:'保守',placedAt:1,placementLine:{motherId:'m9',fatherId:'f9'}});
  });
  test('a spot supplier is not assigned a hatch task just because the return side is custom',async()=>{
    window.localStorage.setItem('roco.accountId','spot-supplier');listMock.mockResolvedValue([group('g1')]);
    const data=workflow([claimed({claimerAccountId:'spot-supplier',demanderAccountId:'b'})]);
    data.state.trades[0].returnLine={eggGameId:3436,nature:'保守',body:'',voice:'',gameAccountKey:'uid:9',motherId:'m',fatherId:'f'};
    matchingMock.mockResolvedValue(data);
    const view=renderHook(()=>useClaimedDemands());
    await waitFor(()=>expect(view.result.current.loading).toBe(false));
    expect(view.result.current.items).toHaveLength(0);
  });
  test('reads accepted custom tasks from the new state and never old demand rows',async()=>{
    window.localStorage.setItem('roco.accountId','new-user');
    listMock.mockResolvedValue([group('g1')]);
    matchingMock.mockResolvedValue({version:3,state:{...emptyEggWorkflow(),trades:[{id:'new-task',groupId:'g1',demandId:'d',supplierAccountId:'new-user',demanderAccountId:'a',give:{id:'planned',accountId:'new-user',eggGameId:100,nature:'固执',body:'',voice:'',status:'available',confidence:'manual',provenance:'unknown'},receive:null,type:'custom',status:'accepted',placed:false,createdAt:1}]}});
    const view=renderHook(()=>useClaimedDemands());
    await waitFor(()=>expect(view.result.current.items).toHaveLength(1));
    expect(view.result.current.items[0]).toMatchObject({workflowTaskId:'new-task',workflowVersion:3,gender:''});
    expect(demandMock).not.toHaveBeenCalled();
  });
  test('60 秒内的缓存直接复用，反复挂载不重拉；重试会强制刷新', async () => {
    window.localStorage.setItem('roco.accountId', 'a1');
    listMock.mockResolvedValue([group('g1')]);
    matchingMock.mockResolvedValue(workflow([claimed({ claimerAccountId: 'a1' })]));

    const first = renderHook(() => useClaimedDemands());
    await waitFor(() => expect(first.result.current.items).toHaveLength(1));
    expect(listMock).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderHook(() => useClaimedDemands());
    await waitFor(() => expect(second.result.current.items).toHaveLength(1));
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(second.result.current.loading).toBe(false);

    act(() => second.result.current.reload());
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  test('换身份后旧请求晚回来也不回写，列表不会串到新身份', async () => {
    window.localStorage.setItem('roco.accountId', 'me');
    listMock.mockResolvedValue([group('g1')]);
    let releaseOld: (value: EggMatchingResponse) => void = () => {};
    matchingMock.mockImplementationOnce(
      () => new Promise<EggMatchingResponse>((resolve) => (releaseOld = resolve)),
    );
    matchingMock.mockResolvedValue(workflow([]));

    const view = renderHook(() => useClaimedDemands());
    await waitFor(() => expect(view.result.current.loading).toBe(true));

    await act(async () => {
      window.localStorage.setItem('roco.accountId', 'other');
      markSynced(0);
    });
    await waitFor(() => expect(view.result.current.accountId).toBe('other'));

    await act(async () => {
      releaseOld(workflow([claimed()]));
    });
    expect(view.result.current.items).toEqual([]);
  });

  test('一个小组读失败时保留其它组的单，并提示有几个组失败', async () => {
    window.localStorage.setItem('roco.accountId', 'x9');
    listMock.mockResolvedValue([group('g1'), group('g2')]);
    matchingMock.mockImplementation(async (groupId: string) => {
      if (groupId === 'g2') throw new Error('组已解散');
      return workflow([claimed({ claimerAccountId: 'x9' })]);
    });

    const view = renderHook(() => useClaimedDemands());
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(view.result.current.items).toHaveLength(1);
    expect(view.result.current.error).toContain('1 个小组读取失败');
  });
});
