/**
 * 同目录 home.js（家园场景解析）的对外接口声明。
 * 与 domain/types.ts 的 HomeSnapshot 保持同一口径；这里只声明解码入口。
 */

export interface GamePosition {
  x: number;
  y: number;
  z: number;
}

export interface DecodedHomeNest {
  furnitureGuid: string;
  parentFurnitureGuid?: string;
  itemGid?: string;
  configId: number | null;
  nestType: 'ordinary' | 'academy' | null;
  nestName: string | null;
  residentIds: string[];
  roomId?: number | null;
  roomName?: string;
  planeGuid?: string;
  position?: GamePosition | null;
  positionRaw?: GamePosition | null;
}

export interface DecodedHomeResident {
  instanceId: string;
  baseId: string;
  confId?: number | null;
  furnitureGuid: string;
  actorId: string;
  name?: string;
  position?: GamePosition | null;
  coordinateSystem?: string;
  nest?: DecodedHomeNest | null;
}

export interface DecodedHomeEgg {
  actorId: string;
  furnitureGuid: string;
  npcConfigId?: number | null;
}

export interface DecodedHomePair {
  femaleActorId: string;
  maleActorIds: string[];
}

export interface DecodedHomeSnapshot {
  ok: true;
  schemaVersion: 1;
  gameId: string;
  capturedAt: string;
  homeLevel: number | null;
  roomLevel: number | null;
  residents: DecodedHomeResident[];
  nests: DecodedHomeNest[];
  layEggCouples: DecodedHomePair[];
  sceneEggs: DecodedHomeEgg[];
  couplesStale: boolean;
  snapshotKind: 'full' | 'delta';
}

export function decodeHomePayload(
  payload: Uint8Array,
  opcode: number,
  gameId: string | number,
  previous: DecodedHomeSnapshot | null,
  foreignScene: boolean,
  capturedAt: string,
): DecodedHomeSnapshot | null;

export function decodeHomeScene(
  payload: Uint8Array,
  opcode: number,
): { scene: number | null; foreign: boolean } | null;
