import type { AccountSnapshot } from '../../domain/parseBackup';
import { accountKeyOf } from '../../domain/parseBackup';
import type { HomeEgg, HomeResident, OwnedPet } from '../../domain/types';
import { averageVoice } from '../../domain/nestPlan';
import { bodyGradeOf } from '../../shared/bodySize.js';
import type { EggParentInfo, EggParentsInfo } from '../../shared/eggMatching';
import cfgPetMap from '../../pcap-decoder/tools/pcap-json-app/src/generated/cfgPetMap.json';
import type { EggObservation } from './eggStockModel';

/**
 * 家园地上的蛋 → 蛋仓。
 *
 * 家蛋在抓包里只有 `actorId / furnitureGuid / npcConfigId`（`src/domain/types.ts`），
 * 物种随母方（设计口径 §8.5），性格 / 声音 / 体型由父母推算（§8.7）：
 * - 性格：绿窝那只 100%；普通窝双亲同性格 60%；其余留空，候选交给详情；
 * - 声音：(父 + 母) / 2 向零取整；
 * - 体型：双亲同档才落值；
 * - 蛋重 / 满重拿不到，不编确定值。
 */
export interface HomeStockResult {
  gameAccountKey: string;
  capturedAt: number;
  /** 增量快照可能缺住户，不能拿来删旧家蛋。 */
  complete: boolean;
  eggs: (EggObservation & { location: 'home' })[];
  unresolvedCount: number;
  ambiguousCount: number;
}

const cfgToPet = cfgPetMap as Record<string, number>;

/** 声音分贝 → 蛋仓现有档位（与 `eggInventory` 的背包蛋口径一致）。 */
export function voiceLabelOf(db: number | null | undefined): string {
  if (typeof db !== 'number' || !Number.isFinite(db)) return '';
  if (db === 100) return '+100';
  if (db === -100) return '-100';
  if (db >= 96) return '婉转声';
  if (db <= -96) return '粗嗓门';
  return '';
}

/** 背包精灵按家园实例 id 建索引：`capture_<uid>_<instanceId>`（与 `Home.tsx` 同口径）。 */
function petsByInstance(snapshot: AccountSnapshot): Map<string, OwnedPet> {
  const map = new Map<string, OwnedPet>();
  for (const pet of snapshot.pets) {
    if (!pet.captureId) continue;
    const index = pet.captureId.lastIndexOf('_');
    if (index < 0) continue;
    map.set(pet.captureId.slice(index + 1), pet);
  }
  return map;
}

function uniqueByName(pets: readonly OwnedPet[]): Map<string, OwnedPet | null> {
  const byName = new Map<string, OwnedPet | null>();
  for (const pet of pets) byName.set(pet.name, byName.has(pet.name) ? null : pet);
  return byName;
}

const genderOf = (resident: HomeResident, pet: OwnedPet | undefined): '公' | '母' | '未知' =>
  resident.gender === '公' || resident.gender === '母' ? resident.gender
    : pet?.gender === '公' || pet?.gender === '母' ? pet.gender : '未知';

const speciesOf = (resident: HomeResident, pet: OwnedPet | undefined): number | null => {
  if (pet && Number.isSafeInteger(pet.gameId) && pet.gameId > 0) return pet.gameId;
  const mapped = resident.confId == null ? undefined : cfgToPet[String(resident.confId)];
  return Number.isSafeInteger(mapped) && mapped! > 0 ? mapped! : null;
};

/** 父母属性只来自背包精灵；住户本身只有 confId / 性别 / 名字。 */
function parentInfo(resident: HomeResident, pet: OwnedPet | undefined): EggParentInfo {
  const gameId = speciesOf(resident, pet);
  const academy = resident.nest?.nestType === 'academy';
  return {
    id: pet?.captureId ?? `home:${resident.instanceId}`,
    gameId: gameId ?? 0,
    name: resident.name || pet?.name || `精灵 ${resident.instanceId}`,
    nature: resident.nature || pet?.nature || '',
    body: pet ? bodyGradeOf(pet) : '',
    voice: pet ? voiceLabelOf(pet.voiceDb) : '',
    ...(resident.nest ? { nestName: resident.nest.nestName || (academy ? '学院小窝' : '普通小窝'), academy } : {}),
  };
}

/**
 * 父母推算。返回 `null` 表示「结构上不知道父母」，与「知道父母但属性缺失」区分开：
 * 后者仍然出蛋（物种随母方），只是属性留空。
 */
function parentsFor(
  egg: HomeEgg,
  residents: readonly HomeResident[],
  couples: readonly { femaleActorId: string; maleActorIds: string[] }[],
  pets: Map<string, OwnedPet>,
  petByName: Map<string, OwnedPet | null>,
  stale: boolean,
): { parents?: EggParentsInfo; mother?: HomeResident; fathers: HomeResident[]; ambiguous: boolean } {
  const petOf = (resident: HomeResident): OwnedPet | undefined =>
    pets.get(resident.instanceId) ?? petByName.get(resident.name) ?? undefined;
  const inNest = residents.filter((resident) => {
    const guid = resident.nest?.furnitureGuid || resident.furnitureGuid;
    return guid === egg.furnitureGuid;
  });
  const motherInNest = inNest.filter((resident) => genderOf(resident, petOf(resident)) === '母');
  // 先按「蛋所在窝里的母本」；窝里没有时退一步找配对里母本住这一窝的。
  const couple = couples.find((item) => inNest.some((resident) => resident.actorId === item.femaleActorId))
    ?? couples.find((item) => motherInNest.some((resident) => resident.actorId === item.femaleActorId));
  let mother = motherInNest.length === 1 ? motherInNest[0]
    : motherInNest.length > 1 ? undefined
      : couple ? residents.find((resident) => resident.actorId === couple.femaleActorId) : undefined;
  let ambiguous = motherInNest.length > 1;
  if (!mother && couple) mother = residents.find((resident) => resident.actorId === couple.femaleActorId);
  if (!mother) return { fathers: [], ambiguous };
  const pair = couples.find((item) => item.femaleActorId === mother!.actorId);
  const allFathers = (pair?.maleActorIds ?? []).flatMap((actorId) => {
    const resident = residents.find((item) => item.actorId === actorId);
    return resident ? [resident] : [];
  });
  // 游戏规则：父本窝 ≠ 蛋窝，学院 1:2 时父本可能是多个。
  const fathers = allFathers.filter((resident) => (resident.nest?.furnitureGuid || resident.furnitureGuid) !== egg.furnitureGuid);
  if (fathers.length > 1) ambiguous = true;
  const parents: EggParentsInfo = {
    mother: parentInfo(mother, petOf(mother)),
    ...(fathers.length ? { fathers: fathers.map((resident) => parentInfo(resident, petOf(resident))) } : {}),
    confirmed: false,
    stale,
  };
  return { parents, mother, fathers, ambiguous };
}

export function homeStockFromSnapshot(snapshot: AccountSnapshot, _accountId?: string): HomeStockResult | null {
  const home = snapshot.home;
  if (!home) return null;
  const capturedAt = Date.parse(home.capturedAt) || Date.parse(snapshot.exportedAt || snapshot.importedAt);
  if (!Number.isFinite(capturedAt)) return null;
  const pets = petsByInstance(snapshot);
  const petByName = uniqueByName(snapshot.pets);
  const eggs: HomeStockResult['eggs'] = [];
  let unresolvedCount = 0;
  let ambiguousCount = 0;
  for (const egg of home.sceneEggs) {
    const { parents, mother, fathers, ambiguous } = parentsFor(egg, home.residents, home.layEggCouples, pets, petByName, home.couplesStale);
    if (ambiguous) ambiguousCount++;
    if (!mother) { unresolvedCount++; continue; }
    const motherPet = pets.get(mother.instanceId) ?? petByName.get(mother.name) ?? undefined;
    const eggGameId = speciesOf(mother, motherPet);
    if (!eggGameId) { unresolvedCount++; continue; }
    const motherInfo = parents?.mother;
    const fatherInfos = parents?.fathers ?? [];
    // 绿窝：学院小窝那只自己的性格 100% 遗传（§8.3）。
    const academy = [motherInfo, ...fatherInfos].filter((item): item is EggParentInfo => !!item && item.academy === true && !!item.nature);
    const nature = academy.length === 1 ? academy[0].nature
      : motherInfo?.nature && fatherInfos.length && fatherInfos.every((father) => father.nature === motherInfo.nature)
        ? motherInfo.nature : '';
    // 声音：(父 + 母) / 2 向零取整；多父本必须推出同一个档位。
    const motherDb = motherPet?.voiceDb;
    const fatherDbs = fathers.map((father) => (pets.get(father.instanceId) ?? petByName.get(father.name))?.voiceDb);
    const voice = typeof motherDb === 'number' && fatherDbs.length && fatherDbs.every((db) => typeof db === 'number')
      ? [...new Set(fatherDbs.map((db) => voiceLabelOf(averageVoice(db!, motherDb))))] : [];
    const motherBody = motherPet ? bodyGradeOf(motherPet) : '';
    const fatherBodies = fathers.map((father) => {
      const pet = pets.get(father.instanceId) ?? petByName.get(father.name);
      return pet ? bodyGradeOf(pet) : '';
    });
    const body: '大块头' | '小不点' | 'unknown' =
      motherBody === '大块头' && fatherBodies.length > 0 && fatherBodies.every((item) => item === '大块头') ? '大块头'
        : motherBody === '小不点' && fatherBodies.length > 0 && fatherBodies.every((item) => item === '小不点') ? '小不点'
          : 'unknown';
    const voiceValue = voice.length === 1 ? voice[0] : '';
    const labeled = !!nature || !!voiceValue || body !== 'unknown';
    eggs.push({
      id: JSON.stringify([accountKeyOf(snapshot), 'home', egg.actorId]),
      eggGameId,
      gameAccountKey: accountKeyOf(snapshot),
      nature,
      body,
      voice: (voiceValue || 'unknown') as EggObservation['voice'],
      provenance: 'self-bred',
      confidence: labeled ? 'system' : 'unknown',
      labelSource: labeled ? 'system' : 'unknown',
      kind: 'ordinary',
      ...(parents ? { parents } : {}),
      location: 'home',
    });
  }
  return {
    gameAccountKey: accountKeyOf(snapshot),
    capturedAt,
    complete: home.snapshotKind !== 'delta',
    eggs,
    unresolvedCount,
    ambiguousCount,
  };
}
