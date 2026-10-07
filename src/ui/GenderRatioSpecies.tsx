import { useMemo, useState } from 'react';
import type { OwnedPet } from '../domain/types';
import { ALL_GRADES } from '../domain/coverageTargets';
import {
  buildChainSearchIndex,
  chainKeyOf,
  classifyGrade,
  gradeLabel,
  matchesVoiceOption,
  type PetGrade,
} from '../domain/petFilters';
import { eggGroupNames, species, targetNaturePool } from '../data/catalog';
import { FilterAccordion } from './FilterAccordion';
import { PetCard } from './PetCard';
import { useTargetMode } from './targetModeStore';

/**
 * 性别比例 ≠ 5:5 的精灵（2026-10-05 用户拍板，改名为「性别比例特殊精灵」）。
 *
 * 名单 = 游戏字段 genderRatio（10 分制）自动归类，只列基础形态（stage 1）：
 * - 纯母：male = 0
 * - 公多母少：male > female（且 female > 0）
 * - 母多公少：female > male（且 male > 0）
 *
 * 筛选（2026-10-05 用户拍板，去掉推荐/自选性格与四档位，改成声音 + 体型 + 精灵名 + 性格）：
 * - 声音 / 体型：与「我的精灵」标签一致的多选（默认 ±100 × 大块头/小不点 = 满分 4 档）；
 * - 名称搜索：按物种显示名过滤；
 * - 性格：可选，跟「我的精灵」一样只列出背包里**已有**的性格（没有的性格不显示），默认不筛=全部。
 * 展示：公母都显示（性别符号 ♂/♀），卡片为 PetCard。
 * 不给三类做游戏规则说明（用户拍板：不解释游戏内规则）。
 */
export type GenderRatioKind = 'pure-female' | 'male-more' | 'female-more';

const KIND_META: Record<GenderRatioKind, { label: string; dot: string }> = {
  'pure-female': { label: '纯母', dot: 'bg-pink-400' },
  'male-more': { label: '公多母少', dot: 'bg-sky-400' },
  'female-more': { label: '母多公少', dot: 'bg-violet-400' },
};

const KIND_ORDER: GenderRatioKind[] = ['pure-female', 'male-more', 'female-more'];

const classify = (male: number, female: number): GenderRatioKind | null => {
  if (male === 0 && female > 0) return 'pure-female';
  if (male > female) return 'male-more';
  if (female > male && male > 0) return 'female-more';
  return null;
};

const VOICE_OPTIONS = ['婉转声', '+100', '-100', '粗嗓门'] as const;
const BODY_OPTIONS = ['大块头', '小不点'] as const;
type VoiceOption = (typeof VOICE_OPTIONS)[number];
type BodyOption = (typeof BODY_OPTIONS)[number];

/** 八大性格排在前面，其余性格在后（2026-10-05 用户拍板） */
const POOL_ORDER = new Map(targetNaturePool.map((entry, index) => [entry.name, index]));
const sortPoolFirst = (names: string[]): string[] =>
  [...names].sort((a, b) => {
    const ia = POOL_ORDER.get(a);
    const ib = POOL_ORDER.get(b);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.localeCompare(b);
  });

export function GenderRatioSpecies({ owned }: { owned: OwnedPet[] }) {
  const mode = useTargetMode();
  const [bodies, setBodies] = useState<BodyOption[]>(['大块头', '小不点']);
  const [voices, setVoices] = useState<VoiceOption[]>(['+100', '-100']);
  const [natures, setNatures] = useState<string[]>([]);
  const [grades, setGrades] = useState<PetGrade[]>(['大婉']);
  const [query, setQuery] = useState('');

  const speciesByGameId = useMemo(() => new Map(species.map((s) => [s.gameId, s])), []);
  // 进化链搜索索引：搜链上任一成员名/图鉴号 → 命中整条链
  const chainSearchIndex = useMemo(() => buildChainSearchIndex(species), []);

  /** 性格筛选项：只列背包里实际出现过的性格（我的精灵同样粒度），八大性格排前面，默认不选 = 全部 */
  const availableNatures = useMemo(
    () => sortPoolFirst([...new Set(owned.map((pet) => pet.nature))].filter(Boolean)),
    [owned],
  );

  const petsByKind = useMemo(() => {
    const result = new Map<GenderRatioKind, OwnedPet[]>();
    for (const kind of KIND_ORDER) result.set(kind, []);
    const bodySet = new Set(bodies);
    const natureSet = new Set(natures);
    const gradeSet = new Set(grades);
    const keyword = query.trim().toLowerCase();
    for (const pet of owned) {
      const entry = speciesByGameId.get(pet.gameId);
      if (!entry || entry.stage !== 1 || !entry.genderRatio) continue;
      const kind = classify(entry.genderRatio.male, entry.genderRatio.female);
      if (!kind) continue;
      // 档位快捷筛选（restore 2026-10-05 用户拍板：保留档位选择，快捷搜索）
      const petGrade = classifyGrade(pet, mode);
      if (gradeSet.size > 0 && (petGrade === null || !gradeSet.has(petGrade))) continue;
      if (bodies.length > 0 && !bodySet.has(pet.medalBody as BodyOption)) continue;
      if (voices.length > 0 && !voices.some((voice) => matchesVoiceOption(pet.voiceDb, voice))) continue;
      if (natureSet.size > 0 && !natureSet.has(pet.nature)) continue;
      if (keyword) {
        const text = chainSearchIndex.get(chainKeyOf(entry, pet.gameId)) ?? '';
        if (!text.includes(keyword)) continue;
      }
      result.get(kind)!.push(pet);
    }
    for (const list of result.values()) {
      list.sort(
        (a, b) =>
          (speciesByGameId.get(a.gameId)?.name ?? '').localeCompare(
            speciesByGameId.get(b.gameId)?.name ?? '',
          ) || b.voiceDb - a.voiceDb,
      );
    }
    return result;
  }, [owned, bodies, voices, natures, grades, query, mode, speciesByGameId, chainSearchIndex]);

  const totalCount = KIND_ORDER.reduce((sum, kind) => sum + (petsByKind.get(kind)?.length ?? 0), 0);
  const toggleBody = (body: BodyOption): void =>
    setBodies((prev) => (prev.includes(body) ? prev.filter((v) => v !== body) : [...prev, body]));
  const toggleVoice = (voice: VoiceOption): void =>
    setVoices((prev) => (prev.includes(voice) ? prev.filter((v) => v !== voice) : [...prev, voice]));
  const toggleNature = (nature: string): void =>
    setNatures((prev) => (prev.includes(nature) ? prev.filter((v) => v !== nature) : [...prev, nature]));

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="gender-ratio-section">
      <h2 className="text-sm font-medium text-slate-500">性别比例特殊精灵</h2>

      {/* 筛选：声音 × 体型 × 名称 × 性格（可选，默认全部） */}
      <div className="mt-2 space-y-2" data-testid="gr-filters">
        <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索精灵名"
        data-testid="gr-name-search"
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none"
      />
      {/* 档位：快捷选择（2026-10-05 用户拍板保留，不折叠） */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="gr-grades">
        <span className="text-xs text-slate-400">档位</span>
        {ALL_GRADES.map((grade) => {
          const on = grades.includes(grade);
          return (
            <button
              key={grade}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setGrades((prev) =>
                  on ? prev.filter((item) => item !== grade) : [...prev, grade],
                )
              }
              data-testid={`gr-grade-${grade}`}
              className={`min-h-[28px] rounded-full px-2.5 text-xs ${
                on
                  ? 'bg-emerald-500 font-semibold text-white shadow'
                  : 'bg-slate-100 font-medium text-slate-500'
              }`}
            >
              {gradeLabel(grade, mode)}
            </button>
          );
        })}
      </div>
      <FilterAccordion
        dimensions={[
          {
            id: 'voice',
            label: '声音',
            options: VOICE_OPTIONS.map((voice) => ({ value: voice, label: voice })),
            selected: voices,
            onToggle: (voice) => toggleVoice(voice as VoiceOption),
            onClear: () => setVoices([]),
          },
          {
            id: 'body',
            label: '体型',
            options: BODY_OPTIONS.map((body) => ({ value: body, label: body })),
            selected: bodies,
            onToggle: (body) => toggleBody(body as BodyOption),
            onClear: () => setBodies([]),
          },
          {
            id: 'nature',
            label: '性格（可选）',
            options: availableNatures.map((nature) => ({ value: nature, label: nature })),
            selected: natures,
            onToggle: toggleNature,
            onClear: () => setNatures([]),
          },
        ]}
      />
      {/* 该维度一个不选 = 不限 */}
      <p className="text-[11px] text-slate-300" data-testid="gr-tip">
        某一项点开不选 = 不限
      </p>
      </div>

      {/* 三类卡片：显示具体的精灵（PetCard） */}
      {totalCount === 0 ? (
        <p className="mt-2 text-xs text-slate-400" data-testid="gender-ratio-empty">
          当前筛选下没有符合条件的精灵。
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {KIND_ORDER.map((kind) => {
            const pets = petsByKind.get(kind) ?? [];
            if (pets.length === 0) return null;
            const meta = KIND_META[kind];
            return (
              <div key={kind} data-testid={`gender-ratio-kind-${kind}`}>
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                  {meta.label}（{pets.length}）
                </p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {pets.map((pet, index) => (
                    <PetCard
                      key={`${pet.account}-${pet.captureId ?? pet.gameId}-${index}`}
                      pet={pet}
                      species={speciesByGameId.get(pet.gameId)}
                      eggGroupNames={eggGroupNames}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}