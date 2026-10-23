import type { ReactNode } from 'react';
import type { ChangelogEntry } from '../data/changelog';
import { ModalSurface } from './primitives/ModalSurface';

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
    <ModalSurface
      open
      title="更新内容"
      onClose={onClose}
      testId="changelog-modal"
      closeTestId="changelog-close"
      footer={
        <button
          type="button"
          onClick={onClose}
          data-testid="changelog-ok"
          className="min-h-[44px] w-full rounded-xl bg-emerald-600 text-sm font-medium text-white active:bg-emerald-700"
        >
          知道了
        </button>
      }
    >
      <div className="space-y-4 px-4 py-3" data-testid="changelog-body">
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
    </ModalSurface>
  );
}
