import type { NestPet, NestPlan } from './nestPlan';
import type { MotherNestAccount } from './motherNest';
import type { PetGrade } from './petFilters';

/**
 * 「这个缺口怎么补」悬浮窗的数据（2026-11-19 用户口径）。
 *
 * 同一个悬浮窗复用到看板种公推荐 / 收集母本 / 收集种公三处，所以这里只做**查询**：
 * 把母本建议（`MotherNestAccount`）和配窝方案（`NestPlan`）里同一颗蛋 / 同一个缺口的线
 * 找出来，整理成「本号直配 + 跨号传蛋 + 只能求助」三段，界面只负责画。
 *
 * 口径与配窝卡完全一致：概率是**真实概率**（性格 × 公母比例），不是性格概率单算。
 */
export interface GapRoute {
  kind: 'self' | 'transfer';
  /** 需要这个缺口的号 */
  account: string;
  /** 跨号传蛋的源号（本号直配没有） */
  sourceAccount?: string;
  mother: NestPet;
  father: NestPet;
  recommendedNatures: string[];
  /** 子代拿到推荐性格的概率 */
  natureChance: number;
  /** 出母 / 出公比例（种公缺口拿不到性别比例时按 1） */
  genderChance: number;
  /** 真实概率 = 性格概率 × 性别比例 */
  chance: number;
}

export interface GapFill {
  self: GapRoute | null;
  transfer: GapRoute | null;
  /**
   * 只能求助时**最好的真实概率**（母本：性格 × 出母）；
   * `null` = 手里根本没有这只蛋的母本，连求助线索都没有。
   */
  helpChance: number | null;
}

const EMPTY: GapFill = { self: null, transfer: null, helpChance: null };

/** 母本缺口：同一颗蛋在本号 / 别的号的建议里找「本号直配」和「跨号传蛋」。 */
export function findMotherGapFill(
  eggGameId: number,
  suggestions: ReadonlyMap<string, MotherNestAccount>,
  accounts: readonly string[],
): GapFill {
  let self: GapRoute | null = null;
  let transfer: GapRoute | null = null;
  let helpChance: number | null = null;

  for (const account of accounts) {
    const entry = suggestions.get(account);
    if (!entry) continue;

    if (!self) {
      const pairing = entry.pairings.find((item) => item.eggGameId === eggGameId);
      if (pairing) {
        self = {
          kind: 'self',
          account,
          mother: pairing.mother,
          father: pairing.father,
          recommendedNatures: pairing.recommendedNatures,
          natureChance: pairing.natureChance,
          genderChance: pairing.femaleChance,
          chance: pairing.motherGain,
        };
      }
    }

    if (!transfer) {
      const task = entry.tasks.find((item) => item.eggGameId === eggGameId);
      if (task) {
        transfer = {
          kind: 'transfer',
          account,
          sourceAccount: task.sourceAccount,
          mother: task.mother,
          father: task.father,
          recommendedNatures: task.recommendedNatures,
          natureChance: task.natureChance,
          genderChance: task.femaleChance,
          chance: task.chance,
        };
      }
    }

    const help = entry.helps.find((item) => item.eggGameId === eggGameId);
    if (help) {
      const chance = help.bestNatureChance * help.femaleChance;
      helpChance = helpChance == null ? chance : Math.max(helpChance, chance);
    }
  }

  if (!self && !transfer && helpChance == null) return EMPTY;
  return { self, transfer, helpChance };
}

/** 种公缺口的一格：蛋组 + 目标性格 + 档位 */
export interface StudGapKey {
  groupId: number;
  natureName: string;
  grade: PetGrade;
}

const matchesCell = (
  item: { groupIds: number[]; natureName: string; grade: PetGrade },
  cell: StudGapKey,
): boolean =>
  item.grade === cell.grade &&
  item.natureName === cell.natureName &&
  item.groupIds.includes(cell.groupId);

/**
 * 种公缺口：从配窝方案里找补这一格的线。
 *
 * - 本号直配 = 本号的方案里有这一格；跨号传蛋 = **别的号**的方案里有这一格
 *   （在别的号上配蛋、蛋传过来孵化，种公本身不能跨号搬）。
 * - 概率用 `natureChance`（拿到目标性格的概率）；缺口格没有物种性别比例，不再乘一层。
 */
export function findStudGapFill(
  cell: StudGapKey,
  plans: readonly NestPlan[],
  accounts: readonly string[],
): GapFill {
  let self: GapRoute | null = null;
  let transfer: GapRoute | null = null;

  const toRoute = (
    plan: NestPlan,
    pairing: NestPlan['pairings'][number],
    kind: 'self' | 'transfer',
  ): GapRoute => ({
    kind,
    account: plan.account,
    sourceAccount: kind === 'transfer' ? plan.account : undefined,
    mother: pairing.mother,
    father: pairing.father,
    recommendedNatures: [cell.natureName],
    natureChance: pairing.natureChance,
    genderChance: 1,
    chance: pairing.natureChance,
  });

  for (const account of accounts) {
    const plan = plans.find((item) => item.account === account);
    if (!plan) continue;
    if (!self) {
      const pairing = plan.pairings.find((item) => matchesCell(item, cell));
      if (pairing) self = toRoute(plan, pairing, 'self');
    }
  }
  // 跨号：别的号（不在当前选中里也算）的方案里有这一格，就算「传过来」
  for (const plan of plans) {
    if (transfer) break;
    if (accounts.includes(plan.account)) continue;
    const pairing = plan.pairings.find((item) => matchesCell(item, cell));
    if (pairing) {
      transfer = { ...toRoute(plan, pairing, 'transfer'), account: accounts[0] ?? plan.account };
    }
  }

  if (!self && !transfer) return EMPTY;
  return { self, transfer, helpChance: null };
}
