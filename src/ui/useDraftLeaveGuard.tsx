import { useCallback, useEffect, useRef, useState } from 'react';
import { ModalSurface } from './primitives/ModalSurface';
import { Button } from './primitives/Button';

/** 把可能丢掉草稿的动作延后到明确确认之后；Esc、外点和取消都继续编辑。 */
export function useDraftLeaveGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const pending = useRef<((leave: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, []);

  const confirmLeave = useCallback((): Promise<boolean> => {
    if (!dirtyRef.current) return Promise.resolve(true);
    // 重复点导航时，旧的待执行动作作废，避免一次确认执行多个跳转。
    pending.current?.(false);
    setOpen(true);
    return new Promise((resolve) => { pending.current = resolve; });
  }, []);

  const finish = (leave: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOpen(false);
    resolve?.(leave);
  };

  const leaveConfirmation = (
    <ModalSurface
      open={open}
      title="有未发布的选号修改"
      onClose={() => finish(false)}
      testId="draft-leave-confirmation"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => finish(false)}>继续编辑</Button>
          <Button variant="danger" onClick={() => finish(true)}>放弃并离开</Button>
        </div>
      }
    >
      <p className="p-4 text-sm text-slate-600">离开会丢弃本次选号草稿，已发布的资源保持不变。</p>
    </ModalSurface>
  );

  return { confirmLeave, leaveConfirmation };
}
