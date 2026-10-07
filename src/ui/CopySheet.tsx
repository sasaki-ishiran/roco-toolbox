import { useEffect, useState } from 'react';

export interface CopySheetProps {
  open: boolean;
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const PREVIEW_OFF_KEY = 'roco.copyPreviewOff';

export function isCopyPreviewOff(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 复制前预览弹窗（2026-10-04 用户拍板）：底部弹出，展示要复制的清单文本，
 * 可勾选「不再提示」（localStorage 记住偏好）。
 */
export function CopySheet({ open, text, onConfirm, onCancel }: CopySheetProps) {
  const [noMore, setNoMore] = useState(false);

  // 组件常驻挂载（关闭时只是 return null），勾选会跨开关保留：
  // 上次点了「取消」就意味着没确认过偏好，重新打开必须复位，否则下次直接点复制会误存「不再提示」
  useEffect(() => {
    if (!open) setNoMore(false);
  }, [open]);

  const confirm = () => {
    if (noMore) {
      try {
        window.localStorage.setItem(PREVIEW_OFF_KEY, '1');
      } catch {
        // 隐私模式下写不了：下次照旧预览
      }
    }
    onConfirm();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      data-testid="copy-sheet"
    >
      {/* 遮罩 */}
      <button
        type="button"
        aria-label="关闭预览"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
        data-testid="copy-sheet-backdrop"
      />
      <div className="relative w-full rounded-t-2xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-900">复制预览</h3>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[28px] text-xs text-slate-400"
            data-testid="copy-sheet-cancel"
          >
            取消
          </button>
        </div>
        <pre
          className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700"
          data-testid="copy-sheet-preview"
        >
          {text}
        </pre>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={noMore}
            onChange={(event) => setNoMore(event.target.checked)}
            className="h-4 w-4 accent-emerald-600"
            data-testid="copy-sheet-no-more"
          />
          不再提示，以后直接复制
        </label>
        <button
          type="button"
          onClick={confirm}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white"
          data-testid="copy-sheet-confirm"
        >
          复制
        </button>
      </div>
    </div>
  );
}
