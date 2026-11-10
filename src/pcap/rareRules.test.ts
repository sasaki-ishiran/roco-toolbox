import { describe, expect, test } from 'vitest';
import { isRare, kindsOf, rareAlertReason, rareAlertTitle, weightPercentile, type RareKind } from './rareRules';

const kind = (overrides: Partial<{
  mutation: number; glassType: number; weightPct: number | null; heightPct: number | null; voiceDb: number;
}> = {}) =>
  kindsOf({ mutation: 0, glassType: 0, weightPct: null, heightPct: null, voiceDb: 0, ...overrides });

describe('体重百分位', () => {
  test('区间内线性计算并夹取 0..100', () => {
    expect(weightPercentile({ weightKg: 4, lowKg: 3, highKg: 5 })).toBe(50);
    expect(weightPercentile({ weightKg: 2, lowKg: 3, highKg: 5 })).toBe(0);
    expect(weightPercentile({ weightKg: 6, lowKg: 3, highKg: 5 })).toBe(100);
  });
  test('区间无效时返回 null，不做除法兜底', () => {
    expect(weightPercentile({ weightKg: 4, lowKg: 5, highKg: 5 })).toBeNull();
    expect(weightPercentile({ weightKg: 4, lowKg: 5, highKg: 3 })).toBeNull();
    expect(weightPercentile({ weightKg: NaN, lowKg: 3, highKg: 5 })).toBeNull();
  });
});

describe('牌子判定', () => {
  test('异色 / 炫彩 / 污染位掩码', () => {
    expect(kind({ mutation: 1 })).toEqual<RareKind[]>(['shiny']);
    expect(kind({ mutation: 8 })).toEqual<RareKind[]>(['colorful']);
    expect(kind({ glassType: 1 })).toEqual<RareKind[]>(['colorful']);
    expect(kind({ mutation: 166 })).toEqual<RareKind[]>(['pollution']);
  });
  test('体型牌边界 98 / 2：体重与身高都要到顶 / 到底', () => {
    expect(kind({ weightPct: 97.9, heightPct: 100 })).toEqual<RareKind[]>([]);
    expect(kind({ weightPct: 98, heightPct: 100 })).toEqual<RareKind[]>(['big']);
    expect(kind({ weightPct: 100, heightPct: 97.9 })).toEqual<RareKind[]>([]);
    expect(kind({ weightPct: 2, heightPct: 0 })).toEqual<RareKind[]>(['small']);
    expect(kind({ weightPct: 2.1, heightPct: 0 })).toEqual<RareKind[]>([]);
    expect(kind({ weightPct: 0, heightPct: 2.1 })).toEqual<RareKind[]>([]);
  });
  test('缺身高区间不挂体型牌，不按体重单方面猜', () => {
    expect(kind({ weightPct: 100 })).toEqual<RareKind[]>([]);
    expect(kind({ weightPct: 0 })).toEqual<RareKind[]>([]);
  });
  test('回归：格兰花 7.76/7.80kg（体重 98.9%、身高 60%）不算大块头', () => {
    expect(kind({ weightPct: 98.88, heightPct: 60 })).toEqual<RareKind[]>([]);
    // 真正的大块头：身高体重双 100%
    expect(kind({ weightPct: 100, heightPct: 100 })).toEqual<RareKind[]>(['big']);
  });
  test('声音牌边界 96', () => {
    expect(kind({ voiceDb: 95 })).toEqual<RareKind[]>([]);
    expect(kind({ voiceDb: 96 })).toEqual<RareKind[]>(['high']);
    expect(kind({ voiceDb: -95 })).toEqual<RareKind[]>([]);
    expect(kind({ voiceDb: -96 })).toEqual<RareKind[]>(['low']);
  });
  test('只有任意一个牌子就算 rare', () => {
    expect(isRare(kind({ mutation: 1 }))).toBe(true);
    expect(isRare(kind())).toBe(false);
  });
});

describe('主动提醒判定', () => {
  test('±100dB 单独成立，文案只写分贝', () => {
    expect(rareAlertReason({ voiceDb: 100, kinds: kind({ voiceDb: 100 }) })).toBe('+100dB');
    expect(rareAlertReason({ voiceDb: -100, kinds: kind({ voiceDb: -100 }) })).toBe('-100dB');
  });
  test('96~99dB 必须叠加体重牌', () => {
    expect(rareAlertReason({ voiceDb: 99, kinds: kind({ voiceDb: 99 }) })).toBeNull();
    expect(rareAlertReason({ voiceDb: 99, kinds: kind({ voiceDb: 99, weightPct: 98, heightPct: 100 }) })).toBe('大块头 · +99dB');
    expect(rareAlertReason({ voiceDb: -99, kinds: kind({ voiceDb: -99, weightPct: 2, heightPct: 0 }) })).toBe('小不点 · -99dB');
  });
  test('只有体重牌或只有声音牌都不提醒', () => {
    expect(rareAlertReason({ voiceDb: 0, kinds: kind({ weightPct: 99, heightPct: 100 }) })).toBeNull();
    expect(rareAlertReason({ voiceDb: 97, kinds: kind({ voiceDb: 97 }) })).toBeNull();
  });
  test('±100dB 已经单独成立，不再重复叠加体重牌', () => {
    expect(rareAlertReason({ voiceDb: 100, kinds: kind({ voiceDb: 100, weightPct: 100, heightPct: 100 }) }))
      .toBe('+100dB');
  });
  test('多只时标题带数量', () => {
    expect(rareAlertTitle(1)).toBe('稀有精灵出现！');
    expect(rareAlertTitle(3)).toBe('稀有精灵 ×3');
  });
});
