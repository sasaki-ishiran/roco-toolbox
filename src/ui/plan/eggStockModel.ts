import { canCirculateEgg, type EggRecord } from '../../shared/eggMatching';

/** Normalized trusted-adapter input, not raw capture JSON or user-edited form data. */
export type EggObservation = Pick<EggRecord, 'id' | 'eggGameId' | 'nature' | 'body' | 'voice'> &
  Partial<Pick<EggRecord, 'provenance' | 'confidence' | 'kind' | 'labelSource' | 'parents'>> & {
    gameAccountKey?: string;
  };
export interface StockEgg extends EggRecord {
  location: 'bag' | 'home';
  listed: boolean;
  lastConfirmedAt: number;
  /** 游戏账号（uid:...）；同一工具箱账号可能导入多个游戏账号。 */
  gameAccountKey?: string;
}
interface SnapshotPart {
  eggs: readonly EggObservation[];
  complete: boolean;
  /** 这一部位自己的采集时间；背包与家园来自不同抓包，不能共用一个时间。 */
  capturedAt?: number;
}
export interface EggStockSnapshot {
  accountId: string;
  /** 游戏账号（uid:...）；同一工具箱账号可能导入多个游戏账号，水位按它分开。 */
  gameAccountKey?: string;
  /** One coherent capture cycle; pass its bag/home parts together. */
  capturedAt: number;
  bag?: SnapshotPart;
  home?: SnapshotPart;
}
export interface EggStockState {
  eggs: StockEgg[];
  captureWatermarks: Record<string, number>;
  /** History is not visible stock. Retained so received eggs cannot become self-bred on reimport. */
  provenanceHistory: Record<string, EggRecord['provenance']>;
}

export const emptyEggStock = (): EggStockState => ({ eggs: [], captureWatermarks: {}, provenanceHistory: {} });
const instanceKey = (accountId: string, id: string): string => JSON.stringify([accountId, id]);

function validatePart(part: SnapshotPart | undefined): void {
  if (!part) return;
  if (!Array.isArray(part.eggs) || typeof part.complete !== 'boolean') throw new Error('库存快照缺少完整性标记');
  const seen = new Set<string>();
  for (const egg of part.eggs) {
    if (!egg || typeof egg.id !== 'string' || !egg.id.trim()) throw new Error('蛋实例编号无效');
    if (seen.has(egg.id)) throw new Error('快照存在重复实例');
    seen.add(egg.id);
    if (!Number.isSafeInteger(egg.eggGameId) || egg.eggGameId <= 0) throw new Error('蛋物种编号无效');
    if (typeof egg.nature !== 'string') throw new Error('蛋性格字段无效');
  }
}

export function reconcileEggStock(state: EggStockState, snapshot: EggStockSnapshot): EggStockState {
  if (typeof snapshot.accountId !== 'string' || !snapshot.accountId.trim() ||
      !Number.isFinite(snapshot.capturedAt) || snapshot.capturedAt < 0) throw new Error('账号或采集时间无效');
  validatePart(snapshot.bag);
  validatePart(snapshot.home);
  if (!snapshot.bag && !snapshot.home) return state;
  const accountKey = JSON.stringify([snapshot.accountId, snapshot.gameAccountKey ?? '']);
  if (snapshot.capturedAt <= (state.captureWatermarks[accountKey] ?? -1)) return state;

  const previous = new Map(state.eggs.filter(e => e.accountId === snapshot.accountId).map(e => [e.id, e]));
  const next = new Map(previous);
  const gameKey = snapshot.gameAccountKey ?? '';
  const sameGame = (egg: StockEgg): boolean =>
    egg.accountId === snapshot.accountId && (egg.gameAccountKey ?? '') === gameKey;
  for (const location of ['bag', 'home'] as const) {
    const part = snapshot[location];
    if (part?.complete) {
      const currentIds = new Set(part.eggs.map(e => e.id));
      for (const [id, egg] of next) if (sameGame(egg) && egg.location === location && !currentIds.has(id)) next.delete(id);
    }
  }
  const history = { ...state.provenanceHistory };
  const currentBag = new Set(snapshot.bag?.eggs.map(e => e.id) ?? []);
  // Process home first, then let actual bag entries take precedence.
  for (const location of ['home', 'bag'] as const) {
    for (const observation of snapshot[location]?.eggs ?? []) {
      const old = previous.get(observation.id);
      const key = instanceKey(snapshot.accountId, observation.id);
      const provenance: EggRecord['provenance'] = history[key] === 'external' || old?.provenance === 'external' || observation.provenance === 'external'
        ? 'external' : observation.provenance ?? history[key] ?? old?.provenance ?? 'unknown';
      history[key] = provenance;
      if (location === 'home' && (currentBag.has(observation.id) || next.get(observation.id)?.location === 'bag')) {
        // Keep bag location, but retain restrictive classification from either observation.
        const current = next.get(observation.id);
        if (current) {
          const kind = observation.kind === 'special' || observation.kind === 'shiny' ? observation.kind : current.kind;
          const updated = { ...current, provenance, kind,
            lastConfirmedAt: Math.max(current.lastConfirmedAt, snapshot[location]?.capturedAt ?? snapshot.capturedAt) };
          if (observation.parents) updated.parents = observation.parents;
          if (observation.labelSource === 'system' && updated.labelSource !== 'manual') updated.labelSource = 'system';
          next.set(current.id, { ...updated, listed: current.listed && canCirculateEgg(updated) });
        }
        continue;
      }
      const egg: StockEgg = { id: observation.id, accountId: snapshot.accountId, eggGameId: observation.eggGameId,
        nature: observation.nature, body: observation.body, voice: observation.voice,
        provenance, confidence: observation.confidence ?? 'unknown',
        labelSource: observation.labelSource ?? (observation.confidence === 'system' ? 'system' : 'unknown'),
        parents: observation.parents ?? old?.parents,
        kind: observation.kind ?? old?.kind ?? 'ordinary',
        gameAccountKey: observation.gameAccountKey ?? old?.gameAccountKey ?? snapshot.gameAccountKey,
        status: old?.status ?? 'available', location, lastConfirmedAt: snapshot[location]?.capturedAt ?? snapshot.capturedAt, listed: false };
      egg.listed = !!old?.listed && canCirculateEgg(egg);
      next.set(egg.id, egg);
    }
  }
  return { eggs: [...state.eggs.filter(e => e.accountId !== snapshot.accountId), ...next.values()],
    captureWatermarks: { ...state.captureWatermarks, [accountKey]: snapshot.capturedAt }, provenanceHistory: history };
}

export function setEggListed(state: EggStockState, accountId: string, id: string, listed: boolean): EggStockState {
  const egg = state.eggs.find(e => e.accountId === accountId && e.id === id);
  if (!egg) throw new Error('蛋库存不存在');
  if (listed && !canCirculateEgg(egg)) throw new Error('异色蛋和特殊蛋不可挂出交换');
  if (egg.listed === listed) return state;
  return { ...state, eggs: state.eggs.map(e => e === egg ? { ...e, listed } : e) };
}

/** Stable partition: non-giftable eggs stay visible after ordinary stock. */
export function sortEggStock(eggs: readonly StockEgg[]): StockEgg[] {
  const special = (egg: StockEgg) => egg.kind === 'special' || egg.kind === 'shiny';
  return [...eggs.filter(e => !special(e)), ...eggs.filter(special)];
}
