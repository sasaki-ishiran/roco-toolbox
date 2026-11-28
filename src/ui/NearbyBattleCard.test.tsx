import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import type { SeasonEncounter } from '../collector/captureProgress';
import { getBattleTarget, resetBattleTargetForTest } from '../collector/battleTargetStore';
import { NearbyBattleCard } from './NearbyBattleCard';

const encounter: SeasonEncounter = {
  guardName: '龙棋士', rewardPetId: 3011, rewardName: '恶魔狼',
  level: 41, natureId: 4, natureConfirmed: true, nature: '勇敢',
  gender: '公', height: 180, weight: 82000, heightPct: 45, weightPct: 30, voiceDb: 14,
};

beforeEach(() => {
  window.localStorage.clear();
  resetBattleTargetForTest();
});

describe('战斗采集模块卡（NearbyBattleCard）', () => {
  test('没有奇遇战时也常驻显示，给等待提示与目标设置', () => {
    render(<NearbyBattleCard encounter={null} />);
    const card = screen.getByTestId('nearby-battle-card');
    expect(card.textContent).toContain('战斗 · 赛季奇遇');
    expect(card.textContent).toContain('进入赛季奇遇战后，这里会显示守卫的个体数据');
    expect(screen.getByTestId('battle-target-editor')).toBeTruthy();
  });

  test('有奇遇战时显示守卫个体数据（沿用奇遇卡口径）', () => {
    render(<NearbyBattleCard encounter={encounter} />);
    const detail = screen.getByTestId('battle-encounter-detail');
    expect(detail.textContent).toContain('赛季奇遇 · 恶魔狼');
    expect(detail.textContent).toContain('守卫 龙棋士');
    expect(detail.textContent).toContain('L41 · 公 · 勇敢');
    expect(detail.textContent).toContain('身高 1.80m（45%）');
    expect(detail.textContent).toContain('体重 82.00kg（30%）');
    expect(detail.textContent).toContain('声音 14dB');
  });

  test('还没拿到真实 petId 时不猜精灵名，显示守卫名', () => {
    render(<NearbyBattleCard encounter={{ ...encounter, rewardPetId: null, rewardName: '' }} />);
    const detail = screen.getByTestId('battle-encounter-detail');
    expect(detail.textContent).toContain('赛季奇遇 · 龙棋士');
    expect(detail.textContent).toContain('捕获后确认精灵');
  });

  test('没设目标时，有奇遇也不给命中/未命中标签', () => {
    render(<NearbyBattleCard encounter={encounter} />);
    expect(screen.queryByTestId('battle-target-hit')).toBeNull();
    expect(screen.queryByTestId('battle-target-miss')).toBeNull();
  });

  test('设了目标未命中显示「未命中」，命中显示「命中目标」', () => {
    render(<NearbyBattleCard encounter={encounter} />);
    // 在卡上选一个不匹配的性格 → 未命中
    fireEvent.click(screen.getByTestId('battle-target-nature'));
    fireEvent.click(screen.getByTestId('battle-target-nature-胆小'));
    expect(screen.getByTestId('battle-target-miss')).toBeTruthy();

    // 换成守卫真实性格 → 命中
    fireEvent.click(screen.getByTestId('battle-target-nature'));
    fireEvent.click(screen.getByTestId('battle-target-nature-勇敢'));
    expect(screen.getByTestId('battle-target-hit')).toBeTruthy();
  });

  test('在卡上选目标会写入 store：性格（多选）+ 声音（多选）+ 匹配方式', () => {
    render(<NearbyBattleCard encounter={encounter} />);
    // 性格：弹层多选，点「勇敢」和「胆小」都勾上（维度内取或）
    fireEvent.click(screen.getByTestId('battle-target-nature'));
    fireEvent.click(screen.getByTestId('battle-target-nature-勇敢'));
    fireEvent.click(screen.getByTestId('battle-target-nature-胆小'));
    // 声音：页内多选，勾「婉转声」
    fireEvent.click(screen.getByTestId('battle-target-voice'));
    fireEvent.click(screen.getByTestId('battle-target-voice-婉转声'));
    // 匹配方式：切到「全部满足」
    fireEvent.click(screen.getByRole('button', { name: '全部满足' }));

    expect(getBattleTarget().natures).toEqual(['勇敢', '胆小']);
    expect(getBattleTarget().voices).toEqual(['婉转声']);
    expect(getBattleTarget().mode).toBe('all');
  });

  test('声音目标有婉转声 / 粗嗓门与 ±100 四档，选 +100 后按 100dB 判定', () => {
    render(<NearbyBattleCard encounter={{ ...encounter, voiceDb: 96 }} />);
    fireEvent.click(screen.getByTestId('battle-target-voice'));
    fireEvent.click(screen.getByTestId('battle-target-voice-+100'));
    expect(getBattleTarget().voices).toEqual(['+100']);
    // 96dB 达到「婉转声」牌但没到 100dB 档 → 不命中
    expect(screen.getByTestId('battle-target-miss')).toBeTruthy();
  });

  test('声音多选：勾 ±100 两档，命中其中一档即算命中', () => {
    render(<NearbyBattleCard encounter={{ ...encounter, voiceDb: -100 }} />);
    fireEvent.click(screen.getByTestId('battle-target-voice'));
    fireEvent.click(screen.getByTestId('battle-target-voice-+100'));
    fireEvent.click(screen.getByTestId('battle-target-voice--100'));
    expect(getBattleTarget().voices).toEqual(['+100', '-100']);
    expect(screen.getByTestId('battle-target-hit')).toBeTruthy();
  });

  test('切换匹配方式改变命中判定（any 命中其一 / all 全都满足才算）', () => {
    render(<NearbyBattleCard encounter={encounter} />);
    // 设目标：性格「勇敢」+ 声音「婉转声」（守卫声音 14dB 不满足）
    fireEvent.click(screen.getByTestId('battle-target-nature'));
    fireEvent.click(screen.getByTestId('battle-target-nature-勇敢'));
    fireEvent.click(screen.getByTestId('battle-target-voice'));
    fireEvent.click(screen.getByTestId('battle-target-voice-婉转声'));
    // 满足其一：性格命中 → 命中
    expect(screen.getByTestId('battle-target-hit')).toBeTruthy();

    // 全部满足：性格命中但声音没中 → 不命中
    fireEvent.click(screen.getByRole('button', { name: '全部满足' }));
    expect(screen.getByTestId('battle-target-miss')).toBeTruthy();
  });
});
