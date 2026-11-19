import { useEffect } from 'react';
import {
  bodyMedalIcon,
  petVoiceMedalIcon,
  voiceMedalIconByLabel,
  voiceMedalLabel,
} from '../domain/petIcons';
import type { GapFill, GapRoute } from '../domain/gapFill';
import { PairingPetCard } from './NestPlanCard';
import { PetAvatar } from './PetAvatar';
import { StudStack } from './StudStack';
import type { StudCandidate } from '../domain/studCandidates';

/**
 * 「这个缺口怎么补」悬浮窗（2026-11-19 用户口径）。
 *
 * 同一块内容复用到三处：看板种公推荐 / 收集母本 / 收集种公矩阵的缺口格。
 * 区别只有目标卡底色（母本粉 / 种公蓝）和 eyebrow 文案，其余一套：
 * 上方「目标卡 + 小组求助卡」，下方「本号直配 / 跨号传蛋」两段，卡底右侧「加入配窝建议」；
 * 两段都补不了时不再画两个空框，改成红框感叹号 + 「本号、跨号都无法配对」。
 */
export interface GapTargetView {
  kind: 'mother' | 'stud';
  name: string;
  number?: string;
  gameId: number | null;
  /** 目标性格（卡右上角，最多两个） */
  natures: readonly string[];
  eggGroupLabels: readonly string[];
  /** 右上角状态：未收集 / 推荐 / 缺口 */
  tag: string;
  /** 卡底一行：目标 满分大婉 / 目标 满分大粗 / 目标 大婉（双牌） */
  targetLabel?: string;
  /** 目标奖牌（有就给图标，没有就只写文字） */
  bodyMedal?: string | null;
  /**
   * 声音目标标签（`+100` / `-100` / `婉转声` / `粗嗓门`），按它取奖牌图：
   * 追满分用 MAX 缎带、追双牌用普通奖牌。只给 dB 分不出「满分」和「双牌」。
   */
  voiceTarget?: string | null;
  voiceDb?: number | null;
  weightPercent?: number | null;
}

export interface GapFillDialogProps {
  target: GapTargetView | null;
  fill: GapFill | null;
  /** 蛋组标签是否已收齐（按这条线所属的号） */
  collectedGroupIds?: ReadonlySet<number>;
  onClose: () => void;
  onSeekHelp?: () => void;
  /** 「加入配窝建议」：把这条线记进计划 */
  onAddToPlan?: (route: GapRoute) => void;
  /** 自定义 eyebrow：看板种公推荐写「种公推荐 · 怎么补」 */
  eyebrow?: string;
  /**
   * 目标奖牌是否已选。没选档位时母本 / 种公都算不出配窝线，
   * 这时不能写「本号、跨号都无法配对」——那会把「没设置目标」说成「配不出来」。
   */
  targetReady?: boolean;
  /** 种公缺口格：候选种公（有就改用「堆叠卡」替代目标卡） */
  studCandidates?: readonly StudCandidate[];
  /** 点了某只候选公（写回种公阵列） */
  onSelectStud?: (candidate: StudCandidate) => void;
}

const percent = (chance: number): string => `${Math.round(chance * 100)}%`;

/**
 * 卡片右侧的流向：跨号写「云舟 → 昭昭」；本号不写。
 * 目标号与源号相同（本号配窝）时也不要画成「昭昭 → 昭昭」。
 */
export function GapRouteFlow({ route }: { route: GapRoute }) {
  if (route.kind !== 'transfer') return null;
  const source = route.sourceAccount;
  if (!source || source === route.account) return null;
  return (
    <span className="shrink-0 whitespace-nowrap text-[10px] text-sky-700" data-testid="gap-route-flow">
      {source} → {route.account}
    </span>
  );
}

function TargetCard({ target }: { target: GapTargetView }) {
  const mother = target.kind === 'mother';
  // 体型用普通奖牌：MAX 缎带是「极限/满体重」的图，目标卡只是大块头 / 小不点（与顶部档位选择器同口径）
  const bodyIcon = bodyMedalIcon(target.bodyMedal);
  // 声音按目标标签取图：+100 / -100 才有 MAX 缎带，双牌档（婉转声 / 粗嗓门）是普通奖牌
  const voiceIcon = target.voiceTarget
    ? voiceMedalIconByLabel(target.voiceTarget)
    : petVoiceMedalIcon(target.voiceDb);
  const voiceTitle = target.voiceTarget
    ? voiceMedalLabel(target.voiceTarget)
    : target.voiceDb != null
      ? `声音 ${target.voiceDb}dB`
      : '';
  return (
    <article
      className={`relative h-[92px] w-full min-w-0 overflow-hidden rounded-xl p-1.5 shadow-sm ${
        mother ? 'border border-pink-200 bg-pink-50' : 'border border-sky-200 bg-sky-50'
      }`}
      data-testid="gap-target-card"
    >
      <header className="absolute inset-x-1.5 top-1.5 z-10 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-0.5">
        <div className="flex min-w-0 flex-col items-start gap-px">
          {target.eggGroupLabels.slice(0, 2).map((label) => (
            <span
              key={label}
              className={`max-w-full truncate rounded px-1 py-px text-[9px] leading-3 ${
                mother ? 'bg-pink-100 text-pink-800' : 'bg-sky-100 text-sky-800'
              }`}
            >
              {label}
            </span>
          ))}
          {bodyIcon || voiceIcon ? (
            <span className="mt-0.5 flex items-center gap-1">
              {bodyIcon ? (
                <img src={bodyIcon} alt={target.bodyMedal ?? ''} className="h-3.5 w-3.5" />
              ) : null}
              {voiceIcon ? (
                <img src={voiceIcon} alt="" title={voiceTitle} className="h-3.5 w-3.5" />
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-px">
          {target.natures.slice(0, 2).map((nature) => (
            <span
              key={nature}
              className="max-w-full truncate rounded bg-amber-50 px-1 py-px text-[10px] leading-3 font-medium text-amber-800"
            >
              {nature}
            </span>
          ))}
          <span
            className={`rounded px-1 py-px text-[9px] leading-3 font-medium ${
              mother ? 'bg-rose-100 text-rose-700' : 'bg-sky-200 text-sky-800'
            }`}
            data-testid="gap-target-tag"
          >
            {target.tag}
          </span>
        </div>
      </header>
      <div className="absolute left-1/2 top-[8px] flex h-11 w-11 -translate-x-1/2 items-center justify-center">
        <PetAvatar gameId={target.gameId} name={target.name} size={44} />
      </div>
      <h4
        className="absolute inset-x-1 truncate text-center text-[11px] font-bold leading-[14px] text-slate-900"
        style={{ top: 60 }}
        title={target.name}
      >
        {target.name}
      </h4>
      <p className="absolute inset-x-1 truncate text-center text-[9px] leading-3 text-slate-400" style={{ top: 76 }}>
        {target.targetLabel ?? (target.number ? `No.${target.number}` : '')}
      </p>
    </article>
  );
}

/**
 * 小组求助卡：上方写概率 / 已有几条线，下面只留「去求蛋」。
 * 原型里删掉了那句解释，所以这里不再写「找组员要」之类的说明。
 */
function HelpCard({
  fill,
  routeCount,
  bestChance,
  onSeekHelp,
}: {
  fill: GapFill;
  routeCount: number;
  bestChance: number | null;
  onSeekHelp?: () => void;
}) {
  const main =
    routeCount > 0 && bestChance != null
      ? `已有 ${routeCount} 条 ${percent(bestChance)} 的线`
      : fill.helpChance != null
        ? `对性母 ${percent(fill.helpChance)}`
        : null;
  return (
    <div
      className="flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white p-2 text-center"
      data-testid="gap-help-card"
    >
      <span className="text-[12px] leading-4 font-medium text-slate-500">小组求助</span>
      {main ? (
        <p className="text-[13px] leading-4 font-semibold text-slate-800" data-testid="gap-help-main">
          {main}
        </p>
      ) : null}
      {onSeekHelp ? (
        <button
          type="button"
          onClick={onSeekHelp}
          data-testid="gap-help-action"
          className="mt-0.5 min-h-[26px] rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-medium text-emerald-700 active:bg-emerald-100"
        >
          小组求蛋 ›
        </button>
      ) : null}
    </div>
  );
}

function RouteBlock({
  route,
  title,
  missingNote,
  collectedGroupIds,
  onAddToPlan,
}: {
  route: GapRoute;
  title: string;
  missingNote: string;
  collectedGroupIds: ReadonlySet<number>;
  onAddToPlan?: (route: GapRoute) => void;
}) {
  return (
    <section
      className={`rounded-xl border-l-4 px-2 py-2 ${
        route.kind === 'self' ? 'border-amber-400 bg-slate-50' : 'border-sky-400 bg-slate-50'
      }`}
      data-testid={`gap-route-${route.kind}`}
      aria-label={missingNote}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-600">{title}</span>
        <GapRouteFlow route={route} />
        <span className="ml-auto shrink-0 text-[11px] font-bold text-slate-800" data-testid="gap-route-chance">
          {percent(route.chance)}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <PairingPetCard pet={route.mother} collectedGroupIds={collectedGroupIds} />
        <PairingPetCard pet={route.father} collectedGroupIds={collectedGroupIds} />
      </div>
      {onAddToPlan ? (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => onAddToPlan(route)}
            data-testid="gap-add-to-plan"
            className="min-h-[24px] rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-medium text-emerald-700 active:bg-emerald-50"
          >
            加入配窝建议
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** 少一截的样子：虚框写「无对应母本 / 无对应种公」，不画两个空配窝卡 */
function MissingRoute({ title, note }: { title: string; note: string }) {
  return (
    <section
      className="rounded-xl border border-dashed border-slate-200 px-2 py-2"
      data-testid="gap-route-missing"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-400">{title}</span>
        <span className="ml-auto text-[11px] text-slate-300">—</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{note}</p>
    </section>
  );
}

export function GapFillDialog({
  target,
  fill,
  collectedGroupIds = new Set<number>(),
  onClose,
  onSeekHelp,
  onAddToPlan,
  eyebrow,
  targetReady = true,
  studCandidates,
  onSelectStud,
}: GapFillDialogProps) {
  // 打开时按 Esc 关闭（手机上没有键盘，桌面 / 网页端有用）
  useEffect(() => {
    if (!target) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, onClose]);

  if (!target) return null;

  const mother = target.kind === 'mother';
  const routes: GapRoute[] = [fill?.self, fill?.transfer].filter(
    (route): route is GapRoute => route != null,
  );
  const bestChance = routes.length > 0 ? Math.max(...routes.map((route) => route.chance)) : null;
  const label = eyebrow ?? (mother ? '母本缺口 · 怎么补' : '种公缺口 · 怎么补');
  const missingNote = mother ? '无对应母本' : '无对应种公';
  /** 跨号那截缺的是「别的号也没这条线」，不是「没有母本」，文案要分开写 */
  const transferMissingNote = mother ? '别的号也没有过线的配法' : '别的号也没有这一格的线';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3.5"
      data-testid="gap-fill-layer"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50"
        aria-label="关闭悬浮窗"
        onClick={onClose}
        data-testid="gap-fill-backdrop"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="怎么补"
        className="relative flex max-h-[92%] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        data-testid="gap-fill-dialog"
      >
        <div className="flex items-start gap-2 px-3 pt-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-wide text-emerald-600" data-testid="gap-fill-eyebrow">
              {label}
            </p>
            <h2 className="flex min-w-0 items-baseline gap-1 text-base font-bold text-slate-900">
              <span className="truncate">{target.name}</span>
              {target.number ? (
                <small className="shrink-0 text-[11px] font-normal text-slate-400">No.{target.number}</small>
              ) : null}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="gap-fill-close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm text-slate-500"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {studCandidates && studCandidates.length > 0 ? (
            <div className="mt-2">
              <StudStack
                candidates={studCandidates}
                onSelect={onSelectStud}
                aside={
                  <HelpCard
                    fill={fill ?? { self: null, transfer: null, helpChance: null }}
                    routeCount={routes.length}
                    bestChance={bestChance}
                    onSeekHelp={onSeekHelp}
                  />
                }
              />
            </div>
          ) : (
          <div
            className="mt-2 grid grid-cols-2 gap-1.5"
            data-testid="gap-top-row"
          >
            <TargetCard target={target} />
            <HelpCard
              fill={fill ?? { self: null, transfer: null, helpChance: null }}
              routeCount={routes.length}
              bestChance={bestChance}
              onSeekHelp={onSeekHelp}
            />
          </div>
          )}

          <div className="mt-2 space-y-2">
            {routes.length === 0 && !targetReady ? (
              <p
                className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-800"
                data-testid="gap-need-target"
              >
                先在目标里选体型与声音奖牌，再算本号直配 / 跨号传蛋。
              </p>
            ) : routes.length === 0 ? (
              <p
                className="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-2 py-2 text-[11px] leading-4 font-medium text-rose-700"
                data-testid="gap-unpairable"
              >
                <span
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-rose-400"
                  aria-hidden="true"
                >
                  {/* 用两根圆角线画「!」：字体字形在不同浏览器里会偏左上，画出来才能和文本真正居中对齐 */}
                  <span className="flex flex-col items-center gap-[2px]">
                    <span className="block h-[5px] w-px rounded-full bg-rose-500" />
                    <span className="block h-[1.5px] w-[1.5px] rounded-full bg-rose-500" />
                  </span>
                </span>
                本号、跨号都无法配对
              </p>
            ) : (
              <>
                {fill?.self ? (
                  <RouteBlock
                    route={fill.self}
                    title="本号直配"
                    missingNote={missingNote}
                    collectedGroupIds={collectedGroupIds}
                    onAddToPlan={onAddToPlan}
                  />
                ) : (
                  <MissingRoute title="本号直配" note={missingNote} />
                )}
                {fill?.transfer ? (
                  <RouteBlock
                    route={fill.transfer}
                    title="跨号传蛋"
                    missingNote={missingNote}
                    collectedGroupIds={collectedGroupIds}
                    onAddToPlan={onAddToPlan}
                  />
                ) : (
                  <MissingRoute title="跨号传蛋" note={transferMissingNote} />
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
