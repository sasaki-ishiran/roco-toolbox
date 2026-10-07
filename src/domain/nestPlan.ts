import { GRADE_BODY, classifyGrade, type PetGrade, type TargetMode } from './petFilters';
import { isBreedableGroup } from './eggs';
import { speciesDisplayName } from './speciesName';
import {
  arrangeClusters,
  centerDistance,
  nestsConnect,
  PAIR_RANGE,
  placeGreedy,
  type NestPosition,
  type Placement,
} from './nestGeometry';
import { cellStateFor, type StudCoverageResult } from './studCoverage';
import { buildCanBreedMale } from './breedAbility';
import { boxLabel } from './coverageDetail';
import type { OwnedPet, SpeciesEntry } from './types';

/**
 * 家园配窝方案（第一期：**可配建议** / 补齐种公）。
 *
 * 目标不是「产蛋越多越好」，而是**产出的每颗蛋都是我们要的**。
 *
 * 判定模型按 **M1（多路径）** 建模（用户 2026-10-05 拍板）：**每条公母连线各自独立判定**，
 * 连线越多机会越多。于是最优摆位不是「把每条配对隔离」，而是：
 * - **组内**：把目标相容的精灵摆成紧凑块 → 最大化连线（组内任意公母配对都是我们要的蛋）；
 * - **组间**：拉开 >4.25 格 → 不产生非目标连线（防串窝）。
 * 学院小窝（绿窝）放进它所在那组的紧凑块里、尽量多挂线：既提高它自己命中率（早进 CD），
 * 也让它在 CD 期间「仍计数但不产蛋」时把机会让给同组母窝（催化）。
 *
 * 三档（遗传概率）：学院 100% / 普通双方同性格 60% / 普通单方带 30%；双方都没目标性格 → 不生成。
 * 资源模型：**窝是资源、配对是边**——一只精灵占一个窝，但可以同时和附近多只异性配对。
 * 分配顺序：① 普通 60% 主力 → ② 学院补差（凑不出 60% 的缺口，最多 2 个配对方）→ ③ 普通 30% 兜底。
 * 每档内部再按**公母尽量均衡**收线（2026-10-06 用户口径：11 窝的最优是 5 公 6 母——M1 下公母
 * 连线最多、命中机会最大；**不强制 1:1**，|公−母| ≤ 1 就算均衡，只为避免「1 公挂 N 母」的失衡），
 * 同级里仍按这条线的期望产出从高到低；「补新缺口」仍是硬门槛，只收能补新缺口的线，不为凑数硬加线。
 */
export type NestTier = 'academy' | 'normal60' | 'normal30';

/** 默认窝位：11 = 1 个学院小窝 + 10 个普通小窝。 */
export const DEFAULT_NEST_COUNT = 11;

/** 学院小窝那只最多服务几只普通小窝（12h CD 限制，用户口径）。 */
export const MAX_ACADEMY_PARTNERS = 2;

/**
 * 声音遗传：子代分贝 =（父 + 母）/ 2 **向零取整**。
 * 因此 100 + 100 才是满分 100；100 + 99 只能得 99（不是四舍五入到 100）。
 */
export function averageVoice(fatherDb: number, motherDb: number): number {
  return Math.trunc((fatherDb + motherDb) / 2);
}

export interface NestPet {
  /** 唯一标识（用于判断「学院小窝那只」是母本还是配对方） */
  key: string;
  name: string;
  account: string;
  gender: '公' | '母';
  nature: string;
  voiceDb: number;
  medalBody: string;
  /** 游戏里的位置（如「盒子29 第4位」），方便去背包找 */
  box: string;
}

export interface NestPairing {
  tier: NestTier;
  /** 这一窝能补的缺口蛋组 */
  groupIds: number[];
  natureName: string;
  grade: PetGrade;
  account: string;
  father: NestPet;
  mother: NestPet;
  /** 学院小窝那只（普通档为 null） */
  academyParent: NestPet | null;
  /** 配对方：学院档 = 非学院的那只；普通档 = 另一个亲本（父本） */
  partner: NestPet;
  /** 目标性格的遗传概率：学院 1 / 普通同性格 0.6 / 普通单方 0.3 */
  natureChance: number;
  distance: number;
  /** 两只精灵所在窝位的坐标（给可视化画连线用） */
  fatherPosition: NestPosition;
  motherPosition: NestPosition;
  expected: { species: string; nature: string; body: string; voice: string };
}

/** 一个窝位：放到哪、放谁、属于哪个连通组（簇）、是不是学院小窝。 */
export interface NestSlot {
  position: NestPosition;
  pet: NestPet;
  cluster: number;
  academy: boolean;
}

/** 会产出非目标蛋的连线（理想情况下应为空；非空说明摆位还有缺陷） */
export interface BlockedLink {
  father: NestPet;
  mother: NestPet;
  distance: number;
  reason: string;
}

export interface NestPlan {
  account: string;
  pairings: NestPairing[];
  blockedLinks: BlockedLink[];
  slots: NestSlot[];
  nestsUsed: number;
  nestsTotal: number;
  clusters: NestPosition[][];
  /** 没能排上的缺口（**带原因**，直接告诉用户缺什么） */
  unfilled: UnfilledItem[];
  /** 候选配对：生成过但没进方案的组合，供用户自行替换（默认在界面上收起） */
  alternatives: CandidateOption[];
}

/**
 * 缺口没排上的原因（与覆盖度、换蛋共用同一套格子判定）：
 * - `no-room`：手里这对本来能配（或已通），只是**这轮没排上**（窝位/学院名额被占）→ 算配窝候选
 * - `has-mother`：有带这个性格的母、缺公 → **要去弄**一只公
 * - `to-collect`：连一只带这个性格的都没有 → **要去弄**（不弄一只进来，连迭代都启动不了）
 */
export type UnfilledReason = 'no-room' | 'has-mother' | 'to-collect';

export interface UnfilledItem {
  groupId: number;
  natureName: string;
  grade: PetGrade;
  reason: UnfilledReason;
}

/** 候选配对（没进当前方案、可自行替换） */
export interface CandidateOption {
  tier: NestTier;
  groupIds: number[];
  natureName: string;
  grade: PetGrade;
  mother: NestPet;
  father: NestPet;
  /** 学院档：学院小窝那只（普通档为 null） */
  academyParent: NestPet | null;
  /** 配对方：学院档 = 非学院的那只；普通档 = 另一个亲本（父本） */
  partner: NestPet;
  natureChance: number;
  /** 这一对精灵的个体标识（界面「换这条」原样回传给 `pinned`；数据变了会自然失效，不会指错精灵） */
  pairKey: string;
  /** 把它摆进来还要新占几个窝（两只都已在方案里就是 0） */
  newNests: number;
  /** 等价配法的条数：同名同性格同档位的几只个体合并成一条展示（选哪只上场没区别） */
  count: number;
  expected: { species: string; nature: string; body: string; voice: string };
}

/** 用户手动指定：某个缺口（性格 + 档位）改用哪一对精灵来配（界面「换这条」）。 */
export interface NestPin {
  account: string;
  natureName: string;
  grade: PetGrade;
  /** 取自 `CandidateOption.pairKey` */
  pairKey: string;
}

export interface NestPlanInput {
  species: SpeciesEntry[];
  owned: OwnedPet[];
  coverage: StudCoverageResult;
  mode: TargetMode;
  nestCount?: number;
  /** 用户手动指定的配对（「换这条」）：这些缺口优先交给指定的那一对 */
  pinned?: NestPin[];
}

interface Candidate {
  tier: NestTier;
  natureName: string;
  grade: PetGrade;
  groupIds: number[];
  /** 学院档：学院小窝那只；普通档：null */
  academy: OwnedPet | null;
  p1: OwnedPet;
  p2: OwnedPet;
}

const cellKey = (natureName: string, grade: PetGrade, groupId: number): string =>
  `${natureName}|${grade}|${groupId}`;

/** 稳的排序：补得多的在前，再按性格名、组号。 */
const byGroupsThenStable = (a: Candidate, b: Candidate): number =>
  b.groupIds.length - a.groupIds.length ||
  a.natureName.localeCompare(b.natureName) ||
  (a.groupIds[0] ?? 0) - (b.groupIds[0] ?? 0);

export function buildNestPlans(input: NestPlanInput): NestPlan[] {
  const { species, owned, coverage, mode, pinned = [] } = input;
  const nestCount = input.nestCount ?? DEFAULT_NEST_COUNT;

  const speciesByGameId = new Map<number, SpeciesEntry>();
  const breedableGroupsByGameId = new Map<number, number[]>();
  for (const entry of species) {
    speciesByGameId.set(entry.gameId, entry);
    breedableGroupsByGameId.set(entry.gameId, (entry.eggGroups ?? []).filter(isBreedableGroup));
  }
  const groupsOf = (pet: OwnedPet): number[] => breedableGroupsByGameId.get(pet.gameId) ?? [];
  const inGroup = (pet: OwnedPet, groupId: number): boolean => groupsOf(pet).includes(groupId);
  const sharesGroup = (a: OwnedPet, b: OwnedPet): boolean =>
    groupsOf(a).some((groupId) => groupsOf(b).includes(groupId));
  // 母方物种能不能出公（后代随母方）：和覆盖度/换蛋收益同一口径
  const canBreedMale = buildCanBreedMale(species);

  const byAccount = new Map<string, OwnedPet[]>();
  for (const pet of owned) {
    const list = byAccount.get(pet.account) ?? [];
    list.push(pet);
    byAccount.set(pet.account, list);
  }

  const plans: NestPlan[] = [];
  // 缺口分工：同一格只让一个账号补（避免两个账号做重复功）。
  // 先让「能力更强」的账号挑（能用的目标档位精灵多 = 更能补得动）。
  const capability = (pets: OwnedPet[]): number =>
    pets.filter((pet) => classifyGrade(pet, mode) !== null).length;
  const claimedCells = new Set<string>();
  const pendingUnfilled: Array<{ account: string; item: UnfilledItem }> = [];
  const accountsByAbility = [...byAccount.entries()].sort(
    (a, b) => capability(b[1]) - capability(a[1]) || a[0].localeCompare(b[0]),
  );
  for (const [account, accountOwned] of accountsByAbility) {
    const petIndex = new Map(accountOwned.map((pet, index) => [pet, index]));
    const keyOf = (pet: OwnedPet): number => petIndex.get(pet) ?? -1;
    // 个体身份用「账号 + 账号内序号」：同名同内容的两只精灵也是两个个体，不能按内容指纹去重
    const toNestPet = (pet: OwnedPet): NestPet => ({
      key: `${pet.account}#${keyOf(pet)}`,
      name: speciesDisplayName(speciesByGameId.get(pet.gameId), pet.name),
      account: pet.account,
      gender: pet.gender === '公' ? '公' : '母',
      nature: pet.nature,
      voiceDb: pet.voiceDb,
      medalBody: pet.medalBody,
      box: boxLabel(pet),
    });

    // —— 用户手动指定（「换这条」）——
    /** 候选配对的个体标识：母本名|性格 × 父本名|性格。数据变了自然匹配不上 → 自动失效，不会指错精灵 */
    const pairKeyOf = (a: OwnedPet, b: OwnedPet): string => {
      const motherPet = a.gender === '母' ? a : b;
      const fatherPet = a.gender === '公' ? a : b;
      return `${toNestPet(motherPet).name}|${motherPet.nature}×${toNestPet(fatherPet).name}|${fatherPet.nature}`;
    };
    const accountPins = pinned.filter((pin) => pin.account === account);
    const pinOf = (candidate: Candidate): NestPin | undefined =>
      accountPins.find(
        (pin) =>
          pin.natureName === candidate.natureName &&
          pin.grade === candidate.grade &&
          pin.pairKey === pairKeyOf(candidate.p1, candidate.p2),
      );
    /** 用户指定过的格子：不再自动加别的线去补它 */
    const pinnedCells = new Set<string>();

    // 只认领「还没被别的账号接走」的缺口（分工）
    const cells = coverage.cells.filter(
      (cell) =>
        cell.state !== 'covered' &&
        !claimedCells.has(cellKey(cell.natureName, cell.grade, cell.groupId)),
    );

    // —— 候选配对（用来决定「该放哪些精灵」；最终连线由几何决定）——
    const byPair = new Map<string, Candidate>();
    for (const cell of cells) {
      const { groupId, grade, natureName } = cell;
      // 性别未知的精灵配不了，直接排除（否则会当选「学院那只」却一条线也产不出）
      const graded = accountOwned.filter(
        (pet) => pet.gender !== '未知' && classifyGrade(pet, mode) === grade,
      );
      const carriers = graded.filter((pet) => pet.nature === natureName);

      const push = (tier: NestTier, academy: OwnedPet | null, p1: OwnedPet, p2: OwnedPet) => {
        const key = `${tier}|${natureName}|${grade}|${keyOf(p1)}|${keyOf(p2)}`;
        const existing = byPair.get(key);
        if (existing) {
          if (!existing.groupIds.includes(groupId)) existing.groupIds.push(groupId);
          return;
        }
        byPair.set(key, { tier, natureName, grade, groupIds: [groupId], academy, p1, p2 });
      };

      // 学院小窝：带目标性格的那只 + 异性配对方
      for (const academy of carriers) {
        for (const partner of graded) {
          if (partner === academy) continue;
          if (partner.gender === '未知' || partner.gender === academy.gender) continue;
          if (!sharesGroup(partner, academy)) continue;
          const mother = academy.gender === '母' ? academy : partner;
          // 母方必须在目标蛋组，且**本身出得了公**（出不了公 → 永远孵不出种公，别白占窝）
          if (!inGroup(mother, groupId) || !canBreedMale(mother)) continue;
          push('academy', academy, academy, partner);
        }
      }

      // 普通小窝：一对普通窝（双方至少一方带目标性格，否则概率 0 不生成）
      for (let i = 0; i < graded.length; i += 1) {
        for (let j = i + 1; j < graded.length; j += 1) {
          const a = graded[i];
          const b = graded[j];
          if (a.gender === '未知' || b.gender === '未知' || a.gender === b.gender) continue;
          if (!sharesGroup(a, b)) continue;
          const mother = a.gender === '母' ? a : b;
          if (!inGroup(mother, groupId) || !canBreedMale(mother)) continue;
          const aCarrier = a.nature === natureName;
          const bCarrier = b.nature === natureName;
          if (!aCarrier && !bCarrier) continue;
          push(aCarrier && bCarrier ? 'normal60' : 'normal30', null, a, b);
        }
      }
    }

    const candidates = [...byPair.values()];
    const has60 = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.tier !== 'normal60') continue;
      for (const groupId of candidate.groupIds) {
        has60.add(cellKey(candidate.natureName, candidate.grade, groupId));
      }
    }
    /**
     * 一条配对（母×公）的**总期望产出** = Σ（它涉及的每个缺口格 × 它在这个格上能给的概率）。
     * 例：「母平和 × 公开朗」一边出 30% 平和、一边出 30% 开朗 → 0.6，
     * 比「母平和 × 公非目标性格」的 0.3 高一倍（用户 2026-10-06 指出的口径）。
     *
     * **学院档不参与**（代码审查 2026-10-06 修）：学院只有一只、另有自己的收益排序；
     * 把它按 1.0 累加进普通线的价值，会把「名义很高、实际只补一格」的线排到真·补两格的线前面。
     */
    const pairKeyOfPets = (a: OwnedPet, b: OwnedPet): string => {
      const i = keyOf(a);
      const j = keyOf(b);
      return i < j ? `${i}|${j}` : `${j}|${i}`;
    };
    const pairValue = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate.tier === 'academy') continue;
      const chance = candidate.tier === 'normal60' ? 0.6 : 0.3;
      const key = pairKeyOfPets(candidate.p1, candidate.p2);
      pairValue.set(key, (pairValue.get(key) ?? 0) + chance * candidate.groupIds.length);
    }
    /** 先按「这条线总共能补多少」从高到低，再按蛋组数/性格稳定排序 */
    const byValueThenStable = (a: Candidate, b: Candidate): number =>
      (pairValue.get(pairKeyOfPets(b.p1, b.p2)) ?? 0) -
        (pairValue.get(pairKeyOfPets(a.p1, a.p2)) ?? 0) || byGroupsThenStable(a, b);

    /**
     * 学院补差门槛：只收「至少有一组凑不出 60%」的候选。
     * 多组候选不能用 every —— 否则另一组明明只能靠学院（100%），会被整条砍掉。
     * 全组都有 60% 的候选照旧丢掉：别把学院（12h CD）花在普通窝能覆盖的缺口上。
     */
    const academyQualifies = (candidate: Candidate): boolean =>
      candidate.tier === 'academy' &&
      candidate.groupIds.some(
        (groupId) => !has60.has(cellKey(candidate.natureName, candidate.grade, groupId)),
      );
    const normal60List = candidates.filter((c) => c.tier === 'normal60').sort(byValueThenStable);
    const normal30List = candidates.filter((c) => c.tier === 'normal30').sort(byValueThenStable);
    const academyList = candidates.filter(academyQualifies).sort(byValueThenStable);

    // —— 分配：窝是资源、配对是边（一只精灵占 1 个窝，但可同时和多个异性配对）——
    const placed = new Set<OwnedPet>();
    const accepted: Candidate[] = [];
    const filledCells = new Set<string>();
    /** 学院簇专用：学院那只 + 它的配对方，不能再出现在别的配对里（否则蛋的身份不确定） */
    const reserved = new Set<OwnedPet>();
    let nestsLeft = nestCount;
    let academyPet: OwnedPet | null = null;
    let academyPartners = 0;
    /** 已被普通配对用掉的精灵（学院不能用它们当配对方，否则「绿窝蛋/非绿窝蛋」分不清） */
    let usedByNormal = new Set<OwnedPet>();

    const addsNewGap = (candidate: Candidate): boolean =>
      candidate.groupIds.some(
        (groupId) => !filledCells.has(cellKey(candidate.natureName, candidate.grade, groupId)),
      );
    /** 新占的窝数（已放下的精灵不额外占窝） */
    const costOf = (candidate: Candidate): number =>
      (placed.has(candidate.p1) ? 0 : 1) + (placed.has(candidate.p2) ? 0 : 1);
    const markFilled = (candidate: Candidate) => {
      for (const groupId of candidate.groupIds) {
        filledCells.add(cellKey(candidate.natureName, candidate.grade, groupId));
      }
    };
    const tryAccept = (candidate: Candidate): boolean => {
      if (accepted.includes(candidate)) return false; // 同一条别再收一次
      if (candidate.tier === 'academy') {
        // 学院小窝只有一个：不能让另一只也当学院那只
        if (academyPet !== null && candidate.academy !== academyPet) return false;
        if (academyPartners >= MAX_ACADEMY_PARTNERS) return false;
        // 学院簇要「干净」：学院那只和它的配对方不能已被普通配对占用
        if (usedByNormal.has(candidate.p1) || usedByNormal.has(candidate.p2)) return false;
      } else if (reserved.has(candidate.p1) || reserved.has(candidate.p2)) {
        // 学院的精灵不再参与普通配对（宁可牺牲连线，也不弄错蛋）
        return false;
      }
      // **只收能补新缺口的线**（2026-10-06 用户口径）：
      // 同一格已经有线了就不再叠加——冗余线产出的还是那一种蛋，把窝占死反而让玩家
      // 没窝自己孵「对性蛋」去换蛋（产出来全成了迭代蛋，没人换）。
      if (!addsNewGap(candidate)) return false;
      // 用户手动指定过的格子：不再自动加别的线去补（说了用哪条就用哪条）
      if (!pinOf(candidate)) {
        const allPinned = candidate.groupIds.every((groupId) =>
          pinnedCells.has(cellKey(candidate.natureName, candidate.grade, groupId)),
        );
        if (allPinned) return false;
      }
      const cost = costOf(candidate);
      if (cost > nestsLeft) return false;
      placed.add(candidate.p1);
      placed.add(candidate.p2);
      nestsLeft -= cost;
      markFilled(candidate);
      accepted.push(candidate);
      if (candidate.tier === 'academy') {
        academyPet = candidate.academy;
        academyPartners += 1;
        reserved.add(candidate.p1);
        reserved.add(candidate.p2);
      } else {
        // 普通配对占用的精灵要**实时**记下来：第二遍挂学院第 2 条时不能再挑它们当配对方
        usedByNormal.add(candidate.p1);
        usedByNormal.add(candidate.p2);
      }
      return true;
    };

    // 用户「换这条」：先把指定候选收进来，这个缺口就交给它（其余照常走自动分配）
    for (const candidate of candidates) {
      if (!pinOf(candidate)) continue;
      if (!tryAccept(candidate)) continue;
      for (const groupId of candidate.groupIds) {
        pinnedCells.add(cellKey(candidate.natureName, candidate.grade, groupId));
      }
    }

    /**
     * 学院小窝只有一个、还会进 12h CD，所以**要挑期望收益最大的那只**，不能先到先得：
     * 收益 = Σ(100% − 这个缺口在普通窝本来能拿到的最高概率)，最多服务 MAX_ACADEMY_PARTNERS 个缺口。
     * 例：能 1:2 补两个「只有 30%」缺口的精灵（1.4）> 只能补一个缺口的精灵（0.7）。
     */
    const normalChanceByCell = new Map<string, number>();
    for (const candidate of [...normal60List, ...normal30List]) {
      const chance = candidate.tier === 'normal60' ? 0.6 : 0.3;
      for (const groupId of candidate.groupIds) {
        const key = cellKey(candidate.natureName, candidate.grade, groupId);
        normalChanceByCell.set(key, Math.max(normalChanceByCell.get(key) ?? 0, chance));
      }
    }
    /** 这条学院线比留在普通窝多赚多少（该线覆盖的每个缺口各算一份） */
    const academyGain = (candidate: Candidate): number =>
      candidate.groupIds.reduce(
        (sum, groupId) =>
          sum +
          (1 -
            (normalChanceByCell.get(cellKey(candidate.natureName, candidate.grade, groupId)) ?? 0)),
        0,
      );
    /** 候选按「坐学院小窝的那只」分组，组内按收益排，组间也按总收益排 */
    const academyByPet = (() => {
      const byPet = new Map<OwnedPet, Candidate[]>();
      for (const candidate of academyList) {
        if (!candidate.academy) continue;
        const list = byPet.get(candidate.academy) ?? [];
        list.push(candidate);
        byPet.set(candidate.academy, list);
      }
      /** 这只坐学院能拿到的总收益：**按缺口去重**（同一格挂两条不加倍） */
      const scoreOf = (list: Candidate[]): number => {
        const byCell = new Map<string, number>();
        for (const candidate of list) {
          for (const groupId of candidate.groupIds) {
            const key = cellKey(candidate.natureName, candidate.grade, groupId);
            const gain =
              1 -
              (normalChanceByCell.get(cellKey(candidate.natureName, candidate.grade, groupId)) ?? 0);
            byCell.set(key, Math.max(byCell.get(key) ?? 0, gain));
          }
        }
        return [...byCell.values()]
          .sort((a, b) => b - a)
          .slice(0, MAX_ACADEMY_PARTNERS)
          .reduce((sum, gain) => sum + gain, 0);
      };
      return [...byPet.values()]
        .map((list) => ({
          list: [...list].sort((a, b) => academyGain(b) - academyGain(a) || byGroupsThenStable(a, b)),
        }))
        .sort((a, b) => scoreOf(b.list) - scoreOf(a.list));
    })();

    /** 每只精灵在**所有候选**里出现的次数：次数高 = 别的缺口也靠它，学院把它留着当配对方的机会成本大 */
    const candidateDegree = new Map<OwnedPet, number>();
    for (const candidate of candidates) {
      candidateDegree.set(candidate.p1, (candidateDegree.get(candidate.p1) ?? 0) + 1);
      candidateDegree.set(candidate.p2, (candidateDegree.get(candidate.p2) ?? 0) + 1);
    }

    /**
     * 学院候选的**尝试顺序**：
     * ① 先选「机会成本小」的配对方（候选度数低 = 别的缺口不靠它；学院的配对方要被保留、不能再配别人，
     *    挑错了会把别的缺口堵死——例：把「平和」唯一的载体挑去当配对方，平和就补不上了）；
     * ② 再把「能带来新缺口格」的排在前面（每个格各取第一条），同格其余候选排到后面当**备胎**
     *    （第一条可能因为那只公已被 60% 配对占用而被拒，这时要能换人；但名额最多 2 个**不同**的格）。
     */
    const orderAcademyCandidates = (list: Candidate[]): Candidate[] => {
      const partnerOf = (candidate: Candidate): OwnedPet =>
        candidate.p1 === candidate.academy ? candidate.p2 : candidate.p1;
      const ranked = [...list].sort(
        (a, b) => (candidateDegree.get(partnerOf(a)) ?? 0) - (candidateDegree.get(partnerOf(b)) ?? 0),
      );
      const covered = new Set<string>();
      const fresh: Candidate[] = [];
      const fallback: Candidate[] = [];
      for (const candidate of ranked) {
        const cells = candidate.groupIds.map((groupId) =>
          cellKey(candidate.natureName, candidate.grade, groupId),
        );
        if (cells.some((key) => !covered.has(key))) {
          fresh.push(candidate);
          for (const key of cells) covered.add(key);
        } else {
          fallback.push(candidate);
        }
      }
      return [...fresh, ...fallback];
    };

    /**
     * 收一个档位：**公母尽量均衡（不强制 1:1）**（2026-10-06 用户口径修正）。
     * 蛋虽然只落在母窝，但 M1 下**每条公母连线各自独立判定**——公母接近一半一半时连线最多、
     * 命中机会最大（用户与其他开发者核对后的结论：11 窝的最优是 5 公 6 母，公母比约 1:1）。
     * 此前「母优先、公复用」会把窝挤成「1 公挂 N 母」，公母失衡、连线反而少。
     * 做法：每次先收「收下之后公母数量差最小」的那条线（同级里仍按这条线的期望产出从高到低）——
     * 是**软偏好**不是硬门槛：父本/母本/窝位不够时该失衡就失衡，也不为凑 1:1 加冗余线。
     * 只收能补新缺口的线（见 `tryAccept`），不为凑数硬加线。
     */
    const motherOf = (candidate: Candidate): OwnedPet =>
      candidate.p1.gender === '母' ? candidate.p1 : candidate.p2;
    const fatherOf = (candidate: Candidate): OwnedPet =>
      candidate.p1.gender === '公' ? candidate.p1 : candidate.p2;
    /** 收下这条线之后的「公母数量差」：只看它新带进来的精灵，已在场的记 0 */
    const genderGapAfter = (candidate: Candidate, gap: number): number =>
      Math.abs(
        gap + (placed.has(fatherOf(candidate)) ? 0 : 1) - (placed.has(motherOf(candidate)) ? 0 : 1),
      );
    const acceptTier = (list: Candidate[]) => {
      const pending = new Set(list);
      // 每收一条就重算公母差（前面的收线会改变它），再挑下一条差距最小的；
      // `list` 本身已按期望产出排好，同分同差时先到先得 → 保住「高产出优先」。
      for (let step = 0; step < list.length; step += 1) {
        let males = 0;
        let females = 0;
        for (const pet of placed) {
          if (pet.gender === '公') males += 1;
          else females += 1;
        }
        const gap = males - females;
        let best: Candidate | null = null;
        let bestGap = Number.POSITIVE_INFINITY;
        for (const candidate of list) {
          if (!pending.has(candidate)) continue;
          const after = genderGapAfter(candidate, gap);
          if (after < bestGap) {
            bestGap = after;
            best = candidate;
          }
        }
        if (best === null) break;
        pending.delete(best);
        tryAccept(best);
      }
    };

    // 一遍扫描：只收能补新缺口的线（**不再有「空窝就把线挂满」的第二遍**，见 tryAccept 注释）。
    // 顺序：普通 60% 主力 → 学院补差 → 普通 30% 兜底；每档内部按「这条线的总期望产出」从高到低。
    acceptTier(normal60List);
    // 学院小窝：按收益从高到低试，**被拒（那只已被普通配对占用）就换下一只**。
    // 已经定下学院那只时（含用户「换这条」pin 的）只补它自己，别被别的精灵挡掉。
    for (const entry of academyByPet) {
      const pet = entry.list[0]?.academy;
      if (academyPet !== null && pet !== academyPet) continue;
      for (const candidate of orderAcademyCandidates(entry.list)) tryAccept(candidate);
      if (academyPet !== null) break;
    }
    acceptTier(normal30List);

    // —— 编组：**学院簇单独成组**（保证「干净」），普通配对再按共享精灵并组 ——
    const componentOf = new Map<OwnedPet, number>();
    let componentCount = 0;
    if (academyPet !== null) {
      componentOf.set(academyPet, 0);
      for (const candidate of accepted) {
        if (candidate.tier !== 'academy') continue;
        componentOf.set(candidate.p1, 0);
        componentOf.set(candidate.p2, 0);
      }
      componentCount = 1;
    }
    for (const candidate of accepted) {
      if (candidate.tier === 'academy') continue;
      const a = componentOf.get(candidate.p1);
      const b = componentOf.get(candidate.p2);
      if (a === undefined && b === undefined) {
        componentOf.set(candidate.p1, componentCount);
        componentOf.set(candidate.p2, componentCount);
        componentCount += 1;
      } else if (a !== undefined && b !== undefined) {
        if (a !== b) {
          for (const [pet, id] of componentOf) if (id === b) componentOf.set(pet, a);
        }
      } else if (a !== undefined) {
        componentOf.set(candidate.p2, a);
      } else if (b !== undefined) {
        componentOf.set(candidate.p1, b);
      }
    }
    const componentPets = new Map<number, OwnedPet[]>();
    for (const [pet, id] of componentOf) {
      const list = componentPets.get(id) ?? [];
      list.push(pet);
      componentPets.set(id, list);
    }
    const components = [...componentPets.values()];

    const gradeOf = (pet: OwnedPet): PetGrade | null => classifyGrade(pet, mode);
    const natureChanceFor = (mother: OwnedPet, father: OwnedPet, natureName: string): number => {
      // 学院小窝 100% 遗传的是「学院那只**自己的**性格」，不是任意目标性格
      if (academyPet === mother || academyPet === father) {
        return academyPet.nature === natureName ? 1 : 0;
      }
      const m = mother.nature === natureName;
      const f = father.nature === natureName;
      if (m && f) return 0.6;
      if (m || f) return 0.3;
      return 0;
    };
    /** 这条连线会不会产出目标蛋（用于标出摆位图里的非目标连线；建议本身不再由几何决定） */
    const isTargetLink = (mother: OwnedPet, father: OwnedPet): boolean => {
      const grade = gradeOf(mother);
      if (grade === null || gradeOf(father) !== grade) return false;
      const motherGroups = groupsOf(mother);
      // 2026-10-06 修复（m1）：这里要按**全部目标格**判断（coverage.cells），
      // 不能只看本账号认领的分工格——分工格是「谁来补」的归属，不是「什么是目标线」的定义；
      // 用窄了的 cells 会把合法目标连线误标成 blockedLink。
      return coverage.cells.some(
        (cell) =>
          cell.grade === grade &&
          motherGroups.includes(cell.groupId) &&
          natureChanceFor(mother, father, cell.natureName) > 0,
      );
    };

    // —— 摆位（2026-10-06 重做）——
    // 目标**不是**「簇内两两全连」：一簇里各窝的蛋组/性格本来就不全相容，有些窝天然配不上对，
    // 把它们摆在一起只是为了**尽量多连上能连的边**（M1 下每条公母连线各自独立判定，线越多命中机会越多）。
    // 评分逐项比较：① 先保证 accepted 的边真的连得上（连不上就等于没补上那个缺口）
    // ② 再避免摆出非目标连线（会产非目标蛋、白占窝）③ 再多连目标边 ④ 最后才求紧凑。
    const edgeKey = (a: OwnedPet, b: OwnedPet): string => {
      const i = keyOf(a);
      const j = keyOf(b);
      return i < j ? `${i}|${j}` : `${j}|${i}`;
    };
    const acceptedPairs = new Set(accepted.map((candidate) => edgeKey(candidate.p1, candidate.p2)));
    const degree = new Map<OwnedPet, number>();
    for (const candidate of accepted) {
      degree.set(candidate.p1, (degree.get(candidate.p1) ?? 0) + 1);
      degree.set(candidate.p2, (degree.get(candidate.p2) ?? 0) + 1);
    }
    const scorePlacement = (
      pet: OwnedPet,
      position: NestPosition,
      already: Placement<OwnedPet>[],
    ): number[] => {
      let acceptedRealized = 0;
      let blocked = 0;
      let bonusTargets = 0;
      let span = 0;
      for (const other of already) {
        const distance = centerDistance(position, other.position);
        span += distance;
        if (distance > PAIR_RANGE) continue;
        if (acceptedPairs.has(edgeKey(pet, other.item))) acceptedRealized += 1;
        if (pet.gender === '未知' || other.item.gender === '未知') continue;
        if (pet.gender === other.item.gender) continue;
        if (!sharesGroup(pet, other.item)) continue;
        const motherPet = pet.gender === '母' ? pet : other.item;
        const fatherPet = pet.gender === '公' ? pet : other.item;
        if (isTargetLink(motherPet, fatherPet)) bonusTargets += 1;
        else blocked += 1;
      }
      return [acceptedRealized, -blocked, bonusTargets, -span];
    };
    // 连线最多的精灵先摆（学院那只永远第一个，它得先占住绿窝的中心）；同名同内容的按账号内序号稳定排序
    const orderedComponents = components.map((pets) =>
      [...pets].sort(
        (a, b) =>
          (a === academyPet ? 0 : 1) - (b === academyPet ? 0 : 1) ||
          (degree.get(b) ?? 0) - (degree.get(a) ?? 0) ||
          keyOf(a) - keyOf(b),
      ),
    );
    const clusters = arrangeClusters(
      orderedComponents.map((pets) => placeGreedy(pets, scorePlacement).map((item) => item.position)),
    );
    const placements: Array<{ pet: OwnedPet; position: NestPosition; cluster: number }> = [];
    orderedComponents.forEach((pets, cluster) => {
      pets.forEach((pet, index) => {
        placements.push({ pet, position: clusters[cluster][index], cluster });
      });
    });

    // —— 配窝建议：只保留**摆位后真的连得上**的边 ——
    // 一条线能补多个性格：普通窝「母 X × 公 Y」每颗蛋各有 30% 出 X / 30% 出 Y，
    // 所以同一对精灵可以为两个缺口各出一条建议（学院那只例外：100% 只出它自己的性格）。
    const chanceOf = (candidate: Candidate): number =>
      candidate.tier === 'academy' ? 1 : candidate.tier === 'normal60' ? 0.6 : 0.3;
    const positions = new Map<OwnedPet, NestPosition>();
    for (const item of placements) positions.set(item.pet, item.position);

    const pairings: NestPairing[] = [];
    /** 真的出现在某条连线上的精灵（只有它们才占窝；摆不出来的边不占窝、也不算补上） */
    const activePets = new Set<OwnedPet>();
    for (const candidate of accepted) {
      const motherPet = candidate.p1.gender === '母' ? candidate.p1 : candidate.p2;
      const fatherPet = candidate.p1.gender === '公' ? candidate.p1 : candidate.p2;
      const motherPosition = positions.get(motherPet);
      const fatherPosition = positions.get(fatherPet);
      if (!motherPosition || !fatherPosition) continue;
      if (!nestsConnect(motherPosition, fatherPosition)) continue; // 摆不出来 → 不说它能补这个缺口
      activePets.add(motherPet);
      activePets.add(fatherPet);
      const mother = toNestPet(motherPet);
      const father = toNestPet(fatherPet);
      const academyParent =
        candidate.tier === 'academy' && candidate.academy ? toNestPet(candidate.academy) : null;
      pairings.push({
        tier: candidate.tier,
        groupIds: [...candidate.groupIds].sort((a, b) => a - b),
        natureName: candidate.natureName,
        grade: candidate.grade,
        account,
        father,
        mother,
        academyParent,
        // 学院档 = 非学院的那只；普通档 = 另一个亲本
        partner: academyParent && academyParent.key === mother.key ? father : academyParent ? mother : father,
        natureChance: chanceOf(candidate),
        distance: centerDistance(motherPosition, fatherPosition),
        fatherPosition,
        motherPosition,
        expected: {
          species: mother.name,
          nature: candidate.natureName,
          body: GRADE_BODY[candidate.grade],
          voice: String(averageVoice(fatherPet.voiceDb, motherPet.voiceDb)),
        },
      });
    }

    // 只留真的会占窝的精灵（摆不出来的边不占窝）
    const activePlacements = placements.filter((item) => activePets.has(item.pet));
    const activeClusters = clusters.map((_cluster, cluster) =>
      activePlacements.filter((item) => item.cluster === cluster).map((item) => item.position),
    );

    // 摆位体检：摆出来的连线里有没有「不是目标」的
    const blockedLinks: BlockedLink[] = [];
    for (let i = 0; i < activePlacements.length; i += 1) {
      for (let j = i + 1; j < activePlacements.length; j += 1) {
        const A = activePlacements[i];
        const B = activePlacements[j];
        if (!nestsConnect(A.position, B.position)) continue;
        if (A.pet.gender === '未知' || B.pet.gender === '未知') continue;
        if (A.pet.gender === B.pet.gender) continue;
        if (!sharesGroup(A.pet, B.pet)) continue; // 蛋组不通 → 游戏里配不上
        const motherPet = A.pet.gender === '母' ? A.pet : B.pet;
        const fatherPet = A.pet.gender === '公' ? A.pet : B.pet;
        if (isTargetLink(motherPet, fatherPet)) continue;
        blockedLinks.push({
          father: toNestPet(fatherPet),
          mother: toNestPet(motherPet),
          distance: centerDistance(A.position, B.position),
          reason: '这条连线产出的不是目标缺口（性格不对 / 档位不对 / 母方不在目标蛋组）',
        });
      }
    }

    // unfilled 按**真正摆出来的连线**算：只有连得上的边才算补上了这个缺口
    //（摆位放不下的边不算，缺口自动回到「未排上」，不会虚报成已排上）
    const filledFromPairings = new Set<string>();
    for (const pairing of pairings) {
      for (const groupId of pairing.groupIds) {
        filledFromPairings.add(cellKey(pairing.natureName, pairing.grade, groupId));
      }
    }
    /**
     * 这个缺口为什么没排上 —— 判定和覆盖度/换蛋**共用 `cellStateFor`**，不再各算一套。
     */
    const reasonFor = (cell: (typeof cells)[number]): UnfilledReason => {
      const matched = accountOwned.filter(
        (pet) => classifyGrade(pet, mode) === cell.grade && groupsOf(pet).includes(cell.groupId),
      );
      const state = cellStateFor(matched, cell, canBreedMale);
      if (state === 'covered' || state === 'breedable') return 'no-room';
      return state === 'missingStud' ? 'has-mother' : 'to-collect';
    };
    // 认领：本账号排上的格子，别的账号就不用再管了（分工）
    for (const key of filledFromPairings) claimedCells.add(key);
    for (const cell of cells) {
      if (filledFromPairings.has(cellKey(cell.natureName, cell.grade, cell.groupId))) continue;
      pendingUnfilled.push({
        account,
        item: {
          groupId: cell.groupId,
          natureName: cell.natureName,
          grade: cell.grade,
          reason: reasonFor(cell),
        },
      });
    }

    // 候选去重、和「是否已进方案」的比对，都用**等价配法**做键：
    // 同一个缺口下，档位/概率 + 双方的名字与性格都一样 → 就是等价的一条
    //（背后就算有几只同名同性格同档位的个体，选哪只上场也没区别）→ 合并成一条并记数量。
    // 注意：算法内部一律按**个体（对象/账号内序号）**判定；这个键只用于候选列表的展示聚合。
    const equivalenceKey = (
      tier: NestTier,
      natureName: string,
      grade: PetGrade,
      mother: NestPet,
      father: NestPet,
    ): string =>
      `${tier}|${natureName}|${grade}|${mother.account}|${mother.gender}|${mother.name}|${mother.nature}|${father.name}|${father.nature}`;
    const chosenKeys = new Set(
      pairings.map((pairing) =>
        equivalenceKey(pairing.tier, pairing.natureName, pairing.grade, pairing.mother, pairing.father),
      ),
    );
    const alternatives: CandidateOption[] = [];
    const altByKey = new Map<string, CandidateOption>();
    for (const candidate of candidates) {
      // 算法主动放弃的学院档候选（那个缺口已经有普通 60% 能补）不再当「候选」列出：
      // 否则候选清单会被学院档淹没，同名的普通档候选还会被它挤掉
      if (candidate.tier === 'academy' && !academyList.includes(candidate)) continue;
      const motherPet = candidate.p1.gender === '母' ? candidate.p1 : candidate.p2;
      const fatherPet = candidate.p1.gender === '公' ? candidate.p1 : candidate.p2;
      const mother = toNestPet(motherPet);
      const father = toNestPet(fatherPet);
      const key = equivalenceKey(candidate.tier, candidate.natureName, candidate.grade, mother, father);
      if (chosenKeys.has(key)) continue;
      const existing = altByKey.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const academyParent = candidate.academy ? toNestPet(candidate.academy) : null;
      const option: CandidateOption = {
        tier: candidate.tier,
        groupIds: [...candidate.groupIds].sort((a, b) => a - b),
        natureName: candidate.natureName,
        grade: candidate.grade,
        mother,
        father,
        academyParent,
        partner: academyParent && academyParent.key === mother.key ? father : academyParent ? mother : father,
        natureChance: chanceOf(candidate),
        pairKey: pairKeyOf(motherPet, fatherPet),
        // 用 activePets（真的进了方案的）而不是 placed：摆不出来的边不占窝，别显示成 0
        newNests: (activePets.has(motherPet) ? 0 : 1) + (activePets.has(fatherPet) ? 0 : 1),
        count: 1,
        expected: {
          species: mother.name,
          nature: candidate.natureName,
          body: GRADE_BODY[candidate.grade],
          voice: String(averageVoice(fatherPet.voiceDb, motherPet.voiceDb)),
        },
      };
      altByKey.set(key, option);
      alternatives.push(option);
    }
    const tierRank = (tier: NestTier): number => (tier === 'academy' ? 0 : tier === 'normal60' ? 1 : 2);
    alternatives.sort(
      (a, b) =>
        tierRank(a.tier) - tierRank(b.tier) ||
        b.groupIds.length - a.groupIds.length ||
        (a.groupIds[0] ?? 0) - (b.groupIds[0] ?? 0) ||
        a.natureName.localeCompare(b.natureName),
    );

    plans.push({
      account,
      pairings: pairings.sort(
        (a, b) => a.groupIds[0] - b.groupIds[0] || a.natureName.localeCompare(b.natureName),
      ),
      blockedLinks,
      slots: activePlacements.map((item) => ({
        position: item.position,
        pet: toNestPet(item.pet),
        cluster: item.cluster,
        academy: item.pet === academyPet,
      })),
      nestsUsed: activePlacements.length,
      nestsTotal: nestCount,
      clusters: activeClusters,
      unfilled: [], // 收尾时按分工结果统一填（见函数末尾）
      alternatives,
    });
  }

  // 收尾：没排上的只报「真的没人能补」的（已被任一账号认领的不再报）
  for (const plan of plans) {
    plan.unfilled = pendingUnfilled
      .filter(
        (entry) =>
          entry.account === plan.account &&
          !claimedCells.has(cellKey(entry.item.natureName, entry.item.grade, entry.item.groupId)),
      )
      .map((entry) => entry.item);
  }
  return plans.sort((a, b) => a.account.localeCompare(b.account));
}
