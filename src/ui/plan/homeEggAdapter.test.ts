import { describe, expect, test } from 'vitest';
import type { AccountSnapshot } from '../../domain/parseBackup';
import type { HomeResident, OwnedPet } from '../../domain/types';
import { homeStockFromSnapshot, voiceLabelOf } from './homeEggAdapter';

const pet = (over: Partial<OwnedPet>): OwnedPet => ({
  gameId: 3227, name: '菊花梨', captureId: 'capture_1001_11', gender: '母', nature: '保守',
  voiceDb: 100, medalBody: '大块头', isShiny: false, account: '甲', ...over,
});
const resident = (over: Partial<HomeResident>): HomeResident => ({
  instanceId: '11', baseId: 'base', confId: 10009, furnitureGuid: 'nest1', actorId: 'a1', name: '菊花梨', gender: '母', ...over,
});
const nest = (furnitureGuid: string, nestType: 'ordinary' | 'academy', nestName: string) => ({
  furnitureGuid, configId: 1, nestType, nestName, residentIds: [],
});
const snapshot = (over: Partial<AccountSnapshot> = {}, home: Partial<NonNullable<AccountSnapshot['home']>> = {}): AccountSnapshot => ({
  accountName: '甲', gameId: 1001, exportedAt: '2026-11-17T15:00:00Z', importedAt: '2026-11-17T15:00:01Z',
  pets: [pet({}), pet({ gameId: 3215, name: '海豹战士', captureId: 'capture_1001_22', gender: '公', nature: '胆小', voiceDb: 96 })],
  eggs: [],
  home: {
    schemaVersion: 1, gameId: '1001', capturedAt: '2026-11-17T23:00:00+08:00',
    residents: [
      resident({}),
      resident({ instanceId: '22', actorId: 'a2', name: '海豹战士', gender: '公', furnitureGuid: 'nest2',
        nest: { furnitureGuid: 'nest2', configId: 2, nestType: 'ordinary', nestName: '普通小窝' } }),
    ],
    nests: [nest('nest1', 'ordinary', '普通小窝'), nest('nest2', 'ordinary', '普通小窝')],
    layEggCouples: [{ femaleActorId: 'a1', maleActorIds: ['a2'] }],
    sceneEggs: [{ actorId: 'e1', furnitureGuid: 'nest1', npcConfigId: 301 }],
    couplesStale: false, snapshotKind: 'full', ...home,
  },
  ...over,
});

describe('home egg adapter', () => {
  test('turns a scene egg into home stock with species from the mother and derived labels', () => {
    const result = homeStockFromSnapshot(snapshot())!;
    expect(result.complete).toBe(true);
    expect(result.eggs).toHaveLength(1);
    const egg = result.eggs[0];
    expect(egg).toMatchObject({ eggGameId: 3227, location: 'home', provenance: 'self-bred',
      labelSource: 'system', confidence: 'system', body: '大块头', voice: '婉转声', nature: '' });
    expect(egg.parents?.mother?.name).toBe('菊花梨');
    expect(egg.parents?.fathers?.[0].name).toBe('海豹战士');
    expect(egg.parents?.confirmed).toBe(false);
  });

  test('green nest parent passes its nature down 100%', () => {
    const base = snapshot({}, {
      residents: [
        resident({}),
        resident({ instanceId: '22', actorId: 'a2', name: '海豹战士', gender: '公', furnitureGuid: 'nest2', nest: {
          furnitureGuid: 'nest2', configId: 2, nestType: 'academy', nestName: '学院小窝' } }),
      ],
      nests: [nest('nest1', 'ordinary', '普通小窝'), nest('nest2', 'academy', '学院小窝')],
    });
    expect(homeStockFromSnapshot(base)!.eggs[0].nature).toBe('胆小');
  });

  test('same-nature parents give a 60% nature; voice averages toward zero', () => {
    const base = snapshot({
      pets: [pet({ voiceDb: 99 }), pet({ gameId: 3215, name: '海豹战士', captureId: 'capture_1001_22', gender: '公', nature: '保守', voiceDb: 100 })],
    });
    const egg = homeStockFromSnapshot(base)!.eggs[0];
    expect(egg.nature).toBe('保守');
    expect(egg.voice).toBe('婉转声');
    expect(voiceLabelOf(98)).toBe('婉转声');
    expect(voiceLabelOf(100)).toBe('+100');
  });

  test('missing father still produces the egg but leaves inferred labels unknown', () => {
    const egg = homeStockFromSnapshot(snapshot({}, { layEggCouples: [] }))!.eggs[0];
    expect(egg.eggGameId).toBe(3227);
    expect(egg.nature).toBe('');
    expect(egg.voice).toBe('unknown');
    expect(egg.body).toBe('unknown');
    expect(egg.confidence).toBe('unknown');
    expect(egg.parents?.mother?.name).toBe('菊花梨');
    expect(egg.parents?.fathers).toBeUndefined();
  });

  test('falls back to the resident confId when the mother is not in the backpack snapshot', () => {
    const base = snapshot({ pets: [] });
    const egg = homeStockFromSnapshot(base)!.eggs[0];
    expect(egg.eggGameId).toBe(3011);
    expect(egg.confidence).toBe('unknown');
  });

  test('delta snapshots are not complete; unknown residents are counted and skipped', () => {
    const delta = homeStockFromSnapshot(snapshot({}, { snapshotKind: 'delta' }))!;
    expect(delta.complete).toBe(false);
    const orphan = homeStockFromSnapshot(snapshot({}, { sceneEggs: [{ actorId: 'e9', furnitureGuid: 'nest1' }] }))!;
    expect(orphan.eggs).toHaveLength(1);
    const unresolved = homeStockFromSnapshot(snapshot({}, {
      residents: [resident({ instanceId: '22', actorId: 'a2', name: '海豹战士', gender: '公' })],
      sceneEggs: [{ actorId: 'e9', furnitureGuid: 'nest1' }],
    }))!;
    expect(unresolved.eggs).toHaveLength(0);
    expect(unresolved.unresolvedCount).toBe(1);
  });

  test('marks stale couples and keeps ambiguous multiple fathers', () => {
    const base = snapshot({}, {
      couplesStale: true,
      layEggCouples: [{ femaleActorId: 'a1', maleActorIds: ['a2', 'a3'] }],
      residents: [
        resident({}),
        resident({ instanceId: '22', actorId: 'a2', name: '海豹战士', gender: '公', furnitureGuid: 'nest2' }),
        resident({ instanceId: '33', actorId: 'a3', name: '柴渣虫', gender: '公', furnitureGuid: 'nest3' }),
      ],
    });
    const result = homeStockFromSnapshot(base)!;
    expect(result.ambiguousCount).toBe(1);
    expect(result.eggs[0].parents?.stale).toBe(true);
    expect(result.eggs[0].parents?.fathers).toHaveLength(2);
  });
});
