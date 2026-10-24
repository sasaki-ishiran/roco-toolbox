import { isCollectorCaptureUrl, MAX_CAPTURE_BYTES } from '../pcap/collectorUrl';

export type CapturePhase = 'idle' | 'starting' | 'capturing' | 'stopping' | 'failed';
export type CaptureUploadState = 'uploading' | 'processing' | 'pending' | 'persisted' | 'failed';
/** 蛋神助手云端单文件上限；与 android-shell 的 CaptureUploader.MAX_UPLOAD_BYTES 一致。 */
export const CAPTURE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export interface CaptureUpload {
  state: CaptureUploadState; message: string; progress: number;
  captureId?: string; gameId?: string; deduplicated?: boolean;
}
export interface CaptureFile { id: string; name: string; size: number; createdAt: number; valid: boolean; upload?: CaptureUpload }
export interface CollectorState {
  version: 1; supported: boolean; phase: CapturePhase; message: string;
  packets: number; bytes: number; files: CaptureFile[];
  progressVersion?: 1; fileId?: string; savedBytes?: number; uploadBusy?: boolean;
}
export interface CaptureSnapshot { id: string; size: number; url: string }
export type CollectorAction = 'startCapture' | 'stopCapture' | 'openGame' | 'importCapture' | 'uploadCapture' | 'shareCapture' | 'deleteCapture';
declare global {
  interface Window {
    RocoCapture?: { getState: () => string | Promise<string>; inspectCapture?: () => string | Promise<string> } & Partial<Record<CollectorAction, (id?: string) => string | Promise<string>>>;
  }
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const UPLOAD_STATES: CaptureUploadState[] = ['uploading', 'processing', 'pending', 'persisted', 'failed'];
const CAPTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validUpload(value: unknown): value is CaptureUpload {
  if (!value || typeof value !== 'object') return false;
  const upload = value as Record<string, unknown>;
  return UPLOAD_STATES.includes(upload.state as CaptureUploadState)
    && typeof upload.message === 'string'
    && nonnegative(upload.progress) && upload.progress <= 100
    && (upload.captureId == null || (typeof upload.captureId === 'string' && CAPTURE_ID.test(upload.captureId)))
    && (upload.gameId == null || (typeof upload.gameId === 'string' && /^\d{5,12}$/.test(upload.gameId)))
    && (upload.deduplicated == null || typeof upload.deduplicated === 'boolean');
}
export async function readCollectorState(): Promise<CollectorState | null> {
  if (typeof window === 'undefined' || !window.RocoCapture) return null;
  let value: CollectorState;
  try { value = JSON.parse(await window.RocoCapture.getState()) as CollectorState; }
  catch { throw new Error('无法读取本机采集状态，请返回工具箱重试'); }
  if (value?.version !== 1) throw new Error('采集桥版本不兼容，请更新安卓工具箱');
  if (typeof value.supported !== 'boolean' || !['idle', 'starting', 'capturing', 'stopping', 'failed'].includes(value.phase)
    || typeof value.message !== 'string' || !nonnegative(value.packets) || !nonnegative(value.bytes)
    || (value.progressVersion != null && (value.progressVersion !== 1 || typeof value.fileId !== 'string'
      || (value.fileId !== '' && !/^capture-[0-9]+\.pcap$/.test(value.fileId)) || !Number.isSafeInteger(value.savedBytes)
      || !nonnegative(value.savedBytes) || value.savedBytes > MAX_CAPTURE_BYTES))
    || (value.uploadBusy != null && typeof value.uploadBusy !== 'boolean')
    || !Array.isArray(value.files) || value.files.length > 10 || value.files.some((file) =>
      !file || !/^capture-[0-9]+\.pcap$/.test(file.id) || typeof file.name !== 'string'
      || !nonnegative(file.size) || !nonnegative(file.createdAt) || typeof file.valid !== 'boolean'
      || (file.upload != null && !validUpload(file.upload)))) {
    throw new Error('本机采集状态无效，请重新打开工具箱');
  }
  return value;
}
export async function readCaptureSnapshot(): Promise<CaptureSnapshot | null> {
  if (!window.RocoCapture?.inspectCapture) return null;
  const text = await window.RocoCapture.inspectCapture();
  if (!text) return null;
  let snapshot: CaptureSnapshot;
  try { snapshot = JSON.parse(text) as CaptureSnapshot; } catch { throw new Error('无法读取采集快照'); }
  if (!snapshot || !/^capture-[0-9]+\.pcap$/.test(snapshot.id) || !Number.isSafeInteger(snapshot.size)
    || snapshot.size <= 24 || snapshot.size > MAX_CAPTURE_BYTES || typeof snapshot.url !== 'string' || !isCollectorCaptureUrl(snapshot.url)) {
    throw new Error('本机采集快照无效');
  }
  return snapshot;
}
export async function collectorAction(action: CollectorAction, id?: string): Promise<void> {
  const bridge = window.RocoCapture;
  if (!bridge || typeof bridge[action] !== 'function') throw new Error('请更新安卓工具箱后使用内置采集');
  if (id != null && !/^capture-[0-9]+\.pcap$/.test(id)) throw new Error('无效的采集文件');
  const error = await (id == null ? bridge[action]() : bridge[action](id));
  if (error) throw new Error(error);
}
