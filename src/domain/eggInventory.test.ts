import { expect, test } from 'vitest';
import { capturedEggKind, inventoryFromSnapshot } from './eggInventory';
import type { AccountSnapshot } from './parseBackup';

const snapshot: AccountSnapshot = { accountName: '甲', gameId: 1001, exportedAt: '2026-11-16T00:00:00Z',
  importedAt: '2026-11-16T00:00:01Z', pets: [], eggs: [], eggInventoryComplete: true };

test('real instance IDs and classification survive; ordinary unknown source remains exchangeable', () => {
  const result = inventoryFromSnapshot({ ...snapshot, eggs: [{ petName: '菊花梨', speciesPetId: 3227,
    externalEggId: '887', obtainedAt: '', weightGrams: 0, sourceType: '交换', isOrdinary: true }] }, 'cloud-me');
  expect(result.complete).toBe(true);
  expect(result.eggs[0]).toMatchObject({ id: '["uid:1001","887"]', accountId: 'cloud-me',
    gameAccountKey: 'uid:1001', eggGameId: 3227, provenance: 'external', nature: '', body: 'unknown', kind: 'ordinary' });
});
test('special variants are excluded by every captured signal, not just source text', () => {
  const egg = { petName: '蛋', obtainedAt: '', weightGrams: 0 };
  expect(capturedEggKind({ ...egg, isShiny: true })).toBe('shiny');
  expect(capturedEggKind({ ...egg, preciousEggType: 2 })).toBe('shiny');
  expect(capturedEggKind({ ...egg, specialEggConfId: 15 })).toBe('special');
  expect(capturedEggKind({ ...egg, isOrdinary: false })).toBe('special');
  expect(capturedEggKind(egg)).toBe('ordinary');
});
test('never invents identity or species; incomplete classification cannot erase existing inventory', () => {
  const result = inventoryFromSnapshot({ ...snapshot, eggs: [{ petName: '未知蛋', obtainedAt: '', weightGrams: 10 }] }, 'me');
  expect(result.eggs).toEqual([]);
  expect(result.complete).toBe(false);
  expect(result.unresolvedCount).toBe(1);
});

test('captured egg weight determines its body grade using the game egg thresholds',()=>{
  const result=inventoryFromSnapshot({...snapshot,eggs:[{petName:'菊花梨',speciesPetId:3227,externalEggId:'1',weightGrams:2320,obtainedAt:''},{petName:'菊花梨',speciesPetId:3227,externalEggId:'2',weightGrams:2303,obtainedAt:''}]},'a');
  expect(result.eggs.map(e=>e.body)).toEqual(['满体重','大块头']);
});

test('captured obtained time is forwarded to the stock sync payload',()=>{
  const result=inventoryFromSnapshot({...snapshot,eggs:[{petName:'菊花梨',speciesPetId:3227,externalEggId:'1',weightGrams:2320,obtainedAt:'2026-11-17T22:31:00Z'}]},'a');
  expect(result.eggs[0].obtainedAt).toBe('2026-11-17T22:31:00Z');
});
