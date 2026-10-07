import { useState } from 'react';

/**
 * 使用教程弹窗：首启自动弹（见 App），也可从顶部「教程」随时打开。
 *
 * 结构 = **前两页先讲「这是什么、值在哪」（功能简介）** → 后面按「第一次打开该干什么」的顺序
 * 讲操作：导数据 → 看板 → 云同步。
 * 推荐种公 / 配窝建议的说明只放在第 1 页（功能简介），不再单独开页（内容重复）。
 * 不解释游戏机制（那些玩家自己懂），只讲「这个工具怎么用」。
 */
export interface GuideStep {
  title: string;
  points: string[];
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    title: '这个工具能帮你做什么',
    points: [
      '根据你已有的精灵，给出配窝建议与推荐种公，让你快人一步把各蛋组的推荐种公集齐',
      '推荐种公：把你的精灵和每个蛋组要收的目标比一遍，列出还缺哪些。推荐的种公常常能同时覆盖好几个目标，照这份清单去补最省事',
      '配窝建议：按账号给出 11 个窝（1 个学院小窝 + 10 个普通小窝）怎么摆、谁和谁配、每条线在补什么。摆位按游戏的窝尺寸和配对距离画，照着摆就能连上',
    ],
  },
  {
    title: '关于档位和性格',
    points: [
      '四大档位都能追：不只是最热门的满分大婉，小婉 / 大粗 / 小粗 也在里面。看板顶部点一下，覆盖度、母本、配窝全都跟着变',
      '目标性格不是随便定的：每个蛋组该收哪几个性格，是按这些性格在实际对局里的使用情况推出来的。按它收集，收的就是这个蛋组真正热门、值得留的性格',
      '想追自用的性格，可以切「自选性格」自己勾',
    ],
  },
  {
    title: '怎么开始：先把数据导进来',
    points: [
      '用数据采集器抓一次包 → 在采集器里点「分享」，选「洛克工具箱」；也可以「导出全部数据」后把文件传过来',
      '已经有备份文件也行：在微信/QQ 里直接分享给「洛克工具箱」，或到「导入数据」页选文件',
      '回看板：进度、该补的种公、怎么配窝都出来了',
      '数据只存在这台设备上；换手机或多设备用「导出 + 合并导入」或「云同步」（推荐）',
    ],
  },
  {
    title: '看板：今天该补什么',
    points: [
      '覆盖度 = 还缺哪些「蛋组 × 性格 × 档位」；种公全收集 / 母本全收集 = 两边的进度',
      '顶部「当前模式」是全站口径：追满分 / 追双牌 + 目标档位，看板、覆盖度、母本、配窝都按它算',
    ],
  },
  {
    title: '云同步（可选）：换手机不丢数据',
    points: [
      '「导入数据」页点「开启云同步」→ 拿到恢复码（只显示一次，请复制或截图保存）',
      '新手机输入恢复码即可一键把数据拉过去（合并，不会清掉新手机上的数据）',
    ],
  },
];

export function GuideModal({ onClose, startAt = 0 }: { onClose: () => void; startAt?: number }) {
  const [step, setStep] = useState(Math.min(Math.max(startAt, 0), GUIDE_STEPS.length - 1));
  const current = GUIDE_STEPS[step];
  const last = step === GUIDE_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      data-testid="guide-modal"
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 id="guide-title" className="text-base font-semibold text-slate-900">
            使用教程
          </h2>
          <span className="text-xs text-slate-400" data-testid="guide-progress">
            {step + 1} / {GUIDE_STEPS.length}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="guide-body">
          <h3 className="text-sm font-semibold text-emerald-700">{current.title}</h3>
          <ul className="mt-2 space-y-2">
            {current.points.map((point) => (
              <li key={point} className="flex gap-2 text-[13px] leading-relaxed text-slate-600">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={onClose}
            data-testid="guide-skip"
            className="min-h-[44px] rounded-xl px-3 text-sm text-slate-400"
          >
            跳过
          </button>
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((value) => value - 1)}
              data-testid="guide-prev"
              className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600"
            >
              上一步
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (last ? onClose() : setStep((value) => value + 1))}
            data-testid={last ? 'guide-done' : 'guide-next'}
            className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 text-sm font-medium text-white active:bg-emerald-700"
          >
            {last ? '开始用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
