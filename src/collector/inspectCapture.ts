import { extractPcap, inspectExtractedCapture, type ExtractedCapture } from '../pcap-decoder/tools/pcap-json-app/src/core';
import type { CaptureAnalysis } from './captureProgress';

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
export async function inspectCaptureBytes(bytes: Uint8Array): Promise<CaptureAnalysis> {
  const extracted = extractPcap(bytes, { allowTruncated: true, retainRawProtocol: false });
  const d = inspectExtractedCapture(extracted);
  return {
    fingerprint: await captureFingerprint(extracted), hasGameTraffic: d.hasGameTraffic,
    hasKey: d.hasKey, hasProfile: Boolean(d.profile), accountCount: d.accountCount,
    boxes: d.boxes, records: d.records, missingRecords: d.missingRecords,
    hasEggInventory: d.hasEggInventory, eggInventoryComplete: d.eggInventoryComplete,
    eggRecords: d.eggRecords, completionCandidate: d.completionCandidate,
    truncated: d.truncated, flowErrors: d.flowErrors, stableWaitMs: d.stableWaitMs,
  };
}
