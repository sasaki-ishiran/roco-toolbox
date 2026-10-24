import { useState } from 'react';
import {
  GROUP_TYPE_LABELS,
  type CollectionGroupType,
  type GroupTargetConfig,
} from '../shared/collectionGroups';

export interface InvitePreviewShape {
  name: string;
  groupType: CollectionGroupType;
  targetRevision: number;
  targetReady: boolean;
  target: GroupTargetConfig | null;
}

export interface CollectionGroupSetupProps {
  onCreate: (name: string, displayName: string, groupType: CollectionGroupType) => Promise<unknown>;
  onJoin: (inviteCode: string, displayName: string) => Promise<unknown>;
  preflightInvite: (inviteCode: string) => Promise<InvitePreviewShape>;
  initialInviteCode?: string;
}

const targetText = (target: GroupTargetConfig | null): string => {
  if (!target) return '目标待确认';
  if (target.kind === 'mother') return `母 · ${target.bodies.join('/')} · ${target.voices.join('/')}`;
  if (target.slots.length === 0) return '目标待确认';
  const natures = [...new Set(target.slots.map((slot) => slot.natureName))];
  return `${target.mode === 'perfect' ? '追满分' : '追双牌'} · ${target.slots.length} 个槽位 · ${natures.slice(0, 3).join('/')}${natures.length > 3 ? '…' : ''}`;
};

const TYPE_OPTIONS: Array<{ value: CollectionGroupType; label: string; hint: string }> = [
  { value: 'mother', label: '母本收集', hint: '按蛋血脉收集达标母本；口径由组长维护' },
  { value: 'stud', label: '种公收集', hint: '按蛋组 × 性格 × 档位收集真实种公' },
];

/**
 * 新建 / 加入小组。
 *
 * 新建时先选类型（创建后不可改）；组名不承担类型识别，列表与组页始终显示类型标签。
 * 加入时先展示组名、类型与目标，确认后才提交，避免进组后才发现目标不符。
 */
export function CollectionGroupSetup({
  onCreate,
  onJoin,
  preflightInvite,
  initialInviteCode = '',
}: CollectionGroupSetupProps) {
  const [mode, setMode] = useState<'create' | 'join'>(initialInviteCode ? 'join' : 'create');
  const [groupType, setGroupType] = useState<CollectionGroupType>('mother');
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [preview, setPreview] = useState<InvitePreviewShape | null>(null);
  const [busy, setBusy] = useState<'create' | 'preview' | 'join' | ''>('');
  const [error, setError] = useState('');

  const run = async (kind: 'create' | 'preview' | 'join', action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      const result = await action();
      if (result === false) return;
      if (kind !== 'preview') {
        setName('');
        setInviteCode('');
        setDisplayName('');
        setPreview(null);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="space-y-2" data-testid="group-setup">
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="tablist">
          {([
            ['create', '新建小组'],
            ['join', '加入小组'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => {
                setMode(id);
                setPreview(null);
                setError('');
              }}
              data-testid={`group-setup-tab-${id}`}
              className={`min-h-[30px] flex-1 rounded-md text-xs ${
                mode === id ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'create' ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5" data-testid="group-type-options">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={groupType === option.value}
                onClick={() => setGroupType(option.value)}
                data-testid={`group-type-${option.value}`}
                className={`rounded-lg border px-2 py-1.5 text-left ${
                  groupType === option.value
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{option.hint}</span>
              </button>
            ))}
          </div>
        ) : null}

        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="我在组里的昵称"
          maxLength={20}
          data-testid="group-setup-nickname"
          className="mt-2 min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm text-slate-700 placeholder:text-slate-300"
        />

        {mode === 'create' ? (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="小组名称（如：周末互换）"
            maxLength={40}
            data-testid="group-setup-group-name"
            className="mt-2 min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm text-slate-700 placeholder:text-slate-300"
          />
        ) : (
          <input
            value={inviteCode}
            onChange={(event) => {
              setInviteCode(event.target.value.toUpperCase());
              setPreview(null);
            }}
            placeholder="8 位邀请码"
            maxLength={8}
            data-testid="group-setup-invite"
            className="mt-2 min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm uppercase tracking-widest text-slate-700 placeholder:tracking-normal placeholder:text-slate-300"
          />
        )}

        {mode === 'create' ? (
          <button
            type="button"
            disabled={busy !== '' || displayName.trim().length === 0 || name.trim().length === 0}
            onClick={() =>
              void run('create', () =>
                onCreate(name.trim(), displayName.trim(), groupType),
              )
            }
            data-testid="group-create-submit"
            className="mt-2 min-h-[36px] w-full rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'create' ? '处理中…' : `创建${GROUP_TYPE_LABELS[groupType]}小组`}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== '' || displayName.trim().length === 0 || inviteCode.trim().length === 0}
              onClick={() => void run('preview', () => preflightInvite(inviteCode.trim()).then(setPreview))}
              data-testid="group-join-preview"
              className="mt-2 min-h-[36px] w-full rounded-lg border border-emerald-500 text-sm font-medium text-emerald-700 disabled:opacity-50"
            >
              {busy === 'preview' ? '读取中…' : '查看小组'}
            </button>
            {preview ? (
              <div className="mt-2 rounded-xl bg-slate-50 px-2.5 py-2" data-testid="group-join-confirm">
                <p className="text-sm font-medium text-slate-700">{preview.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {GROUP_TYPE_LABELS[preview.groupType]} · {targetText(preview.target)}
                  {preview.targetReady ? '' : ' · 目标待确认'}
                </p>
                <button
                  type="button"
                  disabled={busy !== ''}
                  onClick={() =>
                    void run('join', () => onJoin(inviteCode.trim(), displayName.trim()))
                  }
                  data-testid="group-join-submit"
                  className="mt-2 min-h-[32px] w-full rounded-lg bg-emerald-600 text-xs font-medium text-white disabled:opacity-50"
                >
                  {busy === 'join' ? '处理中…' : `加入${GROUP_TYPE_LABELS[preview.groupType]}小组`}
                </button>
              </div>
            ) : null}
          </>
        )}
        {error ? <p className="mt-2 text-xs text-rose-600" data-testid="group-setup-error">{error}</p> : null}
      </div>
    </section>
  );
}
