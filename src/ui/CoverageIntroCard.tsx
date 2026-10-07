import { useState } from 'react';

/**
 * 「覆盖度怎么看」的极简说明卡（2026-10-07）。
 *
 * 背景：新用户从看板「去看怎么迭代」跳过来时，不清楚这一页有什么、先看哪儿（一进来就是
 * 14 行蛋组 + 一堆筛选），容易懵。所以在页内给一张 3 条的极简说明，点「知道了」关掉并记住。
 *
 * 与教程一样记**版本号**：以后文案改了把版本号 +1，就能再给所有用户展示一次。
 */
const INTRO_SEEN_KEY = 'roco.coverageIntroSeen';
export const COVERAGE_INTRO_VERSION = '1';

export function coverageIntroPending(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(INTRO_SEEN_KEY) !== COVERAGE_INTRO_VERSION;
  } catch {
    return false;
  }
}

export function markCoverageIntroSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INTRO_SEEN_KEY, COVERAGE_INTRO_VERSION);
  } catch {
    // 隐私模式写不了：这次关掉就算，下次再显示
  }
}

const LINES = [
  '每个蛋组一行，看这组还缺哪些「性格 × 档位」；行首圆点：灰＝未收集 · 蓝＝可迭代 · 绿＝已通',
  '点开一行看明细：谁进学院小窝、旁边配哪只（蓝色那行会直接给出这一对）',
  '下面只管筛选这页看哪些组 / 性格；目标档位在看板顶部选，全站通用；缺的精灵去「换什么」弄',
];

export function CoverageIntroCard() {
  const [open, setOpen] = useState(() => coverageIntroPending());

  if (!open) return null;

  return (
    <section
      className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3"
      data-testid="coverage-intro"
    >
      {/* 标题刻意不含「覆盖度」：页头已经有一个「覆盖度」标题，重复会让按名称找标题的查询撞车 */}
      <h2 className="text-sm font-medium text-emerald-800">怎么看这页</h2>
      <ul className="mt-1 space-y-1 text-xs leading-relaxed text-emerald-900/80">
        {LINES.map((line) => (
          <li key={line} className="flex gap-1.5">
            <span aria-hidden>·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {/* 「知道了」放右下角（2026-10-07 用户拍板：符合用户认知，也避免右上角和页头抢注意力） */}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          data-testid="coverage-intro-dismiss"
          onClick={() => {
            markCoverageIntroSeen();
            setOpen(false);
          }}
          className="min-h-[32px] rounded-lg border border-emerald-200 bg-white/70 px-3 text-xs text-emerald-700"
        >
          知道了
        </button>
      </div>
    </section>
  );
}
