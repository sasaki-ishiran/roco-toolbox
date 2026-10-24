import { useEffect, useState } from 'react';
import { CATALOG_VERSION, eggGroupNames } from '../data/catalog';
import {
  MOTHER_TARGET_BODIES,
  motherCriteriaIdOf,
  motherVoicesForTargetMode,
  slotKeyOf,
  studSlotSetIdOf,
  type GroupTargetConfig,
} from '../shared/collectionGroups';
import type { CollectionGroupsHook } from './useCollectionGroups';
import { useCoverageSlots } from './useCoverageSlots';
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

  useEffect(() => {
    if (target?.kind !== 'mother') {
      setMotherMode('perfect');
      setBodies(['大块头']);
      setVoices(['+100']);
      return;
    }
    setMotherMode(target.mode);
    setBodies(target.bodies);
    setVoices(target.voices);
  }, [target, hook.currentGroup?.group.id, hook.currentGroup?.group.targetRevision]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusy(false);
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
    void run(() => hook.updateTarget(next), '本组目标已更新，成员需要重新预览并发布');
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
    const next: GroupTargetConfig = {
      kind: 'mother',
      criteriaId: motherCriteriaIdOf({ mode: motherMode, bodies, voices }),
      mode: motherMode,
      bodies,
      voices,
      catalogVersion: CATALOG_VERSION,
    };
    void run(() => hook.updateTarget(next), '本组口径已更新，成员需要重新发布');
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

  const summary = (() => {
    if (!target) return '目标待确认';
    if (target.kind === 'mother') {
      return `母 · ${target.bodies.join('/')} · ${target.voices.join('/')} · ${TARGET_MODE_LABELS[target.mode]}`;
    }
    if (target.slots.length === 0) return '目标待确认';
    const groups = [...new Set(target.slots.map((slot) => eggGroupNames[slot.groupId] ?? `蛋组${slot.groupId}`))];
    const natures = [...new Set(target.slots.map((slot) => slot.natureName))];
    return `${TARGET_MODE_LABELS[target.mode]} · ${target.slots.length} 个槽位 · ${groups.slice(0, 2).join('/')}${groups.length > 2 ? '…' : ''} · ${natures.slice(0, 3).join('/')}${natures.length > 3 ? '…' : ''}`;
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
          <div className="flex flex-wrap gap-1">
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
          </div>
          <div className="flex flex-wrap gap-1">
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
            口径标识 {motherCriteriaIdOf({ mode: motherMode, bodies, voices })}
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
    </section>
  );
}
