import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ProfileHome } from './ProfileHome';
import { PROFILE_ACTIVE, PROFILE_CARDS_V3, PROFILE_STABLE_V1 } from './recipes';
import { makeCtx } from './testContext';
import type { SectionDef } from './types';

/**
 * 配方层（2026-11-28 UX1 方案 A）：页面 = 区块数组。
 * 这里验证三件事：默认配方顺序、无数据时的可达性、删块/换配方不炸。
 */
afterEach(cleanup);

describe('「我的」页配方（卡片化）', () => {
  test('有数据：身份 → 采集卡 → 蛋仓/小组 → 设置', () => {
    render(<ProfileHome ctx={makeCtx()} />);

    const home = screen.getByTestId('profile-home');
    expect(home.getAttribute('data-sections')).toBe('identity,collect,egg-group,settings');
    expect(screen.getByTestId('profile-egg-card')).toBeTruthy();
    expect(screen.getByTestId('profile-group-card')).toBeTruthy();
  });

  test('没有数据：身份 + 采集 + 设置（蛋仓/小组不出现，不重复空态）', () => {
    render(<ProfileHome ctx={makeCtx({ snapshots: [] })} />);

    expect(screen.getByTestId('profile-home').getAttribute('data-sections')).toBe(
      'identity,collect,settings',
    );
    expect(screen.queryByTestId('profile-egg-card')).toBeNull();
    expect(screen.queryByTestId('profile-group-card')).toBeNull();
  });

  test('区块 when=false 时不渲染、不占高度', () => {
    const hidden: SectionDef = {
      id: 'never',
      title: '永不显示',
      render: () => <div data-testid="should-not-render" className="h-96" />,
      when: () => false,
    };
    const { container } = render(
      <ProfileHome ctx={makeCtx()} recipe={[hidden]} />,
    );

    expect(screen.queryByTestId('should-not-render')).toBeNull();
    expect(screen.getByTestId('profile-home').getAttribute('data-sections')).toBe('');
    expect(container.querySelector('[data-testid="profile-home"]')?.children.length ?? 0).toBe(0);
  });

  test('任意子集都能渲染：空配方也不炸', () => {
    render(<ProfileHome ctx={makeCtx()} recipe={[]} />);
    expect(screen.getByTestId('profile-home')).toBeTruthy();
  });

  test('PROFILE_ACTIVE 指向卡片版；STABLE_V1 是不含附近卡的旧结构（一行回退）', () => {
    expect(PROFILE_ACTIVE).toBe(PROFILE_CARDS_V3);
    expect(PROFILE_STABLE_V1.map((section) => section.id)).toEqual([
      'identity',
      'collect',
      'egg-group',
      'settings',
    ]);
    expect(PROFILE_CARDS_V3.length).toBe(4);
    for (const section of PROFILE_CARDS_V3) {
      expect(typeof section.id).toBe('string');
      expect(typeof section.render).toBe('function');
      if (section.when !== undefined) expect(typeof section.when).toBe('function');
    }
  });

  test('删掉任意一个区块，页面仍渲染（可回退的最低保证）', () => {
    for (const drop of PROFILE_CARDS_V3) {
      const recipe = PROFILE_CARDS_V3.filter((section) => section.id !== drop.id);
      const { unmount } = render(<ProfileHome ctx={makeCtx()} recipe={recipe} />);
      expect(screen.getByTestId('profile-home')).toBeTruthy();
      unmount();
    }
    vi.clearAllMocks();
  });
});
