import { expect, test } from 'vitest';
import { formatEggObtainedAt, formatEggObtainedAtFull } from './eggTime';

test('蛋仓卡片时间按本地时区显示到分钟', () => {
  // 不带时区的字符串按本机时区解析，断言不会随运行环境漂移。
  expect(formatEggObtainedAt('2026-11-17T22:31:00')).toBe('11-17 22:31');
  expect(formatEggObtainedAt('2026-01-02T03:04:00')).toBe('01-02 03:04');
});

test('详情时间显示完整年月日与分钟', () => {
  expect(formatEggObtainedAtFull('2026-11-17T22:31:00')).toBe('2026-11-17 22:31');
});

test('缺失或非法时间返回空串，不编造采集时间', () => {
  expect(formatEggObtainedAt(undefined)).toBe('');
  expect(formatEggObtainedAt(null)).toBe('');
  expect(formatEggObtainedAt('')).toBe('');
  expect(formatEggObtainedAt('不是时间')).toBe('');
  expect(formatEggObtainedAtFull('')).toBe('');
  expect(formatEggObtainedAtFull('不是时间')).toBe('');
});
