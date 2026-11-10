import { describe, expect, test } from 'vitest';
import type { LiveNearbyPet } from '../collector/captureProgress';
import { createSelfEstimate, MAX_FRAME_SHIFT_M, updateSelfEstimate } from './selfOdometry';

const pet = (key: string, x: number, y: number): LiveNearbyPet => ({
  key, cfgId: 10000, petId: 3001, name: key, level: 10, voiceDb: 0,
  weightPct: 50, kinds: [], rare: false, alertReason: null, distanceM: null,
  pos: { x, y, z: 0 },
});

describe('自身位置里程计', () => {
  test('首帧用精灵几何中位数初始化中心', () => {
    const state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000);
    expect(state.session).toBe('s1');
    expect(state.self).toEqual({ x: 0, y: 100 });
  });

  test('精灵整体北移 → 玩家南移，中心跟着走', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000);
    // 玩家向北走 1 米（100 单位）：所有精灵的世界坐标相对玩家看起来南移 100
    state = updateSelfEstimate(state, 's1', [pet('a', 0, -100), pet('b', 0, 100)], 2000);
    expect(state.self).toEqual({ x: 0, y: 200 });
  });

  test('只取两帧都存在的精灵计算位移', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000);
    // b 消失，新增 c；只有 a 可比对
    state = updateSelfEstimate(state, 's1', [pet('a', 100, 0), pet('c', 0, 500)], 2000);
    expect(state.self).toEqual({ x: -100, y: 100 });
  });

  test('视野内精灵整批换掉时用新一批精灵重新定位（否则走远后地图永远不动）', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000);
    // 玩家走远，旧精灵全部离开、新精灵在新位置附近出现：中心要跟到新区域
    state = updateSelfEstimate(state, 's1', [pet('x', 500000, 500000), pet('y', 500000, 500200)], 2000);
    expect(state.self).toEqual({ x: 500000, y: 500100 });
  });

  test('只有部分精灵换掉时仍按共同精灵算位移，不跳到新精灵中心', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000);
    state = updateSelfEstimate(state, 's1', [pet('a', -100, 0), pet('x', 900000, 900000)], 2000);
    expect(state.self).toEqual({ x: 100, y: 100 });
  });

  test('换会话重新初始化', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000);
    state = updateSelfEstimate(state, 's2', [pet('a', 500, 500)], 2000);
    expect(state.session).toBe('s2');
    expect(state.self).toEqual({ x: 500, y: 500 });
  });

  test('单帧位移过大（切场景 / 瞬移）时重新初始化而不是累加', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000);
    const jump = MAX_FRAME_SHIFT_M * 100 + 1000;
    state = updateSelfEstimate(state, 's1', [pet('a', jump, 0), pet('b', jump, 200)], 2000);
    expect(state.self).toEqual({ x: jump, y: 100 });
  });

  test('没有坐标的精灵不参与', () => {
    const noPos: LiveNearbyPet = { ...pet('n', 0, 0), pos: undefined };
    const state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 100, 100), noPos], 1000);
    expect(state.self).toEqual({ x: 100, y: 100 });
  });

  test('有真实 307 时以它为锚点，而不是用精灵中位数', () => {
    const state = updateSelfEstimate(
      createSelfEstimate(), 's1', [pet('a', 0, 0), pet('b', 0, 200)], 1000,
      { x: 5000, y: 6000 },
    );
    expect(state.self).toEqual({ x: 5000, y: 6000 });
    expect(state.anchor).toEqual({ x: 5000, y: 6000 });
  });

  test('新的 307 会重锚，里程计从新坐标继续', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1', [pet('a', 0, 0)], 1000, { x: 0, y: 0 });
    // 只换精灵不换 307：继续按位移走
    state = updateSelfEstimate(state, 's1', [pet('a', -100, 0)], 2000);
    expect(state.self).toEqual({ x: 100, y: 0 });
    // 传来新的 307：直接回到真实坐标
    state = updateSelfEstimate(state, 's1', [pet('a', -100, 0)], 3000, { x: 900, y: 900 });
    expect(state.self).toEqual({ x: 900, y: 900 });
    expect(state.anchorAt).toBe(3000);
  });

  test('换场景（会话键变化）时即使没有 307 也重新按精灵定位', () => {
    let state = updateSelfEstimate(createSelfEstimate(), 's1#10003', [pet('a', 0, 0)], 1000, { x: 0, y: 0 });
    state = updateSelfEstimate(state, 's1#20001', [pet('a', 800, 800)], 2000);
    expect(state.self).toEqual({ x: 800, y: 800 });
    expect(state.anchor).toBeNull();
  });
});
