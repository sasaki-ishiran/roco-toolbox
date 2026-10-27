import { useState } from 'react';
import type { CollectionGroupType, GroupTargetConfig } from '../shared/collectionGroups';

export interface InvitePreviewShape {
  name: string;
  groupType: CollectionGroupType;
  targetRevision: number;
  targetReady: boolean;
  target: GroupTargetConfig | null;
}

export interface CollectionGroupSetupProps {
  onCreate: (
    name: string,
    displayName: string,
    groupType: CollectionGroupType,
  ) => Promise<unknown>;
  onJoin: (inviteCode: string, displayName: string) => Promise<unknown>;
  preflightInvite: (inviteCode: string) => Promise<InvitePreviewShape>;
  initialInviteCode?: string;
  /** 已入组时默认收起（2026-10-26 小组页精简）；个人求蛋模式默认展开。 */
  defaultOpen?: boolean;
}

/** 小组不再设母本口径：加入后每个人按自己的本地筛选查看缺口。 */
const JOIN_TARGET_TEXT = '加入后按各自的本地筛选查看缺口';

/**
 * 新建 / 加入小组。
 *
 * 2026-10-27 起小组只剩一种「收集小组」，不再让用户选母本组 / 种公组；
 * 类型参数保留在回调签名里，固定传 `mother`，服务端也只接受这一种。
 * 加入时先展示组名与目标，确认后才提交，避免进组后才发现目标不符。
 */
export function CollectionGroupSetup({
  onCreate,
  onJoin,
  preflightInvite,
  initialInviteCode = '',
  defaultOpen = true,
}: CollectionGroupSetupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<'create' | 'join'>(initialInviteCode ? 'join' : 'create');
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-500">新建 / 加入小组</h2>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            data-testid="group-setup-toggle"
            className="min-h-[26px] text-[11px] text-slate-500"
          >
            {open ? '收起' : '展开'}
          </button>
        </div>
        {open ? (
          <>
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

        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="我在组里的昵称（最多 6 个字）"
          maxLength={6}
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
                onCreate(name.trim(), displayName.trim(), 'mother'),
              )
            }
            data-testid="group-create-submit"
            className="mt-2 min-h-[36px] w-full rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'create' ? '处理中…' : '创建收集小组'}
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
                <p className="mt-0.5 text-[11px] text-slate-500">{JOIN_TARGET_TEXT}</p>
                <button
                  type="button"
                  disabled={busy !== ''}
                  onClick={() =>
                    void run('join', () => onJoin(inviteCode.trim(), displayName.trim()))
                  }
                  data-testid="group-join-submit"
                  className="mt-2 min-h-[32px] w-full rounded-lg bg-emerald-600 text-xs font-medium text-white disabled:opacity-50"
                >
                  {busy === 'join' ? '处理中…' : '加入小组'}
                </button>
              </div>
            ) : null}
          </>
        )}
        {error ? <p className="mt-2 text-xs text-rose-600" data-testid="group-setup-error">{error}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
