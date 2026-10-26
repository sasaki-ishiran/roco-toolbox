import { useEffect, useRef, useState } from 'react';
import { CATALOG_VERSION, eggGroupNames } from '../data/catalog';
import {
  MOTHER_TARGET_BODIES,
  motherCriteriaIdOf,
  motherVoicesForTargetMode,
  slotKeyOf,
  studSlotSetIdOf,
  type GroupTargetConfig,
  type MotherTargetConfig,
  type StudTargetConfig,
} from '../shared/collectionGroups';
import { activeNatureOverrides } from '../domain/recommendedNatures';
import type { CollectionGroupsHook } from './useCollectionGroups';
import { useCoverageSlots } from './useCoverageSlots';
import { getNatureOverrides, useNatureOverrides } from './natureOverrideStore';
import { RecommendedNatureEditor } from './RecommendedNatureEditor';
import { useTargetMode } from './targetModeStore';
import { TARGET_MODE_LABELS } from '../domain/petFilters';

export interface GroupTargetEditorProps {
  hook: CollectionGroupsHook;
}

/**
 * 本组目标：常显摘要；组长可确认/更新。
 *
 * - 母本组：自选模式 × 体型 × 声音；保存后生成新的 criteriaId，成员需重新发布；
 * - 种公组：从个人覆盖目标导入蛋组 × 性格 × 档位，确认后才能发布。
 */
export function GroupTargetEditor({ hook }: GroupTargetEditorProps) {
  const slots = useCoverageSlots();
  const mode = useTargetMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const target = hook.target;
  const isOwner = hook.currentGroup?.group.ownerAccountId === hook.accountId;
  const isStud = hook.groupType === 'stud';
  const isMother = hook.groupType === 'mother';

  const [motherMode, setMotherMode] = useState<'perfect' | 'medal'>('perfect');
  const [bodies, setBodies] = useState<string[]>(['大块头']);
  const [voices, setVoices] = useState<string[]>(['+100']);
  const [requireNatures, setRequireNatures] = useState(false);
  const [natureEditorOpen, setNatureEditorOpen] = useState(false);
  const natureOverrides = useNatureOverrides();
  const mountedRef = useRef(true);
  /** 从个人配置导入的目标先预览，确认后才递增全组修订。 */
  const [pendingTarget, setPendingTarget] = useState<GroupTargetConfig | null>(null);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // 只在「换组 / 目标修订真的变了」时把服务器目标同步到本地编辑态。
  // 不能依赖 target 对象本身：每 15 秒轮询都会解析出新对象，会把组长未保存的编辑悄悄重置。
  const groupId = hook.currentGroup?.group.id ?? '';
  const targetRevision = hook.currentGroup?.group.targetRevision ?? 0;
  useEffect(() => {
    const current = hook.target;
    if (current?.kind !== 'mother') {
      setMotherMode('perfect');
      setBodies(['大块头']);
      setVoices(['+100']);
      setRequireNatures(false);
      return;
    }
    setMotherMode(current.mode);
    setBodies(current.bodies);
    setVoices(current.voices);
    setRequireNatures(current.requireRecommendedNatures === true);
  }, [groupId, targetRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // 切组后不保留上一组的保存提示 / 错误 / 待确认目标
  useEffect(() => {
    setMessage('');
    setError('');
    setPendingTarget(null);
  }, [groupId]);

  const run = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      if (mountedRef.current) setMessage(success);
      return true;
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : '操作失败，请稍后再试';
      if (/目标已被其他设备更新|状态已更新|刷新后再/.test(text)) {
        try {
          await hook.refresh();
        } catch {
          // 刷新失败时保留原错误，用户可手动点刷新
        }
        if (mountedRef.current) setError('已刷新到最新目标，请再保存一次');
      } else if (mountedRef.current) {
        setError(text);
      }
      return false;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const confirmFromPersonal = () => {
    const next: GroupTargetConfig = {
      kind: 'stud',
      mode,
      catalogVersion: CATALOG_VERSION,
      slots: slots.map((slot) => ({
        groupId: slot.groupId,
        natureId: slot.natureId,
        natureName: slot.natureName,
        grade: slot.grade,
      })),
    };
    if (next.slots.length === 0) {
      setError('个人覆盖目标为空：先在收集 · 覆盖矩阵里选择蛋组、性格与档位');
      return;
    }
    // 先预览再确认：点一次就改目标会让全组成员全部重发
    setPendingTarget(next);
  };

  const applyPendingTarget = async () => {
    const next = pendingTarget;
    if (!next) return;
    const ok = await run(() => hook.updateTarget(next), '本组目标已更新，成员需要重新预览并发布');
    if (ok && mountedRef.current) setPendingTarget(null);
  };

  const saveMother = () => {
    if (bodies.length === 0) {
      setError('至少选择一种体型');
      return;
    }
    if (voices.length === 0) {
      setError('至少选择一种声音');
      return;
    }
    // 组长那份推荐性格表在保存这一刻带进目标；之后改表要再保存一次（用户拍板：手动更新口径）
    const overrides = requireNatures ? activeNatureOverrides(getNatureOverrides()) : {};
    const next: MotherTargetConfig = {
      kind: 'mother',
      criteriaId: motherCriteriaIdOf({
        mode: motherMode,
        bodies,
        voices,
        requireRecommendedNatures: requireNatures,
        natureOverrides: overrides,
      }),
      mode: motherMode,
      bodies,
      voices,
      catalogVersion: CATALOG_VERSION,
      ...(requireNatures ? { requireRecommendedNatures: true } : {}),
      ...(requireNatures && Object.keys(overrides).length > 0 ? { natureOverrides: overrides } : {}),
    };
    void run(
      () => hook.updateTarget(next),
      requireNatures
        ? '本组口径已更新（含推荐性格），成员需要重新发布'
        : '本组口径已更新，成员需要重新发布',
    );
  };

  const toggle = (list: string[], value: string, set: (next: string[]) => void) => {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const changeMode = (next: 'perfect' | 'medal') => {
    setMotherMode(next);
    const allowed = motherVoicesForTargetMode(next);
    const kept = voices.filter((voice) => allowed.includes(voice));
    setVoices(kept.length > 0 ? kept : allowed);
  };

  const studSummaryOf = (value: StudTargetConfig): string => {
    const groups = [...new Set(value.slots.map((slot) => eggGroupNames[slot.groupId] ?? `蛋组${slot.groupId}`))];
    const natures = [...new Set(value.slots.map((slot) => slot.natureName))];
    return `${TARGET_MODE_LABELS[value.mode]} · ${value.slots.length} 个槽位 · ${groups.slice(0, 2).join('/')}${groups.length > 2 ? '…' : ''} · ${natures.slice(0, 3).join('/')}${natures.length > 3 ? '…' : ''}`;
  };

  const summary = (() => {
    if (!target) return '目标待确认';
    if (target.kind === 'mother') {
      return `母 · ${target.bodies.join('/')} · ${target.voices.join('/')} · ${TARGET_MODE_LABELS[target.mode]}${
        target.requireRecommendedNatures ? ' · 推荐性格' : ''
      }`;
    }
    if (target.slots.length === 0) return '目标待确认';
    return studSummaryOf(target);
  })();

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="group-target">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium text-slate-500">本组目标</h2>
          <p className="mt-0.5 break-words text-xs text-slate-700" data-testid="group-target-summary">
            {summary}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            修订 {hook.currentGroup?.group.targetRevision ?? 0}
            {isStud && !hook.targetReady ? ' · 待组长确认后才能发布' : ''}
          </p>
        </div>
        {isOwner && isStud ? (
          <button
            type="button"
            disabled={busy}
            onClick={confirmFromPersonal}
            data-testid="group-target-confirm"
            className="min-h-[30px] shrink-0 rounded-lg border border-emerald-500 px-2.5 text-xs font-medium text-emerald-700 disabled:opacity-50"
          >
            {target && target.kind === 'stud' && target.slots.length > 0 ? '用我的目标更新' : '确认本组目标'}
          </button>
        ) : null}
      </div>

      {isOwner && isStud && pendingTarget && pendingTarget.kind === 'stud' ? (
        <div
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5"
          data-testid="group-target-import-preview"
        >
          <p className="break-words text-[11px] text-amber-800">
            将写入：{studSummaryOf(pendingTarget)}
          </p>
          <p className="mt-0.5 text-[11px] text-amber-700">
            更新后全组成员需要重新预览并发布，旧摘要只作历史。
          </p>
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void applyPendingTarget()}
              data-testid="group-target-import-confirm"
              className="min-h-[28px] rounded-lg bg-amber-600 px-2.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy ? '更新中…' : '确认更新目标'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPendingTarget(null)}
              data-testid="group-target-import-cancel"
              className="min-h-[28px] rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-amber-800 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {isOwner && isMother ? (
        <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2" data-testid="mother-target-editor">
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
            {(['perfect', 'medal'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={motherMode === value}
                onClick={() => changeMode(value)}
                data-testid={`mother-target-mode-${value}`}
                className={`min-h-[28px] flex-1 rounded-md text-xs ${
                  motherMode === value ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'
                }`}
              >
                {TARGET_MODE_LABELS[value]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1" data-testid="mother-target-options">
            {MOTHER_TARGET_BODIES.map((body) => (
              <button
                key={body}
                type="button"
                aria-pressed={bodies.includes(body)}
                onClick={() => toggle(bodies, body, setBodies)}
                data-testid={`mother-target-body-${body}`}
                className={`min-h-[28px] rounded-md border px-2 text-xs ${
                  bodies.includes(body)
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {body}
              </button>
            ))}
            {motherVoicesForTargetMode(motherMode).map((voice) => (
              <button
                key={voice}
                type="button"
                aria-pressed={voices.includes(voice)}
                onClick={() => toggle(voices, voice, setVoices)}
                data-testid={`mother-target-voice-${voice}`}
                className={`min-h-[28px] rounded-md border px-2 text-xs ${
                  voices.includes(voice)
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {voice}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              aria-pressed={requireNatures}
              onClick={() => setRequireNatures((value) => !value)}
              data-testid="mother-target-natures"
              className={`min-h-[28px] rounded-md border px-2 text-xs ${
                requireNatures
                  ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              要求推荐性格
            </button>
            <button
              type="button"
              onClick={() => setNatureEditorOpen(true)}
              data-testid="mother-target-nature-editor"
              className="min-h-[28px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-500"
            >
              编辑我的推荐性格
            </button>
          </div>
          {requireNatures ? (
            <p className="text-[11px] leading-snug text-slate-400" data-testid="mother-target-nature-hint">
              已改 {Object.keys(activeNatureOverrides(natureOverrides)).length} 颗蛋；没改的用图鉴推荐、图鉴没收录的按种族值兜底。
              改完要再点「保存本组口径」才会生效，成员需重新发布。
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={saveMother}
            data-testid="mother-target-save"
            className="min-h-[30px] w-full rounded-lg border border-emerald-500 text-xs font-medium text-emerald-700 disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存本组口径'}
          </button>
          <p className="text-[11px] text-slate-400">
            口径标识{requireNatures ? '（含推荐性格）' : ''}{' '}
            {motherCriteriaIdOf({
              mode: motherMode,
              bodies,
              voices,
              requireRecommendedNatures: requireNatures,
              natureOverrides: requireNatures ? activeNatureOverrides(natureOverrides) : undefined,
            })}
          </p>
        </div>
      ) : null}

      {isOwner && isStud ? (
        <p className="mt-1 text-[11px] text-slate-400">
          会读取个人覆盖矩阵当前的蛋组 / 性格 / 档位；成员按新目标重新预览并发布。
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-rose-600" data-testid="group-target-error">{error}</p> : null}
      {message ? (
        <p className="mt-1 text-xs text-emerald-700" data-testid="group-target-message">{message}</p>
      ) : null}
      {isOwner && isStud && target && target.kind === 'stud' && target.slots.length > 0 ? (
        <p className="mt-1 text-[11px] text-slate-400" data-testid="group-target-id">
          目标标识 {studSlotSetIdOf(target)} · {target.slots.slice(0, 3).map(slotKeyOf).join(' ')}
        </p>
      ) : null}
      <RecommendedNatureEditor open={natureEditorOpen} onClose={() => setNatureEditorOpen(false)} />
    </section>
  );
}
