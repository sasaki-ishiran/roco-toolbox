import {
  exportLiveDecodeState,
  extractPcap,
  importLiveDecodeState,
  inspectExtractedCapture,
  type ExtractedCapture
} from '../pcap-decoder/tools/pcap-json-app/src/core';
import { decorateWildPet, genderNameOf, natureNameOf, withDistance } from '../pcap/wildNearby';
import { species } from '../data/catalog';
import type { CaptureAnalysis, SeasonEncounter } from './captureProgress';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export async function captureFingerprint(capture: Partial<ExtractedCapture>): Promise<string> {
  const meaningful = {
    profile: capture.profile,
    records: capture.records?.map(({ occurrences: _count, raw_source: _source, ...record }) => record),
    boxes: capture.boxes, eggs: capture.eggInventory?.eggs, balls: capture.guluInventory?.balls,
    fruits: capture.fruits, fashions: capture.fashions, topics: capture.topics,
    petMedals: capture.petMedals, grassMedals: capture.grassMedals, grassTrials: capture.grassTrials,
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(meaningful))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Read-only diagnostics; does not import accounts or retain decrypted protocol frames. */
export async function inspectCaptureBytes(
  bytes: Uint8Array,
  options: { windowBytes?: number; sessionKey?: string; resume?: string } = {},
): Promise<CaptureAnalysis> {
  const windowed = Boolean(options.windowBytes);
  // 冷启动（Worker 被回收后）：注入上一轮导出的 key / 账号基线，裁剪过的文件也能解尾窗
  if (windowed && options.resume) {
    try { importLiveDecodeState(JSON.parse(options.resume)); } catch { /* 状态损坏就按冷启动处理 */ }
  }
  const extracted = extractPcap(bytes, {
    allowTruncated: true,
    retainRawProtocol: false,
    // 实时巡检只解文件尾部窗口（附近页 / 悬浮球）；「我的」页不传，保持全量解析。
    windowBytes: options.windowBytes ? Number(options.windowBytes) : 0,
    // 窗口解析要跨轮保留「当前场景基线」（330 全量帧会滑出窗口），按采集会话隔离
    sessionKey: options.sessionKey || "",
  });
  const d = inspectExtractedCapture(extracted);
  // 宠物记录（仓库/背包）按 petId + 等级 + 身高 + 体重 关联附近精灵，抓后回填性格/性别
  const details = new Map<string, { natureId: number; genderId: number }>();
  for (const detail of extracted.ownedPetDetails || []) {
    details.set(`${detail.petId}:${detail.level}:${detail.height}:${detail.weight}`, detail);
  }
  const nearby = (extracted.nearbyPets || []).map((raw) => {
    const base = decorateWildPet(raw);
    const detail = base.petId != null
      ? details.get(`${base.petId}:${raw.level}:${raw.height}:${raw.weight}`)
      : undefined;
    const pet = detail ? decorateWildPet(raw, detail) : base;
    const row = withDistance(pet, null);
    return {
      key: pet.key, cfgId: pet.cfgId, name: pet.name, level: pet.level, voiceDb: pet.voiceDb,
      weightPct: pet.weightPct, heightPct: pet.heightPct, kinds: pet.kinds, rare: pet.rare,
      nature: pet.nature, natureId: pet.natureId, gender: pet.gender,
      alertReason: pet.alertReason, distanceM: row.distanceM, pos: raw.pos, petId: pet.petId,
    };
  });
  const liveState = windowed && options.sessionKey ? exportLiveDecodeState() : null;
  return {
    fingerprint: await captureFingerprint(extracted), hasGameTraffic: d.hasGameTraffic,
    hasKey: d.hasKey, hasProfile: Boolean(d.profile), accountCount: d.accountCount,
    boxes: d.boxes, records: d.records, missingRecords: d.missingRecords,
    hasEggInventory: d.hasEggInventory, eggInventoryComplete: d.eggInventoryComplete,
    eggRecords: d.eggRecords, completionCandidate: d.completionCandidate,
    truncated: d.truncated, flowErrors: d.flowErrors, stableWaitMs: d.stableWaitMs,
    nearbyScene: extracted.nearbyScene ?? null, nearbySelf: extracted.nearbySelf ?? null,
    nearbyPets: nearby.length, nearby,
    encounter: toSeasonEncounter(extracted),
    ...(liveState ? { liveState: JSON.stringify(liveState) } : {}),
  };
}

/**
 * 战斗帧（4886/4890）里的奇遇守卫记录 → 展示用结构；没有奇遇战返回 null。
 * 奖励精灵是随机的，按捕获后的真实 petId 查图鉴；查不到（仍是临时 unitId）就不猜名字。
 */
const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));

/** 前端 catalog 仍是 2026-10-31 版，3808（蛋包蛋）是 11-05 才进图鉴；catalog 同步后可删。 */
const EXTRA_SPECIES_NAMES: Record<number, string> = { 3808: '蛋包蛋' };

function percentile(value: number, min: number, max: number): number | null {
  if (!(max > min)) return null;
  return Math.max(0, Math.min(100, Math.round(((value - min) / (max - min)) * 100)));
}

function toSeasonEncounter(extracted: ExtractedCapture): SeasonEncounter | null {
  const raw = extracted.seasonEncounter;
  if (!raw) return null;
  const reward = speciesByGameId.get(raw.unitId);
  return {
    guardName: raw.guardName,
    rewardPetId: reward?.gameId ?? (raw.unitId in EXTRA_SPECIES_NAMES ? raw.unitId : null),
    rewardName: reward?.name ?? EXTRA_SPECIES_NAMES[raw.unitId] ?? '',
    level: raw.level,
    natureId: raw.natureId,
    natureConfirmed: raw.natureConfirmed,
    nature: raw.natureConfirmed ? natureNameOf(raw.natureId) : '',
    gender: genderNameOf(raw.genderId),
    height: raw.height,
    weight: raw.weight,
    heightPct: reward?.heightSize
      ? percentile(raw.height / 100, reward.heightSize.min, reward.heightSize.max)
      : null,
    weightPct: reward?.bodySize
      ? percentile(raw.weight / 1000, reward.bodySize.small, reward.bodySize.big)
      : null,
    voiceDb: raw.voiceDb || null,
  };
}
