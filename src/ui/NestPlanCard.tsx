import { useState } from 'react';
import { eggGroupNames, species, targetNatureNames } from '../data/catalog';
import { heightMetersOf, weightKgOf } from '../domain/petFilters';
import { petBodyMedalIcon, petVoiceMedalIcon } from '../domain/petIcons';
import type { NestPairing, NestPet, NestPlan } from '../domain/nestPlan';
import {
  recommendedNatureChance,
  type MotherHelpItem,
  type MotherNestAccount,
  type MotherNestPairing,
  type MotherNestTask,
} from '../domain/motherNest';
import { GenderMark } from './GenderMark';
import { genderShareOf } from '../domain/genderRatio';
import { PetAvatar } from './PetAvatar';
import { pairingColor, pairingDashed } from './pairingColors';
import { formatPercent } from './formatPercent';
import { getMyPetsSizeUnit } from './myPetsFilterStore';

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));
/** 玩家说的「八大性格」：只有这些性格才配在母本卡头上单独写概率 */
const EIGHT_NATURES = new Set(targetNatureNames);

export const groupName = (groupId: number): string => eggGroupNames[groupId] ?? `蛋组${groupId}`;

/** 一条配对的展示键（同一对精灵补多个性格 → 同一行；同名同内容的两只精灵 key 不同，不会被并） */
const viewKeyOf = (pairing: NestPairing): string =>
  pairing.academyParent
    ? `academy|${pairing.academyParent.key}|${pairing.grade}`
    : `normal|${pairing.mother.key}|${pairing.father.key}|${pairing.grade}`;

/** 一条配对（同一对精灵能补多个性格 → 合并成一条；学院 1:2 也合并成一条） */
interface PairingView {
  key: string;
  groupIds: number[];
  /** 这一对能补的性格 + 各自的遗传概率（普通 30% / 60%、学院 100%） */
  natures: Array<{ name: string; chance: number }>;
  grade: string;
  /** 左边那只：学院档 = 学院小窝那只，普通档 = 母本 */
  left: NestPet;
  /** 这一窝的母本（性别折算看它） */
  mother: NestPet;
  /** 期望补格数：概率 × 组数 × 母方性别折算（排序与界面都用它） */
  expectedValue: number;
  /** 子代是目标性别的比例（种公线看出公；按母方物种性别比例，缺数据 5:5） */
  genderShare: number;
  /** 右边：普通档 1 只；学院那只挂 2 个配对方时并排写多只 */
  partners: NestPet[];
  academyParent: NestPet | null;
  expected: NestPairing['expected'];
  /** 这一条在摆位图里的线色（卡片也用同一色） */
  color: string;
  /** 颜色轮回到同一色时用虚线/空心点区分 */
  dashed: boolean;
}

/**
 * 这条建议**产出目标性格的总概率**（各性格互斥：一颗蛋只会有一个性格 → 相加）。
 * 只用于排序；卡片上每个性格单独写各自概率（2026-11-18）。
 */
const viewChance = (view: Pick<PairingView, 'natures'>): number =>
  view.natures.reduce((sum, item) => sum + item.chance, 0);

const percentLabel = (chance: number): string => `${Math.round(chance * 100)}%`;

/**
 * 卡头声音：公、母各取平均后两边再平均，向下取整（2026-11-19 用户口径）。
 * 一对 100 / 97 → (100 + 97) / 2 = 98.5 → 98dB；学院 1:2 时母方两只先平均。
 */
export const averageVoiceOf = (
  pets: readonly { gender: '公' | '母' | '未知'; voiceDb?: number | null }[],
): number | null => {
  const meanOf = (list: number[]): number => list.reduce((sum, value) => sum + value, 0) / list.length;
  const voices = (gender: '公' | '母'): number[] =>
    pets
      .filter(
        (pet) =>
          pet.gender === gender && typeof pet.voiceDb === 'number' && Number.isFinite(pet.voiceDb),
      )
      .map((pet) => pet.voiceDb as number);
  const males = voices('公');
  const females = voices('母');
  if (males.length === 0 || females.length === 0) return null;
  return Math.floor((meanOf(males) + meanOf(females)) / 2);
};

const mergePairings = (pairings: NestPairing[]): PairingView[] => {
  const views: PairingView[] = [];
  const byKey = new Map<string, PairingView>();
  for (const pairing of pairings) {
    // 键用个体身份 + 档位，**不含性格**：同一对精灵补多个性格要并成一行；
    // 同名同内容的两只精灵 key 不同，不会被并；学院那只挂 2 个配对方也只并到它自己这一行。
    const key = viewKeyOf(pairing);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.partners.some((partner) => partner.key === pairing.partner.key)) {
        existing.partners.push(pairing.partner);
      }
      for (const groupId of pairing.groupIds) {
        if (!existing.groupIds.includes(groupId)) existing.groupIds.push(groupId);
      }
      // 同一对可能对不同性格分别有 60% / 30%：概率按性格各自记，不能一律用档位算
      const existingNature = existing.natures.find((item) => item.name === pairing.natureName);
      if (existingNature) {
        existingNature.chance = Math.max(existingNature.chance, pairing.natureChance);
      } else {
        existing.natures.push({ name: pairing.natureName, chance: pairing.natureChance });
      }
      existing.expectedValue += pairing.expectedValue;
      continue;
    }
    const view: PairingView = {
      key,
      groupIds: [...pairing.groupIds],
      natures: [{ name: pairing.natureName, chance: pairing.natureChance }],
      grade: pairing.grade,
      left: pairing.academyParent ?? pairing.mother,
      mother: pairing.mother,
      expectedValue: pairing.expectedValue,
      genderShare: genderShareOf(speciesByGameId.get(pairing.mother.gameId), '公'),
      partners: [pairing.partner],
      academyParent: pairing.academyParent,
      expected: pairing.expected,
      color: pairingColor(views.length),
      dashed: pairingDashed(views.length),
    };
    byKey.set(key, view);
    views.push(view);
  }
  // 产出目标性格概率高的排前面（同率时按蛋组、性格稳定排序）
  views.sort(
    (a, b) =>
      b.expectedValue - a.expectedValue ||
      viewChance(b) - viewChance(a) ||
      (a.groupIds[0] ?? 0) - (b.groupIds[0] ?? 0) ||
      (a.natures[0]?.name ?? '').localeCompare(b.natures[0]?.name ?? '') ||
      a.key.localeCompare(b.key),
  );
  return views;
};

/**
 * 一行「概率 + 性格 + 性别」：**每个性格一枚「50%固执 ♂」**。
 *
 * 2026-11-19 用户口径：卡片上方的蛋组也去掉（每只精灵卡左上角已有蛋组）；
 * 2026-11-18 口径：不标「普通 / 学院（绿窝）」档位，也不写「单组 / 双组 / 补 / 种公」。
 * 性别用图标（GenderMark）。
 */
function PairingHead({
  natures,
  genderShare,
  voiceDb,
}: Pick<PairingView, 'natures' | 'genderShare'> & { voiceDb: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="pairing-head">
      {natures.map(({ name, chance }) => (
        <span
          key={name}
          className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-amber-700"
        >
          {percentLabel(chance * genderShare)}
          {name}
          <GenderMark gender="公" />
        </span>
      ))}
      {voiceDb !== null ? (
        <span className="text-[10px] leading-none text-slate-500" data-testid="pairing-voice">
          {voiceDb}dB
        </span>
      ) : null}
    </div>
  );
}

/** 空集合：没有传「这个号已收齐哪些组」时，蛋组标签一律保持原蓝色 */
const NO_COLLECTED_GROUPS: ReadonlySet<number> = new Set();

/**
 * 配窝卡里的一只精灵（2026-11-19 用户口径）：补全计划与家园共用同一张紧凑卡。
 *
 * - 蛋组在左上角（编号不再显示）：**这个号已收齐的组显示绿色**，没收齐的保持原来的蓝色；
 * - 体型 / 声音奖牌放在蛋组下方；
 * - 分贝、身高、体重纵向排在性格下方；
 * - 头像 44、名字 11px；补全计划的卡高 86px，卡底留一行盒子位置；
 *   家园卡高 70px，不写盒子（数据里也没有）。
 */
export interface PairCardPet {
  key: string;
  gameId: number | null;
  name: string;
  /** 完整名字（含形态）：`name` 只放基础名时用它做 title */
  fullName?: string;
  gender: '公' | '母' | '未知';
  nature: string;
  voiceDb?: number | null;
  medalBody?: string | null;
  heightPercent?: number | null;
  weightPercent?: number | null;
  /** 卡底小字：补全计划是盒子位置；家园不写 */
  box?: string;
}

export function PairingPetCard({
  pet,
  collectedGroupIds,
  academy = false,
  home = false,
  testId = 'breed-pet-card',
}: {
  pet: PairCardPet;
  collectedGroupIds: ReadonlySet<number>;
  /** 住学院小窝：绿框，和普通窝的卡片区分开 */
  academy?: boolean;
  /** 家园版：70px（补全计划 86px，多一行盒子位置） */
  home?: boolean;
  /** 覆盖默认 data-testid（接单上窝复用这张卡时用 `home-demand-parent`） */
  testId?: string;
}) {
  const entry = pet.gameId != null ? speciesByGameId.get(pet.gameId) : undefined;
  const groups = (entry?.eggGroups ?? []).filter((groupId) => groupId >= 2 && groupId <= 15);
  const bodyIcon = petBodyMedalIcon(pet.medalBody, pet.weightPercent);
  const voiceIcon = petVoiceMedalIcon(pet.voiceDb);
  const sizeValue = getMyPetsSizeUnit() === 'value';
  const meters = heightMetersOf(entry?.heightSize, pet.heightPercent);
  const kilograms = weightKgOf(entry?.bodySize, pet.weightPercent);
  /** 名字完整显示（含形态后缀）；越长字号越小，保证一行放得下（2026-11-19） */
  const nameClass = home
    ? 'text-[11px] leading-4'
    : pet.name.length > 8
      ? 'text-[9px] leading-3'
      : pet.name.length > 5
        ? 'text-[10px] leading-3'
        : 'text-[11px] leading-[14px]';
  const heightText =
    sizeValue && meters !== null ? `${meters.toFixed(2)}m` : formatPercent(pet.heightPercent);
  const weightText =
    sizeValue && kilograms !== null ? `${kilograms.toFixed(1)}kg` : formatPercent(pet.weightPercent);

  return (
    <article
      className={`relative min-w-0 overflow-hidden rounded-xl p-1.5 shadow-sm ${
        home ? 'h-[70px]' : 'h-[86px]'
      } ${
        pet.gender === '母'
          ? 'bg-pink-50'
          : pet.gender === '公'
            ? 'bg-sky-50'
            : 'bg-slate-50'
      } ${
        academy
          ? 'border-2 border-emerald-500'
          : pet.gender === '母'
            ? 'border border-pink-200'
            : pet.gender === '公'
              ? 'border border-sky-200'
              : 'border border-slate-200'
      }`}
      data-testid={testId}
    >
      <header className="absolute inset-x-1.5 top-1.5 z-10 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-0.5 overflow-hidden">
        <div className="flex min-w-0 flex-col items-start gap-px">
          {groups.map((groupId) => {
            const collected = collectedGroupIds.has(groupId);
            return (
              <span
                key={groupId}
                className={`max-w-full truncate rounded px-1 py-px text-[9px] leading-3 ${
                  collected
                    ? 'bg-emerald-100 font-medium text-emerald-700'
                    : 'bg-sky-100 text-sky-800'
                }`}
                title={collected ? `${groupName(groupId)}（已收齐）` : groupName(groupId)}
              >
                {groupName(groupId)}
              </span>
            );
          })}
          {bodyIcon || voiceIcon ? (
            <span className="mt-0.5 flex items-center gap-1" data-testid="breed-pet-medals">
              {bodyIcon ? (
                <img
                  src={bodyIcon}
                  alt={pet.medalBody ?? ''}
                  title={pet.medalBody ?? undefined}
                  className="h-3.5 w-3.5 drop-shadow-sm"
                />
              ) : null}
              {voiceIcon ? (
                <img
                  src={voiceIcon}
                  alt=""
                  title={`声音 ${pet.voiceDb}dB`}
                  className="h-3.5 w-3.5 drop-shadow-sm"
                />
              ) : null}
            </span>
          ) : null}
        </div>
        <div className={`flex min-w-0 flex-col items-end gap-px text-[10px] text-slate-500 ${home ? 'leading-[13px]' : 'leading-3'}`}>
          <span className="flex min-w-0 items-center justify-end gap-0.5">
            <GenderMark gender={pet.gender} />
            <span
              className="inline-flex max-w-full items-center truncate rounded bg-amber-100 px-1 text-[10px] leading-3 font-medium text-amber-900"
              title={pet.nature}
            >
              {pet.nature}
            </span>
          </span>
          <span className="whitespace-nowrap">
            {pet.voiceDb != null ? `${pet.voiceDb}dB` : '—'}
          </span>
          <span className="whitespace-nowrap">高{heightText}</span>
          <span className="whitespace-nowrap">重{weightText}</span>
        </div>
      </header>
      <div className="absolute left-1/2 top-[6px] flex h-11 w-11 -translate-x-1/2 items-center justify-center">
        <PetAvatar gameId={pet.gameId} name={pet.name} size={44} />
      </div>
      <h4
        className={`absolute inset-x-1 truncate text-center font-bold text-slate-900 ${
          home ? 'top-[52px]' : 'top-[56px]'
        } ${nameClass}`}
        title={pet.fullName ?? pet.name}
      >
        {pet.name}
      </h4>
      {pet.box ? (
        <p
          className="absolute inset-x-1 top-[72px] truncate text-center text-[9px] leading-3 text-slate-400"
          title={pet.box}
        >
          {pet.box}
        </p>
      ) : null}
    </article>
  );
}

/**
 * 母本线卡头的性格概率：推荐性格（目标）优先，后面补上双亲自己的性格。
 * 这样即使推荐性格没命中双亲，卡头也有「性格 + 百分比 + 性别」，不会只剩蛋组 / dB
 * （2026-11-19 用户反馈）。
 */
const motherNatureChances = (
  mother: NestPet,
  father: NestPet,
  recommendedNatures: readonly string[],
  femaleChance: number,
): Array<{ nature: string; chance: number }> => {
  const chanceOf = (nature: string): number =>
    femaleChance * recommendedNatureChance(mother.nature, father.nature, [nature]);
  /** 只有双方都不是八大性格时，才把非八大性格也写出来；一方是八大就只写八大那一方 */
  const bothNonEight =
    Boolean(mother.nature) &&
    Boolean(father.nature) &&
    !EIGHT_NATURES.has(mother.nature) &&
    !EIGHT_NATURES.has(father.nature);
  const parentNatures = [mother.nature, father.nature].filter(
    (nature) => nature && (bothNonEight || EIGHT_NATURES.has(nature)),
  );
  const byNature = new Map<string, number>();
  for (const nature of [...recommendedNatures, ...parentNatures]) {
    if (!nature) continue;
    const chance = chanceOf(nature);
    if (chance > 0) byNature.set(nature, Math.max(byNature.get(nature) ?? 0, chance));
  }
  return [...byNature].map(([nature, chance]) => ({ nature, chance }));
};

/**
 * 公不是八大性格时的标记（2026-11-19 用户口径）。
 *
 * 母本概率上它和八大公一样（母本自己带了推荐性格），但这只公补不了任何种公格；
 * 只有这一组实在没有八大公时才会退回来用它，所以要标出来，别让用户以为推荐错了。
 */
const NonEightStudNote = ({ nature }: { nature: string }) =>
  EIGHT_NATURES.has(nature) ? null : (
    <span
      className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] leading-none font-medium text-slate-500"
      title="这只公的性格不在八大里，补不了种公格；这一组没有八大公时才用它配母本"
      data-testid="mother-non-eight-stud"
    >
      非八大公·仅补母本
    </span>
  );

/** 母本卡头：性格概率 + 平均分贝 + 非八大公标记（与补全计划卡同一套卡头，2026-11-19 统一） */
function MotherCardHead({
  natures,
  voiceDb,
  fatherNature,
  testId,
}: {
  natures: Array<{ nature: string; chance: number }>;
  voiceDb: number | null;
  fatherNature: string;
  testId: string;
}) {
  return (
    <div className="flex flex-1 flex-wrap items-center gap-1" data-testid={testId}>
      {natures.map(({ nature, chance }) => (
        <span
          key={nature}
          className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-amber-700"
        >
          {percentLabel(chance)}
          {nature}
          <GenderMark gender="母" />
        </span>
      ))}
      {voiceDb !== null ? (
        <span className="text-[10px] leading-none text-slate-500">{voiceDb}dB</span>
      ) : null}
      <NonEightStudNote nature={fatherNature} />
    </div>
  );
}

/**
 * 卡片上的「问小组」（2026-11-19 用户口径）。
 *
 * 跨号传蛋和小组求助本质是同一件事（内求 / 外求），所以每条内求的线旁边都留一个外求入口，
 * 不占额外位置：卡底右侧一个小按钮。
 */
function SeekGroupButton({ onSeekHelp }: { onSeekHelp?: () => void }) {
  if (!onSeekHelp) return null;
  return (
    <div className="mt-1 flex justify-end">
      <button
        type="button"
        onClick={onSeekHelp}
        data-testid="mother-seek-help"
        className="min-h-[24px] rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-500 active:bg-slate-50"
      >
        问小组
      </button>
    </div>
  );
}

/** 母本配窝：一条「未收集母本 × 公」的线（同种时同时补种公，记双收益） */
function MotherPairingCard({
  pairing,
  collectedGroupIds,
  onSeekHelp,
}: {
  pairing: MotherNestPairing;
  collectedGroupIds: ReadonlySet<number>;
  onSeekHelp?: () => void;
}) {
  /** 每个推荐性格单独算「出母 × 拿到这个性格」：6~30 个百分点的独立目标 */
  const natureChances = motherNatureChances(
    pairing.mother,
    pairing.father,
    pairing.recommendedNatures,
    pairing.femaleChance,
  );
  const voiceDb = averageVoiceOf([pairing.mother, pairing.father]);
  return (
    <li
      className="rounded-xl border-l-4 border-amber-400 bg-slate-50 px-2 py-2"
      data-testid="mother-pairing"
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400"
          aria-hidden="true"
        />
        <MotherCardHead
          natures={natureChances}
          voiceDb={voiceDb}
          fatherNature={pairing.father.nature}
          testId="mother-pairing-head"
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <PairingPetCard pet={pairing.mother} collectedGroupIds={collectedGroupIds} />
        <PairingPetCard pet={pairing.father} collectedGroupIds={collectedGroupIds} />
      </div>
      <SeekGroupButton onSeekHelp={onSeekHelp} />
    </li>
  );
}

/** 跨号母本建议：源号最高概率的一对 → 传蛋过来 */
function MotherTaskCard({
  task,
  collectedGroupIds,
  onSeekHelp,
}: {
  task: MotherNestTask;
  collectedGroupIds: ReadonlySet<number>;
  onSeekHelp?: () => void;
}) {
  const natureChances = motherNatureChances(
    task.mother,
    task.father,
    task.recommendedNatures,
    task.femaleChance,
  );
  const voiceDb = averageVoiceOf([task.mother, task.father]);

  return (
    <li
      className="rounded-xl border-l-4 border-sky-400 bg-slate-50 px-2 py-2"
      data-testid="mother-task"
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-400"
          aria-hidden="true"
        />
        <MotherCardHead
          natures={natureChances}
          voiceDb={voiceDb}
          fatherNature={task.father.nature}
          testId="mother-task-head"
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <PairingPetCard pet={task.mother} collectedGroupIds={collectedGroupIds} />
        <PairingPetCard pet={task.father} collectedGroupIds={collectedGroupIds} />
      </div>
      <p
        className="mt-1 text-center text-[11px] font-semibold text-sky-700"
        data-testid="mother-task-flow"
      >
        {task.sourceAccount} → {task.account}
      </p>
      <SeekGroupButton onSeekHelp={onSeekHelp} />
    </li>
  );
}

/**
 * 向小组求助的母本缺口（2026-11-19 用户口径）。
 *
 * 本号自己只能 30%、别的号也没有更稳的一对：不占窝，集中成一小段，配一个「向小组求助」入口。
 * 每条写「最好 30%」而不是不写，让用户知道这不是漏算。
 */
function MotherHelpList({
  helps,
  onSeekHelp,
}: {
  helps: MotherHelpItem[];
  onSeekHelp?: () => void;
}) {
  return (
    <div
      className="mt-1.5 rounded-xl border-l-4 border-slate-300 bg-slate-50 px-2 py-2"
      data-testid="mother-helps"
    >
      <p className="text-[11px] leading-relaxed text-slate-600">
        这些蛋最好的配法也不到 30%：占窝不划算，去小组问问有没有更稳的一对，或直接换蛋。
      </p>
      <ul className="mt-1 space-y-0.5">
        {helps.map((help) => (
          <li
            key={help.eggGameId}
            className="flex items-center justify-between gap-2 text-[11px] text-slate-500"
            data-testid="mother-help"
          >
            <span className="truncate">{help.eggName}</span>
            <span className="shrink-0" data-testid="mother-help-chance">
              最好 {percentLabel(help.bestNatureChance * help.femaleChance)}
            </span>
          </li>
        ))}
      </ul>
      {onSeekHelp ? (
        <button
          type="button"
          onClick={onSeekHelp}
          data-testid="mother-help-action"
          className="mt-1.5 min-h-[28px] rounded-lg border border-emerald-200 bg-white px-2 text-[11px] font-medium text-emerald-700 active:bg-emerald-50"
        >
          向小组求助
        </button>
      ) : null}
    </div>
  );
}

/** 配对卡片：一条配窝建议（左侧色条 + 圆点 = 摆位图里那条线的颜色，便于对号入座） */
function PairingCard({
  view,
  testId,
  receivers,
  collectedGroupIds,
}: {
  view: PairingView;
  testId: string;
  /** 这一格还有哪些号在等蛋（缺口分工算出来的收蛋方） */
  receivers: string[];
  /** 本号已经收齐的蛋组（卡里标绿） */
  collectedGroupIds: ReadonlySet<number>;
}) {
  const cards = [view.left, ...view.partners];
  const voiceDb = averageVoiceOf(cards);
  return (
    <li
      className="rounded-xl border-l-4 bg-slate-50 px-2 py-2"
      style={{ borderLeftColor: view.color }}
      data-testid={testId}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
          style={
            view.dashed
              ? { border: `2px solid ${view.color}` } // 与虚线一一对应
              : { backgroundColor: view.color }
          }
          aria-hidden="true"
        />
        <PairingHead
          natures={view.natures}
          genderShare={view.genderShare}
          voiceDb={voiceDb}
        />
      </div>
      {/* 一对 = 两张精灵背包卡（学院 1:2 时三张）；卡片里自带盒子位置，外面不再重复 */}
      <div
        className="mt-1.5 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}
      >
        {cards.map((pet, index) => (
          <PairingPetCard
            key={`${pet.key}-${index}`}
            pet={pet}
            collectedGroupIds={collectedGroupIds}
            academy={view.academyParent?.key === pet.key}
          />
        ))}
      </div>
      {/* 谁传给谁（2026-11-18）：放在两张精灵卡下方正中，不埋在卡片底部 */}
      {receivers.length > 0 ? (
        <p
          className="mt-1 text-center text-[11px] font-medium text-sky-700"
          data-testid="breed-receivers"
        >
          {view.mother.account} → {receivers.slice(0, 3).join('、')}
          {receivers.length > 3 ? ` 等 ${receivers.length} 个号` : ''}
        </p>
      ) : null}
    </li>
  );
}

/**
 * 「一键配窝」卡片：按账号给出**哪只进哪个窝、和谁配、小窝怎么摆**。
 * 数据来自 `buildNestPlans`（第一期：可配建议）。候选配对默认收起，用户可自行替换。
 *
 * `emptyNote`：没有可排方案时的提示语。目标已全收齐时由页面改写成「已全部收集」，
 * 不再让用户去覆盖度找不存在的缺口（2026-10-24）。
 */
export function NestPlanCard({
  plans,
  emptyNote,
  gapsByAccount,
  collectedGroupIdsByAccount,
  motherSuggestions,
  onSeekHelp,
}: {
  plans: NestPlan[];
  emptyNote?: string;
  /** 每个号自己还差几个种公目标（按号各算，2026-11-18） */
  gapsByAccount?: ReadonlyMap<string, number>;
  /** 每个号已经收齐的蛋组（配窝卡里标绿；没传就全是原来的蓝色） */
  collectedGroupIdsByAccount?: ReadonlyMap<string, ReadonlySet<number>>;
  /** 母本配窝建议（2026-11-18）：本号内母本线 + 跨号传蛋；按账号索引 */
  motherSuggestions?: ReadonlyMap<string, MotherNestAccount>;
  /** 「向小组求助」：去小组发需求（2026-11-19） */
  onSeekHelp?: () => void;
}) {
  /** 当前看哪个号（多账号滑条切换；默认第一个有内容的号） */
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const entries = plans.map((plan) => ({ plan, views: mergePairings(plan.pairings) }));
  /** 这个号实际占几个窝：种公方案 + 母本配窝（2026-11-19：tab 写窝数，不写对数） */
  const nestsOf = (plan: NestPlan): number =>
    plan.nestsUsed + (motherSuggestions?.get(plan.account)?.nestsUsed ?? 0);
  /** 这个号有几条母本建议（本号内 + 跨号） */
  const motherCountOf = (account: string): number => {
    const suggestion = motherSuggestions?.get(account);
    return (
      (suggestion?.pairings.length ?? 0) +
      (suggestion?.tasks.length ?? 0) +
      (suggestion?.helps.length ?? 0)
    );
  };
  /** 有内容的号才进滑条：出窝的、等蛋的、还有缺口的、或者有母本建议的 */
  const visible = entries.filter(
    (entry) =>
      entry.views.length > 0 ||
      entry.plan.unfilled.length > 0 ||
      entry.plan.delegated.length > 0 ||
      motherCountOf(entry.plan.account) > 0,
  );
  const hasContent = visible.length > 0;

  /** 每一格还有哪些号在等蛋：来自别的号的 delegated 清单（2026-11-18 多账号） */
  const receiversByCell = new Map<string, string[]>();
  for (const plan of plans) {
    for (const item of plan.delegated) {
      const key = `${item.groupId}|${item.natureName}|${item.grade}`;
      const list = receiversByCell.get(key) ?? [];
      if (!list.includes(plan.account)) list.push(plan.account);
      receiversByCell.set(key, list);
    }
  }
  const receiversOf = (view: PairingView): string[] => {
    const set = new Set<string>();
    for (const groupId of view.groupIds) {
      for (const nature of view.natures) {
        const key = `${groupId}|${nature.name}|${view.grade}`;
        for (const account of receiversByCell.get(key) ?? []) set.add(account);
      }
    }
    return [...set];
  };

  if (!hasContent) {
    return (
      <p className="mt-1 text-sm text-slate-400" data-testid="breed-empty">
        {emptyNote ?? '当前没有能排的配窝方案——先到「覆盖度」挑要补的缺口，或缺的配对方/母本还没到位。'}
      </p>
    );
  }
  // 默认看「要出的窝最多」的那个号，而不是按账号名排第一个（多号时第一个往往是空壳）
  const defaultAccount = visible.reduce(
    (best, entry) =>
      entry.views.length + motherCountOf(entry.plan.account) >
      best.views.length + motherCountOf(best.plan.account)
        ? entry
        : best,
    visible[0],
  );
  const active =
    visible.find((entry) => entry.plan.account === activeAccount) ?? defaultAccount;
  /** 当前号的母本配窝：pairings = 本号内要占窝的线；tasks = 跨号传蛋建议 */
  const mother = active ? motherSuggestions?.get(active.plan.account) ?? null : null;
  const motherNests = mother?.nestsUsed ?? 0;

  return (
    <div className="mt-1">
      {visible.length > 1 ? (
        <div
          className="-mx-1 mb-1.5 flex gap-1.5 overflow-x-auto px-1 pb-1"
          data-testid="breed-account-tabs"
        >
          {visible.map((entry) => {
            const selected = entry.plan.account === active?.plan.account;
            return (
              <button
                key={entry.plan.account}
                type="button"
                onClick={() => setActiveAccount(entry.plan.account)}
                data-testid="breed-account-tab"
                aria-pressed={selected}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                }`}
              >
                {entry.plan.account}
                <span className={`ml-1 text-[10px] ${selected ? 'text-emerald-100' : 'text-slate-400'}`}>
                  {nestsOf(entry.plan) > 0 ? `${nestsOf(entry.plan)} 窝` : '待补'}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {active ? (
        <div data-testid="breed-account">
          <h3 className="mb-1 text-sm font-medium text-slate-700" data-testid="breed-account-name">
            {active.plan.account} · 用 {active.plan.nestsUsed + motherNests}/{active.plan.nestsTotal} 个窝
            {motherNests > 0 ? (
              <span className="ml-1 text-[10px] font-normal text-amber-700">
                种公 {active.plan.nestsUsed} + 母本 {motherNests}
              </span>
            ) : null}
            {gapsByAccount?.get(active.plan.account) != null ? (
              <span className="ml-1 text-xs font-normal text-slate-500">
                · 差 <b className="text-rose-600">{gapsByAccount.get(active.plan.account)}</b> 个种公目标
              </span>
            ) : null}
          </h3>
          {active.views.length === 0 && (mother?.pairings.length ?? 0) === 0 ? (
            <p className="mt-1 text-xs text-slate-400" data-testid="breed-idle">
              这个号不用出窝：缺口由别的号补，孵好再把蛋传过来。
            </p>
          ) : null}
          {active.views.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5" data-testid="breed-list">
              {active.views.map((view) => (
                <PairingCard
                  key={view.key}
                  view={view}
                  testId="breed-suggestion"
                  receivers={receiversOf(view)}
                  collectedGroupIds={
                    collectedGroupIdsByAccount?.get(active.plan.account) ?? NO_COLLECTED_GROUPS
                  }
                />
              ))}
            </ul>
          ) : null}

          {mother &&
          (mother.pairings.length > 0 || mother.tasks.length > 0 || mother.helps.length > 0) ? (
            <div className="mt-2 border-t border-dashed border-slate-200 pt-2" data-testid="mother-nest">
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-semibold text-slate-700">母本配窝</h4>
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  本号未收集 {mother.gapCount} · 可补 {mother.pairings.length + mother.tasks.length}
                </span>
                {mother.helps.length > 0 ? (
                  <span
                    className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                    data-testid="mother-help-count"
                  >
                    求助 {mother.helps.length}
                  </span>
                ) : null}
                {motherNests > 0 ? (
                  <span className="text-[10px] text-slate-400">本号内线占 {motherNests} 个窝</span>
                ) : null}
              </div>
              {mother.pairings.length > 0 ? (
                <ul className="mt-1.5 space-y-1.5" data-testid="mother-pairings">
                  {mother.pairings.map((pairing) => (
                    <MotherPairingCard
                      key={`${pairing.eggGameId}-${pairing.mother.key}-${pairing.father.key}`}
                      pairing={pairing}
                      collectedGroupIds={
                        collectedGroupIdsByAccount?.get(active.plan.account) ?? NO_COLLECTED_GROUPS
                      }
                      onSeekHelp={onSeekHelp}
                    />
                  ))}
                </ul>
              ) : null}
              {mother.tasks.length > 0 ? (
                <ul className="mt-1.5 space-y-1.5" data-testid="mother-tasks">
                  {mother.tasks.map((task) => (
                    <MotherTaskCard
                      key={`${task.eggGameId}-${task.sourceAccount}`}
                      task={task}
                      collectedGroupIds={
                        collectedGroupIdsByAccount?.get(active.plan.account) ?? NO_COLLECTED_GROUPS
                      }
                      onSeekHelp={onSeekHelp}
                    />
                  ))}
                </ul>
              ) : null}
              {mother.helps.length > 0 ? (
                <MotherHelpList helps={mother.helps} onSeekHelp={onSeekHelp} />
              ) : null}
            </div>
          ) : null}

          {active.plan.blockedLinks.length > 0 ? (
            <p className="mt-1 text-[11px] text-rose-600" data-testid="breed-blocked">
              注意：有 {active.plan.blockedLinks.length} 条连线会产出非目标蛋
            </p>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
