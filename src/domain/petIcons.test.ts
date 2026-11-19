import { describe, expect, test } from 'vitest';
import {
  bodyMedalIcon,
  bodyMedalIconByLabel,
  petBodyMedalIcon,
  petVoiceMedalIcon,
  rarityIcon,
  voiceMedalIcon,
  voiceMedalIconByLabel,
  voiceMedalName,
} from './petIcons';

describe('petIcons', () => {
  test('体型奖牌按名字取图，普通体型没有图', () => {
    expect(bodyMedalIcon('大块头')).toBe('/ui/medals/1001.png');
    expect(bodyMedalIcon('小不点')).toBe('/ui/medals/1002.png');
    expect(bodyMedalIcon('')).toBeNull();
    expect(bodyMedalIcon(undefined)).toBeNull();
  });

  test('体型目标的满分档换 MAX / MIN 图（2026-11-01）', () => {
    expect(bodyMedalIconByLabel('满体重')).toBe('/ui/medals/1001-max.png');
    expect(bodyMedalIconByLabel('零体重')).toBe('/ui/medals/1002-min.png');
    expect(bodyMedalIconByLabel('大块头')).toBe('/ui/medals/1001.png');
    expect(bodyMedalIconByLabel('小不点')).toBe('/ui/medals/1002.png');
    expect(bodyMedalIconByLabel('')).toBeNull();
  });

  test('声音奖牌只在 ±100 两端有图', () => {
    expect(voiceMedalIcon(100)).toBe('/ui/medals/1026.png');
    expect(voiceMedalIcon(-100)).toBe('/ui/medals/1025.png');
    expect(voiceMedalIcon(96)).toBeNull();
    expect(voiceMedalName(100)).toBe('婉转声');
    expect(voiceMedalName(-100)).toBe('粗嗓门');
    expect(voiceMedalName(0)).toBeNull();
  });

  test('需求/目标里的声音字符串也能取图：满分档带 MAX 缎带', () => {
    expect(voiceMedalIconByLabel('+100')).toBe('/ui/medals/1026-max.png');
    expect(voiceMedalIconByLabel('-100')).toBe('/ui/medals/1025-max.png');
    expect(voiceMedalIconByLabel('婉转声')).toBe('/ui/medals/1026.png');
    expect(voiceMedalIconByLabel('粗嗓门')).toBe('/ui/medals/1025.png');
    expect(voiceMedalIconByLabel('')).toBeNull();
    expect(voiceMedalIconByLabel('不挑')).toBeNull();
  });

  test('精灵本体的奖牌：满体重 / 零体重 / 满声音换 MAX / MIN 图（2026-11-01）', () => {
    expect(petBodyMedalIcon('大块头', 100)).toBe('/ui/medals/1001-max.png');
    expect(petBodyMedalIcon('大块头', 99.5)).toBe('/ui/medals/1001.png');
    expect(petBodyMedalIcon('小不点', 0)).toBe('/ui/medals/1002-min.png');
    expect(petBodyMedalIcon('小不点', 2)).toBe('/ui/medals/1002.png');
    // 缺体重数据时退回普通奖牌，不猜满分
    expect(petBodyMedalIcon('大块头', undefined)).toBe('/ui/medals/1001.png');
    expect(petBodyMedalIcon('', 100)).toBeNull();

    expect(petVoiceMedalIcon(100)).toBe('/ui/medals/1026-max.png');
    expect(petVoiceMedalIcon(-100)).toBe('/ui/medals/1025-max.png');
    // 双牌档（≥96 / ≤-96）也有奖牌，只是不带 MAX 缎带（2026-11-17 用户口径）
    expect(petVoiceMedalIcon(96)).toBe('/ui/medals/1026.png');
    expect(petVoiceMedalIcon(99)).toBe('/ui/medals/1026.png');
    expect(petVoiceMedalIcon(-96)).toBe('/ui/medals/1025.png');
    expect(petVoiceMedalIcon(95)).toBeNull();
    expect(petVoiceMedalIcon(-95)).toBeNull();
  });

  test('稀有度徽标：异色 / 炫彩 / 异色炫彩', () => {
    expect(rarityIcon('shiny')).toBe('/ui/rarity/shiny.png');
    expect(rarityIcon('colorful')).toBe('/ui/rarity/colorful.png');
    expect(rarityIcon('shiny-colorful')).toBe('/ui/rarity/shiny-colorful.png');
    expect(rarityIcon(null)).toBeNull();
    expect(rarityIcon('shiny-bw')).toBeNull();
  });
});
