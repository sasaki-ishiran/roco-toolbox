import { describe, expect, test } from 'vitest';
import { bodyMedalIcon, rarityIcon, voiceMedalIcon, voiceMedalIconByLabel, voiceMedalName } from './petIcons';

describe('petIcons', () => {
  test('体型奖牌按名字取图，普通体型没有图', () => {
    expect(bodyMedalIcon('大块头')).toBe('/ui/medals/1001.png');
    expect(bodyMedalIcon('小不点')).toBe('/ui/medals/1002.png');
    expect(bodyMedalIcon('')).toBeNull();
    expect(bodyMedalIcon(undefined)).toBeNull();
  });

  test('声音奖牌只在 ±100 两端有图', () => {
    expect(voiceMedalIcon(100)).toBe('/ui/medals/1026.png');
    expect(voiceMedalIcon(-100)).toBe('/ui/medals/1025.png');
    expect(voiceMedalIcon(96)).toBeNull();
    expect(voiceMedalName(100)).toBe('婉转声');
    expect(voiceMedalName(-100)).toBe('粗嗓门');
    expect(voiceMedalName(0)).toBeNull();
  });

  test('需求/目标里的声音字符串也能取图', () => {
    expect(voiceMedalIconByLabel('+100')).toBe('/ui/medals/1026.png');
    expect(voiceMedalIconByLabel('婉转声')).toBe('/ui/medals/1026.png');
    expect(voiceMedalIconByLabel('-100')).toBe('/ui/medals/1025.png');
    expect(voiceMedalIconByLabel('粗嗓门')).toBe('/ui/medals/1025.png');
    expect(voiceMedalIconByLabel('')).toBeNull();
    expect(voiceMedalIconByLabel('不挑')).toBeNull();
  });

  test('稀有度徽标：异色 / 炫彩 / 异色炫彩', () => {
    expect(rarityIcon('shiny')).toBe('/ui/rarity/shiny.png');
    expect(rarityIcon('colorful')).toBe('/ui/rarity/colorful.png');
    expect(rarityIcon('shiny-colorful')).toBe('/ui/rarity/shiny-colorful.png');
    expect(rarityIcon(null)).toBeNull();
    expect(rarityIcon('shiny-bw')).toBeNull();
  });
});
