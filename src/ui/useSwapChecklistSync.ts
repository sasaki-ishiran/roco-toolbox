import { useCallback, useEffect, useRef } from 'react';
import { createSharedList, fetchSharedList, putSharedList } from '../api/sharedList';
import { CATALOG_VERSION } from '../data/catalog';
import { mergeChecklistState, type MotherChecklist } from '../domain/swapChecklist';
import {
  applyRemoteChecklist,
  buildRemotePayload,
  clearSharedTarget,
  getSwapChecklist,
  parseRemotePayload,
  setSharedTarget,
  setSyncError,
  useSwapChecklist,
} from './swapChecklistStore';

const PUSH_DELAY_MS = 700;
const POLL_INTERVAL_MS = 15_000;

/** 最近一次与云端一致（或刚应用过）的 payload；用来避免「拉下来又原样推回去」的回声 */
let lastSyncedPayload = '';

/**
 * 互换清单的云端同步：
 * - 发布：算好的名单 + 我方账号一起上传，拿到分享码
 * - 加入：按分享码拉下来直接渲染
 * - 之后：本地改动 700ms 内推一次；每 15 秒拉一次，按条合并
 */
export function useSwapChecklistSync(): {
  publish: (mineAccounts: string[], lists: MotherChecklist) => Promise<string>;
  join: (code: string) => Promise<void>;
  leave: () => void;
} {
  const { code, items } = useSwapChecklist();
  const busy = useRef(false);

  const publish = useCallback(async (mineAccounts: string[], lists: MotherChecklist) => {
    const payload = buildRemotePayload(
      { ...getSwapChecklist(), mineAccounts, lists, items: {}, code: '', version: 0 },
      CATALOG_VERSION,
    );
    const created = await createSharedList(payload);
    lastSyncedPayload = payload;
    setSharedTarget({
      code: created.code,
      version: created.version,
      lists,
      items: {},
      mineAccounts,
      role: 'publisher',
    });
    return created.code;
  }, []);

  const join = useCallback(async (inputCode: string) => {
    const normalized = inputCode.trim().toUpperCase();
    const remote = await fetchSharedList(normalized);
    if (!remote) throw new Error('分享码不存在（或已被重置）');
    const parsed = parseRemotePayload(remote.payload);
    if (!parsed) throw new Error('清单格式不对，可能对方用的是旧版本');
    lastSyncedPayload = remote.payload;
    setSharedTarget({
      code: normalized,
      version: remote.version,
      lists: parsed.lists,
      items: parsed.items,
      mineAccounts: parsed.mineAccounts,
      role: 'joiner',
    });
  }, []);

  const leave = useCallback(() => {
    lastSyncedPayload = '';
    clearSharedTarget();
  }, []);

  // 推送：items 变了且与上次同步的内容不同 → 延迟推一次
  useEffect(() => {
    if (!code) return;
    const payload = buildRemotePayload(getSwapChecklist(), CATALOG_VERSION);
    if (payload === lastSyncedPayload) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (busy.current) return;
        busy.current = true;
        try {
          const state = getSwapChecklist();
          const body = buildRemotePayload(state, CATALOG_VERSION);
          if (body === lastSyncedPayload) return;
          const result = await putSharedList(state.code, state.version, body);
          if (result.ok) {
            lastSyncedPayload = body;
            applyRemoteChecklist({
              version: result.version ?? state.version + 1,
              lists: state.lists,
              mineAccounts: state.mineAccounts,
              items: state.items,
            });
            return;
          }
          // 409：对方先推了 → 拉下来按条合并，下次 effect 会再推
          const remote = result.list;
          if (!remote) {
            setSyncError('云端清单不存在了');
            return;
          }
          const parsed = parseRemotePayload(remote.payload);
          if (!parsed) {
            setSyncError('云端数据格式不对');
            return;
          }
          const latest = getSwapChecklist();
          lastSyncedPayload = remote.payload;
          applyRemoteChecklist({
            version: remote.version,
            lists: parsed.lists,
            mineAccounts: parsed.mineAccounts,
            items: mergeChecklistState(latest.items, parsed.items),
          });
        } catch (error) {
          setSyncError(error instanceof Error ? error.message : '同步失败');
        } finally {
          busy.current = false;
        }
      })();
    }, PUSH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [code, items]);

  // 轮询：每 15 秒 + 切回前台时拉一次
  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    const pull = async () => {
      const state = getSwapChecklist();
      if (!state.code || busy.current) return;
      try {
        const remote = await fetchSharedList(state.code);
        if (cancelled || !remote) return;
        const parsed = parseRemotePayload(remote.payload);
        if (!parsed) return;
        const latest = getSwapChecklist();
        if (remote.version <= latest.version) return;
        lastSyncedPayload = remote.payload;
        applyRemoteChecklist({
          version: remote.version,
          lists: parsed.lists,
          mineAccounts: parsed.mineAccounts,
          items: mergeChecklistState(latest.items, parsed.items),
        });
      } catch (error) {
        if (!cancelled) setSyncError(error instanceof Error ? error.message : '同步失败');
      }
    };

    void pull();
    const timer = window.setInterval(() => void pull(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pull();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [code]);

  return { publish, join, leave };
}
