import { bodyMedalOf } from './bodySize.js';
import { matchesVoiceOption } from '../domain/petFilters';

export interface PatrolTask {
  groupId: string;
  tradeId: string;
  side: 'give' | 'return';
  uid: string;
  producerAccountId: string;
  recipientAccountId: string;
  /** 发布时推荐的亲本，只用于展示与任务键；巡查判定不依赖这两个个体（2026-11-18）。 */
  motherId: string;
  fatherId: string;
  eggGameId: number;
  /** 任务目标：性格 / 体型 / 声音。空字符串 = 不挑。 */
  nature: string;
  body: string;
  voice: string;
}
export interface PatrolParent {
  petId: string;
  nestId: string | null;
  roundedNestId?: number;
  /** 亲本物种（scene 的 pet_cfg_id，等于图鉴 gameId）。缺失时判不了，宁漏。 */
  speciesGameId: number | null;
  natureId: number | null;
  voiceDb: number | null;
  /** home_pets 里的weight（克）换算成 kg；缺了算不出体型档位。 */
  weightKg: number | null;
}
export interface PatrolEgg {
  actorId: string;
  nestId: string;
  mother: PatrolParent | null;
  fathers: PatrolParent[];
  biologicalParentageConfirmed: boolean;
}
/** 家园里已经排上的一对亲本（breeding_pairs）。用于判定「已上窝」。 */
export interface PatrolPair { mother: PatrolParent; fathers: PatrolParent[] }
export interface PatrolScene { eggs: PatrolEgg[]; pairs: PatrolPair[]; capturedAt: number }
/**
 * 巡查判定用的图鉴索引（由服务端从 catalog 构建一次）。
 *
 * 只放判定必需的三样：物种 → 蛋、物种 → 体型阈值、性格 id → 名字。
 */
export interface PatrolSpeciesIndex {
  eggGameIdByGameId: ReadonlyMap<number, number>;
  bodySizeByGameId: ReadonlyMap<number, { small: number; big: number }>;
  natureNameById: ReadonlyMap<number, string>;
}
export interface PatrolObservation { task: PatrolTask; actorId: string; status: 'placed' | 'produced' | 'ambiguous' }
export interface PatrolTaskStatus {
  tradeId: string; side: 'give' | 'return'; checkedAt: number | null;
  status: 'pending' | 'ok' | 'queued' | 'error' | 'quota' | 'placed' | 'produced' | 'ambiguous' | 'quiet';
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
function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
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
  return {
    petId: exactId(raw.pet_gid),
    nestId,
    speciesGameId: optionalInteger(raw.pet_cfg_id),
    natureId: optionalInteger(raw.nature),
    voiceDb: optionalNumber(raw.voice),
    weightKg: null,
    ...(nestId === null && typeof raw.furniture_guid === 'number' && Number.isFinite(raw.furniture_guid)
      ? { roundedNestId: raw.furniture_guid } : {}),
  };
}

/**
 * 解析家园场景。
 *
 * 亲本的物种 / 性格 / 声音在蛋的候选亲本上就有；体重只在 `home_pets` 里，
 * 所以按 pet_gid 关联一次补进去（2026-11-18：巡查改为按蛋目标判定，不再只认亲本编号）。
 */
export function parsePatrolScene(raw: unknown, now: number): PatrolScene {
  const root = object(raw);
  if (root.code !== 0) throw new Error('家园场景读取失败');
  const data = object(root.data);
  const scene = object(data.home_scene_info);
  if (scene.snapshot_status !== 'valid' || !Array.isArray(scene.eggs) ||
      !Number.isSafeInteger(scene.egg_count) || scene.egg_count !== scene.eggs.length ||
      !Number.isFinite(now) || now <= 0) throw new Error('家园场景尚未完整');
  const weightByPetId = new Map<string, number>();
  if (Array.isArray(scene.home_pets)) {
    for (const value of scene.home_pets) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const pet = value as ObjectValue;
      const grams = optionalNumber(pet.weight);
      if (pet.pet_gid === undefined || grams === null || grams <= 0) continue;
      try {
        weightByPetId.set(exactId(pet.pet_gid), grams / 1000);
      } catch {
        continue;
      }
    }
  }
  const eggs = scene.eggs.map(value => {
    const rawEgg = object(value);
    const actorId = exactId(rawEgg.actor_id);
    const nestId = exactId(rawEgg.nest_furniture_guid);
    const mother = rawEgg.mother_candidate === null || rawEgg.mother_candidate === undefined
      ? null : parent(rawEgg.mother_candidate);
    if (!Array.isArray(rawEgg.father_candidates)) throw new Error('亲本信息不完整');
    const fathers = rawEgg.father_candidates.map(parent);
    if (new Set(fathers.map(father => father.petId)).size !== fathers.length) throw new Error('亲本信息重复');
    for (const value of mother ? [mother, ...fathers] : fathers) {
      value.weightKg = weightByPetId.get(value.petId) ?? null;
    }
    return { actorId, nestId, mother, fathers, biologicalParentageConfirmed: rawEgg.biological_parentage_confirmed === true };
  });
  if (new Set(eggs.map(egg => egg.actorId)).size !== eggs.length) throw new Error('蛋实例重复');
  const pairs: PatrolPair[] = [];
  if (Array.isArray(scene.breeding_pairs)) {
    for (const value of scene.breeding_pairs) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const raw = value as ObjectValue;
      if (!raw.female) continue;
      const mother = parent(raw.female);
      mother.weightKg = weightByPetId.get(mother.petId) ?? null;
      const fathers = (Array.isArray(raw.male_partners) ? raw.male_partners : []).map(value => {
        const father = parent(value);
        father.weightKg = weightByPetId.get(father.petId) ?? null;
        return father;
      });
      if (fathers.length) pairs.push({ mother, fathers });
    }
  }
  return { eggs, pairs, capturedAt: now };
}

/** 亲本体型档位：按体重与物种阈值判，缺体重就判不了（返回空串）。 */
function bodyGradeOf(value: PatrolParent, index: PatrolSpeciesIndex): string {
  const size = value.speciesGameId === null ? undefined : index.bodySizeByGameId.get(value.speciesGameId);
  if (!size || value.weightKg === null) return '';
  return bodyMedalOf(size, value.weightKg);
}

/**
 * 目标体型是否命中。父母用的口径与需求配对一致：满体重 / 零体重按大块头 / 小不点算。
 * 判不了（物种未收录、体重缺失）一律不命中。
 */
function bodyMatches(value: PatrolParent, target: string, index: PatrolSpeciesIndex): boolean {
  if (!target) return true;
  const grade = bodyGradeOf(value, index);
  if (!grade) return false;
  const want = target === '满体重' ? '大块头' : target === '零体重' ? '小不点' : target;
  return grade === want;
}

function voiceMatches(value: PatrolParent, target: string): boolean {
  if (!target) return true;
  return value.voiceDb !== null && matchesVoiceOption(value.voiceDb, target);
}

function natureOf(value: PatrolParent, index: PatrolSpeciesIndex): string {
  return value.natureId === null ? '' : (index.natureNameById.get(value.natureId) ?? '');
}

/**
 * 一颗蛋是否满足任务目标（2026-11-18 用户口径：按蛋的目标匹配，不再硬绑发布时那一对）。
 *
 * - 蛋：母本物种所属的蛋 = 任务目标蛋（同进化链都算）
 * - 位置：母本在这颗蛋的窝上，父本在另一个窝
 * - 档位：父母双方体型、声音都达标（判不了视为不达标）
 * - 性格：任务指定时，父母至少一方带目标性格
 */
/**
 * 一对亲本是否满足任务目标：蛋链（同进化链）、父母双方档位、至少一方带目标性格。
 * 判不了的字段一律视为不达标。
 */
function parentsMatchTarget(
  mother: PatrolParent,
  fathers: readonly PatrolParent[],
  task: PatrolTask,
  index: PatrolSpeciesIndex,
): boolean {
  if (mother.speciesGameId === null || index.eggGameIdByGameId.get(mother.speciesGameId) !== task.eggGameId) return false;
  if (!bodyMatches(mother, task.body, index) || !voiceMatches(mother, task.voice)) return false;
  const passing = fathers.filter(father => bodyMatches(father, task.body, index) && voiceMatches(father, task.voice));
  if (passing.length === 0) return false;
  if (!task.nature) return true;
  return natureOf(mother, index) === task.nature || passing.some(father => natureOf(father, index) === task.nature);
}

/** 这颗蛋是否满足任务目标：位置关系之外的部分与「上窝」共用同一套判定。 */
function taskMatches(task: PatrolTask, egg: PatrolEgg, scene: PatrolScene, index: PatrolSpeciesIndex): boolean {
  const mother = egg.mother;
  if (!mother) return false;
  const motherNestMatches = mother.nestId === egg.nestId ||
    (mother.roundedNestId !== undefined && Number(egg.nestId) === mother.roundedNestId &&
      new Set(scene.eggs.filter(e => Number(e.nestId) === mother.roundedNestId).map(e => e.nestId)).size === 1);
  if (!motherNestMatches) return false;
  const fathers = egg.fathers.filter(father => father.nestId !== egg.nestId);
  if (fathers.length === 0) return false;
  return parentsMatchTarget(mother, fathers, task, index);
}

/**
 * 已经上窝的任务：家园当前排着一对满足任务目标的亲本。
 *
 * 只用于更新任务状态，不产生群提醒（2026-11-18 用户口径：上窝更新状态，产出才提醒）。
 */
export function observeScenePlacements(
  scene: PatrolScene,
  tasks: readonly PatrolTask[],
  index: PatrolSpeciesIndex,
): PatrolTask[] {
  return tasks.filter(task => scene.pairs.some(pair => parentsMatchTarget(pair.mother, pair.fathers, task, index)));
}

/** 每次巡查都按当前还在地上的蛋匹配；蛋收走后就匹配不到，提醒自然停止。 */
export function observeSceneEggs(
  scene: PatrolScene,
  tasks: readonly PatrolTask[],
  index: PatrolSpeciesIndex,
): PatrolObservation[] {
  const observations: PatrolObservation[] = [];
  for (const egg of scene.eggs) {
    const matches = tasks.filter(task => taskMatches(task, egg, scene, index));
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
