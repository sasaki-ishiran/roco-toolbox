import { describe, expect, test } from 'vitest';
import { species } from '../../data/catalog';
import { accountKeyOf } from '../../domain/parseBackup';
import { buildDemandPlacements } from '../../domain/demandPlacement';
import { applyEggAction } from '../../shared/eggWorkflow';
import { claimedItemsOf } from '../../ui/useClaimedDemands';
import { MOCK_GROUP_ID, MOCK_ME, createEggWorkflow } from './data';
import { mockSnapshots } from './home';

/**
 * 「接单上窝」伪本地的约束（2026-11-19）。
 *
 * 假数据最容易出的错不是「不好看」，而是**页面看起来有单、其实一行都排不上**：
 * 换蛋单的字段和家园的母本 / 种公对不上，接单上窝就只剩「排不上 / 暂无接单」。
 * 这里直接拿生产同一套映射（claimedItemsOf）和同一个分配算法验一遍。
 */
const state = createEggWorkflow();
const items = claimedItemsOf(state, MOCK_ME, { id: MOCK_GROUP_ID, name: '周末互换' }, 1);
const snapshots = mockSnapshots();

const legacyOf = items.filter((item) => !(item.placementLine ?? item.workflowTask?.line));
const fixedOf = items.filter((item) => item.placementLine ?? item.workflowTask?.line);
const instanceOf = (captureId: string): string => captureId.slice(captureId.lastIndexOf('_') + 1);

describe('接单上窝的假数据', () => {
  test('三张已接的单都能出现在家园（不会只剩「暂无接单」）', () => {
    expect(items).toHaveLength(3);
    expect(legacyOf).toHaveLength(1);
    expect(fixedOf).toHaveLength(2);
  });

  test('没选蛋线的那张单，在本机背包里真能排出母本 × 种公', () => {
    const result = buildDemandPlacements({
      demands: legacyOf.map((item) => ({
        groupId: item.groupId,
        groupName: item.groupName,
        demanderAccountId: item.demanderAccountId,
        eggGameId: item.eggGameId,
        nature: item.nature,
        gender: item.gender,
        body: item.body,
        voice: item.voice,
        claimedAt: item.updatedAt,
        version: item.version,
      })),
      snapshots,
      species,
    });
    expect(result.unassigned).toEqual([]);
    expect(result.placedCount).toBe(1);

    const placement = result.accounts.flatMap((account) => account.placements)[0];
    expect(placement).toBeTruthy();
    // 火花（母）× 阿米亚特（公）：同属石组，能出火花蛋
    expect(placement.mother.pet.gender).toBe('母');
    expect(placement.father.pet.gender).toBe('公');
    expect(placement.mother.pet.gameId).toBe(3003);
    expect(placement.father.pet.gameId).toBe(3014);
    expect(placement.accountKey).toBe(accountKeyOf(snapshots[0]));
  });

  test('排出来的母本 / 种公真会显示「已在家园」', () => {
    const mother = snapshots[0].pets.find((pet) => pet.gameId === 3003);
    const father = snapshots[0].pets.find((pet) => pet.gameId === 3014);
    const residents = new Set(
      (snapshots[0].home?.residents ?? []).map((resident) => resident.instanceId),
    );
    expect(mother?.captureId && residents.has(instanceOf(mother.captureId))).toBe(true);
    expect(father?.captureId && residents.has(instanceOf(father.captureId))).toBe(true);
  });

  test('两张已选蛋线的单，亲本实例号都能在对应账号的背包里找到', () => {
    for (const item of fixedOf) {
      const line = (item.placementLine ?? item.workflowTask?.line)!;
      const snapshot = snapshots.find((entry) => accountKeyOf(entry) === line.gameAccountKey);
      expect(snapshot, `找不到 ${line.gameAccountKey} 这张号`).toBeTruthy();
      const ids = new Set(snapshot!.pets.map((pet) => pet.captureId));
      expect(ids.has(line.motherId), `${line.motherId} 不在背包里`).toBe(true);
      expect(ids.has(line.fatherId), `${line.fatherId} 不在背包里`).toBe(true);
    }
  });

  test('勾「已上窝」在假后端里真能落：老单 / 我供蛋 / 对方回我三条路都通', () => {
    let state = createEggWorkflow();
    for (const id of ['trade-2', 'trade-3', 'trade-4']) {
      state = applyEggAction(state, MOCK_GROUP_ID, MOCK_ME, { type: 'place', id }, Date.now());
    }
    expect(state.trades.find((trade) => trade.id === 'trade-2')?.placed).toBe(true);
    expect(state.trades.find((trade) => trade.id === 'trade-3')?.placed).toBe(true);
    expect(state.trades.find((trade) => trade.id === 'trade-4')?.returnPlaced).toBe(true);
  });

  test('家园快照够家园页和接单上窝用：11 个窝、1 个学院小窝、住户与配对都能对上', () => {
    for (const snapshot of snapshots) {
      const home = snapshot.home;
      expect(home).toBeTruthy();
      expect(home!.nests).toHaveLength(11);
      expect(home!.nests.filter((nest) => nest.nestType === 'academy')).toHaveLength(1);
      expect(home!.residents.length).toBeGreaterThan(0);
      const residentIds = new Set(home!.residents.map((resident) => resident.instanceId));
      for (const couple of home!.layEggCouples) {
        const actorIds = new Set(home!.residents.map((resident) => resident.actorId));
        expect(actorIds.has(couple.femaleActorId)).toBe(true);
        for (const male of couple.maleActorIds) expect(actorIds.has(male)).toBe(true);
      }
      for (const nest of home!.nests) {
        for (const id of nest.residentIds) {
          expect(residentIds.has(id), `窝 ${nest.nestName} 指向了不存在的住户 ${id}`).toBe(true);
        }
      }
    }
  });
});
