import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { GapFillDialog, type GapTargetView } from './GapFillDialog';
import type { GapFill, GapRoute } from '../domain/gapFill';
import type { NestPet } from '../domain/nestPlan';

const pet = (key: string, name: string, gender: '公' | '母', account = '昭昭'): NestPet => ({
  key,
  gameId: 3002,
  name,
  account,
  gender,
  nature: '大胆',
  voiceDb: 100,
  medalBody: '大块头',
  heightPercent: 100,
  weightPercent: 100,
  box: `${account} · 盒子 03 第 1 位`,
});

const route = (over: Partial<GapRoute> = {}): GapRoute => ({
  kind: 'self',
  account: '昭昭',
  mother: pet('m', '水蓝蓝', '母'),
  father: pet('f', '果冻', '公'),
  recommendedNatures: ['聪明'],
  natureChance: 0.3,
  genderChance: 1,
  chance: 0.3,
  ...over,
});

const target: GapTargetView = {
  kind: 'mother',
  name: '水蓝蓝',
  number: '008',
  gameId: 3002,
  natures: ['聪明'],
  eggGroupLabels: ['魔力组'],
  tag: '未收集',
  targetLabel: '目标 满分大婉',
  bodyMedal: '大块头',
  voiceTarget: '+100',
  voiceDb: 100,
  weightPercent: 100,
};

const emptyFill: GapFill = { self: null, transfer: null, helpChance: null };

describe('GapFillDialog', () => {
  test('没选中目标时不渲染', () => {
    const { container } = render(
      <GapFillDialog target={null} fill={null} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('母本缺口：标题、目标卡、求助卡与两段路线都画出来', () => {
    render(
      <GapFillDialog
        target={target}
        fill={{ ...emptyFill, self: route(), transfer: route({ kind: 'transfer', sourceAccount: '云舟' }) }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('gap-fill-eyebrow').textContent).toBe('母本缺口 · 怎么补');
    expect(screen.getByRole('dialog', { name: '怎么补' })).toBeTruthy();
    expect(screen.getByTestId('gap-target-card')).toBeTruthy();
    expect(screen.getByTestId('gap-target-tag').textContent).toBe('未收集');
    // 体型用普通大块头奖牌；MAX 缎带是「极限」那一档的图，目标卡不能标成极限
    expect(
      within(screen.getByTestId('gap-target-card')).getByAltText('大块头'),
    ).toHaveAttribute('src', '/ui/medals/1001.png');
    // 追满分的声音目标（+100）才用 MAX 缎带
    expect(
      within(screen.getByTestId('gap-target-card')).getByTitle('婉转声'),
    ).toHaveAttribute('src', '/ui/medals/1026-max.png');
    // 已有两条线 → 求助卡写「已有 2 条 30% 的线」
    expect(screen.getByTestId('gap-help-main').textContent).toBe('已有 2 条 30% 的线');
    expect(screen.getByTestId('gap-route-self')).toBeTruthy();
    expect(screen.getByTestId('gap-route-transfer')).toBeTruthy();
    expect(screen.getByTestId('gap-route-flow').textContent).toBe('云舟 → 昭昭');
    expect(screen.queryByTestId('gap-unpairable')).toBeNull();
  });

  test('两张卡等宽铺满一行，不再给求助卡留右边空位（母本 / 种公两条复用线同一套）', () => {
    const { unmount } = render(
      <GapFillDialog target={target} fill={emptyFill} onClose={() => {}} />,
    );
    const row = screen.getByTestId('gap-top-row');
    expect(row).toHaveClass('grid-cols-2');
    // 两张卡都吃满各自那一列：宽度必须一样，且不能有 max-w 把整行截短（网页宽屏会留一大块空位）
    expect(row).not.toHaveClass('max-w-[326px]');
    expect(screen.getByTestId('gap-target-card')).toHaveClass('w-full');
    expect(screen.getByTestId('gap-help-card')).toHaveClass('w-full');
    expect(screen.getByTestId('gap-target-card')).not.toHaveClass('max-w-[160px]');
    expect(screen.getByTestId('gap-help-card')).not.toHaveClass('max-w-[160px]');
    unmount();

    render(
      <GapFillDialog
        target={{ ...target, kind: 'stud', tag: '推荐' }}
        fill={emptyFill}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('gap-top-row')).toHaveClass('grid-cols-2');
    expect(screen.getByTestId('gap-help-card')).toHaveClass('w-full');
  });

  test('声音奖牌按目标档位取图：满分大粗用 -100 的 MAX 图，追双牌用普通婉转声', () => {
    const { unmount } = render(
      <GapFillDialog
        target={{ ...target, targetLabel: '目标 满分大粗', voiceTarget: '-100', voiceDb: -100 }}
        fill={emptyFill}
        onClose={() => {}}
      />,
    );
    expect(
      within(screen.getByTestId('gap-target-card')).getByTitle('粗嗓门'),
    ).toHaveAttribute('src', '/ui/medals/1025-max.png');
    unmount();

    render(
      <GapFillDialog
        target={{ ...target, targetLabel: '目标 大婉', voiceTarget: '婉转声', voiceDb: null }}
        fill={emptyFill}
        onClose={() => {}}
      />,
    );
    // 追双牌不保证 ±100，用普通奖牌图，不能画成满声 MAX
    expect(
      within(screen.getByTestId('gap-target-card')).getByTitle('婉转声'),
    ).toHaveAttribute('src', '/ui/medals/1026.png');
  });

  test('两段都补不了 → 红框写「本号、跨号都无法配对」，不再画空框', () => {
    render(<GapFillDialog target={target} fill={emptyFill} onClose={() => {}} />);
    expect(screen.getByTestId('gap-unpairable').textContent).toContain('本号、跨号都无法配对');
    // 红框宽度跟文本、水平居中对齐到上面两张卡的正下方
    expect(screen.getByTestId('gap-unpairable')).toHaveClass('mx-auto', 'w-fit');
    expect(screen.queryByTestId('gap-route-self')).toBeNull();
    expect(screen.queryByTestId('gap-route-missing')).toBeNull();
  });

  test('没选目标奖牌时不写「都无法配对」，改成提示先选目标', () => {
    render(
      <GapFillDialog target={target} fill={emptyFill} onClose={() => {}} targetReady={false} />,
    );
    expect(screen.getByTestId('gap-need-target').textContent).toContain('先在目标里选体型与声音奖牌');
    expect(screen.queryByTestId('gap-unpairable')).toBeNull();
  });

  test('少一截时给虚框：缺本号写「无对应母本」，缺跨号写「别的号也没有过线的配法」', () => {
    const { unmount } = render(
      <GapFillDialog target={target} fill={{ ...emptyFill, self: route() }} onClose={() => {}} />,
    );
    expect(screen.getAllByTestId('gap-route-missing')).toHaveLength(1);
    expect(screen.getByTestId('gap-route-missing').textContent).toContain('别的号也没有过线的配法');
    expect(screen.queryByTestId('gap-unpairable')).toBeNull();
    unmount();

    render(
      <GapFillDialog
        target={target}
        fill={{ ...emptyFill, transfer: route({ kind: 'transfer', sourceAccount: '云舟' }) }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('gap-route-missing').textContent).toContain('无对应母本');
  });

  test('只能求助时求助卡写对性母概率', () => {
    render(
      <GapFillDialog target={target} fill={{ ...emptyFill, helpChance: 0.12 }} onClose={() => {}} />,
    );
    expect(screen.getByTestId('gap-help-main').textContent).toBe('对性母 12%');
  });

  test('种公缺口：eyebrow 与目标卡状态跟着变', () => {
    render(
      <GapFillDialog
        target={{ ...target, kind: 'stud', tag: '缺口', natures: ['固执'] }}
        fill={{ ...emptyFill, self: route({ chance: 0.6 }) }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('gap-fill-eyebrow').textContent).toBe('种公缺口 · 怎么补');
    expect(screen.getByTestId('gap-target-tag').textContent).toBe('缺口');
    expect(screen.getByTestId('gap-route-chance').textContent).toBe('60%');
  });

  test('关闭按钮 / 遮罩 / Esc 都能关；加入配窝建议走自己的回调', () => {
    const onClose = vi.fn();
    const onAddToPlan = vi.fn();
    render(
      <GapFillDialog
        target={target}
        fill={{ ...emptyFill, self: route() }}
        onClose={onClose}
        onAddToPlan={onAddToPlan}
      />,
    );
    fireEvent.click(screen.getByTestId('gap-add-to-plan'));
    expect(onAddToPlan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('gap-fill-close'));
    fireEvent.click(screen.getByTestId('gap-fill-backdrop'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
