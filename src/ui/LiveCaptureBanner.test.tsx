import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { CaptureAnalysis, LiveNearbyPet } from '../collector/captureProgress';
import { LiveCaptureBanner } from './LiveCaptureBanner';

const analysis: CaptureAnalysis = {
  fingerprint: 'a', hasGameTraffic: true, hasKey: true, hasProfile: true, accountCount: 1,
  boxes: 2, records: 8, missingRecords: 1, hasEggInventory: true, eggInventoryComplete: true,
  eggRecords: 3, completionCandidate: false, truncated: false, flowErrors: 0, stableWaitMs: 12000,
};
const nearby: LiveNearbyPet = {
  key: '12011305', cfgId: 10096, name: '护主犬', level: 37, voiceDb: -99,
  weightPct: 49, kinds: ['low'], rare: true, alertReason: null, distanceM: null,
};

describe('持续获取实时条', () => {
  test('显示精灵/盒子/蛋数量与已落盘体积', () => {
    render(<LiveCaptureBanner analysis={analysis} sourceBytes={1024 * 1024} />);
    expect(screen.getByText(/持续获取中/)).toBeTruthy();
    expect(screen.getByText('精灵 8 只 · 盒子 2 个 · 蛋 3 个')).toBeTruthy();
    expect(screen.getByText('1.00 MiB')).toBeTruthy();
  });

  test('还没有解析结果时不丢标题，数量显示 0', () => {
    render(<LiveCaptureBanner analysis={null} sourceBytes={0} />);
    expect(screen.getByText('精灵 0 只 · 盒子 0 个 · 蛋 0 个')).toBeTruthy();
  });

  test('有附近精灵时展示名称/等级/牌子与稀有数量', () => {
    render(<LiveCaptureBanner analysis={{ ...analysis, nearbyPets: 1, nearby: [nearby] }} sourceBytes={0} />);
    expect(screen.getByText(/附近 1 只（稀有 1）/)).toBeTruthy();
    expect(screen.getByText(/护主犬 37级/)).toBeTruthy();
    expect(screen.getByText(/粗嗓门/)).toBeTruthy();
  });

  test('可提醒的精灵标记出来', () => {
    render(<LiveCaptureBanner analysis={{ ...analysis, nearbyPets: 1, nearby: [{ ...nearby, alertReason: '-100dB 粗嗓门' }] }} sourceBytes={0} />);
    expect(screen.getByText('可提醒')).toBeTruthy();
  });
});
