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
