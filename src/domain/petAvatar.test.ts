import { describe, expect, test } from 'vitest';
import { petAvatarUrl } from './petAvatar';

describe('petAvatarUrl', () => {
  test('按 gameId 拼官方 CDN 头像地址', () => {
    expect(petAvatarUrl(3001)).toBe(
      'https://game.gtimg.cn/images/rocom/rocodata/jingling/3001/icon.png',
    );
  });

  test('异色档取 icon_yise.png', () => {
    expect(petAvatarUrl(3001, 'shiny')).toBe(
      'https://game.gtimg.cn/images/rocom/rocodata/jingling/3001/icon_yise.png',
    );
  });

  test('非法或缺失的 gameId 返回 null', () => {
    expect(petAvatarUrl(undefined)).toBeNull();
    expect(petAvatarUrl(null)).toBeNull();
    expect(petAvatarUrl(0)).toBeNull();
    expect(petAvatarUrl(Number.NaN)).toBeNull();
  });
});
