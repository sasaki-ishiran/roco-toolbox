import { useEffect, useMemo, useRef, useState } from 'react';
import { clearAutoImportCompletion, requestAutoImport, useAutoImport } from '../../collector/autoImportFlow';
import { useCaptureOrigin } from '../../collector/captureOriginStore';
import { useImportOutcome } from '../importOutcomeStore';

/**
 * 采集卡的一次性完成态（2026-11-28 UX1 定稿追加，AV2 移植到两卡版）。
 *
 * 数据只认 `autoImportFlow` 的 completion：成功（done）显示绿色「已导入」+ 一条
 * `role="status"`；失败（failed）显示琥珀条 + 重试，绝不落成成功态。
 * 手动停止不会产生 completion，所以什么条都不出现。
 *
 * 「一次性」按本机 session 记账（`roco.profileImportDone`）：
 * 点 × / 再次开始采集 / 离开「我的」后都不再出现；失败态不因离开而消失，
 * 留着让用户重试。完成条里的「新增 N 个角色」直接用导入结果（ImportOutcome）
 * 的 message，不另外统计。
 */
const DONE_KEY = 'roco.profileImportDone';

function readDone(): string | null {
  try {
    return window.localStorage.getItem(DONE_KEY);
  } catch {
    return null;
  }
}

function markDone(session: string): void {
  try {
    window.localStorage.setItem(DONE_KEY, session);
  } catch {
    // 隐私模式 / 存储被禁用：本次仍然生效，只是下次进来可能再出现
  }
}

function clockText(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface CollectCompletion {
  /** 这一轮是否要画完成条（成功或失败） */
  show: boolean;
  success: boolean;
  failed: boolean;
  session: string | null;
  /** 完成时间 HH:mm（自动导入结束的那一刻，不是当前时间） */
  at: string | null;
  /** 导入结果里的就绪文案（如「新增 2 个角色」）；没有就只显示时间 */
  detail: string | null;
  error: string | null;
  /** 点 ×：记账并清掉完成态 */
  dismiss: () => void;
  /** 失败条上的「重试」：复用同一个会话再走一遍自动导入 */
  retry: () => void;
  /** 新一轮采集开始：把这次完成态消费掉 */
  consume: () => void;
}

export function useCollectCompletion(): CollectCompletion {
  const flow = useAutoImport();
  const outcome = useImportOutcome();
  const origin = useCaptureOrigin();
  const session = flow.completion?.session ?? null;
  const success = session != null && flow.stage === 'done' && flow.completionError == null;
  const failed = session != null && (flow.stage === 'failed' || flow.completionError != null);

  const [doneSession, setDoneSession] = useState<string | null>(() => readDone());
  /** 完成态出现后，采集归属换到新会话 / 新来源 = 用户又点了一次开始 */
  const [restartedSession, setRestartedSession] = useState<string | null>(null);
  const baselineOrigin = useRef<{ origin: string | null; session: string | null } | null>(null);
  const latest = useRef({ session, success });
  latest.current = { session, success };

  const at = useMemo(() => (session ? clockText() : null), [session]);
  const consumed = session != null && (doneSession === session || restartedSession === session);

  // 记下完成态出现时的采集归属：之后归属一变就是新一轮采集
  useEffect(() => {
    baselineOrigin.current = session
      ? { origin: origin.origin, session: origin.session }
      : null;
    // 只跟 completion session 走；归属的后续变化由下面的 effect 判断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    const base = baselineOrigin.current;
    if (!session || !base || consumed) return;
    const startedFresh =
      (origin.session != null && origin.session !== session) ||
      (origin.origin != null && origin.origin !== base.origin);
    if (!startedFresh) return;
    setRestartedSession(session);
    markDone(session);
    clearAutoImportCompletion();
  }, [origin.origin, origin.session, session, consumed]);

  // 离开「我的」也算看过：成功态记账；失败态留着，回来还能重试
  useEffect(
    () => () => {
      const current = latest.current;
      if (current.session && current.success) markDone(current.session);
    },
    [],
  );

  const consume = () => {
    if (session) {
      markDone(session);
      setDoneSession(session);
    }
    clearAutoImportCompletion();
  };

  return {
    show: session != null && !consumed && (success || failed),
    success: session != null && success && !consumed,
    failed: session != null && failed && !consumed,
    session,
    // 失败态不显示「几点 + 新增」成功文案
    at: success ? at : null,
    detail: success && outcome.local === 'saved' ? outcome.message : null,
    error: flow.completionError,
    dismiss: consume,
    retry: () => {
      if (session) requestAutoImport(session);
    },
    consume,
  };
}
