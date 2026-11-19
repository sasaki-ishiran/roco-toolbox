import { expect, test } from 'vitest';
import { parsePatrolScene, observeSceneEggs, observeScenePlacements, patrolWindowOpen, type PatrolSpeciesIndex, type PatrolTask } from './eggPatrol';

/** 巡查现在按「蛋目标 + 性格 + 体型 + 声音」判定，不再要求是发布时那一对个体。 */
const speciesIndex: PatrolSpeciesIndex = {
  eggGameIdByGameId: new Map([[3810, 3810], [3215, 3215], [3490, 3490]]),
  bodySizeByGameId: new Map([
    [3810, { small: 0.616, big: 1.372 }],
    [3215, { small: 69.862, big: 87.238 }],
    [3490, { small: 9.5, big: 12.4 }],
  ]),
  natureNameById: new Map([[2, '固执'], [22, '急躁'], [28, '平和']]),
};

interface PetSeed { pet_gid: number; pet_cfg_id: number; nature: number; voice: number; weight: number }
const motherPet: PetSeed = { pet_gid: 64299, pet_cfg_id: 3810, nature: 2, voice: 100, weight: 1389 };
const fatherPet: PetSeed = { pet_gid: 64037, pet_cfg_id: 3215, nature: 2, voice: 100, weight: 87344 };

const parent = (pet: PetSeed, nest: string) => ({
  pet_gid: pet.pet_gid, furniture_guid_exact: nest, pet_cfg_id: pet.pet_cfg_id, nature: pet.nature, voice: pet.voice,
});
const egg = (actor_id = '9511622085513840850', mother = motherPet, father = fatherPet) => ({
  actor_id, nest_furniture_guid: '5170452278714212143',
  mother_candidate: parent(mother, '5170452278714212143'),
  father_candidates: [parent(father, '453835583565763747')],
  biological_parentage_confirmed: false,
});
const raw = (eggs: unknown[] = [], homePets: PetSeed[] = [motherPet, fatherPet], pairs: unknown[] = []) => ({
  code: 0, data: { home_scene_info: { snapshot_status: 'valid', eggs, egg_count: eggs.length, home_pets: homePets, breeding_pairs: pairs } },
});
const task: PatrolTask = {
  groupId: 'g', tradeId: 't', side: 'give', uid: '293143', producerAccountId: 'b', recipientAccountId: 'a',
  motherId: 'capture_293143_64299', fatherId: 'capture_293143_64037', eggGameId: 3810,
  nature: '固执', body: '大块头', voice: '婉转声',
};
const observe = (value: unknown, tasks: PatrolTask[] = [task]) =>
  observeSceneEggs(parsePatrolScene(value, 100), tasks, speciesIndex);

test('every scan observes eggs currently on the ground; no first-scan baseline is needed', () => {
  const scene = parsePatrolScene(raw([egg()]), 100);
  expect(scene.eggs[0].actorId).toBe('9511622085513840850');
  expect(scene.eggs[0].biologicalParentageConfirmed).toBe(false);
  expect(observeSceneEggs(scene, [task], speciesIndex)).toEqual([{ task, actorId: scene.eggs[0].actorId, status: 'produced' }]);
});

test('换了同进化链的个体也能认出来：只要蛋 + 性格 + 体型 + 声音对得上', () => {
  // 任务里记录的还是发布时那一对，现场用的是另外两只（同链、同性格、同档位）
  const otherMother: PetSeed = { pet_gid: 65001, pet_cfg_id: 3810, nature: 2, voice: 100, weight: 1390 };
  const otherFather: PetSeed = { pet_gid: 65002, pet_cfg_id: 3215, nature: 2, voice: 100, weight: 88000 };
  const staleTask = { ...task, motherId: 'capture_293143_60000', fatherId: 'capture_293143_60001' };
  const scene = parsePatrolScene(raw([egg('9511622085513840999', otherMother, otherFather)], [otherMother, otherFather]), 100);
  expect(observeSceneEggs(scene, [staleTask], speciesIndex).map((value) => value.status)).toEqual(['produced']);
});

test('蛋、性格、体型、声音任一不符都不认；判不了也不认', () => {
  const fromOtherEgg: PetSeed = { pet_gid: 64299, pet_cfg_id: 3490, nature: 2, voice: 100, weight: 12000 };
  expect(observe(raw([egg('a1', fromOtherEgg)])).length).toBe(0);

  const wrongNature: PetSeed = { pet_gid: 64299, pet_cfg_id: 3810, nature: 22, voice: 100, weight: 1389 };
  const wrongNatureFather: PetSeed = { pet_gid: 64037, pet_cfg_id: 3215, nature: 22, voice: 100, weight: 87344 };
  expect(observe(raw([egg('a2', wrongNature, wrongNatureFather)])).length).toBe(0);

  // 普通体型（两份档位都不达标），即使蛋和性格对得上也不认
  const normalBody: PetSeed = { pet_gid: 64299, pet_cfg_id: 3810, nature: 2, voice: 100, weight: 1000 };
  const normalFather: PetSeed = { pet_gid: 64037, pet_cfg_id: 3215, nature: 2, voice: 100, weight: 80000 };
  expect(observe(raw([egg('a3', normalBody, normalFather)], [normalBody, normalFather])).length).toBe(0);

  // 父本声音不达标（婉转声要求 >=96）
  const quietFather: PetSeed = { pet_gid: 64037, pet_cfg_id: 3215, nature: 2, voice: 50, weight: 87344 };
  expect(observe(raw([egg('a4', motherPet, quietFather)], [motherPet, quietFather])).length).toBe(0);

  // 体重缺失（home_pets 里没有这只）→ 体型判不了，宁漏
  expect(observe(raw([egg('a5')], [motherPet])).length).toBe(0);
});

test('ambiguous fathers/tasks never choose one', () => {
  const scene = parsePatrolScene(raw([egg()]), 1);
  expect(observeSceneEggs(scene, [task, { ...task, tradeId: 'other' }], speciesIndex).every((o) => o.status === 'ambiguous')).toBe(true);
  const secondFather: PetSeed = { ...fatherPet, pet_gid: 64038 };
  const uncertain = {
    ...egg(),
    father_candidates: [parent(fatherPet, '453835583565763747'), parent(secondFather, '453835583565763748')],
  };
  const uncertainScene = parsePatrolScene(raw([uncertain], [motherPet, fatherPet, secondFather]), 1);
  expect(observeSceneEggs(uncertainScene, [task], speciesIndex)[0].status).toBe('ambiguous');
});

test('invalid or truncated scene cannot become an empty baseline; unsafe numeric IDs rejected', () => {
  for (const value of [{}, { code: 1, data: {} }, { code: 0, data: { home_scene_info: { snapshot_status: 'partial', eggs: [] } } },
    { code: 0, data: { home_scene_info: { snapshot_status: 'valid', eggs: [], egg_count: 1 } } }, raw([{ ...egg(), actor_id: 9511622085513840850 }])]) {
    expect(() => parsePatrolScene(value, 1)).toThrow();
  }
});

test('large rounded nest GUID cannot override exact parent evidence or select a different nest', () => {
  const value = { ...egg(), mother_candidate: { pet_gid: 64299, furniture_guid: Number('5170452278714212143'), pet_cfg_id: 3810, nature: 2, voice: 100 } };
  expect(observe(raw([value]))[0].status).toBe('produced');
  const wrongNest = { ...egg(), mother_candidate: parent(motherPet, '5170452278714212144') };
  expect(observe(raw([wrongNest]))).toEqual([]);
  const collision = {
    ...egg('9511622085513840851'), nest_furniture_guid: '5170452278714212144',
    mother_candidate: parent({ ...motherPet, pet_gid: 64298 }, '5170452278714212144'),
  };
  expect(observe(raw([value, collision]))).toEqual([]);
});

test('已上窝：家园排着能孵目标蛋的一对时命中，档位或性格不符不命中', () => {
  const pair = [{ female: parent(motherPet, 'n1'), male_partners: [parent(fatherPet, 'n2')] }];
  const scene = parsePatrolScene(raw([], [motherPet, fatherPet], pair), 1);
  expect(observeScenePlacements(scene, [task], speciesIndex)).toEqual([task]);

  const normalFather: PetSeed = { ...fatherPet, weight: 80000 };
  const weak = parsePatrolScene(raw([], [motherPet, normalFather], [{ female: parent(motherPet, 'n1'), male_partners: [parent(normalFather, 'n2')] }]), 1);
  expect(observeScenePlacements(weak, [task], speciesIndex)).toEqual([]);

  const wrongNature: PetSeed = { ...motherPet, nature: 22 };
  const mismatched = parsePatrolScene(raw([], [wrongNature, { ...fatherPet, nature: 22 }],
    [{ female: parent(wrongNature, 'n1'), male_partners: [parent({ ...fatherPet, nature: 22 }, 'n2')] }]), 1);
  expect(observeScenePlacements(mismatched, [task], speciesIndex)).toEqual([]);
});

test('patrol is silent midnight to 08:00 Beijing time, including pending task polling', () => {
  expect(patrolWindowOpen(Date.parse('2026-11-16T23:59:59+08:00'))).toBe(true);
  expect(patrolWindowOpen(Date.parse('2026-11-17T00:00:00+08:00'))).toBe(false);
  expect(patrolWindowOpen(Date.parse('2026-11-17T07:59:59+08:00'))).toBe(false);
  expect(patrolWindowOpen(Date.parse('2026-11-17T08:00:00+08:00'))).toBe(true);
});
