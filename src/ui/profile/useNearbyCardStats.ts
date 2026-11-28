import { useMemo } from 'react';
import { battleTargetHit, useBattleTarget } from '../../collector/battleTargetStore';
import { useNearbySnapshot } from '../../collector/nearbyStore';
import { useNearbyTargets } from '../../nearby/nearbyTargetStore';
import type { SeasonEncounter } from '../../collector/captureProgress';

/**
 * 「我的」页附近卡的数据（2026-11-28 UX1 方案 A）。
 *
 * 全部来自**现有 store**：附近快照（`nearbyStore`）、蹲守名单、战斗目标。
 * 一次采集同时产出附近与战斗两类结果，这里只读同一份快照，不触发解析。
 */
export interface NearbyCardStats {
  pets: number;
  rare: number;
  targets: number;
  /** 最近一场战斗守卫；没有则为 null */
  encounter: SeasonEncounter | null;
  /** 本场是否命中战斗目标 */
  hit: boolean;
  updatedAt: number | null;
}

export function useNearbyCardStats(): NearbyCardStats {
  const snapshot = useNearbySnapshot();
  const targets = useNearbyTargets();
  const battleTarget = useBattleTarget();

  return useMemo(() => {
    const pets = snapshot?.pets ?? [];
    const encounter = snapshot?.encounter ?? null;
    return {
      pets: pets.length,
      rare: pets.filter((pet) => pet.rare).length,
      targets: targets.length,
      encounter,
      hit: encounter != null && battleTargetHit(battleTarget, encounter),
      updatedAt: snapshot?.updatedAt ?? null,
    };
  }, [snapshot, targets.length, battleTarget]);
}
