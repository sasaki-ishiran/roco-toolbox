import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 弹层基础（2026-10-24 重构任务 3）：只负责展示与交互基础，不掺业务。
 *
 * - 具名 dialog / aria-modal；打开聚焦内部，关闭把焦点还给触发元素
 * - Tab / Shift+Tab 在弹层内循环，不逃到背景
 * - Esc 只关最上层弹层（嵌套确认不会一起关）
 * - 打开期间锁定背景滚动；多个弹层用计数，内层关闭不会提前解锁
 */
export interface ModalSurfaceProps {
  open: boolean;
  title: string;
  placement?: 'dialog' | 'sheet';
  onClose: () => void;
  children: ReactNode;
  /** 固定在底部、不随正文滚动的动作区 */
  footer?: ReactNode;
  testId?: string;
  closeTestId?: string;
  backdropTestId?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 弹层栈：只有最上层响应 Esc */
const stack: string[] = [];
/** 背景滚动锁计数（多个弹层同时打开时只锁一次） */
let lockCount = 0;
let overflowBeforeLock = '';

function lockScroll(): void {
  if (lockCount === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function unlockScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = overflowBeforeLock;
}

export function ModalSurface({
  open,
  title,
  placement = 'dialog',
  onClose,
  children,
  footer,
  testId,
  closeTestId,
  backdropTestId,
}: ModalSurfaceProps) {
  const titleId = useId();
  const modalId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // 调用方的 onClose 常是内联箭头：放进 ref，避免每次父组件渲染都拆掉焦点/滚动锁
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    stack.push(modalId);
    lockScroll();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stack[stack.length - 1] !== modalId) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    // 等 portal 内容提交后再聚焦
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      const index = stack.lastIndexOf(modalId);
      if (index >= 0) stack.splice(index, 1);
      unlockScroll();
      restoreRef.current?.focus?.();
    };
  }, [open, modalId]);

  if (!open) return null;

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusables = panelRef.current
      ? [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      : [];
    if (focusables.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex justify-center bg-slate-900/40 p-4 ${
        placement === 'sheet' ? 'items-end p-0' : 'items-center'
      }`}
      data-testid={testId}
    >
      <button
        type="button"
        aria-label="关闭弹层"
        onClick={onClose}
        data-testid={backdropTestId}
        className="absolute inset-0"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={`relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden bg-white shadow-xl focus:outline-none ${
          placement === 'sheet' ? 'rounded-t-2xl' : 'rounded-2xl'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid={closeTestId}
            className="min-h-[44px] min-w-[44px] shrink-0 rounded-full text-lg leading-none text-slate-400"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? (
          <div
            className={`shrink-0 border-t border-slate-100 p-3 ${
              placement === 'sheet' ? 'pb-[max(0.75rem,env(safe-area-inset-bottom))]' : ''
            }`}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
