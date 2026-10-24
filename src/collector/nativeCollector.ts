export type CapturePhase = 'idle' | 'starting' | 'capturing' | 'stopping' | 'failed';
export interface CaptureFile { id: string; name: string; size: number; createdAt: number; valid: boolean }
export interface CollectorState {
  version: 1; supported: boolean; phase: CapturePhase; message: string;
  packets: number; bytes: number; files: CaptureFile[];
}
export type CollectorAction = 'startCapture' | 'stopCapture' | 'openGame' | 'importCapture' | 'shareCapture' | 'deleteCapture';
declare global {
  interface Window {
    RocoCapture?: { getState: () => string | Promise<string> } & Partial<Record<CollectorAction, (id?: string) => string | Promise<string>>>;
  }
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export async function readCollectorState(): Promise<CollectorState | null> {
  if (typeof window === 'undefined' || !window.RocoCapture) return null;
  let value: CollectorState;
  try { value = JSON.parse(await window.RocoCapture.getState()) as CollectorState; }
  catch { throw new Error('无法读取本机采集状态，请返回工具箱重试'); }
  if (value?.version !== 1) throw new Error('采集桥版本不兼容，请更新安卓工具箱');
  if (typeof value.supported !== 'boolean' || !['idle', 'starting', 'capturing', 'stopping', 'failed'].includes(value.phase)
    || typeof value.message !== 'string' || !nonnegative(value.packets) || !nonnegative(value.bytes)
    || !Array.isArray(value.files) || value.files.length > 10 || value.files.some((file) =>
      !file || !/^capture-[0-9]+\.pcap$/.test(file.id) || typeof file.name !== 'string'
      || !nonnegative(file.size) || !nonnegative(file.createdAt) || typeof file.valid !== 'boolean')) {
    throw new Error('本机采集状态无效，请重新打开工具箱');
  }
  return value;
}
export async function collectorAction(action: CollectorAction, id?: string): Promise<void> {
  const bridge = window.RocoCapture;
  if (!bridge || typeof bridge[action] !== 'function') throw new Error('请更新安卓工具箱后使用内置采集');
  if (id != null && !/^capture-[0-9]+\.pcap$/.test(id)) throw new Error('无效的采集文件');
  const error = await (id == null ? bridge[action]() : bridge[action](id));
  if (error) throw new Error(error);
}
