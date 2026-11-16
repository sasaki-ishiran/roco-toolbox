import { afterEach, expect, test, vi } from 'vitest';
import { getEggMatching, mutateEggMatching } from './eggMatching';
import { emptyEggWorkflow } from '../shared/eggWorkflow';
vi.mock('./session', () => ({ authFetch: vi.fn() }));
import { authFetch } from './session';

test('malformed historical records cannot enter the task panel',async()=>{
  vi.mocked(authFetch).mockResolvedValueOnce(Response.json({version:1,state:{...emptyEggWorkflow(),legacyHistory:[{id:'bad'}]}}));
  await expect(getEggMatching('g')).rejects.toThrow(/数据/);
});
afterEach(() => vi.resetAllMocks());
test('reads real state through authenticated group route and sends optimistic version on changes', async () => {
  const changed=vi.fn();window.addEventListener('roco:egg-workflow-changed',changed,{once:true});
  vi.mocked(authFetch).mockImplementation(async () => new Response(JSON.stringify({ ok: true, version: 1, state: emptyEggWorkflow() })));
  expect((await getEggMatching('g')).version).toBe(1);
  await mutateEggMatching('g', 1, { type: 'withdraw', id: 'd' });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(authFetch).toHaveBeenLastCalledWith('/api/collection-groups/g/egg-matching', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ baseVersion: 1, action: { type: 'withdraw', id: 'd' } }) }));
});
test('does not turn malformed success or version conflicts into empty usable data', async () => {
  vi.mocked(authFetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, version: 0, state: {} })));
  await expect(getEggMatching('g')).rejects.toThrow(/数据/);
  vi.mocked(authFetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: '小组数据已变化' }), { status: 409 }));
  await expect(mutateEggMatching('g', 0, {})).rejects.toMatchObject({ status: 409 });
});

test('rejects malformed published lines before rendering parent instructions',async()=>{
  for(const lines of [{},[{id:'l',accountId:'a',motherId:'m',fatherId:'f'}]]){
    vi.mocked(authFetch).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,version:1,state:{...emptyEggWorkflow(),lines}})));
    await expect(getEggMatching('g')).rejects.toThrow(/数据/);
  }
});
