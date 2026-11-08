import { describe, expect, test } from 'vitest';
import type { CollectionPlanView } from '../../api/collectionGroups';
import type { SpeciesEntry } from '../../domain/types';
import {
  formatPlanConditions,
  planBarSegments,
  planConditions,
  planPills,
  planProgressText,
  planReason,
  planStaleDays,
  sortPlansForMe,
} from './planCardModel';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_790_000_000_000;

const plan = (over: Partial<CollectionPlanView> = {}): CollectionPlanView => ({
  id: 'p1',
  groupId: 'g1',
  memberAccountId: 'me',
  eggGameId: 3001,
  note: '',
  status: 'active',
  version: 1,
  createdAt: NOW - 10 * DAY,
  updatedAt: NOW - 10 * DAY,
  memberDisplayName: '我',
  progressStep: 1,
  needsConfirm: false,
  demands: [],
  offers: [],
  ...over,
});

const demand = (
  over: Partial<CollectionPlanView['demands'][number]> = {},
): CollectionPlanView['demands'][number] => ({
  nature: '固执',
  gender: '母',
  body: '大块头',
  voice: '+100',
  status: 'open',
  claimerAccountId: null,
  placedAt: null,
  ...over,
});

const nameOf = (accountId: string) => (accountId === 'me' ? '我' : '阿乙');

describe('我的收集排序', () => {
  test('待我确认 > 待接单 > 已认领/已上窝 > 无进展 > 想收 > 已完成', () => {
    const ordered = sortPlansForMe([
      plan({ id: 'done', status: 'done', progressStep: 5 }),
      plan({ id: 'backlog', status: 'backlog', progressStep: 0 }),
      plan({ id: 'idle', progressStep: 0 }),
      plan({ id: 'claimed', progressStep: 2 }),
      plan({ id: 'placed', progressStep: 3 }),
      plan({ id: 'open', progressStep: 1 }),
      plan({ id: 'confirm', progressStep: 4, needsConfirm: true }),
    ]).map((item) => item.id);
    expect(ordered).toEqual([
      'confirm',
      'open',
      'claimed',
      'placed',
      'idle',
      'backlog',
      'done',
    ]);
  });

  test('同一档按最近更新在前，再按蛋 id 升序', () => {
    const ordered = sortPlansForMe([
      plan({ id: 'old', eggGameId: 3001, updatedAt: NOW - 5 * DAY }),
      plan({ id: 'new', eggGameId: 3002, updatedAt: NOW - DAY }),
      plan({ id: 'same-a', eggGameId: 3003, updatedAt: NOW - DAY }),
      plan({ id: 'same-b', eggGameId: 3004, updatedAt: NOW - DAY }),
    ]).map((item) => item.id);
    expect(ordered).toEqual(['new', 'same-a', 'same-b', 'old']);
  });
});

describe('停留天数（stale）', () => {
  test('进行中停满阈值才算；想收 / 已完成不算', () => {
    expect(planStaleDays(plan({ updatedAt: NOW - 10 * DAY }), NOW)).toBe(10);
    expect(planStaleDays(plan({ updatedAt: NOW - DAY }), NOW)).toBe(0);
    expect(planStaleDays(plan({ updatedAt: NOW - 2 * DAY }), NOW)).toBe(2);
    expect(planStaleDays(plan({ status: 'backlog', updatedAt: NOW - 10 * DAY }), NOW)).toBe(0);
    expect(planStaleDays(plan({ status: 'done', updatedAt: NOW - 10 * DAY }), NOW)).toBe(0);
  });

  test('角标区分「没人接」和「没上窝」；等确认时不再提醒', () => {
    expect(
      planPills(plan({ updatedAt: NOW - 3 * DAY, demands: [demand()] }), 'me', NOW),
    ).toContainEqual({ text: '3 天没人接', tone: 'amber' });
    expect(
      planPills(
        plan({
          updatedAt: NOW - 3 * DAY,
          demands: [demand({ status: 'claimed', claimerAccountId: 'B' })],
        }),
        'me',
        NOW,
      ),
    ).toContainEqual({ text: '3 天没上窝', tone: 'amber' });
    expect(
      planPills(
        plan({
          progressStep: 4,
          needsConfirm: true,
          updatedAt: NOW - 3 * DAY,
          demands: [demand({ status: 'claimed', claimerAccountId: 'B', placedAt: NOW - 3 * DAY })],
        }),
        'me',
        NOW,
      ),
    ).toEqual([]);
  });

  test('别人愿意提供时给「N 人可提供」，自己的提供不算', () => {
    const pills = planPills(
      plan({
        updatedAt: NOW,
        offers: [
          { offerAccountId: 'B', offerDisplayName: '阿乙', note: '', createdAt: 1, updatedAt: 1 },
          { offerAccountId: 'me', offerDisplayName: '我', note: '', createdAt: 1, updatedAt: 1 },
        ],
      }),
      'me',
      NOW,
    );
    expect(pills).toEqual([{ text: '1 人可提供', tone: 'green' }]);
  });
});

describe('卡面五段进度映射', () => {
  test('第 1~4 步逐段点亮，第 5 步全亮', () => {
    expect(planBarSegments(plan({ progressStep: 1 }))).toEqual([
      'current',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
    expect(planBarSegments(plan({ progressStep: 2 }))).toEqual([
      'done',
      'current',
      'todo',
      'todo',
      'todo',
    ]);
    expect(planBarSegments(plan({ progressStep: 3 }))).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ]);
    expect(planBarSegments(plan({ progressStep: 4, needsConfirm: true }))).toEqual([
      'done',
      'done',
      'done',
      'current',
      'todo',
    ]);
    expect(planBarSegments(plan({ progressStep: 5 }))).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(planBarSegments(plan({ status: 'done', progressStep: 5 }))).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  test('想收 / 还没发需求时五段都不亮', () => {
    expect(planBarSegments(plan({ status: 'backlog', progressStep: 0 }))).toEqual([
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
    expect(planBarSegments(plan({ progressStep: 0 }))).toEqual([
      'todo',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
  });

  test('认领人视角停在 3 时「已上窝」那段亮；发布人看到第 4 段', () => {
    const claimerView = plan({ progressStep: 3, needsConfirm: false });
    expect(planBarSegments(claimerView)[2]).toBe('current');
    expect(planBarSegments(claimerView)[3]).toBe('todo');
    expect(planProgressText(claimerView)).toBe('已上窝 · 等发布人确认');

    const ownerView = plan({ progressStep: 4, needsConfirm: true });
    expect(planBarSegments(ownerView)[3]).toBe('current');
    expect(planProgressText(ownerView)).toBe('等你确认收货');
  });
});

describe('卡面理由', () => {
  test('已上窝：发布人看到「等你确认」，其他人只看到「等发布人结单」', () => {
    const placed = plan({
      memberAccountId: 'me',
      demands: [demand({ status: 'claimed', claimerAccountId: 'B', placedAt: NOW - DAY })],
    });
    expect(planReason(placed, 'me', nameOf, NOW)).toEqual({
      text: '阿乙 已上窝 · 等你确认',
      tone: 'amber',
    });
    expect(planReason(placed, 'C', nameOf, NOW)).toEqual({
      text: '阿乙 已上窝 · 等发布人结单',
      tone: 'sky',
    });
  });

  test('已认领只说谁接的，天数交给角标', () => {
    const claimed = plan({
      updatedAt: NOW - 10 * DAY,
      demands: [demand({ status: 'claimed', claimerAccountId: 'B' })],
    });
    expect(planReason(claimed, 'me', nameOf, NOW)).toEqual({ text: '阿乙 已认领', tone: 'sky' });
  });
});

describe('卡面条件行（想收不许空白）', () => {
  const species = [
    {
      gameId: 3001,
      eggGameId: 3001,
      name: '喵喵',
      eggRecommendedNatures: ['固执', '保守'],
    },
  ] as unknown as SpeciesEntry[];

  test('想收没有需求：用口径默认值，性格用这颗蛋的目标性格', () => {
    const conditions = planConditions(plan({ status: 'backlog', demands: [] }), { species });
    expect(formatPlanConditions(conditions)).toBe('♀ · 大块头 · +100');
    expect(conditions.natures).toEqual(['固执', '保守']);
  });

  test('没有推荐性格也不空白：条件行仍有口径默认值', () => {
    const conditions = planConditions(plan({ status: 'backlog', eggGameId: 9999, demands: [] }), {
      species,
    });
    expect(conditions.natures).toEqual([]);
    expect(formatPlanConditions(conditions)).toBe('♀ · 大块头 · +100');
  });

  test('已有需求：条件行跟着需求走，性格取需求行', () => {
    const conditions = planConditions(
      plan({
        demands: [
          demand({ gender: '公', body: '小不点', voice: '粗嗓门', nature: '胆小' }),
          demand({ nature: '开朗' }),
        ],
      }),
      { species },
    );
    expect(formatPlanConditions(conditions)).toBe('♂ · 小不点 · 粗嗓门');
    expect(conditions.natures).toEqual(['胆小', '开朗']);
  });

  test('空口径显示「不限」，不会渲染成空串', () => {
    expect(formatPlanConditions({ gender: '', body: '', voice: '' })).toBe('不限 · 不限 · 不限');
  });
});
