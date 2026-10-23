import { describe, expect, test } from 'vitest';
import decoderCatalog from '../pcap-decoder/tools/pcap-json-app/src/generated/catalog.json';
import { species, CATALOG_VERSION } from '../data/catalog';
import { parseBackup } from '../domain/parseBackup';
import { buildMotherResource } from '../domain/motherResource';
import { resolveBodySize, bodyMedalOf } from '../shared/bodySize.js';

type BuildBackpack = (records: unknown[], meta: Record<string, unknown>) => {
  payload: { collections: { petBackpack: { items: Record<string, unknown>[] } } };
};

const decodePet = async (id: number, grams: number, shiny = true) => {
  const decoder = await import('../pcap-decoder/tools/pcap-json-app/src/core');
  const build = Reflect.get(decoder, 'buildBackpack') as BuildBackpack;
  return build([{
    instance_id: 'body-regression',
    int_fields: { '15': [id], '8': [2], '27': [grams], '93': [100], '98': [Number(shiny)] },
    byte_fields: {},
  }], { gameId: 1001, playerName: '体型回归' }).payload;
};

describe('成体体型解析到母本共享', () => {
  test('图鉴内每个可孵物种都有成体体型数据，新增物种不能静默漏算', () => {
    const breedable = species.filter((entry) => entry.eggGameId != null);
    expect(breedable.length).toBeGreaterThan(0);
    for (const entry of breedable) {
      expect(entry.bodySize, `${entry.name}(${entry.gameId})`).toBeDefined();
      expect(entry.bodySize!.small).toBeGreaterThan(0);
      expect(entry.bodySize!.big).toBeGreaterThan(entry.bodySize!.small);
    }
  });

  test('补算阈值不会覆盖已有的专用阈值，包括与区间不同的特殊形态', () => {
    for (const entry of decoderCatalog.pets) {
      if (entry.adultSmallWeight == null || entry.adultBigWeight == null) continue;
      expect(resolveBodySize(entry)).toEqual({ small: entry.adultSmallWeight, big: entry.adultBigWeight });
    }
  });

  test('体重或区间缺失、非法时保持无法判定，不将其误认成小不点', () => {
    for (const weight of ['', '未知', '0~2KG', '3~1KG', '1~1KG']) {
      expect(resolveBodySize({ weight })).toBeNull();
    }
    const size = resolveBodySize({ weight: '1~2.9KG' });
    for (const weight of [0, -1, NaN, Infinity, undefined, null]) {
      expect(bodyMedalOf(size, weight)).toBe('');
    }
    expect(bodyMedalOf(null, 2.9)).toBe('');
  });

  test.each([false, true])('布灵及进化形态不会因异色=%s 漏掉达标母本', async (shiny) => {
    for (const [id, grams] of [[3775, 2862], [3776, 6632]]) {
      const payload = await decodePet(id, grams, shiny);
      expect(payload.collections.petBackpack.items[0].medalBody).toBe('大块头');
      const snapshot = parseBackup(payload, '2026-10-24T00:00:00.000Z');
      const resource = buildMotherResource({ snapshots: [snapshot], selectedAccountKeys: ['uid:1001'], species, catalogVersion: CATALOG_VERSION });
      expect(resource.accounts[0].eggGameIds).toContain(3775);
    }
  });

  test('所有缺专用阈值但有成体体重区间的物种都能判定大小体型', async () => {
    const entries = decoderCatalog.pets.filter((entry) => entry.petId > 0 && entry.adultBigWeight == null && /^\d+(\.\d+)?~\d+(\.\d+)?KG$/.test(entry.weight));
    expect(entries.some((entry) => entry.petId === 3775)).toBe(true);
    for (const entry of entries) {
      const [min, max] = entry.weight.replace('KG', '').split('~').map(Number);
      if (min <= 0 || max <= min) continue;
      const big = await decodePet(entry.petId, Math.floor(max * 1000));
      const small = await decodePet(entry.petId, Math.ceil(min * 1000));
      expect(big.collections.petBackpack.items[0].medalBody, `${entry.name}大块头`).toBe('大块头');
      expect(small.collections.petBackpack.items[0].medalBody, `${entry.name}小不点`).toBe('小不点');
    }
  });

  test.each([[2861, ''], [2862, '大块头'], [1038, '小不点'], [1039, ''], [0, '']])('布灵 %s 克的边界判定为 %s', async (grams, expected) => {
    const payload = await decodePet(3775, grams as number);
    expect(payload.collections.petBackpack.items[0].medalBody).toBe(expected);
  });
});
