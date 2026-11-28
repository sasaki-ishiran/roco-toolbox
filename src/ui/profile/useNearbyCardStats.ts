import { useMemo } from 'react';
import { battleTargetHit, useBattleTarget } from '../../collector/battleTargetStore';
import { useNearbySnapshot } from '../../collector/nearbyStore';
import { useNearbyTargets } from '../../nearby/nearbyTargetStore';

/**
 * 「我的」页附近卡的数据（2026-11-28 UX1 方案 A）。
 *
 * 全部来自**现有 store**：附近快照（`nearbyStore`）、蹲守名单、战斗目标；
 * 不新建状态，也不发起采集——卡只负责显示与入口。
 */
export interface NearbyCardStats {
  pets: number;
  rare: number;
  targets: number;
  /** 本场奇遇是否命中战斗目标（0/1） */
  hits: number;
  updatedAt: number | null;
}

export function useNearbyCardStats(): NearbyCardStats {
  const snapshot = useNearbySnapshot();
  const targets = useNearbyTargets();
  const battleTarget = useBattleTarget();

  return useMemo(() => {
    const pets = snapshot?.pets ?? [];
    return {
      pets: pets.length,
      rare: pets.filter((pet) => pet.rare).length,
      targets: targets.length,
      hits: snapshot?.encounter && battleTargetHit(battleTarget, snapshot.encounter) ? 1 : 0,
      updatedAt: snapshot?.updatedAt ?? null,
    };
  }, [snapshot, targets.length, battleTarget]);
}
