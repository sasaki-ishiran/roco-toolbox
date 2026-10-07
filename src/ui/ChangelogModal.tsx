import type { ReactNode } from 'react';
import type { ChangelogEntry } from '../data/changelog';

/**
 * 把条目里的 `**重点**` 渲染成粗体。
 *
 * 2026-10-07：以前这里是纯文本渲染，文案里写 `**` 会把星号原样显示出来（所以老约定是
 * "别写粗体"）。现在真的支持粗体了，写 `**……**` 就会加粗——文案里可以放心标重点。
 */
export function renderChangelogItem(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-slate-800">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/**
 * 更新内容弹窗（2026-10-05 起固定做法）：
 * App 启动时若本机有没看过的更新，就用它盖一层弹窗展示。
 * - 点「知道了」关闭，并记住已读（同一条不再打扰）；
 * - 内容可滚动，条目多也不会顶破屏幕。
 */
export function ChangelogModal({
  entries,
  onClose,
}: {
  entries: ChangelogEntry[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-title"
      data-testid="changelog-modal"
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 id="changelog-title" className="text-base font-semibold text-slate-900">
            更新内容
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="changelog-close"
            className="min-h-[32px] min-w-[32px] rounded-full text-lg leading-none text-slate-400"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" data-testid="changelog-body">
          {entries.map((entry) => (
            <section key={entry.id}>
              <h3 className="text-sm font-medium text-slate-700">{entry.title}</h3>
              <ul className="mt-1.5 space-y-1.5">
                {entry.items.map((item) => (
                  <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-slate-600">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                    <span>{renderChangelogItem(item)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={onClose}
            data-testid="changelog-ok"
            className="min-h-[44px] w-full rounded-xl bg-emerald-600 text-sm font-medium text-white active:bg-emerald-700"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
