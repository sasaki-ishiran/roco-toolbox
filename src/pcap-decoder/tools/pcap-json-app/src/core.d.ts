/**
 * 这里声明的是同目录下 core.js（原采集器的 PCAP 解析器）的对外接口，
 * 只声明我们用到的部分，避免 TypeScript 去类型检查那份 95 KB 的上游代码。
 */

export type ConvertedCounts = {
  petBackpackItems: number;
  matched: number;
} & Record<string, number>;

export type ConvertedPayload = {
  meta: {
    type: string;
    gameId: number;
    playerName: string;
    exportedAt: string;
  } & Record<string, unknown>;
  collections: {
    petBackpack: { items: Array<Record<string, unknown>> };
    eggInventory?: { eggs: Array<Record<string, unknown>> };
  } & Record<string, unknown>;
};

export type ConvertedCapture = {
  payload: ConvertedPayload;
  /** 与手动导出的 JSON 文件一致的文本 */
  mainText: string;
  /** 采集器建议的文件名，形如 玩家名_游戏编号_年月日-时分秒.json */
  mainName: string;
  report: {
    linkType: number;
    boxes: number;
    accountCount: number;
    accountTransitions: number;
    counts: ConvertedCounts;
  };
};

export function convertPcapBytes(bytes: Uint8Array, fileName?: string): ConvertedCapture;

export interface ExtractedCapture {
  profile?: Record<string, unknown> | null;
  records: Array<Record<string, unknown>>;
  boxes?: unknown[];
  eggInventory?: { eggs: unknown[] } | null;
  guluInventory?: { balls: unknown[] } | null;
  fruits?: unknown[]; fashions?: unknown[]; topics?: Record<string, unknown>;
  petMedals?: unknown[]; grassMedals?: unknown[]; grassTrials?: unknown[];
  /** 野外附近精灵（330 全量 + 1043 增量） */
  nearbyPets?: WildEntityRaw[];
  /** 宠物记录里的性格/性别（4934/579/4908），用于抓后回填附近精灵 */
  ownedPetDetails?: OwnedPetDetailRaw[];
  nearbyScene?: number | null;
  /** 自身世界坐标（上行 307）；拿不到为 null */
  nearbySelf?: { x: number; y: number; heading?: number | null } | null;
  /** 最近一次赛季奇遇战（4886/4890）守卫的个体数据 */
  seasonEncounter?: SeasonEncounterRaw | null;
  /** 本次实际扫描的 pcap 记录数（窗口化时只算窗口内） */
  packets?: number;
  /** 各连接的帧 / 解密帧统计（窗口化诊断用） */
  flows?: Array<{ flow: string; frames: number; decryptedFrames: number; hasKey: boolean; error?: string }>;
}

/** 测试 / 性能诊断用：跨轮解密缓存命中情况。 */
export function __frameCacheStats(): { hits: number; misses: number; entries: number; bytes: number };
/** 测试用：清空跨轮解密缓存与已知 AES key。 */
export function __resetFrameCacheForTest(): void;

/** 赛季奇遇战守卫的宠物记录（性格在战斗中即为真实值）。 */
export interface SeasonEncounterRaw {
  /** 形态 id（龙棋士 = 1646） */
  formId: number;
  /** 战斗中的显示名（龙棋士） */
  guardName: string;
  /** 战斗内临时单位 id */
  unitId: number;
  level: number;
  natureId: number;
  /** false 表示 field7 = 30 占位，性格尚未生成 */
  natureConfirmed: boolean;
  genderId: number;
  height: number;
  weight: number;
  bloodId: number;
  /** 声音（-100 ~ 100 dB）；战斗帧或捕获记录缺失时为 0 */
  voiceDb: number;
}
export interface CaptureDiagnostics {
  hasGameTraffic: boolean; hasKey: boolean; profile: unknown; accountCount: number;
  boxes: number; records: number; missingRecords: number; hasEggInventory: boolean;
  eggInventoryComplete: boolean; eggRecords: number; completionCandidate: boolean;
  truncated: boolean; flowErrors: number; stableWaitMs: number;
  nearbyPets: number; nearbyScene: number | null; nearbySelf: { x: number; y: number; heading?: number | null } | null;
}
export function extractPcap(bytes: Uint8Array, options?: {
  allowTruncated?: boolean;
  retainRawProtocol?: boolean;
  /** 只解析文件尾部窗口（字节数）；0 / 不传 = 全量。实时巡检用 2MiB。 */
  windowBytes?: number;
  /** 窗口解析的跨轮「当前场景基线」隔离键（采集会话 id）；导入流程不传。 */
  sessionKey?: string;
  /** 冷启动补扫的文件头字节数（默认 2MiB）；测试可调小。 */
  headScanBytes?: number;
}): ExtractedCapture;

/** 实时会话状态：解密 key + 账号 / 附近基线；采集文件被裁剪后靠它恢复。 */
export interface LiveDecodeState {
  version: 1;
  key: string;
  keys: Array<[string, number[]]>;
  baseline: {
    pets: Array<[string, WildEntityRaw]>;
    scene: number | null;
    self: { x: number; y: number } | null;
    encounter: SeasonEncounterRaw | null;
    petDetails: Array<[string, OwnedPetDetailRaw]>;
    uid: string;
    profile: Record<string, unknown> | null;
  };
}
export function exportLiveDecodeState(): LiveDecodeState | null;
export function importLiveDecodeState(state: unknown): boolean;
export function parseSeasonEncounterUnits(payload: Uint8Array): SeasonEncounterRaw[];
/** 战斗帧 → 奇遇卡：4886 里有单位但不是奇遇形态时清空上一场残留；4890 只合并不清空。 */
export function applyBattleEncounterFrame(
  previous: SeasonEncounterRaw | null,
  opcode: number,
  payload: Uint8Array,
): SeasonEncounterRaw | null;
export function inspectExtractedCapture(extracted: ExtractedCapture): CaptureDiagnostics;

/** 野外实体（330/1043/1044）的协议字段；名称与判定在 src/pcap/wildNearby.ts。 */
export interface WildEntityRaw {
  cfgId: number; actorId: number; uniqueId: number; level: number;
  height: number; weight: number; voiceDb: number; mutation: number;
  glassType: number; glassValue: number; pos: { x: number; y: number; z: number };
}
export function parseWildEntities(payload: Uint8Array): WildEntityRaw[];
/** 把一帧实体数据写进采集状态：330 全量覆盖，1043/1044 按 uniqueId 增量 upsert；墓碑不复活。 */
export function applyWildEntityFrame(
  capture: { wildPets: Map<string, WildEntityRaw>; capturedWild: Set<string> },
  opcode: number,
  payload: Uint8Array,
): number;
export function parseSceneInfo(payload: Uint8Array, opcode?: number): { scene: number | null; sceneCfgId: number | null };
/** 上行移动帧的自身坐标：明文里「时间戳 + field 2 坐标」结构（2026-11-10 真机对账）。
 *  heading 取同一帧的速度方向（0=正北、顺时针）；静止时为 null。 */
export function parseUpstreamSelfPosition(plaintext: Uint8Array): { x: number; y: number; heading: number | null } | null;

/** 宠物记录里的性格 / 性别 / 等级 / 身高体重；按 petId + level + 身高 + 体重 关联附近精灵。 */
export interface OwnedPetDetailRaw {
  petId: number; level: number; height: number; weight: number;
  natureId: number; genderId: number; bloodId: number; voiceDb: number;
}
export function parseOwnedPetDetails(payload: Uint8Array): OwnedPetDetailRaw[];

/** 捕获成功（579 非空）后按 种族+等级+身高+体重 从附近实体里剔除，避免抓到的精灵继续留在地图/列表 */
export function removeCapturedWildPets(
  capture: { wildPets: Map<string, WildEntityRaw>; capturedWild: Set<string> },
  details: OwnedPetDetailRaw[],
): void;

/** 把捕获记录 / 背包同步里的个体记录合并进奇遇卡（补真实 petId、声音、性格） */
export function mergeEncounterDetail(encounter: SeasonEncounterRaw | null, detail: OwnedPetDetailRaw): SeasonEncounterRaw | null;
/** 同场战斗的重复帧合并：已确认的性格不被 30 占位冲掉 */
export function mergeSeasonEncounterUnit(previous: SeasonEncounterRaw | null, next: SeasonEncounterRaw): SeasonEncounterRaw;

/** 诊断用：逐帧列出已解密业务帧的 opcode 与 payload（不做业务字段解析）。 */
export interface BusinessFrame {
  flowIndex: number; opcode: number; packetIndex: number; frameIndex: number; payloadHex: string;
}
export function extractBusinessFrames(bytes: Uint8Array, options?: { allowTruncated?: boolean }): BusinessFrame[];
/** 诊断用：逐条列出上行帧里解析出的自身坐标（需先跑过 extractBusinessFrames / extractPcap 以缓存 AES key）。 */
export function extractUpstreamSelfFrames(bytes: Uint8Array): Array<{
  flowIndex: number; frameIndex: number; packetIndex: number; opcode: number | null;
  x: number; y: number; heading: number | null;
}>;
