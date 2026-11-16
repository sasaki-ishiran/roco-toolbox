import { expect, test } from 'vitest';
import { migrateEggDemands } from './eggMigration';

test('merges only former gender variants; keeps nature requirements and each outstanding unit', () => {
  const base = { group_id: 'g', demander_account_id: 'a', egg_game_id: 3227, nature: '固执',
    body: '大块头', voice: '+100', status: 'open', claimer_account_id: null, created_at: 1, placed_at: null };
  const result = migrateEggDemands([ { ...base, gender: '公' }, { ...base, gender: '母' },
    { ...base, gender: '母', nature: '保守', status: 'claimed', claimer_account_id: 'b', placed_at: 2 } ],
    [{ id: 'p1', group_id: 'g', member_account_id: 'a', egg_game_id: 3436, status: 'backlog' }]);
  expect(result.demands).toHaveLength(3);
  const merged = result.demands.find(d => d.natures[0] === '固执')!;
  expect(merged.quantity).toBe(2);
  expect(merged).not.toHaveProperty('gender');
  expect(result.trades[0]).toMatchObject({ supplierAccountId: 'b', demanderAccountId: 'a', status: 'accepted', type: 'custom', placed: true });
  expect(result.demands.find(d => d.eggGameId === 3436)).toMatchObject({ natures: [], quantity: 1 });
});
test('repeat migration is deterministic and never fabricates historical received counts or inventory', () => {
  const plans = [{ id: 'done', group_id: 'g', member_account_id: 'a', egg_game_id: 3227, status: 'done' }];
  expect(migrateEggDemands([], plans)).toEqual(migrateEggDemands([], plans));
  expect(migrateEggDemands([], plans).demands[0]).toMatchObject({ fulfilled: 1, status: 'fulfilled' });
  expect(migrateEggDemands([], plans).eggs).toEqual([]);
});

test('completed legacy receipts remain available in task history without gender', () => {
  const result=migrateEggDemands([],[],[{group_id:'g',demander_account_id:'a',claimer_account_id:'b',egg_game_id:3227,nature:'固执',body:'',voice:'',gender:'母',status:'done',placed_at:1,created_at:1,completed_at:2}]);
  expect(result.trades[0]).toMatchObject({status:'done',demanderAccountId:'a',supplierAccountId:'b',completedAt:2});
  expect(result.demands[0]).toMatchObject({status:'fulfilled',fulfilled:1});
  expect(result.demands[0]).not.toHaveProperty('gender');
});

test('migration retains green-nest requirements and original task dates',()=>{
  const result=migrateEggDemands([{group_id:'g',demander_account_id:'a',claimer_account_id:'b',egg_game_id:3227,nature:'固执',body:'',voice:'',gender:'母',status:'claimed',placed_at:20,created_at:10,require_green_nest:1}],[]);
  expect(result.demands[0].greenNest).toBe(true);
  expect(result.trades[0].createdAt).toBe(10);
});

test('untyped egg-group obligations are cancelled with history, never invented as species',()=>{
 const base={group_id:'g',demander_account_id:'a',claimer_account_id:'b',egg_game_id:-4,nature:'开朗',gender:'公',body:'',voice:'',status:'claimed',placed_at:2,created_at:1};
 const result=migrateEggDemands([base],[{id:'p',group_id:'g',member_account_id:'a',egg_game_id:-3,status:'backlog'}],[{...base,egg_game_id:-7,status:'done',completed_at:9}]);
 expect(result.demands).toEqual([]);
 expect(result.trades).toEqual([]);
 expect(result.legacyHistory).toHaveLength(3);
 expect(result.legacyHistory).toEqual(expect.arrayContaining([
   expect.objectContaining({eggGroupId:4,status:'cancelled',supplierAccountId:'b',demanderAccountId:'a'}),
   expect.objectContaining({eggGroupId:7,status:'done',completedAt:9}),
   expect.objectContaining({eggGroupId:3,status:'needs-species'}),
 ]));
 expect(result.legacyHistory.every(row=>!('gender' in row))).toBe(true);
 expect(migrateEggDemands([base],[],[])).toEqual(migrateEggDemands([base],[],[]));
});
