import { describe, expect, test } from 'vitest';
import { emptyEggStock, reconcileEggStock, setEggListed, sortEggStock, type EggObservation } from './eggStockModel';

const egg = (over: Partial<EggObservation> = {}): EggObservation => ({
  id: 'e1', eggGameId: 3227, nature: '固执', body: '大块头', voice: '婉转声',
  provenance: 'self-bred', confidence: 'system', ...over,
});
const part = (eggs: EggObservation[], complete = true) => ({ eggs, complete });

describe('egg stock snapshots', () => {
  test('merges bag and home once by actual instance; bag wins', () => {
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 10,
      bag: part([egg()]), home: part([egg({ nature: '开朗' }), egg({ id: 'e2' })]) });
    expect(state.eggs).toHaveLength(2);
    expect(state.eggs.find(e => e.id === 'e1')).toMatchObject({ nature: '固执', location: 'bag' });
    expect(state.eggs.find(e => e.id === 'e2')?.location).toBe('home');
  });
  test('complete empty snapshot removes stock; partial or absent source never deletes', () => {
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 10,
      bag: part([egg()]), home: part([egg({ id: 'h1' })]) });
    const partial = reconcileEggStock(state, { accountId: 'me', capturedAt: 11, bag: part([], false) });
    expect(partial.eggs).toHaveLength(2);
    const bagOnly = reconcileEggStock(partial, { accountId: 'me', capturedAt: 12, bag: part([]) });
    expect(bagOnly.eggs.map(e => e.id)).toEqual(['h1']);
    const empty = reconcileEggStock(bagOnly, { accountId: 'me', capturedAt: 13, bag: part([]), home: part([]) });
    expect(empty.eggs).toEqual([]);
  });
  test('accounts and capture time are isolated; old data cannot resurrect removed eggs', () => {
    const one = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 20, bag: part([egg()]) });
    const two = reconcileEggStock(one, { accountId: 'other', capturedAt: 10, bag: part([egg()]) });
    expect(two.eggs).toHaveLength(2);
    const removed = reconcileEggStock(two, { accountId: 'me', capturedAt: 30, bag: part([]) });
    expect(reconcileEggStock(removed, { accountId: 'me', capturedAt: 25, bag: part([egg()]) })).toBe(removed);
    expect(removed.eggs.map(e => e.accountId)).toEqual(['other']);
  });
  test('unknown provenance is retained without blocking normal eggs from listing', () => {
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 1,
      bag: part([egg({ provenance: undefined, confidence: undefined }), egg({ id: 'manual', confidence: 'manual' })]) });
    expect(state.eggs[0].provenance).toBe('unknown');
    expect(setEggListed(state, 'me', 'e1', true).eggs[0].listed).toBe(true);
    expect(setEggListed(state, 'me', 'manual', true).eggs[1].listed).toBe(true);
  });
  test('listing is account scoped; source history is factual and no longer blocks circulation', () => {
    const initial = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 1, bag: part([egg()]) });
    expect(() => setEggListed(initial, 'other', 'e1', true)).toThrow(/不存在/);
    const listed = setEggListed(initial, 'me', 'e1', true);
    expect(initial.eggs[0].listed).toBe(false);
    expect(listed.eggs[0].listed).toBe(true);
    const external = reconcileEggStock(listed, { accountId: 'me', capturedAt: 2, bag: part([egg({ provenance: 'external' })]) });
    expect(external.eggs[0]).toMatchObject({ provenance: 'external', listed: true });
    const later = reconcileEggStock(external, { accountId: 'me', capturedAt: 3, bag: part([egg()]) });
    expect(later.eggs[0].provenance).toBe('external');
  });
  test('special and shiny eggs are sorted last and cannot be listed, including reclassification', () => {
    const initial = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 1,
      bag: part([egg({ id: 'special', kind: 'special' }), egg(), egg({ id: 'shiny', kind: 'shiny' }), egg({ id: 'external', provenance: 'external' })]) });
    expect(sortEggStock(initial.eggs).map(e => e.id)).toEqual(['e1', 'external', 'special', 'shiny']);
    expect(initial.eggs[0].id).toBe('special');
    expect(() => setEggListed(initial, 'me', 'special', true)).toThrow(/特殊|交换/);
    expect(() => setEggListed(initial, 'me', 'shiny', true)).toThrow(/异色|交换/);
    const listed = setEggListed(initial, 'me', 'e1', true);
    const refreshed = reconcileEggStock(listed, { accountId: 'me', capturedAt: 2, bag: part([egg({ kind: 'special' })], false) });
    expect(refreshed.eggs.find(e => e.id === 'e1')).toMatchObject({ kind: 'special', listed: false });
  });
  test('received source history survives an absent snapshot without showing ghost inventory', () => {
    const external = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 1, bag: part([egg({ provenance: 'external' })]) });
    const empty = reconcileEggStock(external, { accountId: 'me', capturedAt: 2, bag: part([]) });
    expect(empty.eggs).toEqual([]);
    expect(reconcileEggStock(empty, { accountId: 'me', capturedAt: 3, bag: part([egg()]) }).eggs[0].provenance).toBe('external');
  });
  test('a partial home refresh cannot move an existing bag egg back to home', () => {
    const bag = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 1, bag: part([egg()]) });
    const home = reconcileEggStock(bag, { accountId: 'me', capturedAt: 2, home: part([egg()]) });
    expect(home.eggs[0].location).toBe('bag');
  });
  test('rejects invalid snapshots atomically rather than deleting current data', () => {
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 1, bag: part([egg()]) });
    expect(() => reconcileEggStock(state, { accountId: 'me', capturedAt: NaN, bag: part([]) })).toThrow();
    expect(() => reconcileEggStock(state, { accountId: 'me', capturedAt: 2, bag: part([egg({ id: '' })]) })).toThrow(/实例/);
    expect(() => reconcileEggStock(state, { accountId: 'me', capturedAt: 2, bag: part([egg(), egg()]) })).toThrow(/重复/);
    expect(state.eggs).toHaveLength(1);
  });
});
