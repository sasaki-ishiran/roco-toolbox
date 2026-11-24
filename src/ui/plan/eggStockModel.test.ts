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
  test('picked-up home egg hands its annotation to the new bag egg (1:1)', () => {
    const parents = { mother: { id: 'm1', gameId: 1, name: '妈', nature: '', body: '', voice: '' }, fathers: [], confirmed: false, stale: false };
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 10,
      home: part([egg({ id: 'h1', provenance: 'self-bred', nature: '冷静', body: '大块头', voice: '+100', greenNest: true, parents })]) });
    const after = reconcileEggStock(state, { accountId: 'me', capturedAt: 20,
      home: part([]), bag: part([egg({ id: 'b1', provenance: 'unknown', nature: '', body: 'unknown', voice: 'unknown' })]) });
    expect(after.eggs.map(e => e.id)).toEqual(['b1']);
    expect(after.eggs[0]).toMatchObject({ provenance: 'self-bred', nature: '冷静', body: '大块头', voice: '+100', greenNest: true, parents });
  });
  test('several eggs of one species are only marked self-bred, labels are not guessed', () => {
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 10,
      home: part([egg({ id: 'h1', nature: '冷静' }), egg({ id: 'h2', nature: '开朗' })]) });
    const after = reconcileEggStock(state, { accountId: 'me', capturedAt: 20,
      home: part([]), bag: part([egg({ id: 'b1', provenance: 'unknown', nature: '' }), egg({ id: 'b2', provenance: 'unknown', nature: '' })]) });
    expect(after.eggs.map(e => e.nature)).toEqual(['', '']);
    expect(after.eggs.every(e => e.provenance === 'self-bred')).toBe(true);
  });
  test('partial home capture never hands over: eggs stay home and nothing is guessed', () => {
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 10,
      home: part([egg({ id: 'h1', nature: '冷静' })]) });
    const after = reconcileEggStock(state, { accountId: 'me', capturedAt: 20,
      home: part([], false), bag: part([egg({ id: 'b1', provenance: 'unknown', nature: '' })]) });
    expect(after.eggs.map(e => e.id).sort()).toEqual(['b1', 'h1']);
    expect(after.eggs.find(e => e.id === 'b1')).toMatchObject({ provenance: 'unknown', nature: '' });
  });
  test('re-capture keeps earlier annotation: empty capture fields never erase 自产/性格/体型/声音', () => {
    const initial = reconcileEggStock(emptyEggStock(), { accountId: 'me', capturedAt: 1,
      bag: part([egg({ confidence: 'manual', labelSource: 'manual', nature: '冷静', body: '大块头', voice: '+100', greenNest: true })]) });
    const again = reconcileEggStock(initial, { accountId: 'me', capturedAt: 2,
      bag: part([egg({ provenance: 'unknown', confidence: 'system', labelSource: 'unknown', nature: '', body: 'unknown', voice: 'unknown' })]) });
    expect(again.eggs[0]).toMatchObject({
      provenance: 'self-bred', nature: '冷静', body: '大块头', voice: '+100',
      greenNest: true, labelSource: 'manual', confidence: 'manual',
    });
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
  test('self-bred provenance survives later bag snapshots that cannot identify the source', () => {
    const home = egg({ id: 'home1', provenance: 'self-bred', location: 'home' });
    const state = reconcileEggStock(emptyEggStock(), {
      accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 10,
      home: part([home]),
    });
    const bag = egg({ id: 'home1', provenance: 'unknown' });
    const next = reconcileEggStock(state, {
      accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 20,
      bag: part([bag]),
    });
    expect(next.eggs[0]).toMatchObject({ location: 'bag', provenance: 'self-bred' });
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

  test('bag and home keep their own capture time; complete removes only its own location', () => {
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 20,
      bag: { eggs: [egg({ gameAccountKey: 'uid:1' })], complete: true, capturedAt: 10 },
      home: { eggs: [egg({ id: 'h1', gameAccountKey: 'uid:1' })], complete: true, capturedAt: 20 } });
    expect(state.eggs.find(e => e.id === 'e1')?.lastConfirmedAt).toBe(10);
    expect(state.eggs.find(e => e.id === 'h1')?.lastConfirmedAt).toBe(20);
    const next = reconcileEggStock(state, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 30,
      home: { eggs: [], complete: true, capturedAt: 30 } });
    expect(next.eggs.map(e => e.id)).toEqual(['e1']);
    const kept = reconcileEggStock(state, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 31,
      bag: { eggs: [], complete: true, capturedAt: 31 } });
    expect(kept.eggs.map(e => e.id)).toEqual(['h1']);
  });

  test('different game accounts keep separate watermarks and never delete each other', () => {
    const one = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 10,
      bag: part([egg({ gameAccountKey: 'uid:1' })]) });
    const two = reconcileEggStock(one, { accountId: 'me', gameAccountKey: 'uid:2', capturedAt: 5,
      bag: part([egg({ id: 'b', gameAccountKey: 'uid:2' })]) });
    expect(two.eggs).toHaveLength(2);
    const cleared = reconcileEggStock(two, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 11, bag: part([]) });
    expect(cleared.eggs.map(e => e.id)).toEqual(['b']);
  });

  test('home parents and system source survive re-sync', () => {
    const parents = { mother: { id: 'm', gameId: 3227, name: '菊花梨', nature: '保守', body: '大块头', voice: '+100', nestName: '普通小窝' },
      fathers: [{ id: 'f', gameId: 3215, name: '海豹战士', nature: '胆小', body: '大块头', voice: '婉转声' }], confirmed: false };
    const home = egg({ id: 'h1', nature: '', labelSource: 'system', parents });
    const state = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 1, home: part([home]) });
    expect(state.eggs[0]).toMatchObject({ location: 'home', labelSource: 'system', parents });
  });

  test('captured obtained time height and weight reach the stock and are never cleared later', () => {
    const captured = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 10,
      bag: part([egg({ provenance: 'unknown', obtainedAt: '2026-11-17T22:31:00Z', heightCm: 34, weightGrams: 2320 })]) });
    expect(captured.eggs[0]).toMatchObject({ obtainedAt: '2026-11-17T22:31:00Z', heightCm: 34, weightGrams: 2320 });
    const later = reconcileEggStock(captured, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 20,
      bag: part([egg({ provenance: 'unknown' })]) });
    expect(later.eggs[0]).toMatchObject({ obtainedAt: '2026-11-17T22:31:00Z', heightCm: 34, weightGrams: 2320 });
  });

  test('a captured bag egg fills the unique self-bred home egg instead of replacing it', () => {
    const home = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 10,
      home: part([egg({ id: 'home1', location: 'home' })]) });
    expect(home.eggs[0]).toMatchObject({ location: 'home', provenance: 'self-bred' });
    const bag = egg({ id: 'bag1', provenance: 'unknown', obtainedAt: '2026-11-17T22:31:00Z', heightCm: 34, weightGrams: 2320 });
    const merged = reconcileEggStock(home, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 20, bag: part([bag]) });
    expect(merged.eggs).toHaveLength(1);
    expect(merged.eggs[0]).toMatchObject({ id: 'home1', location: 'bag', capturedEggId: 'bag1',
      provenance: 'self-bred', obtainedAt: '2026-11-17T22:31:00Z', heightCm: 34, weightGrams: 2320 });
    expect(reconcileEggStock(merged, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 30, bag: part([bag]) }).eggs)
      .toHaveLength(1);
  });

  test('a complete capture adds its new egg without dropping the already merged stock', () => {
    const home = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 10,
      home: part([egg({ id: 'home1', location: 'home' })]) });
    const bag = egg({ id: 'bag1', provenance: 'unknown', obtainedAt: '2026-11-17T22:31:00Z' });
    const merged = reconcileEggStock(home, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 20, bag: part([bag]) });
    // 家园那边已经空了（蛋收进背包），完整快照里多出一颗新蛋：旧合并行要留，新蛋要进来。
    const next = reconcileEggStock(merged, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 30, home: part([]),
      bag: part([bag, egg({ id: 'bag2', provenance: 'unknown', obtainedAt: '2026-11-18T09:00:00Z' })]) });
    expect(next.eggs.map(e => e.id).sort()).toEqual(['bag2', 'home1']);
    expect(next.eggs.find(e => e.id === 'home1')).toMatchObject({ capturedEggId: 'bag1', provenance: 'self-bred' });
  });

  test('an incomplete capture only adds stock and never deletes', () => {
    const kept = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 10,
      bag: part([egg({ id: 'kept', provenance: 'unknown' })]) });
    const next = reconcileEggStock(kept, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 20,
      bag: part([egg({ id: 'added', provenance: 'unknown', obtainedAt: '2026-11-18T09:00:00Z' })], false) });
    expect(next.eggs.map(e => e.id).sort()).toEqual(['added', 'kept']);
  });

  test('identical home eggs are not guessed when the capture has no stable link', () => {
    const home = reconcileEggStock(emptyEggStock(), { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 10,
      home: part([egg({ id: 'home1', location: 'home' }), egg({ id: 'home2', location: 'home' })]) });
    const next = reconcileEggStock(home, { accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 20,
      bag: part([egg({ id: 'bag1', provenance: 'unknown', obtainedAt: '2026-11-17T22:31:00Z' })]) });
    expect(next.eggs).toHaveLength(3);
  });

  test('concrete non-exchangeable category and egg measurements survive re-sync', () => {
    const state = reconcileEggStock(emptyEggStock(), {
      accountId: 'me', gameAccountKey: 'uid:1', capturedAt: 1,
      bag: part([egg({ id: 'special', kind: 'special', specialCategory: 'activity' })]),
    });
    expect(state.eggs[0].specialCategory).toBe('activity');
  });
});
