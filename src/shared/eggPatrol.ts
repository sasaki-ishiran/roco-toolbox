export interface PatrolTask {
  groupId: string;
  tradeId: string;
  side: 'give' | 'return';
  uid: string;
  producerAccountId: string;
  recipientAccountId: string;
  motherId: string;
  fatherId: string;
  eggGameId: number;
}

export interface PatrolParent { petId: string; nestId: string | null; roundedNestId?: number }
export interface PatrolEgg {
  actorId: string;
  nestId: string;
  mother: PatrolParent | null;
  fathers: PatrolParent[];
  biologicalParentageConfirmed: boolean;
}
export interface PatrolScene { eggs: PatrolEgg[]; capturedAt: number }
export interface PatrolObservation { task: PatrolTask; actorId: string; status: 'produced' | 'ambiguous' }
export interface PatrolTaskStatus {
  tradeId: string; side: 'give' | 'return'; checkedAt: number | null;
  status: 'pending' | 'ok' | 'queued' | 'error' | 'quota' | 'produced' | 'ambiguous' | 'quiet';
  notification: 'pending' | 'leased' | 'sent' | 'failed' | 'unbound' | null;
}
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('家园场景格式无效');
  return value as ObjectValue;
}
function exactId(value: unknown): string {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('家园场景标识无效');
}
function optionalNest(value: ObjectValue): string | null {
  const exact = value.furniture_guid_exact;
  if (typeof exact === 'string' && exact.length > 0) return exact;
  const furniture = value.furniture;
  const nested = furniture && typeof furniture === 'object' && !Array.isArray(furniture)
    ? (furniture as ObjectValue).furniture_guid : undefined;
  const candidate = exact ?? nested ?? value.furniture_guid;
  if (candidate === undefined || candidate === null || candidate === '') return null;
  if (typeof candidate === 'number' && Number.isFinite(candidate) && !Number.isSafeInteger(candidate)) return null;
  return exactId(candidate);
}
function parent(value: unknown): PatrolParent {
  const raw = object(value);
  const nestId = optionalNest(raw);
  return { petId: exactId(raw.pet_gid), nestId,
    ...(nestId === null && typeof raw.furniture_guid === 'number' && Number.isFinite(raw.furniture_guid)
      ? { roundedNestId: raw.furniture_guid } : {}) };
}

export function parsePatrolScene(raw: unknown, now: number): PatrolScene {
  const root = object(raw);
  if (root.code !== 0) throw new Error('家园场景读取失败');
  const data = object(root.data);
  const scene = object(data.home_scene_info);
  if (scene.snapshot_status !== 'valid' || !Array.isArray(scene.eggs) ||
      !Number.isSafeInteger(scene.egg_count) || scene.egg_count !== scene.eggs.length ||
      !Number.isFinite(now) || now <= 0) throw new Error('家园场景尚未完整');
  const eggs = scene.eggs.map(value => {
    const rawEgg = object(value);
    const actorId = exactId(rawEgg.actor_id);
    const nestId = exactId(rawEgg.nest_furniture_guid);
    const mother = rawEgg.mother_candidate === null || rawEgg.mother_candidate === undefined
      ? null : parent(rawEgg.mother_candidate);
    if (!Array.isArray(rawEgg.father_candidates)) throw new Error('亲本信息不完整');
    const fathers = rawEgg.father_candidates.map(parent);
    if (new Set(fathers.map(father => father.petId)).size !== fathers.length) throw new Error('亲本信息重复');
    return { actorId, nestId, mother, fathers, biologicalParentageConfirmed: rawEgg.biological_parentage_confirmed === true };
  });
  if (new Set(eggs.map(egg => egg.actorId)).size !== eggs.length) throw new Error('蛋实例重复');
  return { eggs, capturedAt: now };
}

export function capturePetId(captureId: string, uid: string): string | null {
  const prefix = `capture_${uid}_`;
  if (!captureId.startsWith(prefix)) return null;
  const petId = captureId.slice(prefix.length);
  return /^\d{1,32}$/.test(petId) ? petId : null;
}

function taskMatches(task: PatrolTask, egg: PatrolEgg, scene: PatrolScene): boolean {
  const motherId = capturePetId(task.motherId, task.uid);
  const fatherId = capturePetId(task.fatherId, task.uid);
  if (!motherId || !fatherId || !egg.mother || egg.mother.petId !== motherId) return false;
  const motherNestMatches = egg.mother.nestId === egg.nestId ||
    (egg.mother.roundedNestId !== undefined && Number(egg.nestId) === egg.mother.roundedNestId &&
      new Set(scene.eggs.filter(e => Number(e.nestId) === egg.mother!.roundedNestId).map(e => e.nestId)).size === 1);
  if (!motherNestMatches) return false;
  return egg.fathers.some(father => father.petId === fatherId && father.nestId !== egg.nestId);
}

export function observeNewEggs(previousActorIds: readonly string[] | null, scene: PatrolScene,
  tasks: readonly PatrolTask[]): PatrolObservation[] {
  if (previousActorIds === null) return [];
  const known = new Set(previousActorIds);
  const observations: PatrolObservation[] = [];
  for (const egg of scene.eggs) {
    if (known.has(egg.actorId)) continue;
    const matches = tasks.filter(task => taskMatches(task, egg, scene));
    if (matches.length === 1) observations.push({ task: matches[0], actorId: egg.actorId,
      status: egg.fathers.length === 1 ? 'produced' : 'ambiguous' });
    else if (matches.length > 1) for (const task of matches) observations.push({ task, actorId: egg.actorId, status: 'ambiguous' });
  }
  return observations;
}

export function patrolWindowOpen(timestamp: number): boolean {
  const hour = new Date(timestamp + 8 * 60 * 60 * 1000).getUTCHours();
  return hour >= 8;
}
