import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completeCollectionPlan,
  createCollectionPlans,
  deleteCollectionPlan,
  getCollectionPlans,
  markPlanOffer,
  startCollectionPlan,
  withdrawPlanOffer,
  type CollectionPlansResponse,
  type CollectionPlanView,
  type CreatePlansResult,
} from '../../api/collectionGroups';

/**
 * 小组收集计划（我的收集 / 组内广场共用一份数据）。
 *
 * 动作只负责调 API + 刷新；埋点已经在 `src/api/collectionGroups.ts` 的
 * create / start / offer 里统一打，页面不要重复打。
 */
export interface CollectionPlansActions {
  create: (input: {
    eggGameIds: number[];
    note?: string;
    start?: boolean;
    bulk?: boolean;
  }) => Promise<CreatePlansResult>;
  start: (plan: CollectionPlanView) => Promise<void>;
  complete: (plan: CollectionPlanView) => Promise<void>;
  remove: (plan: CollectionPlanView) => Promise<void>;
  offer: (plan: CollectionPlanView, note: string) => Promise<void>;
  withdrawOffer: (plan: CollectionPlanView) => Promise<void>;
}

export interface CollectionPlansState {
  data: CollectionPlansResponse | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  clearNotice: () => void;
  refresh: () => Promise<void>;
  actions: CollectionPlansActions;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试';
}

export function useCollectionPlans(groupId: string | null): CollectionPlansState {
  const [data, setData] = useState<CollectionPlansResponse | null>(null);
  const [loading, setLoading] = useState(groupId != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!groupId) {
        setData(null);
        setLoading(false);
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (!silent) setLoading(true);
      try {
        const next = await getCollectionPlans(groupId, controller.signal);
        if (controller.signal.aborted) return;
        setData(next);
        setError(null);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(messageOf(failure));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [groupId],
  );

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  // 别人认领 / 上窝后本机要能看到；只在前台轮询，避免后台白烧请求。
  useEffect(() => {
    if (!groupId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [groupId, load]);

  const run = useCallback(
    async <T,>(task: () => Promise<T>, successNotice?: string | null): Promise<T> => {
      setBusy(true);
      try {
        const result = await task();
        if (successNotice) setNotice(successNotice);
        await load(true);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const actions: CollectionPlansActions = {
    create: (input) => run(() => createCollectionPlans(groupId as string, input)),
    start: (plan) =>
      run(async () => {
        await startCollectionPlan(groupId as string, plan.id);
      }),
    complete: (plan) =>
      run(async () => {
        await completeCollectionPlan(groupId as string, plan.id);
      }),
    remove: (plan) =>
      run(async () => {
        await deleteCollectionPlan(groupId as string, plan.id);
      }),
    offer: (plan, note) =>
      run(async () => {
        await markPlanOffer(groupId as string, plan.id, note);
      }),
    withdrawOffer: (plan) =>
      run(async () => {
        await withdrawPlanOffer(groupId as string, plan.id);
      }),
  };

  return {
    data,
    loading,
    busy,
    error,
    notice,
    clearNotice: () => setNotice(null),
    refresh: () => load(true),
    actions,
  };
}
