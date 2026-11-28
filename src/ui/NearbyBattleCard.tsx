import type { SeasonEncounter } from '../collector/captureProgress';
import {
  battleTargetHit,
  isBattleTargetEmpty,
  setBattleTarget,
  useBattleTarget,
  type BattleTarget,
} from '../collector/battleTargetStore';
import { InlineMultiSelect } from './primitives/InlineMultiSelect';
import { InlineSelect } from './primitives/InlineSelect';
import { NatureMultiSelect } from './primitives/NatureMultiSelect';
import { SegmentedControl } from './primitives/SegmentedControl';

/**
 * 战斗采集模块卡（2026-11-07 剥离）。
 *
 * - 常驻展示「强提醒目标」设置：进入赛季奇遇战后，守卫数据一到就按目标判定；
 *   命中 → 悬浮球变色（见 BattleHudOrb）+ 卡片上给「命中」标签。
 * - 性格 / 声音 / 体型支持多选（2026-11-08）：同一维度里选中任意一个即算该维度命中；
 *   性别公母互斥，保持单选。
 * - 匹配方式「满足其一 / 全部满足」管的是维度之间的关系；一个维度都没选 = 没设目标，永不变色。
 * - 阈值与雷达牌子同口径（±96dB 婉转声/粗嗓门、体重百分位 ≥98/≤2 大块头/小不点）。
 */
export function NearbyBattleCard({ encounter }: { encounter: SeasonEncounter | null }) {
  const target = useBattleTarget();
  const targetSet = !isBattleTargetEmpty(target);
  const hit = encounter != null && battleTargetHit(target, encounter);

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="nearby-battle-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">战斗 · 赛季奇遇</h2>
        {hit ? (
          <span
            className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700"
            data-testid="battle-target-hit"
          >
            命中目标
          </span>
        ) : encounter && targetSet ? (
          <span
            className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"
            data-testid="battle-target-miss"
          >
            未命中
          </span>
        ) : null}
      </div>

      {encounter ? (
        <div
          className="mt-2 rounded-xl bg-amber-50 p-2 ring-1 ring-amber-200"
          data-testid="battle-encounter-detail"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-800">
              {`赛季奇遇 · ${encounter.rewardName || encounter.guardName}`}
            </p>
            <span className="text-[11px] text-amber-600">
              {encounter.rewardName ? `守卫 ${encounter.guardName}` : '捕获后确认精灵'}
            </span>
          </div>
          <p className="mt-1 text-xs text-amber-700">
            {[
              `L${encounter.level}`,
              encounter.gender,
              encounter.natureConfirmed ? encounter.nature || '性格未知' : '性格未生成',
            ].filter(Boolean).join(' · ')}
          </p>
          <p className="text-[11px] text-amber-600">
            {[
              `身高 ${(encounter.height / 100).toFixed(2)}m${encounter.heightPct != null ? `（${encounter.heightPct}%）` : ''}`,
              `体重 ${(encounter.weight / 1000).toFixed(2)}kg${encounter.weightPct != null ? `（${encounter.weightPct}%）` : ''}`,
              encounter.voiceDb != null ? `声音 ${encounter.voiceDb}dB` : '',
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-400">进入赛季奇遇战后，这里会显示守卫的个体数据。</p>
      )}

      <div className="mt-2 space-y-1.5" data-testid="battle-target-editor">
        <p className="text-[11px] text-slate-400">强提醒目标：出现命中个体时，悬浮球变色提醒。</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <NatureMultiSelect
            label="目标性格"
            values={target.natures}
            onValuesChange={(natures) => setBattleTarget({ natures })}
            allLabel="性格不限"
            testId="battle-target-nature"
            menuTestId="battle-target-nature-menu"
            optionTestId={(value) => `battle-target-nature-${value || 'any'}`}
          />
          <InlineSelect
            label="目标性别"
            value={target.gender}
            options={[
              { value: '', label: '性别不限' },
              { value: '公', label: '公' },
              { value: '母', label: '母' },
            ]}
            onValueChange={(gender) => setBattleTarget({ gender: gender as '公' | '母' })}
            testId="battle-target-gender"
            optionTestId={(value) => `battle-target-gender-${value || 'any'}`}
          />
          <InlineMultiSelect
            label="目标声音"
            values={target.voices}
            options={[
              { value: '+100', label: '+100' },
              { value: '-100', label: '-100' },
              { value: '婉转声', label: '婉转声' },
              { value: '粗嗓门', label: '粗嗓门' },
            ]}
            onValuesChange={(voices) => setBattleTarget({ voices: voices as BattleTarget['voices'] })}
            allLabel="声音不限"
            unit="项"
            testId="battle-target-voice"
            menuTestId="battle-target-voice-menu"
            optionTestId={(value) => `battle-target-voice-${value || 'any'}`}
          />
          <InlineMultiSelect
            label="目标体型"
            values={target.bodies}
            options={[
              { value: 'big', label: '大块头' },
              { value: 'small', label: '小不点' },
            ]}
            onValuesChange={(bodies) => setBattleTarget({ bodies: bodies as BattleTarget['bodies'] })}
            allLabel="体型不限"
            unit="项"
            testId="battle-target-body"
            menuTestId="battle-target-body-menu"
            optionTestId={(value) => `battle-target-body-${value || 'any'}`}
          />
        </div>
        <SegmentedControl
          label="目标匹配方式"
          value={target.mode}
          options={[
            { value: 'any', label: '满足其一' },
            { value: 'all', label: '全部满足' },
          ]}
          onValueChange={(mode) => setBattleTarget({ mode: mode as 'any' | 'all' })}
          optionTestId={(value) => `battle-target-mode-${value}`}
        />
      </div>
    </section>
  );
}
