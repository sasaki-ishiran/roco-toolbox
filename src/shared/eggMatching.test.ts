import { describe, expect, test } from 'vitest';
import {
  acceptTrade, canCirculateEgg, canMatchDemand, completeTrade, createDemand,
  createTrade, editDemand, withdrawDemand,
  type EggDemand, type EggRecord, type EggMatchingState,
} from './eggMatching';

const demand = (over: Partial<EggDemand> = {}): EggDemand => createDemand({
  id: 'd1', groupId: 'g1', demanderAccountId: 'me', eggGameId: 3227,
  natures: ['固执', '保守'], body: '大块头', voice: '婉转声', quantity: 2, ...over,
});
const egg = (over: Partial<EggRecord> = {}): EggRecord => ({
  id: 'e1', accountId: 'other', eggGameId: 3227, nature: '固执',
  body: '大块头', voice: '婉转声', provenance: 'self-bred',
  confidence: 'system', status: 'available', ...over,
});
const initial = (): EggMatchingState => ({
  demands: [demand()],
  eggs: [egg(), egg({ id: 'e2', accountId: 'me', eggGameId: 3436, nature: '开朗' })],
  trades: [],
});
const propose = (state = initial(), id = 't1') => createTrade(state, {
  id, demandId: 'd1', groupId: 'g1', actorAccountId: 'other',
  supplierEggId: 'e1', demanderEggId: 'e2',
});

describe('egg matching criteria', () => {
  test('one demand accepts any selected nature without splitting quantity', () => {
    expect(canMatchDemand(demand(), egg())).toBe(true);
    expect(canMatchDemand(demand(), egg({ nature: '保守' }))).toBe(true);
    expect(canMatchDemand(demand(), egg({ nature: '开朗' }))).toBe(false);
    expect(canMatchDemand(demand(), egg({ nature: '' }))).toBe(false);
    expect(canMatchDemand(demand(), egg({ body: 'unknown' }))).toBe(false);
    expect(canMatchDemand(demand(), egg({ eggGameId: 3436 }))).toBe(false);
  });
  test('extreme size and voice are subsets; omitted conditions do not require a value', () => {
    expect(canMatchDemand(demand(), egg({ body: '满体重', voice: '+100' }))).toBe(true);
    expect(canMatchDemand(demand({ body: '满体重', voice: '+100' }), egg())).toBe(false);
    expect(canMatchDemand(demand({ body: '小不点', voice: '粗嗓门' }), egg({ body: '零体重', voice: '-100' }))).toBe(true);
    expect(canMatchDemand(demand({ natures: [], body: '', voice: '' }), egg({ nature: '', body: 'unknown', voice: 'unknown' }))).toBe(true);
  });
  test('deduplicates natures, bounds quantities and has no gender condition', () => {
    const value = demand({ natures: ['固执', '固执', '保守'] });
    expect(value.natures).toEqual(['固执', '保守']);
    expect(value).not.toHaveProperty('gender');
    for (const quantity of [0, -1, 1.5, 100, NaN]) expect(() => demand({ quantity })).toThrow(/数量/);
    expect(() => demand({ fulfilled: 3 })).toThrow(/数量/);
  });
  test('ordinary available eggs circulate regardless of source or unknown nature; special eggs never circulate', () => {
    expect(canCirculateEgg(egg())).toBe(true);
    expect(canCirculateEgg(egg({ provenance: 'external', confidence: 'unknown', nature: '' }))).toBe(true);
    expect(canCirculateEgg(egg({ provenance: 'unknown', confidence: 'manual' }))).toBe(true);
    for (const override of [
      { kind: 'shiny' }, { kind: 'special' }, { status: 'reserved' }, { status: 'transferred' },
    ] as const) expect(canCirculateEgg(egg(override))).toBe(false);
  });
});

describe('egg trade lifecycle', () => {
  test('proposal does not reserve or fulfill; accepting atomically reserves both eggs', () => {
    const before = initial(), proposed = propose(before);
    expect(before.trades).toHaveLength(0);
    expect(proposed.trades[0].status).toBe('proposed');
    expect(proposed.eggs.every(e => e.status === 'available')).toBe(true);
    expect(() => completeTrade(proposed, 't1', 'me')).toThrow(/接受/);
    const accepted = acceptTrade(proposed, 't1', 'me');
    expect(accepted.eggs.every(e => e.status === 'reserved')).toBe(true);
    expect(accepted.demands[0].fulfilled).toBe(0);
    expect(() => acceptTrade(proposed, 't1', 'other')).toThrow(/需求方/);
  });
  test('receipt is demander-only, removes both outgoing eggs from availability and is idempotent', () => {
    const accepted = acceptTrade(propose(), 't1', 'me');
    expect(() => completeTrade(accepted, 't1', 'other')).toThrow(/需求方/);
    const done = completeTrade(accepted, 't1', 'me');
    expect(done.trades[0].status).toBe('done');
    expect(done.demands[0].fulfilled).toBe(1);
    expect(done.eggs.find(e => e.id === 'e1')).toMatchObject({ accountId: 'other', status: 'transferred' });
    expect(done.eggs.find(e => e.id === 'e2')).toMatchObject({ accountId: 'me', status: 'transferred' });
    expect(done.eggs.every(e => !canCirculateEgg(e))).toBe(true);
    expect(completeTrade(done, 't1', 'me')).toBe(done);
    expect(() => completeTrade(done, 't1', 'other')).toThrow(/需求方/);
  });
  test('rejects spoofed owner, cross-group, self trade and reused inventory', () => {
    const state = initial();
    const input = { id: 't1', demandId: 'd1', groupId: 'g1', actorAccountId: 'impostor', supplierEggId: 'e1', demanderEggId: 'e2' };
    expect(() => createTrade(state, input)).toThrow(/供给/);
    expect(() => createTrade(state, { ...input, actorAccountId: 'other', groupId: 'g2' })).toThrow(/小组/);
    expect(() => createTrade(state, { ...input, actorAccountId: 'me', supplierEggId: 'e2' })).toThrow(/自己/);
    const two = propose(propose(), 't2');
    const accepted = acceptTrade(two, 't1', 'me');
    expect(() => acceptTrade(accepted, 't2', 'me')).toThrow(/占用|库存/);
  });
  test('special inventory cannot be proposed; normal external eggs and unknown source are allowed', () => {
    for (const kind of ['special', 'shiny'] as const) {
      const state = initial(); state.eggs[0] = egg({ kind });
      expect(() => propose(state)).toThrow(/特殊|异色|交换/);
    }
    for (const provenance of ['external', 'unknown'] as const) {
      const state = initial(); state.eggs[0] = egg({ provenance, confidence: 'unknown' });
      expect(propose(state).trades[0].status).toBe('proposed');
    }
    expect(() => propose(propose())).toThrow(/重复/);
  });
  test('accepted capacity counts towards quantity and receipt closes at target', () => {
    const state = initial(); state.demands[0] = demand({ quantity: 1 });
    state.eggs.push(egg({ id: 'e3' }), egg({ id: 'e4', accountId: 'me' }));
    const one = propose(state);
    const two = createTrade(one, { id: 't2', demandId: 'd1', groupId: 'g1', actorAccountId: 'other', supplierEggId: 'e3', demanderEggId: 'e4' });
    const accepted = acceptTrade(two, 't1', 'me');
    expect(() => acceptTrade(accepted, 't2', 'me')).toThrow(/数量/);
    const done = completeTrade(accepted, 't1', 'me');
    expect(done.demands[0]).toMatchObject({ status: 'fulfilled', fulfilled: 1 });
    expect(done.trades.find(t => t.id === 't2')?.status).toBe('cancelled');
  });
  test('only unaccepted demand may edit or withdraw; rejected actions do not mutate state', () => {
    const proposed = propose();
    const changed = editDemand(proposed, 'd1', 'me', { natures: ['保守'], quantity: 3 });
    expect(changed.demands[0].quantity).toBe(3);
    expect(changed.trades[0].status).toBe('cancelled');
    expect(proposed.trades[0].status).toBe('proposed');
    expect(withdrawDemand(proposed, 'd1', 'me').demands[0].status).toBe('withdrawn');
    const accepted = acceptTrade(proposed, 't1', 'me');
    expect(() => editDemand(accepted, 'd1', 'me', { quantity: 3 })).toThrow(/已被接受/);
    expect(() => withdrawDemand(accepted, 'd1', 'me')).toThrow(/已被接受/);
    expect(() => withdrawDemand(proposed, 'd1', 'other')).toThrow(/需求方/);
  });
  test('spot trade never adds a placement requirement', () => {
    const accepted = acceptTrade(propose(), 't1', 'me');
    expect(accepted.trades[0].type).toBe('spot');
    expect(accepted.trades[0]).not.toHaveProperty('placed');
    expect(completeTrade(accepted, 't1', 'me').trades[0].status).toBe('done');
  });
});
