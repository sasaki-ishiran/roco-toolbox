import { useLayoutEffect, useRef, useState } from 'react';
import { eggGroupNames, species, targetNatureNames } from '../data/catalog';
import { heightMetersOf, weightKgOf } from '../domain/petFilters';
import { petBodyMedalIcon, petVoiceMedalIcon } from '../domain/petIcons';
import type { NestPairing, NestPet, NestPlan } from '../domain/nestPlan';
import { sortIndividualBonuses } from '../domain/individualStats';
import type { IndividualBonus } from '../domain/types';
import {
  recommendedNatureChance,
  type MotherHelpItem,
  type MotherNestAccount,
  type MotherNestPairing,
  type MotherNestTask,
} from '../domain/motherNest';
import { GenderMark } from './GenderMark';
import { accountTabColumns, compareAccountNames } from './accountOrder';
import { genderShareOf } from '../domain/genderRatio';
import type { StudRecommendation } from '../domain/suggestions';
import { PetAvatar } from './PetAvatar';
import { pairingColor, pairingDashed } from './pairingColors';
import { formatPercent } from './formatPercent';
import { getMyPetsSizeUnit } from './myPetsFilterStore';
import { setNestPicked, useNestPicks } from './nestPicksStore';

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));
/** 玩家说的「八大性格」：只有这些性格才配在母本卡头上单独写概率 */
const EIGHT_NATURES = new Set(targetNatureNames);

/**
 * 配窝建议默认先放 5 条，点「显示更多」每次再放 20 条（2026-11-24 用户口径）。
 * 母本跨号传蛋可能上百条，一次性铺开会把看板拉得很长，所以留一个渐进展开。
 */
const SUGGESTION_FIRST_PAGE = 5;
const SUGGESTION_PAGE_SIZE = 20;

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

/**
 * 种公推荐的高/低概率分界（2026-11-20 用户口径）：看卡片上写的**实际概率**
 * （性格概率 × 出公比例），和母本那条 30% 线一致——界面上不到 30% 的进低概率。
 */
const STUD_HIGH_CHANCE = 0.3;
/** 这张卡最高的那个性格实际能拿到多少（多个性格各自算，取最高） */
const viewTopChance = (view: PairingView): number =>
  view.natures.reduce((best, item) => Math.max(best, item.chance * view.genderShare), 0);

/** 种公推荐按精灵合并：同一只精灵的多个性格 / 蛋组合成一张卡（和看板推荐卡同口径） */
export interface StudRecommendationGroup {
  gameId: number;
  displayName: string;
  natureNames: string[];
  groupLabels: string[];
  /** 原始推荐条目：点卡开「怎么补」要拿第一条的蛋组 / 性格 / 档位定位 */
  records: StudRecommendation[];
}
export const groupStudRecommendations = (
  items: readonly StudRecommendation[],
): StudRecommendationGroup[] => {
  const groups = new Map<number, StudRecommendationGroup>();
  for (const item of items) {
    let group = groups.get(item.gameId);
    if (!group) {
      group = {
        gameId: item.gameId,
        displayName: item.displayName,
        natureNames: [],
        groupLabels: [],
        records: [],
      };
      groups.set(item.gameId, group);
    }
    group.records.push(item);
    if (!group.natureNames.includes(item.natureName)) group.natureNames.push(item.natureName);
    for (const label of item.groupLabels) {
      if (!group.groupLabels.includes(label)) group.groupLabels.push(label);
    }
  }
  return [...groups.values()];
};


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

/** 种公建议的一张卡：普通一对，或者同一只种公配多个母本的「共用种公」卡 */
interface SharedStudGroup {
  kind: 'shared';
  /** 共用的那只种公（按个体 key，不是同名物种） */
  stud: NestPet;
  views: PairingView[];
}
interface SingleStudView {
  kind: 'single';
  view: PairingView;
}
type StudCardLayout = SharedStudGroup | SingleStudView;

/**
 * 种公建议里**同一只种公**配多只母本时并成一张卡（2026-11-20 用户口径，和家园一样）：
 * 种公只画一次，母本并排画，勾一次就把这几个窝一起占上。
 *
 * 只合并「一只公 + 一只母」的普通卡；学院 1:2 的三只卡本来就把公只画一次，保持原样。
 * 同名但不同个体的公（盒子位置不同）不合并。
 */
const groupSharedStudViews = (views: readonly PairingView[]): StudCardLayout[] => {
  const studOf = (view: PairingView): NestPet | null => {
    const cards = [view.left, ...view.partners];
    if (cards.length !== 2) return null;
    const males = cards.filter((pet) => pet.gender === '公');
    return males.length === 1 ? males[0] : null;
  };
  const groups = new Map<string, SharedStudGroup>();
  const layouts: StudCardLayout[] = [];
  for (const view of views) {
    const stud = studOf(view);
    if (!stud) {
      layouts.push({ kind: 'single', view });
      continue;
    }
    const existing = groups.get(stud.key);
    if (existing) {
      existing.views.push(view);
      continue;
    }
    const group: SharedStudGroup = { kind: 'shared', stud, views: [view] };
    groups.set(stud.key, group);
    layouts.push(group);
  }
  // 只有一张卡的「共用种公」没有共用对象，退回普通卡，不写多余的标题
  return layouts.map((layout) =>
    layout.kind === 'shared' && layout.views.length === 1
      ? { kind: 'single', view: layout.views[0] }
      : layout,
  );
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
          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] leading-none font-semibold ${
            chance > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}
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
 * 配窝卡里的一只精灵（2026-11-19 用户口径）：配窝建议卡与家园共用同一张紧凑卡。
 *
 * - 蛋组在左上角（编号不再显示）：**这个号已收齐的组显示绿色**，没收齐的保持原来的蓝色；
 * - 体型 / 声音奖牌放在蛋组下方；
 * - 分贝、身高、体重纵向排在性格下方；
 * - 头像 44、名字 11px；配窝建议的卡高 86px，卡底留一行盒子位置；
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
  /** 卡底小字：配窝建议是盒子位置；家园不写 */
  box?: string;
  /** 个体三维（2026-11-22 用户口径）：家园卡底部一行「物攻+8·生命+9·速度+10」 */
  individualBonuses?: readonly IndividualBonus[];
}

export function PairingPetCard({
  pet,
  collectedGroupIds,
  academy = false,
  home = false,
  hideMeasurements = false,
  testId = 'breed-pet-card',
}: {
  pet: PairCardPet;
  collectedGroupIds: ReadonlySet<number>;
  /** 住学院小窝：绿框，和普通窝的卡片区分开 */
  academy?: boolean;
  /** 家园版：70px（配窝建议 86px，多一行盒子位置） */
  home?: boolean;
  /** 只有物种没有个体（母本缺口）：奖牌照画（目标奖牌），不写分贝/身高/体重，避免假装有数据 */
  hideMeasurements?: boolean;
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
  /**
   * 家园卡底部的个体三维（2026-11-22 用户口径）：固定三格一行，
   * 按抓包里的实际三维填，缺的那格留空（没有三维数据时整行留空）。
   */
  const bonuses = home ? sortIndividualBonuses(pet.individualBonuses ?? []).slice(0, 3) : [];

  return (
    <article
      className={`relative h-[86px] min-w-0 overflow-hidden rounded-xl p-1.5 shadow-sm ${
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
          {!hideMeasurements ? (
            <>
              <span className="whitespace-nowrap">
                {pet.voiceDb != null ? `${pet.voiceDb}dB` : '—'}
              </span>
              <span className="whitespace-nowrap">高{heightText}</span>
              <span className="whitespace-nowrap">重{weightText}</span>
            </>
          ) : null}
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
      {home ? (
        <div
          className="absolute inset-x-0 bottom-0 flex h-4 divide-x divide-slate-300/70 border-t border-slate-300/60 text-center text-[8px] leading-none text-slate-600"
          data-testid="breed-pet-stats"
        >
          {[0, 1, 2].map((index) => {
            const bonus = bonuses[index];
            return (
              <span
                key={index}
                className="flex w-1/3 min-w-0 items-center justify-center"
                data-testid={`breed-pet-stat-${index}`}
              >
                {bonus ? `${bonus.name}+${bonus.value}` : ''}
              </span>
            );
          })}
        </div>
      ) : null}
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
  // 2026-11-20 用户口径：有推荐性格就只按推荐写，不再把双亲自己的性格混进来
  const natures = recommendedNatures.length > 0 ? recommendedNatures : parentNatures;
  for (const nature of natures) {
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

/** 少母精灵（出母 < 50%）才标出母率：这是游戏写死的公母比例（2026-11-20 用户口径） */
function FemaleScarceNote({
  femaleChance,
  effectiveChance,
}: {
  femaleChance: number;
  /** 性格概率 × 出母比例的实际到手概率；传了就在「出母」后面补「到手」 */
  effectiveChance?: number;
}) {
  if (!(femaleChance > 0 && femaleChance < 0.5)) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded bg-rose-50 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-rose-600"
      title="这个蛋出母比例低（游戏写死的公母比例）"
      data-testid="mother-female-rate"
    >
      出母 {percentLabel(femaleChance)}
      {effectiveChance != null ? ` · 到手 ${percentLabel(effectiveChance)}` : ''}
    </span>
  );
}

/** 母本卡头：性格概率 + 平均分贝 + 非八大公标记（与配窝建议卡同一套卡头，2026-11-19 统一） */
function MotherCardHead({
  natures,
  voiceDb,
  fatherNature,
  femaleChance,
  moreNatures = 0,
  naturesTitle,
  effectiveChance,
  testId,
}: {
  natures: Array<{ nature: string; chance: number }>;
  voiceDb: number | null;
  /** 公的性格；求助卡没有具体公，传空字符串，不显示「非八大公」 */
  fatherNature?: string;
  femaleChance: number;
  /** 求助卡推荐性格不止一个时，卡头补「+N」，完整列表放 title */
  moreNatures?: number;
  naturesTitle?: string;
  /** 性格概率 × 出母比例的实际到手概率（求助卡写「到手 12%」） */
  effectiveChance?: number;
  testId: string;
}) {
  return (
    <div className="flex flex-1 flex-wrap items-center gap-1" data-testid={testId}>
      {natures.map(({ nature, chance }) => (
        <span
          key={nature}
          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] leading-none font-semibold ${
            chance > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {percentLabel(chance)}
          {nature}
          <GenderMark gender="母" />
        </span>
      ))}
      {natures.length > 1 ? (
        <span className="text-[10px] leading-none text-slate-400">
          合计 {percentLabel(natures.reduce((sum, item) => sum + item.chance, 0))}
        </span>
      ) : null}
      {voiceDb !== null ? (
        <span className="text-[10px] leading-none text-slate-500">{voiceDb}dB</span>
      ) : null}
      <FemaleScarceNote femaleChance={femaleChance} effectiveChance={effectiveChance} />
      {moreNatures > 0 ? (
        <span className="text-[10px] leading-none text-slate-400" title={naturesTitle}>
          +{moreNatures}
        </span>
      ) : null}
      {fatherNature ? <NonEightStudNote nature={fatherNature} /> : null}
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
    <button
      type="button"
      onClick={onSeekHelp}
      data-testid="mother-seek-help"
      className="min-h-[24px] shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-500 active:bg-slate-50"
    >
      小组求助
    </button>
  );
}

/**
 * 配窝建议的「显示更多」（2026-11-24 用户口径）：
 * 默认 5 条，点一次 +20 条；剩下不足 20 条时直接写「显示全部 N 条」。
 */
function ShowMoreButton({
  remaining,
  onClick,
  testId,
  tone,
}: {
  remaining: number;
  onClick: () => void;
  testId: string;
  tone: 'sky' | 'amber';
}) {
  const all = remaining <= SUGGESTION_PAGE_SIZE;
  const label = all
    ? `显示全部 ${remaining} 条`
    : `显示更多 +${SUGGESTION_PAGE_SIZE} 条`;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`col-span-full mt-1.5 w-full rounded-lg border bg-white py-1.5 text-[11px] font-medium active:bg-slate-50 ${
        tone === 'sky'
          ? 'border-sky-200 text-sky-700'
          : 'border-amber-200 text-amber-700'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * 配窝卡右上角的「占窝」圆圈（2026-11-20 用户口径）：
 * 默认不勾 = 不占窝；种公卡和母本卡勾的是同一个窝数，由 NestPlanCard 统一记。
 */
function NestPickButton({
  picked,
  onToggle,
  label,
}: {
  picked: boolean;
  onToggle?: () => void;
  /** 读屏用：写清勾的是哪一对，不只是一个空圆圈 */
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={picked}
      aria-label={label}
      title={picked ? '取消勾选' : '勾选这组配窝'}
      data-testid="nest-pick"
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
      className="absolute right-0.5 top-0.5 z-20 flex h-7 w-7 items-center justify-center"
    >
      {/* 视觉圆圈 18px，点击区域 28px：手机上不用瞄准 */}
      <span
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 transition-colors ${
          picked
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-slate-300 bg-white active:bg-slate-100'
        }`}
      >
        {picked ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
            <path
              d="M2.5 6.2 4.9 8.6 9.5 3.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

/** 母本配窝：一条「未收集母本 × 公」的线（同种时同时补种公，记双收益） */
function MotherPairingCard({
  pairing,
  collectedGroupIds,
  onSeekHelp,
  low = false,
  picked = false,
  onTogglePick,
}: {
  pairing: MotherNestPairing;
  collectedGroupIds: ReadonlySet<number>;
  onSeekHelp?: () => void;
  /** 本号内概率不到 30% 的线：列出来，勾选后同样占窝（2026-11-20 用户口径） */
  low?: boolean;
  /** 卡片右上角的占窝圆圈（2026-11-20） */
  picked?: boolean;
  onTogglePick?: () => void;
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
      className={`relative list-none rounded-xl border-l-4 bg-slate-50 px-2 py-2 ${
        low ? 'border-slate-300' : 'border-amber-400'
      } ${picked ? 'ring-1 ring-emerald-300' : ''}`}
      data-testid="mother-pairing"
      data-low={low ? 'true' : undefined}
      data-picked={picked ? 'true' : undefined}
    >
      <NestPickButton
        picked={picked}
        onToggle={onTogglePick}
        label={`${picked ? '取消勾选' : '勾选'}：${pairing.mother.name} × ${pairing.father.name}`}
      />
      <div className="flex items-start gap-1.5 pr-7">
        <span
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
            low ? 'bg-slate-300' : 'bg-amber-400'
          }`}
          aria-hidden="true"
        />
        <MotherCardHead
          natures={natureChances}
          voiceDb={voiceDb}
          fatherNature={pairing.father.nature}
          femaleChance={pairing.femaleChance}
          testId="mother-pairing-head"
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <PairingPetCard pet={pairing.mother} collectedGroupIds={collectedGroupIds} />
        <PairingPetCard pet={pairing.father} collectedGroupIds={collectedGroupIds} />
      </div>
      {low ? (
        <div className="mt-1 flex justify-end">
          <SeekGroupButton onSeekHelp={onSeekHelp} />
        </div>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p
            className="min-w-0 truncate text-[11px] font-medium text-amber-700"
            data-testid="mother-pairing-action"
          >
            本号自己配
          </p>
          <SeekGroupButton onSeekHelp={onSeekHelp} />
        </div>
      )}
    </li>
  );
}

/** 跨号母本建议：源号最高概率的一对 → 传蛋过来 */
function MotherTaskCard({
  task,
  targets,
  collectedGroupIds,
  onSeekHelp,
  picked = false,
  onTogglePick,
  readOnly = false,
}: {
  task: MotherNestTask;
  /** 这一对要传给哪些号（同一对只出现一次，2026-11-20） */
  targets: string[];
  collectedGroupIds: ReadonlySet<number>;
  onSeekHelp?: () => void;
  /** 卡片右上角的占窝圆圈（2026-11-20） */
  picked?: boolean;
  onTogglePick?: () => void;
  /** 本号缺口卡：别人补我，只读；窝在出蛋号上，不占本号（2026-11-24） */
  readOnly?: boolean;
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
      className={`relative list-none rounded-xl border-l-4 border-sky-400 bg-slate-50 px-2 py-2 ${
        picked ? 'ring-1 ring-emerald-300' : ''
      }`}
      data-testid="mother-task"
      data-picked={picked ? 'true' : undefined}
      data-readonly={readOnly ? 'true' : undefined}
    >
      {readOnly ? null : (
        <NestPickButton
          picked={picked}
          onToggle={onTogglePick}
          label={`${picked ? '取消勾选' : '勾选'}：${task.mother.name} × ${task.father.name}`}
        />
      )}
      <div className={`flex items-start gap-1.5 ${readOnly ? 'pr-1' : 'pr-7'}`}>
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-400"
          aria-hidden="true"
        />
        <MotherCardHead
          natures={natureChances}
          voiceDb={voiceDb}
          fatherNature={task.father.nature}
          femaleChance={task.femaleChance}
          testId="mother-task-head"
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <PairingPetCard pet={task.mother} collectedGroupIds={collectedGroupIds} />
        <PairingPetCard pet={task.father} collectedGroupIds={collectedGroupIds} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p
          className="min-w-0 truncate text-[11px] font-semibold text-sky-700"
          data-testid="mother-task-flow"
        >
          {readOnly
            ? `从 ${task.sourceAccount} 传蛋 · 不占本号窝`
            : `传给 ${targets.slice(0, 2).join('、')}${targets.length > 2 ? ` 等 ${targets.length} 个号` : ''}`}
        </p>
        <SeekGroupButton onSeekHelp={onSeekHelp} />
      </div>
    </li>
  );
}

/** 没有这只母本时，右边的种公卡换成小组求助卡（和精灵卡同高，2026-11-20 用户口径） */
function SeekHelpCard({ onSeekHelp }: { onSeekHelp?: () => void }) {
  return (
    <button
      type="button"
      onClick={onSeekHelp}
      data-testid="mother-help-action-card"
      className="flex h-[86px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-1.5 text-emerald-700 active:bg-emerald-100"
    >
      <span className="text-[11px] font-semibold">小组求助</span>
    </button>
  );
}

/**
 * 求助里的一只母本（2026-11-20 用户口径）：
 * - 本号有这只母本：左右两张真实精灵卡（母本 + 配对种公）；
 * - 本号没有这只母本：左边只写缺口物种卡（不编分贝/身高/体重/奖牌），右边换成小组求助卡。
 * 卡头写子代推荐性格概率、出母比例和实际到手概率。
 */
function MotherHelpCard({
  help,
  collectedGroupIds,
  targetBodyMedal,
  targetVoiceDb,
  onSeekHelp,
}: {
  help: MotherHelpItem;
  collectedGroupIds: ReadonlySet<number>;
  targetBodyMedal?: string | null;
  targetVoiceDb?: number | null;
  onSeekHelp?: () => void;
}) {
  const mother = help.mother;
  const father = help.father;
  /** 卡头按推荐性格逐个写「到手概率」（已乘出母比例） */
  const natureChances =
    help.natureChances ?? [
      {
        nature: help.recommendedNatures[0] ?? '不限',
        chance: help.bestNatureChance * help.femaleChance,
      },
    ];
  /** 缺口物种卡上写卡头第一个有概率的性格，避免卡头写急躁、卡上写胆小 */
  const nature =
    natureChances.find((item) => item.chance > 0)?.nature ??
    natureChances[0]?.nature ??
    help.recommendedNatures[0] ??
    '不限';
  const missingPet: PairCardPet = {
    key: `help-${help.eggGameId}`,
    gameId: help.eggGameId,
    name: help.eggName,
    gender: '母',
    nature,
    voiceDb: targetVoiceDb ?? null,
    medalBody: targetBodyMedal ?? null,
    box: '未收集',
  };
  return (
    <li className="list-none rounded-xl border-l-4 border-slate-300 bg-slate-50 px-2 py-2" data-testid="mother-help">
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-slate-300"
          aria-hidden="true"
        />
        <MotherCardHead
          natures={natureChances}
          voiceDb={mother && father ? averageVoiceOf([mother, father]) : null}
          fatherNature={father?.nature ?? ''}
          femaleChance={1}
          testId="mother-help-head"
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        {mother && father ? (
          <>
            <PairingPetCard pet={mother} collectedGroupIds={collectedGroupIds} />
            <PairingPetCard pet={father} collectedGroupIds={collectedGroupIds} />
          </>
        ) : (
          <>
            <PairingPetCard pet={missingPet} collectedGroupIds={collectedGroupIds} hideMeasurements />
            <SeekHelpCard onSeekHelp={onSeekHelp} />
          </>
        )}
      </div>
    </li>
  );
}

/** 配对卡片：一条配窝建议（左侧色条 + 圆点 = 摆位图里那条线的颜色，便于对号入座） */
function PairingCard({
  view,
  testId,
  receivers,
  collectedGroupIds,
  picked = false,
  onTogglePick,
}: {
  view: PairingView;
  testId: string;
  /** 这一格还有哪些号在等蛋（缺口分工算出来的收蛋方） */
  receivers: string[];
  /** 本号已经收齐的蛋组（卡里标绿） */
  collectedGroupIds: ReadonlySet<number>;
  /** 卡片右上角的占窝圆圈（2026-11-20） */
  picked?: boolean;
  onTogglePick?: () => void;
}) {
  const cards = [view.left, ...view.partners];
  const voiceDb = averageVoiceOf(cards);
  return (
    <li
      className={`relative rounded-xl border-l-4 bg-slate-50 px-2 py-2 ${
        picked ? 'ring-1 ring-emerald-300' : ''
      }`}
      style={{ borderLeftColor: view.color }}
      data-testid={testId}
      data-picked={picked ? 'true' : undefined}
    >
      <NestPickButton
        picked={picked}
        onToggle={onTogglePick}
        label={`${picked ? '取消勾选' : '勾选'}：${view.mother.name} × ${view.partners
          .map((partner) => partner.name)
          .join('、')}`}
      />
      <div className="flex items-start gap-1.5 pr-7">
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
 * 「共用种公」卡（2026-11-20 用户口径，和家园一样）：同一只种公配 2~3 只母本时，
 * 种公只画一次放在上面，母本两列并排在下面；右上角一个圆圈把这几个窝一起勾上。
 */
function SharedStudCard({
  stud,
  views,
  account,
  receiversOf,
  collectedGroupIds,
  picked = false,
  onTogglePick,
}: {
  stud: NestPet;
  views: PairingView[];
  /** 出蛋的号（卡片底部写「本号 → 收蛋方」） */
  account: string;
  receiversOf: (view: PairingView) => string[];
  collectedGroupIds: ReadonlySet<number>;
  picked?: boolean;
  onTogglePick?: () => void;
}) {
  const motherNames = views.map((view) => view.mother.name).join('、');
  /** 这几窝合起来能帮到的号：同一个号只写一次，按账号名自然排序 */
  const receivers = [...new Set(views.flatMap((view) => receiversOf(view)))].sort(
    compareAccountNames,
  );
  return (
    <li
      className={`relative rounded-xl border-l-4 bg-slate-50 px-2 py-2 ${
        picked ? 'ring-1 ring-emerald-300' : ''
      }`}
      style={{ borderLeftColor: views[0]?.color }}
      data-testid="breed-suggestion"
      data-layout="shared-stud"
      data-picked={picked ? 'true' : undefined}
    >
      <NestPickButton
        picked={picked}
        onToggle={onTogglePick}
        label={`${picked ? '取消勾选' : '勾选'}：共用种公 ${stud.name} 的 ${views.length} 个窝（${motherNames}）`}
      />
      <div className="flex items-center gap-1.5 pr-7">
        <span className="flex shrink-0 items-center gap-1">
          {/* 每种母本一条线：保留摆位图里的颜色，合卡后也能对上号 */}
          {views.map((view) => (
            <span
              key={view.key}
              className="inline-block h-2 w-2 rounded-full"
              style={
                view.dashed
                  ? { border: `2px solid ${view.color}` }
                  : { backgroundColor: view.color }
              }
              aria-hidden="true"
            />
          ))}
        </span>
        <span className="flex-1 text-[11px] font-medium text-slate-600">共用种公</span>
        <span className="shrink-0 text-[10px] text-slate-400">
          1 只 · 配 {views.length} 只母本
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <PairingPetCard
          pet={stud}
          collectedGroupIds={collectedGroupIds}
          academy={views.some((view) => view.academyParent?.key === stud.key)}
        />
      </div>
      <div className="mt-1.5 grid grid-cols-2 items-start gap-1">
        {views.map((view) => (
          <div key={view.key} className="flex min-w-0 flex-col gap-1">
            <PairingHead
              natures={view.natures}
              genderShare={view.genderShare}
              voiceDb={averageVoiceOf([view.left, ...view.partners])}
            />
            <PairingPetCard
              pet={view.mother}
              collectedGroupIds={collectedGroupIds}
              academy={view.academyParent?.key === view.mother.key}
            />
          </div>
        ))}
      </div>
      {/* 这几个窝合起来能帮到哪些号：并成一行写在卡底，和普通配窝卡同一个位置 */}
      {receivers.length > 0 ? (
        <p
          className="mt-1 text-center text-[11px] font-medium text-sky-700"
          data-testid="shared-stud-receivers"
        >
          {account} → {receivers.slice(0, 3).join('、')}
          {receivers.length > 3 ? ` 等 ${receivers.length} 个号` : ''}
        </p>
      ) : null}
    </li>
  );
}

/** 只在母本建议里出现的源号（测试 / 极端数据）没有种公方案，给一个空壳，避免整段消失 */
const emptyNestPlan = (account: string): NestPlan => ({
  account,
  pairings: [],
  blockedLinks: [],
  slots: [],
  nestsUsed: 0,
  nestsTotal: 0,
  clusters: [],
  unfilled: [],
  delegated: [],
  alternatives: [],
});

/** 跨号传蛋按「出蛋号 + 这一对」合并：同一对只出现一次，后面写要传给哪些号（2026-11-20） */
interface SourceTransfer {
  task: MotherNestTask;
  targets: string[];
}

/** 母本「配窝建议」里的一张卡：本号自己配，或从别的号传蛋过来 */
type MotherHighItem =
  | { kind: 'local'; pairing: MotherNestPairing }
  | {
      kind: 'transfer';
      task: MotherNestTask;
      targets: string[];
      /** 本号缺口：别人补我，只读不占本号窝（2026-11-24） */
      readOnly?: boolean;
    };

const transferKeyOf = (task: MotherNestTask): string =>
  `${task.eggGameId}|${task.mother.key}|${task.father.key}`;

/** 占窝勾选的卡片身份：同一张卡跨一次排序 / 切换分区都还能对上（2026-11-20） */
const motherPickKeyOf = (pairing: MotherNestPairing, low = false): string =>
  `${low ? 'low' : 'mother'}:${pairing.eggGameId}:${pairing.mother.key}:${pairing.father.key}`;
const transferPickKeyOf = (task: MotherNestTask): string => `transfer:${transferKeyOf(task)}`;

/** 「缺口」横条里的母本缺口卡（看板构建，配窝卡只负责画） */
export interface MotherGapCard {
  chainKey: string;
  name: string;
  number?: string;
  eggGameId: number;
  eggGroups: string[];
  natures: string[];
  title: string;
  ariaLabel?: string;
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
  section,
  targetBodyMedal,
  targetVoiceDb,
  studRecommendationsByAccount,
  studCompleteAccounts,
  selectedAccounts,
  accountFilterActive = false,
}: {
  plans: NestPlan[];
  emptyNote?: string;
  /** 每个号自己还差几个种公目标（按号各算，2026-11-18） */
  gapsByAccount?: ReadonlyMap<string, number>;
  /**
   * 种公已经全齐的号（2026-11-20 用户口径：全齐的号不能从配窝建议里消失）。
   * 它们会常驻账号格，并带上替别的号出蛋的配对。
   */
  studCompleteAccounts?: ReadonlySet<string>;
  /** 每个号已经收齐的蛋组（配窝卡里标绿；没传就全是原来的蓝色） */
  collectedGroupIdsByAccount?: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * 账号筛选里选中的号（2026-11-24）：只有这些号是「本号缺口」的目标；
   * 其他号仍作为出蛋来源显示。不传 = 不看账号筛选（全选旧行为）。
   */
  selectedAccounts?: readonly string[];
  /** 账号筛选是否真的排除了账号；false = 全选，按出蛋号分组（旧行为） */
  accountFilterActive?: boolean;
  /** 母本配窝建议（2026-11-18）：本号内母本线 + 跨号传蛋；按账号索引 */
  motherSuggestions?: ReadonlyMap<string, MotherNestAccount>;
  /** 「向小组求助」：去小组发需求（2026-11-19） */
  onSeekHelp?: () => void;
  /** 只看种公配对 / 只看母本配窝；不传 = 两段都显示（看板按「看板行动」开关联动，2026-11-20） */
  section?: 'studs' | 'mothers';
  /** 求助卡的奖牌按当前目标写（只画奖牌，不编分贝/身高/体重） */
  targetBodyMedal?: string | null;
  targetVoiceDb?: number | null;
  /** 种公推荐「缺口」页签：每个号自己的种公推荐（按本号缺口算，不是全设备合并的） */
  studRecommendationsByAccount?: ReadonlyMap<string, StudRecommendation[]>;
  /** 点缺口页签的推荐卡：按这个号开「怎么补」 */
  onOpenStudRecommendation?: (account: string, group: StudRecommendationGroup) => void;
  /** 上方的母本缺口卡移进「缺口」横条（2026-11-20 用户口径） */
  motherGaps?: MotherGapCard[];
  onOpenMotherGap?: (chainKey: string) => void;
  onOpenMotherGaps?: () => void;
}) {
  /** 只看种公 / 只看母本：不传 = 两段都显示（2026-11-20 用户口径：跟「看板行动」开关联动） */
  const showStuds = section !== 'mothers';
  const showMothers = section !== 'studs';
  /** 当前看哪个号（多账号账号格切换；默认第一个有内容的号） */
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  /** 母本区分组横条：高概率 / 低概率（含原来的牢五门）/ 缺口（2026-11-20 用户口径） */
  const [motherTab, setMotherTab] = useState<'high' | 'low'>('high');
  /** 种公推荐分组横条：高概率 / 低概率 / 缺口（2026-11-20 用户口径） */
  const [studTab, setStudTab] = useState<'high' | 'low'>('high');
  /** 种公推荐「配窝建议」当前展示几条（默认 5，点「显示更多」+20） */
  const [studShown, setStudShown] = useState(SUGGESTION_FIRST_PAGE);
  /** 母本缺口「配窝建议」当前展示几条（默认 5，点「显示更多」+20） */
  const [motherShown, setMotherShown] = useState(SUGGESTION_FIRST_PAGE);
  /**
   * 占窝勾选（2026-11-20 用户口径）：默认 **零个窝**，不按方案自动算；
   * 用户在对应号的配窝卡右上角自己点圆圈，种公卡和母本卡记在同一份窝数里。
   *
   * 2026-11-22（R2-P1-02）：状态提到 `nestPicksStore`，做到**唯一一份**。
   * 看板宽横屏两边各挂一个本组件，以前各持一份 useState、各自整份回写，
   * 后写会覆盖先写（刷新后勾选凭空消失）；现在两个实例订阅同一份 store。
   */
  const nestPicks = useNestPicks();
  /** 账号格那一行的实际宽度：决定一行 3 个还是 2 个（还没量到时先按 3 个排） */
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [tabsWidth, setTabsWidth] = useState(0);
  const pickKeyOf = (account: string, cardKey: string): string => `${account}|${cardKey}`;
  const isPicked = (account: string, cardKey: string): boolean =>
    nestPicks[pickKeyOf(account, cardKey)] === true;
  /** 一次改一组卡的勾选：共用种公卡勾一次就把这几窝一起勾上 / 一起取消（2026-11-20） */
  const setPicks = (account: string, cardKeys: readonly string[], picked: boolean): void => {
    setNestPicked(
      cardKeys.map((cardKey) => pickKeyOf(account, cardKey)),
      picked,
    );
  };
  const togglePick = (account: string, cardKey: string): void => {
    setPicks(account, [cardKey], !isPicked(account, cardKey));
  };
  /**
   * 这个号一共占几个窝：**一窝一只精灵**，所以勾一对 = 母 + 公两个窝；
   * 种公卡和母本卡共用同一份窝数，同一只精灵被勾的多张卡共用只算一次（2026-11-20 用户口径）。
   */
  const pickedNestsOf = (account: string): number => {
    const pets = new Set<string>();
    for (const card of selectableCardsOf(account)) {
      if (!isPicked(account, card.key)) continue;
      for (const petKey of card.petKeys) pets.add(petKey);
    }
    return pets.size;
  };

  /**
   * 账号全集：配窝方案里的号 + 母本建议里出现的源号 / 目标号。
   * 2026-11-20 用户口径：母本配窝按**出蛋的号**分组；源号可能不在种公方案里，
   * 只从 plans 取会把卡片整段弄丢。
   */
  const planByAccount = new Map(plans.map((plan) => [plan.account, plan]));
  const accountNames = [
    ...new Set([
      ...plans.map((plan) => plan.account),
      ...(motherSuggestions ? [...motherSuggestions.keys()] : []),
      ...(motherSuggestions
        ? [...motherSuggestions.values()].flatMap((suggestion) =>
            suggestion.tasks.map((task) => task.sourceAccount),
          )
        : []),
    ]),
  ];
  const entries = accountNames.map((account) => {
    const plan = planByAccount.get(account);
    return {
      plan: plan ?? emptyNestPlan(account),
      views: plan ? mergePairings(plan.pairings) : [],
    };
  });
  const viewsByAccount = new Map(entries.map((entry) => [entry.plan.account, entry.views]));

  /** 母本建议里属于这个号的「本号内」线：达到门槛的 + 概率低的 */
  const localPairingsOf = (
    account: string,
  ): { accepted: MotherNestPairing[]; low: MotherNestPairing[] } => {
    const suggestion = motherSuggestions?.get(account);
    return { accepted: suggestion?.pairings ?? [], low: suggestion?.lowPairings ?? [] };
  };

  /**
   * 这个号作为**出蛋方**的跨号线（2026-11-20 用户口径：卡片归到出蛋的号下面，
   * 同一对只出现一次，后面写传给哪些号）。
   */
  const sourceTransfersOf = (account: string): SourceTransfer[] => {
    if (!motherSuggestions) return [];
    // 同一颗蛋只留这个源号最高概率的一对：不同目标号可能算出不同的公，
    // 但给用户的配窝数应按「蛋」算，不能同一颗蛋出现两张卡（2026-11-20 用户口径）
    const byEgg = new Map<number, SourceTransfer>();
    for (const suggestion of motherSuggestions.values()) {
      for (const task of suggestion.tasks) {
        if (task.sourceAccount !== account) continue;
        const existing = byEgg.get(task.eggGameId);
        if (existing) {
          if (!existing.targets.includes(task.account)) existing.targets.push(task.account);
          if (task.natureChance > existing.task.natureChance) existing.task = task;
        } else {
          byEgg.set(task.eggGameId, { task, targets: [task.account] });
        }
      }
    }
    return [...byEgg.values()].sort(
      (a, b) =>
        b.task.chance - a.task.chance ||
        a.task.eggName.localeCompare(b.task.eggName, 'zh-Hans-CN'),
    );
  };

  /**
   * 账号筛选生效时，这个号作为**收蛋方**的跨号线（2026-11-24 用户口径）：
   * 单选莱茵时，其他号的传蛋线要归到莱茵下面，才看得见、算得进“本号缺口”。
   */
  const scoped = accountFilterActive && selectedAccounts != null;
  const targetAccountSet = scoped ? new Set(selectedAccounts) : null;
  const isTargetAccount = (account: string): boolean =>
    scoped && targetAccountSet?.has(account) === true;
  const incomingTransfersOf = (account: string): SourceTransfer[] => {
    if (!isTargetAccount(account) || !motherSuggestions) return [];
    const byEgg = new Map<number, SourceTransfer>();
    for (const suggestion of motherSuggestions.values()) {
      for (const task of suggestion.tasks) {
        if (task.account !== account) continue;
        const existing = byEgg.get(task.eggGameId);
        if (existing) {
          // 同一颗蛋只留概率最高的一对；目标号就是本号
          if (task.chance > existing.task.chance) existing.task = task;
        } else {
          byEgg.set(task.eggGameId, { task, targets: [account] });
        }
      }
    }
    return [...byEgg.values()].sort(
      (a, b) =>
        b.task.chance - a.task.chance ||
        a.task.eggName.localeCompare(b.task.eggName, 'zh-Hans-CN'),
    );
  };

  const helpsOf = (account: string): MotherHelpItem[] =>
    motherSuggestions?.get(account)?.helps ?? [];

  /**
   * 这个号当前能勾的卡片：种公卡 + 本号内母本卡（含低概率）+ 跨号传蛋卡，
   * 每张卡带上它要摆的精灵。统计窝数时只认这些，上一次数据留下的旧勾选不会虚增；
   * 同一只精灵出现在多张卡里时按一只算（共用小窝数）。
   */
  const selectableCardsOf = (account: string): Array<{ key: string; petKeys: string[] }> => {
    const cards = (viewsByAccount.get(account) ?? []).map((view) => ({
      key: `stud:${view.key}`,
      petKeys: [view.left, ...view.partners].map((pet) => pet.key),
    }));
    const local = localPairingsOf(account);
    for (const pairing of local.accepted) {
      cards.push({
        key: motherPickKeyOf(pairing),
        petKeys: [pairing.mother.key, pairing.father.key],
      });
    }
    for (const pairing of local.low) {
      cards.push({
        key: motherPickKeyOf(pairing, true),
        petKeys: [pairing.mother.key, pairing.father.key],
      });
    }
    for (const { task } of sourceTransfersOf(account)) {
      cards.push({
        key: transferPickKeyOf(task),
        petKeys: [task.mother.key, task.father.key],
      });
    }
    return cards;
  };

  /**
   * 这个号有几张**正经配窝**卡（达到门槛的本号内线 + 跨号线；低概率线不算“可配”）。
   * 账号筛选生效时，选中的号把“别人补我”的线也算进来（2026-11-24）。
   */
  const mainCardCountOf = (account: string): number => {
    const { accepted } = localPairingsOf(account);
    return (
      accepted.length +
      incomingTransfersOf(account).length +
      sourceTransfersOf(account).length
    );
  };

  /** 这个号一共几张母本卡（含低概率线，用来判断要不要进账号格） */
  const sourceCardCountOf = (account: string): number =>
    mainCardCountOf(account) + localPairingsOf(account).low.length;

  /** 这个号有没有种公方案内容（出窝的、等蛋的、还有缺口的） */
  const hasStudContent = (entry: (typeof entries)[number]): boolean =>
    entry.views.length > 0 || entry.plan.unfilled.length > 0 || entry.plan.delegated.length > 0;
  /**
   * 种公已全齐的号（2026-11-20 用户口径）：即使这一次没有可排的配对，
   * 也要留在账号格里，点开写「种公都收齐了」，不能从配窝建议里消失。
   */
  const isCompleteOf = (account: string): boolean =>
    studCompleteAccounts?.has(account) === true;
  /** 有内容（或种公已全齐）的号才进账号格：按 section 只看种公或只看母本 */
  const visible = entries.filter(
    (entry) =>
      (showStuds && (hasStudContent(entry) || isCompleteOf(entry.plan.account))) ||
      (showMothers &&
        (sourceCardCountOf(entry.plan.account) > 0 || helpsOf(entry.plan.account).length > 0)),
  );
  const hasContent = visible.length > 0;
  /** 量账号格那一行的宽度：决定一行放 3 个还是 2 个（不靠横向滑动） */
  useLayoutEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const update = () => setTabsWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible.length]);

  /**
   * 账号格上的小字：种公和母本**共用**已勾选的窝数（2026-11-20 用户口径），默认 0。
   * 种公都收齐的号不再挂小字；一张可勾的配窝卡都没有时，才写「待补」。
   */
  const tabBadgeOf = (plan: NestPlan): string => {
    const picked = pickedNestsOf(plan.account);
    // 种公都收齐的号不再挂「全齐」小字（母本不一定齐，容易误读），统一写窝数
    if (isCompleteOf(plan.account)) return `${picked} 窝`;
    const selectable =
      (showStuds && plan.pairings.length > 0) ||
      (showMothers &&
        (localPairingsOf(plan.account).accepted.length > 0 ||
          localPairingsOf(plan.account).low.length > 0 ||
          incomingTransfersOf(plan.account).length > 0 ||
          sourceTransfersOf(plan.account).length > 0));
    if (!selectable) return '待补';
    return `${picked} 窝`;
  };

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
    // 收蛋方也按账号名自然排序（账号2 在 账号10 前面），和账号格一致
    return [...set].sort(compareAccountNames);
  };

  if (!hasContent) {
    // 2026-11-22 用户口径：母本缺口卡不再铺到看板，缺口去「收集 → 母本」看。
    return (
      <p className="mt-1 text-sm text-slate-400" data-testid="breed-empty">
        {emptyNote ?? '当前没有能排的配窝方案——先到「覆盖度」挑要补的缺口，或缺的配对方/母本还没到位。'}
      </p>
    );
  }
  // 默认看「要出的窝最多」的那个号，而不是按账号名排第一个（多号时第一个往往是空壳）。
  // 种公全齐的号没有自己的缺口，种公侧权重记 0，不抢默认选中；母本侧照常按母本内容算。
  const weightOf = (entry: (typeof entries)[number]): number => {
    const studWeight = showStuds
      ? isCompleteOf(entry.plan.account)
        ? 0
        : entry.views.length + entry.plan.unfilled.length
      : 0;
    const motherWeight = showMothers
      ? mainCardCountOf(entry.plan.account) * 2 + helpsOf(entry.plan.account).length
      : 0;
    return studWeight + motherWeight;
  };
  const ranked = [...visible].sort(
    (a, b) =>
      weightOf(b) - weightOf(a) ||
      compareAccountNames(a.plan.account, b.plan.account),
  );
  /** 账号格按账号名自然排序（名字里的数字按数值），默认选中仍是内容最多的号 */
  const tabOrder = [...visible].sort((a, b) =>
    compareAccountNames(a.plan.account, b.plan.account),
  );
  const tabColumns = accountTabColumns(
    tabOrder.map((entry) => `${entry.plan.account} ${tabBadgeOf(entry.plan)}`),
    tabsWidth,
  );
  const defaultAccount = ranked[0];
  const active = visible.find((entry) => entry.plan.account === activeAccount) ?? defaultAccount;
  const activeName = active?.plan.account ?? '';
  /** 当前号已勾选的窝数：种公 + 母本同一份（2026-11-20） */
  const activePicked = pickedNestsOf(activeName);
  const activeLocal = localPairingsOf(activeName);
  /** 选中号的“别人补我”线（只读）；其他号的出蛋线仍可勾选（2026-11-24） */
  const activeIncoming = incomingTransfersOf(activeName);
  const activeTransfers = sourceTransfersOf(activeName);
  /** 「配窝建议」卡合成一条列表再分页：本号的线在前，跨号传蛋在后（2026-11-24） */
  const activeMotherHigh: MotherHighItem[] = [
    ...activeLocal.accepted.map((pairing) => ({ kind: 'local' as const, pairing })),
    ...activeIncoming.map(({ task, targets }) => ({
      kind: 'transfer' as const,
      task,
      targets,
      readOnly: true,
    })),
    ...activeTransfers.map(({ task, targets }) => ({ kind: 'transfer' as const, task, targets })),
  ];
  const visibleMotherHigh =
    motherTab === 'high' ? activeMotherHigh.slice(0, motherShown) : activeMotherHigh;
  const motherRemaining = activeMotherHigh.length - visibleMotherHigh.length;
  const activeHelps = helpsOf(activeName);
  /**
   * 低概率里的求助卡（2026-11-20 用户口径修正）：只放**本号已经有这只母本**的线，
   * 按出母比例从高到低排；未收集的母本不进低概率，去「缺口」页签里看。
   */
  const lowHelps = activeHelps
    .filter((help) => help.mother != null && help.father != null)
    .sort(
      (a, b) =>
        b.femaleChance - a.femaleChance ||
        a.eggName.localeCompare(b.eggName, 'zh-Hans-CN'),
    );
  const hasMotherContent =
    activeLocal.accepted.length +
      activeLocal.low.length +
      activeIncoming.length +
      activeTransfers.length +
      activeHelps.length >
    0;
  /** 种公推荐：实际概率 ≥30% 进高概率，其余进低概率；缺口 = 本号没排上 + 等别的号出蛋 */
  /**
   * 种公推荐先按「同一只种公」并卡（2026-11-20 用户口径），再看这张卡进高概率还是低概率：
   * 组里只要有一窝是高概率，整张卡就进高概率——低概率的那只母本既然共用这只种公，
   * 也跟到高概率卡里一起勾（用户 2026-11-20 补充口径），不再在低概率里单独占一张。
   */
  const activeStudCards = groupSharedStudViews(active?.views ?? []);
  const isHighStudCard = (layout: StudCardLayout): boolean =>
    layout.kind === 'shared'
      ? layout.views.some((view) => viewTopChance(view) >= STUD_HIGH_CHANCE)
      : viewTopChance(layout.view) >= STUD_HIGH_CHANCE;
  /** 页签数量按合并后的卡片数算 */
  const activeHighLayouts = activeStudCards.filter(isHighStudCard);
  const activeLowLayouts = activeStudCards.filter((layout) => !isHighStudCard(layout));
  /** 种公区分组横条当前页：高概率 / 低概率（缺口页签已移除，2026-11-22 用户口径） */
  const activeStudLayouts = studTab === 'high' ? activeHighLayouts : activeLowLayouts;
  /**
   * 「配窝建议」渐进展开（2026-11-24）：只有高概率页分页，低概率页照旧整列铺出；
   * 切账号 / 切页签都会回到前 5 条（在对应 onClick 里 reset）。
   */
  const visibleStudLayouts =
    studTab === 'high' ? activeStudLayouts.slice(0, studShown) : activeStudLayouts;
  const studRemaining = activeStudLayouts.length - visibleStudLayouts.length;
  /** 本号的种公推荐（按本号自己的缺口算）；没传时退回计划里没排上的条目当缺口提示 */
  const activeRecommendations = studRecommendationsByAccount?.get(activeName) ?? [];
  const activeGapTargets = gapsByAccount?.get(activeName) ?? activeRecommendations.length;
  const activeGapCount = activeGapTargets;
  /** 当前号的种公是否已全齐（看板按选中账号给集合） */
  const activeComplete = isCompleteOf(activeName);
  /** 当前号的供蛋配对能帮到哪些号（显示在标题里，点开还有每张卡的「源 → 目标」） */
  const activeReceiverNames = [
    ...new Set((active?.views ?? []).flatMap((view) => receiversOf(view))),
  ];
  return (
    <div className="mt-1">
      {visible.length > 1 ? (
        <div
          ref={tabsRef}
          className="mb-1.5 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${tabColumns}, minmax(0, 1fr))` }}
          data-testid="breed-account-tabs"
        >
          {tabOrder.map((entry) => {
            const selected = entry.plan.account === active?.plan.account;
            const badge = tabBadgeOf(entry.plan);
            return (
              <button
                key={entry.plan.account}
                type="button"
                onClick={() => {
                  setActiveAccount(entry.plan.account);
                  setStudShown(SUGGESTION_FIRST_PAGE);
                  setMotherShown(SUGGESTION_FIRST_PAGE);
                }}
                data-testid="breed-account-tab"
                aria-pressed={selected}
                className={`flex w-full min-w-0 items-center justify-center whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                }`}
              >
                {entry.plan.account}
                {badge ? (
                  <span
                    className={`ml-1 shrink-0 text-[10px] ${
                      selected ? 'text-emerald-100' : 'text-slate-400'
                    }`}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {active ? (
        <div data-testid="breed-account">
          <h3 className="mb-1 text-sm font-medium text-slate-700" data-testid="breed-account-name">
            {active.plan.account}
            {active.plan.nestsTotal > 0
              ? ` · 用 ${activePicked}/${active.plan.nestsTotal} 个窝`
              : activePicked > 0
                ? ` · 用 ${activePicked} 个窝`
                : ''}
            {showStuds && (activeComplete || gapsByAccount?.get(active.plan.account) != null) ? (
              <span className="ml-1 text-xs font-normal text-slate-500">
                {activeComplete || gapsByAccount?.get(active.plan.account) === 0 ? (
                  <>
                    · 种公都收齐了
                    {activeReceiverNames.length > 0
                      ? ` · 可帮 ${activeReceiverNames.length} 个号补种公`
                      : ''}
                  </>
                ) : (
                  <>
                    · 差{' '}
                    <b className="text-rose-600">{gapsByAccount?.get(active.plan.account)}</b>{' '}
                    个种公目标
                  </>
                )}
              </span>
            ) : null}
          </h3>
          {showStuds &&
          active.views.length === 0 &&
          activeGapCount === 0 &&
          (!showMothers || !hasMotherContent) ? (
            <p className="mt-1 text-xs text-slate-400" data-testid="breed-idle">
              {activeComplete
                ? '本号种公都收齐了；暂时没有能从本号补的号。'
                : '这个号不用出窝：缺口由别的号补，孵好再把蛋传过来。'}
            </p>
          ) : null}
          {showStuds && (active.views.length > 0 || activeGapCount > 0) ? (
            <>
              <div
                className="-mx-1 mt-1.5 flex gap-1 overflow-x-auto px-1 pb-1"
                data-testid="stud-tabs"
              >
                {(
                  [
                    { key: 'high', label: '配窝建议', count: activeHighLayouts.length },
                    { key: 'low', label: '低概率', count: activeLowLayouts.length },
                  ] as const
                ).map((item) => {
                  const selected = studTab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setStudTab(item.key);
                        setStudShown(SUGGESTION_FIRST_PAGE);
                      }}
                      aria-pressed={selected}
                      data-testid={`stud-tab-${item.key}`}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selected
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                      }`}
                    >
                      {item.label}
                      {item.count != null ? (
                        <span
                          className={`ml-1 text-[10px] ${
                            selected ? 'text-sky-100' : 'text-slate-400'
                          }`}
                        >
                          {item.count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {activeStudLayouts.length > 0 ? (
                <>
                  <ul className="mt-1.5 space-y-1.5" data-testid="breed-list">
                    {visibleStudLayouts.map((layout) => {
                      const collectedGroupIds =
                        collectedGroupIdsByAccount?.get(active.plan.account) ??
                        NO_COLLECTED_GROUPS;
                      if (layout.kind === 'single') {
                        const view = layout.view;
                        const pickKey = `stud:${view.key}`;
                        return (
                          <PairingCard
                            key={view.key}
                            view={view}
                            testId="breed-suggestion"
                            receivers={receiversOf(view)}
                            collectedGroupIds={collectedGroupIds}
                            picked={isPicked(active.plan.account, pickKey)}
                            onTogglePick={() => togglePick(active.plan.account, pickKey)}
                          />
                        );
                      }
                      const pickKeys = layout.views.map((view) => `stud:${view.key}`);
                      const picked = pickKeys.every((key) => isPicked(active.plan.account, key));
                      return (
                        <SharedStudCard
                          key={`shared:${layout.stud.key}`}
                          stud={layout.stud}
                          views={layout.views}
                          account={active.plan.account}
                          receiversOf={receiversOf}
                          collectedGroupIds={collectedGroupIds}
                          picked={picked}
                          onTogglePick={() =>
                            setPicks(active.plan.account, pickKeys, !picked)
                          }
                        />
                      );
                    })}
                  </ul>
                  {studTab === 'high' && studRemaining > 0 ? (
                    <ShowMoreButton
                      remaining={studRemaining}
                      onClick={() => setStudShown((count) => count + SUGGESTION_PAGE_SIZE)}
                      testId="stud-show-more"
                      tone="sky"
                    />
                  ) : null}
                </>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-400" data-testid="stud-empty">
                  {studTab === 'high' ? '本号没有配窝建议。' : '没有低概率种公配对。'}
                </p>
              )}
            </>
          ) : null}

          {showMothers && hasMotherContent ? (
            <div className="mt-2 border-t border-dashed border-slate-200 pt-2" data-testid="mother-nest">
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="mother-tabs">
                {(
                  [
                    {
                      key: 'high',
                      label: '配窝建议',
                      count: activeMotherHigh.length,
                    },
                    {
                      key: 'low',
                      label: '低概率',
                      count: activeLocal.low.length + lowHelps.length,
                    },
                  ] as const
                ).map((item) => {
                  const selected = motherTab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setMotherTab(item.key);
                        setMotherShown(SUGGESTION_FIRST_PAGE);
                      }}
                      aria-pressed={selected}
                      data-testid={`mother-tab-${item.key}`}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selected
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                      }`}
                    >
                      {item.label}
                      {item.count != null ? (
                        <span
                          className={`ml-1 text-[10px] ${
                            selected ? 'text-amber-100' : 'text-slate-400'
                          }`}
                        >
                          {item.count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {motherTab === 'high' ? (
                <div className="space-y-1.5" data-testid="mother-high">
                  {activeIncoming.length > 0 ? (
                    <p
                      className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] leading-4 text-sky-700"
                      data-testid="mother-incoming-note"
                    >
                      本号缺口 {activeIncoming.length} 条：带「从 X 传蛋」的卡在出蛋号出窝，不占本号窝；到出蛋号页签勾选占窝。
                    </p>
                  ) : null}
                  {activeMotherHigh.length === 0 ? (
                    <p className="text-[11px] text-slate-400">本号没有配窝建议。</p>
                  ) : null}
                  {visibleMotherHigh.map((item) =>
                    item.kind === 'local' ? (
                      <MotherPairingCard
                        key={`${item.pairing.eggGameId}-${item.pairing.mother.key}-${item.pairing.father.key}`}
                        pairing={item.pairing}
                        collectedGroupIds={
                          collectedGroupIdsByAccount?.get(active.plan.account) ??
                          NO_COLLECTED_GROUPS
                        }
                        onSeekHelp={onSeekHelp}
                        picked={isPicked(active.plan.account, motherPickKeyOf(item.pairing))}
                        onTogglePick={() =>
                          togglePick(active.plan.account, motherPickKeyOf(item.pairing))
                        }
                      />
                    ) : (
                      <MotherTaskCard
                        key={`${item.readOnly ? 'in' : 'out'}:${transferKeyOf(item.task)}`}
                        task={item.task}
                        targets={item.targets}
                        collectedGroupIds={
                          collectedGroupIdsByAccount?.get(active.plan.account) ??
                          NO_COLLECTED_GROUPS
                        }
                        onSeekHelp={onSeekHelp}
                        readOnly={item.readOnly === true}
                        picked={
                          !item.readOnly &&
                          isPicked(active.plan.account, transferPickKeyOf(item.task))
                        }
                        onTogglePick={
                          item.readOnly
                            ? undefined
                            : () => togglePick(active.plan.account, transferPickKeyOf(item.task))
                        }
                      />
                    ),
                  )}
                  {motherRemaining > 0 ? (
                    <ShowMoreButton
                      remaining={motherRemaining}
                      onClick={() => setMotherShown((count) => count + SUGGESTION_PAGE_SIZE)}
                      testId="mother-show-more"
                      tone="amber"
                    />
                  ) : null}
                </div>
              ) : null}

              {motherTab === 'low' ? (
                <div className="space-y-1.5" data-testid="mother-low">
                  {activeLocal.low.length === 0 && lowHelps.length === 0 ? (
                    <p className="text-[11px] text-slate-400">没有低概率配窝。</p>
                  ) : null}
                  {activeLocal.low.map((pairing) => (
                    <MotherPairingCard
                      key={`low-${pairing.eggGameId}-${pairing.mother.key}-${pairing.father.key}`}
                      pairing={pairing}
                      low
                      collectedGroupIds={
                        collectedGroupIdsByAccount?.get(active.plan.account) ?? NO_COLLECTED_GROUPS
                      }
                      onSeekHelp={onSeekHelp}
                      picked={isPicked(active.plan.account, motherPickKeyOf(pairing, true))}
                      onTogglePick={() =>
                        togglePick(active.plan.account, motherPickKeyOf(pairing, true))
                      }
                    />
                  ))}
                  {lowHelps.map((help) => (
                    <MotherHelpCard
                      key={help.eggGameId}
                      help={help}
                      collectedGroupIds={
                        collectedGroupIdsByAccount?.get(active.plan.account) ?? NO_COLLECTED_GROUPS
                      }
                      targetBodyMedal={targetBodyMedal}
                      targetVoiceDb={targetVoiceDb}
                      onSeekHelp={onSeekHelp}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {showStuds && active.plan.blockedLinks.length > 0 ? (
            <p className="mt-1 text-[11px] text-rose-600" data-testid="breed-blocked">
              注意：有 {active.plan.blockedLinks.length} 条连线会产出非目标蛋
            </p>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}


