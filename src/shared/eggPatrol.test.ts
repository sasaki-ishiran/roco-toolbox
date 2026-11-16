import { expect, test } from 'vitest';
import { parsePatrolScene, observeNewEggs, patrolWindowOpen, capturePetId, type PatrolTask } from './eggPatrol';

const parent = (pet_gid: number, nest: string) => ({ pet_gid, furniture_guid_exact: nest });
const egg = (actor_id = '9511622085513840850') => ({ actor_id, nest_furniture_guid: '5170452278714212143',
  mother_candidate: parent(64299, '5170452278714212143'), father_candidates: [parent(64037, '453835583565763747')], biological_parentage_confirmed: false });
const raw = (eggs: unknown[] = []) => ({ code: 0, data: { home_scene_info: { snapshot_status: 'valid', eggs, egg_count: eggs.length } } });
const task: PatrolTask = { groupId: 'g', tradeId: 't', side: 'give', uid: '293143', producerAccountId: 'b', recipientAccountId: 'a',
  motherId: 'capture_293143_64299', fatherId: 'capture_293143_64037', eggGameId: 3062 };

test('first successful scan establishes baseline; only new exact-instance eggs are observed', () => {
  const scene = parsePatrolScene(raw([egg()]), 100);
  expect(scene.eggs[0].actorId).toBe('9511622085513840850');
  expect(scene.eggs[0].biologicalParentageConfirmed).toBe(false);
  expect(observeNewEggs(null, scene, [task])).toEqual([]);
  expect(observeNewEggs([scene.eggs[0].actorId], scene, [task])).toEqual([]);
  expect(observeNewEggs([], scene, [task])).toEqual([{ task, actorId: scene.eggs[0].actorId, status: 'produced' }]);
  expect(observeNewEggs([], scene, [{ ...task, motherId: 'capture_293143_64000' }])).toEqual([]);
});
test('ambiguous fathers/tasks never choose one; invalid capture instance does not match species', () => {
  const scene = parsePatrolScene(raw([egg()]), 1);
  expect(observeNewEggs([], scene, [task, { ...task, tradeId: 'other' }]).every(o => o.status === 'ambiguous')).toBe(true);
  expect(observeNewEggs([], scene, [{ ...task, motherId: '3062' }])).toEqual([]);
  const uncertain = { ...egg(), father_candidates: [parent(64037, '453835583565763747'), parent(64038, '453835583565763748')] };
  expect(observeNewEggs([], parsePatrolScene(raw([uncertain]), 1), [task])[0].status).toBe('ambiguous');
});
test('invalid or truncated scene cannot become an empty baseline; unsafe numeric IDs rejected', () => {
  for (const value of [{}, { code: 1, data: {} }, { code: 0, data: { home_scene_info: { snapshot_status: 'partial', eggs: [] } } },
    { code: 0, data: { home_scene_info: { snapshot_status: 'valid', eggs: [], egg_count: 1 } } }, raw([{ ...egg(), actor_id: 9511622085513840850 }])]) {
    expect(() => parsePatrolScene(value, 1)).toThrow();
  }
  expect(capturePetId('capture_293143_64299', '293143')).toBe('64299');
  expect(capturePetId('capture_100000_64299', '293143')).toBeNull();
});
test('large rounded nest GUID cannot override exact parent evidence or select a different nest', () => {
  const value = { ...egg(), mother_candidate: { pet_gid: 64299, furniture_guid: Number('5170452278714212143') } };
  expect(observeNewEggs([], parsePatrolScene(raw([value]), 1), [task])[0].status).toBe('produced');
  const wrongNest = { ...egg(), mother_candidate: parent(64299, '5170452278714212144') };
  expect(observeNewEggs([], parsePatrolScene(raw([wrongNest]), 1), [task])).toEqual([]);
  const collision = { ...egg('9511622085513840851'), nest_furniture_guid: '5170452278714212144', mother_candidate: parent(64298, '5170452278714212144') };
  expect(observeNewEggs([], parsePatrolScene(raw([value, collision]), 1), [task])).toEqual([]);
});
test('patrol is silent midnight to 08:00 Beijing time, including pending task polling', () => {
  expect(patrolWindowOpen(Date.parse('2026-11-16T23:59:59+08:00'))).toBe(true);
  expect(patrolWindowOpen(Date.parse('2026-11-17T00:00:00+08:00'))).toBe(false);
  expect(patrolWindowOpen(Date.parse('2026-11-17T07:59:59+08:00'))).toBe(false);
  expect(patrolWindowOpen(Date.parse('2026-11-17T08:00:00+08:00'))).toBe(true);
});
