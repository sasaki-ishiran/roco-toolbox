import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CollectionPlanView } from '../../api/collectionGroups';
import {
  getPlanAlertBadge,
  planAlertCounts,
  publishPlanAlertBadge,
  readPlanAlertSeen,
  savePlanAlertSeen,
  subscribePlanAlertBadge,
} from './planAlertsStore';

const NOW = 1_790_000_000_000;

const plan = (over: Partial<CollectionPlanView> = {}): CollectionPlanView => ({
  id: 'p1',
  groupId: 'g1',
  memberAccountId: 'me',
  eggGameId: 3001,
  note: '',
  status: 'active',
  version: 1,
  createdAt: NOW - 10 * 86_400_000,
  updatedAt: NOW - 10 * 86_400_000,
  memberDisplayName: '我',
  progressStep: 1,
  needsConfirm: false,
  demands: [],
  offers: [],
  ...over,
});

const offer = (accountId: string, updatedAt: number) => ({
  offerAccountId: accountId,
  offerDisplayName: accountId,
  note: '',
  createdAt: updatedAt,
  updatedAt,
});

beforeEach(() => window.localStorage.clear());

describe('已读水位（本机）', () => {
  test('按账号 + 小组隔离；没记录按 0', () => {
    expect(readPlanAlertSeen('me', 'g1')).toBe(0);
    savePlanAlertSeen('me', 'g1', 1234);
    expect(readPlanAlertSeen('me', 'g1')).toBe(1234);
    expect(readPlanAlertSeen('other', 'g1')).toBe(0);
    expect(readPlanAlertSeen('me', 'g2')).toBe(0);
  });

  test('缺账号或小组时不读写', () => {
    savePlanAlertSeen(null, 'g1', 1234);
    savePlanAlertSeen('me', null, 1234);
    expect(readPlanAlertSeen(null, 'g1')).toBe(0);
  });
});

describe('提醒计数口径', () => {
  test('只算我发布的进行中计划：待确认 + 水位之后的新提供', () => {
    const counts = planAlertCounts(
      [
        plan({ id: 'a', progressStep: 4, needsConfirm: true, offers: [offer('B', NOW)] }),
        plan({ id: 'b', progressStep: 1, offers: [offer('C', NOW), offer('me', NOW)] }),
        plan({ id: 'c', progressStep: 1, offers: [offer('B', NOW - 1000)] }),
        // 想收 / 已完成 / 别人的计划都不算
        plan({ id: 'd', status: 'backlog', progressStep: 0, offers: [offer('B', NOW)] }),
        plan({ id: 'e', status: 'done', progressStep: 5, offers: [offer('B', NOW)] }),
        plan({ id: 'f', memberAccountId: 'B', progressStep: 4, needsConfirm: true }),
      ],
      'me',
      NOW - 100,
    );
    expect(counts).toEqual({ needsConfirm: 1, newOffers: 2, total: 3 });
  });

  test('没有身份时全为 0', () => {
    expect(planAlertCounts([plan({ needsConfirm: true, progressStep: 4 })], '', 0)).toEqual({
      needsConfirm: 0,
      newOffers: 0,
      total: 0,
    });
  });

  test('水位推进后旧提供不再算新', () => {
    const plans = [plan({ offers: [offer('B', NOW - 1000)] })];
    expect(planAlertCounts(plans, 'me', 0).newOffers).toBe(1);
    expect(planAlertCounts(plans, 'me', NOW).newOffers).toBe(0);
  });
});

describe('页签红点 store', () => {
  test('发布后订阅者收到通知，取值向下取整且忽略非法值', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlanAlertBadge(listener);
    publishPlanAlertBadge(3.8);
    expect(getPlanAlertBadge()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
    // 同值不重复通知
    publishPlanAlertBadge(3);
    expect(listener).toHaveBeenCalledTimes(1);
    publishPlanAlertBadge(Number.NaN);
    expect(getPlanAlertBadge()).toBe(0);
    subscribePlanAlertBadge(() => undefined)();
    unsubscribe();
    publishPlanAlertBadge(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
