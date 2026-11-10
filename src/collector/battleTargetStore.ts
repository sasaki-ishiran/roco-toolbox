import { matchesVoiceOption } from '../domain/petFilters';
import { createModuleStore } from '../ui/createModuleStore';
import type { SeasonEncounter } from './captureProgress';

/**
 * 战斗采集的强提醒目标（2026-11-07 悬浮球；2026-11-08 性格/声音/体型改多选）。
 *
 * 由用户在战斗采集模块里设置；进入赛季奇遇战后，守卫数据一到就按目标判定：
 * 命中 → 悬浮球变色（两个状态：默认色 / 命中色），没设目标或未命中 → 不变色。
 * 匹配方式可选「满足其一」或「全部满足」：
 * - 同一维度里选了多个值时，**任意一个值匹配就算该维度命中**（多选 = 维度内取或）；
 * - 「满足其一 / 全部满足」管的是**维度之间**的关系。
 * 声音档位与全站筛选共用 {@link matchesVoiceOption}：`+100` / `-100` / `婉转声` / `粗嗓门`；
 * 体型沿用雷达牌子口径：体重百分位 ≥98 大块头 / ≤2 小不点。
 */
export interface BattleTarget {
  /** 目标性格（多选，如 ['勇敢','胆小']）；空数组 = 不限 */
  natures: string[];
  /** 目标性别：'' 不限 / '公' / '母'（公母互斥，不需要多选） */
  gender: '' | '公' | '母';
  /** 目标声音（多选）：'+100' / '-100' / '婉转声' / '粗嗓门'；空数组 = 不限 */
  voices: Array<'+100' | '-100' | '婉转声' | '粗嗓门'>;
  /** 目标体型（多选）：'big' 大块头 / 'small' 小不点；空数组 = 不限 */
  bodies: Array<'big' | 'small'>;
  /** 多个维度的匹配方式：any = 满足其一 / all = 全部满足 */
  mode: 'any' | 'all';
}

const DEFAULT_TARGET: BattleTarget = { natures: [], gender: '', voices: [], bodies: [], mode: 'any' };
const KEY = 'roco.battleTarget';
const store = createModuleStore<BattleTarget>(DEFAULT_TARGET, { persistKey: KEY });

/** 旧数据的内部代号（2026-11-08 之前）：读到换成界面档位 */
const VOICE_ALIASES: Record<string, BattleTarget['voices'][number]> = {
  high: '婉转声', high100: '+100', low: '粗嗓门', low100: '-100',
};

/** 旧版是单选（nature / voice / body 各一个值），读到就迁成数组（2026-11-08） */
function migrate(raw: unknown): BattleTarget {
  const legacy = (raw ?? {}) as Partial<BattleTarget> & {
    nature?: string;
    voice?: string;
    body?: '' | 'big' | 'small';
  };
  const natures = Array.isArray(legacy.natures)
    ? legacy.natures.filter((nature): nature is string => typeof nature === 'string' && nature !== '')
    : legacy.nature
      ? [legacy.nature]
      : [];
  const voices = (Array.isArray(legacy.voices) ? legacy.voices : legacy.voice ? [legacy.voice] : [])
    .map((voice) => VOICE_ALIASES[voice as string] ?? voice)
    .filter((voice): voice is BattleTarget['voices'][number] =>
      voice === '+100' || voice === '-100' || voice === '婉转声' || voice === '粗嗓门');
  const bodies = (Array.isArray(legacy.bodies) ? legacy.bodies : legacy.body ? [legacy.body] : [])
    .filter((body): body is 'big' | 'small' => body === 'big' || body === 'small');
  return {
    natures,
    gender: legacy.gender === '公' || legacy.gender === '母' ? legacy.gender : '',
    voices,
    bodies,
    mode: legacy.mode === 'all' ? 'all' : 'any',
  };
}

{
  const migrated = migrate(store.get());
  const current = store.get();
  if (JSON.stringify(migrated) !== JSON.stringify(current)) store.set(migrated);
}

export function getBattleTarget(): BattleTarget {
  return store.get();
}

export function useBattleTarget(): BattleTarget {
  return store.use();
}

export function setBattleTarget(patch: Partial<BattleTarget>): void {
  store.set(migrate({ ...store.get(), ...patch }));
}

/** 测试用：重置目标。 */
export function resetBattleTargetForTest(): void {
  store.set(DEFAULT_TARGET);
}

/** 一个维度都没选 = 没设目标（悬浮球永远不变色）。 */
export function isBattleTargetEmpty(target: BattleTarget): boolean {
  return target.natures.length === 0 && !target.gender && target.voices.length === 0 && target.bodies.length === 0;
}

/** 个体参与目标判定所需的字段（守卫与附近精灵共用一套维度口径）。 */
export interface BattleTargetFacts {
  /** 性格；null = 未知（守卫以「30 占位未确认」为未知，附近精灵以记录缺省为未知） */
  nature: string | null;
  gender: string | null;
  voiceDb: number | null;
  weightPct: number | null;
}

/** [设了该维度吗, 该维度命中吗]；维度内多选取或。 */
function targetChecks(target: BattleTarget, facts: BattleTargetFacts): Array<[boolean, boolean]> {
  return [
    [target.natures.length > 0, facts.nature != null && target.natures.includes(facts.nature)],
    [!!target.gender, facts.gender === target.gender],
    [
      target.voices.length > 0,
      facts.voiceDb != null && target.voices.some((voice) => matchesVoiceOption(facts.voiceDb!, voice)),
    ],
    [
      target.bodies.length > 0,
      target.bodies.some((body) =>
        body === 'big' ? (facts.weightPct ?? 0) >= 98 : (facts.weightPct ?? 100) <= 2),
    ],
  ];
}

/** 维度之间的叠加：任意维度都没设 → null（由调用方决定语义）。 */
function targetVerdict(target: BattleTarget, facts: BattleTargetFacts): boolean | null {
  const selected = targetChecks(target, facts).filter(([picked]) => picked);
  if (selected.length === 0) return null;
  return target.mode === 'all'
    ? selected.every(([, hit]) => hit)
    : selected.some(([, hit]) => hit);
}

/** 守卫个体是否命中目标（悬浮球变色、战斗卡上「命中」标签都用它）。 */
export function battleTargetHit(target: BattleTarget, encounter: SeasonEncounter | null | undefined): boolean {
  if (!encounter) return false;
  return targetVerdict(target, {
    nature: encounter.natureConfirmed ? encounter.nature : null,
    gender: encounter.gender || null,
    voiceDb: encounter.voiceDb ?? null,
    weightPct: encounter.weightPct ?? null,
  }) === true;
}

/**
 * 附近精灵是否通过目标维度筛选（2026-11-09 悬浮窗列表）。
 *
 * 与 {@link battleTargetHit} 同一套维度口径（维度内多选取或，维度之间按 `mode` 叠加），
 * 唯一区别：**一个维度都没设 = 全部通过**，而不是「没设目标 / 不命中」。
 * 附近精灵的性格来自宠物记录回填，没有额外的确认帧，非空即视为已知。
 */
export function battleTargetAllows(target: BattleTarget, facts: BattleTargetFacts): boolean {
  return targetVerdict(target, facts) !== false;
}
