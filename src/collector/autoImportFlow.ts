import { createModuleStore } from '../ui/createModuleStore';
import { getImportOutcome } from '../ui/importOutcomeStore';
import { hasAutoImported, hasAutoStopped, markAutoImported, markAutoStopped, unmarkAutoStopped } from './captureSessionStore';
import { isNearbyOwnedSession } from './captureOriginStore';
import { getLiveMode } from './liveModeStore';
import { collectorAction, isDesktopShell, readCollectorState } from './nativeCollector';

/**
 * 全局自动导入流程（2026-11-07 还原：数据收齐 → 自动停止 → 保存 → 导入工具箱）。
 *
 * 原来这段逻辑长在「我的 · 游戏数据」面板组件里，只有停在那个页面才会触发；
 * 采集时停在「附近」页看雷达就永远不会自动导入。现在抽成模块级流程：
 * 附近页与我的页谁看到「数据已收齐」都能触发，切页、刷新都不中断。
 *
 * 跳过条件（任一即不触发）：
 * - 持续获取模式开着（用户想边玩边更新）；
 * - 这一 session 由附近页发起（雷达导向：永不自动停止 / 导入，见 captureOriginStore）；
 * - 这一 session 已经自动停止过（防重复触发）。
 */
const SAVE_WAIT_MS = 8000;
const IMPORT_WAIT_MS = 20000;

export type AutoImportStage = 'idle' | 'stopping' | 'importing' | 'syncing' | 'done' | 'failed';

export interface AutoImportCompletion {
  session: string;
}

export interface AutoImportState {
  /** 本次自动导入针对的采集会话 */
  session: string | null;
  stage: AutoImportStage;
  /** 完成 / 失败后的弹窗数据；「我的 · 游戏数据」挂载时弹出，关闭后清空 */
  completion: AutoImportCompletion | null;
  /** 弹窗里的失败原因 */
  completionError: string | null;
  /** 行内错误（停止失败 / 等保存失败）：面板与附近页都展示 */
  error: string | null;
}

const INITIAL: AutoImportState = { session: null, stage: 'idle', completion: null, completionError: null, error: null };
const store = createModuleStore<AutoImportState>(INITIAL);

export function useAutoImport(): AutoImportState {
  return store.use();
}

export function readAutoImport(): AutoImportState {
  return store.get();
}

/** 面板关闭完成弹窗时调用。 */
export function clearAutoImportCompletion(): void {
  store.set({ ...store.get(), completion: null, completionError: null });
}

/** 测试用：重置流程状态。 */
export function resetAutoImportForTest(): void {
  store.set(INITIAL);
}

const delay = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/**
 * 幂等触发：满足条件就开始「自动停止 → 保存 → 导入」。
 * 附近页（progress ready）与我的页（CaptureProgressView onReady）都调它。
 */
export function requestAutoImport(session: string | null | undefined): boolean {
  if (!session) return false;
  // 桌面版（2026-11-08）：登录握手才拿得到 key，自动停止后要重登很麻烦，
  // 所以 PC 一律按「实时采集」处理：只更新地图/列表，不自动停止、不自动导入。
  // 需要入库时由用户手动「停止并保存」→ 文件列表点「解析并导入」。
  if (isDesktopShell()) return false;
  if (getLiveMode()) return false;
  if (isNearbyOwnedSession(session)) return false;
  if (hasAutoStopped(session)) return false;
  markAutoStopped(session);
  store.set({ session, stage: 'stopping', completion: null, completionError: null, error: null });
  void run(session);
  return true;
}

async function run(session: string): Promise<void> {
  try {
    await collectorAction('stopCapture');
  } catch (cause) {
    unmarkAutoStopped(session);
    store.set({
      session: null, stage: 'idle', completion: null, completionError: null,
      error: cause instanceof Error ? cause.message : '停止采集失败，请重试',
    });
    return;
  }
  const saved = await waitForSaved(session);
  if (saved !== 'saved') {
    store.set({
      session: null, stage: 'idle', completion: null, completionError: null,
      error: saved === 'failed'
        ? '本次采集未完整保存，请重新采集；文件列表里仍可导出原包'
        : '采集已保存，但没等到文件就绪；请在文件列表里点「解析并导入」',
    });
    return;
  }
  if (hasAutoImported(session)) return;
  markAutoImported(session);
  store.set({ ...store.get(), stage: 'importing' });

  const baseline = getImportOutcome().operationId;
  const requested = await importWithRetry(session);
  if (!requested) {
    store.set({
      ...store.get(), stage: 'failed',
      completion: { session },
      completionError: lastImportError ?? '无法开始导入',
    });
    return;
  }
  const result = await waitForImportOutcome(baseline);
  const current = store.get();
  if (current.session !== session) return; // 防御：流程被新一轮覆盖
  if (result === 'failed') {
    store.set({
      ...current, stage: 'failed', completion: { session },
      completionError: getImportOutcome().message ?? '导入失败，请在文件列表里重试',
    });
  } else if (result === 'timeout') {
    store.set({
      ...current, stage: 'failed', completion: { session },
      completionError: '导入没有完成，请在文件列表里点「解析并导入」重试',
    });
  } else {
    store.set({ ...current, stage: 'done', completion: { session }, completionError: null });
  }
}

async function waitForSaved(session: string): Promise<'saved' | 'failed' | 'timeout'> {
  const deadline = Date.now() + SAVE_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const current = await readCollectorState();
      if (current && current.phase === 'failed') return 'failed';
      if (current && current.phase === 'idle' && current.files.some((file) => file.id === session)) return 'saved';
    } catch {
      // 保存中偶尔读不到状态：继续等
    }
    await delay(300);
  }
  return 'timeout';
}

let lastImportError: string | null = null;

async function importWithRetry(session: string): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await collectorAction('importCapture', session);
      lastImportError = null;
      return true;
    } catch (cause) {
      lastImportError = cause instanceof Error ? cause.message : '无法开始导入';
      if (!/等待保存完成/.test(lastImportError)) return false;
    }
    await delay(500);
  }
  return false;
}

async function waitForImportOutcome(baseline: number): Promise<'saved' | 'failed' | 'timeout'> {
  const deadline = Date.now() + IMPORT_WAIT_MS;
  while (Date.now() < deadline) {
    const current = getImportOutcome();
    if (current.operationId > baseline) {
      if (current.local === 'failed') return 'failed';
      if (current.local === 'saved') {
        if (current.cloud !== 'syncing') return 'saved';
        if (store.get().stage !== 'syncing') {
          store.set({ ...store.get(), stage: 'syncing' });
        }
      }
    }
    await delay(250);
  }
  const current = getImportOutcome();
  if (current.operationId > baseline && current.local === 'saved') return 'saved';
  return 'timeout';
}
