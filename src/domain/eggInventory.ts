import { canCirculateEgg, type EggRecord } from '../shared/eggMatching';
import { accountKeyOf, type AccountSnapshot, type BackupEgg } from './parseBackup';
import { eggWeightOf } from './eggWeight';

export interface CapturedStockEgg extends EggRecord {
  gameAccountKey: string;
  accountName: string;
  itemConfId?: number;
  weightGrams: number;
  obtainedAt: string;
  listed: boolean;
  isOrdinary?:boolean; isShiny?:boolean; preciousEggType?:number; specialEggConfId?:number; appearanceType?:number; extensionType?:number;
}

export function capturedEggKind(egg: BackupEgg): NonNullable<EggRecord['kind']> {
  if (egg.isShiny || egg.preciousEggType === 2 || egg.sourceType === '异色') return 'shiny';
  if (egg.isOrdinary === false || (egg.preciousEggType != null && egg.preciousEggType !== 0) ||
      (egg.specialEggConfId ?? 0) > 0 || (egg.appearanceType ?? 0) > 0 || (egg.extensionType ?? 0) > 0 ||
      ['特殊', '活动', '首领'].includes(egg.sourceType ?? '')) return 'special';
  return 'ordinary';
}

/** No synthetic IDs, no inferred nature/voice/parents; ordinary defaults follow user policy. */
export function inventoryFromSnapshot(snapshot: AccountSnapshot, accountId: string): {
  gameAccountKey: string; capturedAt: number; complete: boolean; eggs: CapturedStockEgg[]; unresolvedCount: number;
} {
  const gameAccountKey = accountKeyOf(snapshot);
  let unresolvedCount = 0;
  const eggs: CapturedStockEgg[] = [];
  const seen = new Set<string>();
  for (const raw of snapshot.eggs) {
    const instance = raw.externalEggId || (Number.isSafeInteger(raw.instanceId) && raw.instanceId! > 0 ? String(raw.instanceId) : '');
    if (!instance || !Number.isSafeInteger(raw.speciesPetId) || raw.speciesPetId! <= 0 || seen.has(instance)) {
      unresolvedCount++;
      continue;
    }
    seen.add(instance);
    const voice: EggRecord['voice'] = raw.voiceDb === 100 ? '+100' : raw.voiceDb === -100 ? '-100'
      : raw.voiceDb != null && raw.voiceDb >= 96 && raw.voiceDb < 100 ? '婉转声'
      : raw.voiceDb != null && raw.voiceDb <= -96 && raw.voiceDb > -100 ? '粗嗓门' : 'unknown';
    const weight=eggWeightOf(raw.petName);
    const grams=raw.weightGrams;
    const body:EggRecord['body']=!weight||!(grams>0)?'unknown':grams===Math.round(weight.max*1000)?'满体重':grams===Math.round(weight.min*1000)?'零体重':weight.big!=null&&grams>=Math.round(weight.big*1000)?'大块头':weight.small!=null&&grams<=Math.round(weight.small*1000)?'小不点':'';
    eggs.push({ id: JSON.stringify([gameAccountKey, instance]), accountId, gameAccountKey, accountName: snapshot.accountName,
      eggGameId: raw.speciesPetId!, nature: raw.nature ?? '', body, voice,
      provenance: raw.sourceType === '交换' || raw.sourceType === '赠送' ? 'external' : 'unknown',
      confidence: 'system', kind: capturedEggKind(raw), status: 'available', listed: false,
      isOrdinary:raw.isOrdinary,isShiny:raw.isShiny,preciousEggType:raw.preciousEggType,specialEggConfId:raw.specialEggConfId,appearanceType:raw.appearanceType,extensionType:raw.extensionType,
      weightGrams: raw.weightGrams, obtainedAt: raw.obtainedAt, itemConfId: raw.itemConfId });
  }
  return { gameAccountKey, capturedAt: Date.parse(snapshot.exportedAt || snapshot.importedAt),
    complete: snapshot.eggInventoryComplete === true && unresolvedCount === 0, eggs, unresolvedCount };
}

export const listedMatchingEggs = (eggs: readonly CapturedStockEgg[]): CapturedStockEgg[] =>
  eggs.filter(egg => egg.listed && canCirculateEgg(egg));
