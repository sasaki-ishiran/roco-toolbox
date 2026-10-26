import { useState } from 'react';
import type { MotherGroupSummary } from '../shared/motherGroups';

export interface MotherGroupSetupProps {
  onCreate: (name: string, displayName: string) => Promise<unknown>;
  onJoin: (inviteCode: string, displayName: string) => Promise<unknown>;
  initialInviteCode?: string;
}

export interface MotherGroupSwitcherProps {
  groups: MotherGroupSummary[];
  currentGroupId: string | null;
  onSelect: (groupId: string) => void;
}

/** 已加入小组的日常切换入口，与低频的新建/加入表单分开摆放。 */
export function MotherGroupSwitcher({ groups, currentGroupId, onSelect }: MotherGroupSwitcherProps) {
  if (groups.length === 0) return null;
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm" data-testid="mother-group-list">
      <h2 className="text-xs font-medium text-slate-500">我加入的小组</h2>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => onSelect(group.id)}
            aria-pressed={group.id === currentGroupId}
            data-testid={`mother-group-${group.id}`}
            className={`min-h-[28px] rounded-md border px-2 text-xs ${
              group.id === currentGroupId
                ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                : 'border-slate-200 bg-white text-slate-500'
            }`}
          >
            {group.name} · {group.memberCount} 人
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 小组切换与「新建 / 加入」。
 *
 * 昵称必须自己填：不从游戏账号名推真人身份（同一个人可能有多个号，昵称只是组内称呼）。
 * 昵称可重复；重名时由成员列表补 ID 短尾码区分。
 */
export function MotherGroupSetup({
  onCreate,
  onJoin,
  initialInviteCode = '',
}: MotherGroupSetupProps) {
  const [mode, setMode] = useState<'create' | 'join'>(initialInviteCode ? 'join' : 'create');
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [busy, setBusy] = useState<'create' | 'join' | ''>('');
  const [error, setError] = useState('');

  const run = async (kind: 'create' | 'join', action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      if (await action() === false) return;
      setName('');
      setInviteCode('');
      setDisplayName('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="space-y-2" data-testid="mother-group-setup">
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5" role="tablist">
          {(
            [
              ['create', '新建小组'],
              ['join', '加入小组'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => setMode(id)}
              data-testid={`mother-setup-tab-${id}`}
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
          data-testid="mother-setup-nickname"
          className="mt-2 min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm text-slate-700 placeholder:text-slate-300"
        />

        {mode === 'create' ? (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="小组名称（如：周末互换）"
            maxLength={40}
            data-testid="mother-setup-group-name"
            className="mt-2 min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm text-slate-700 placeholder:text-slate-300"
          />
        ) : (
          <input
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
            placeholder="8 位邀请码"
            maxLength={8}
            data-testid="mother-setup-invite"
            className="mt-2 min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm uppercase tracking-widest text-slate-700 placeholder:tracking-normal placeholder:text-slate-300"
          />
        )}

        <button
          type="button"
          disabled={busy !== '' || displayName.trim().length === 0 || (mode === 'create' ? name.trim().length === 0 : inviteCode.trim().length === 0)}
          onClick={() =>
            void run(mode, () =>
              mode === 'create' ? onCreate(name.trim(), displayName.trim()) : onJoin(inviteCode.trim(), displayName.trim()),
            )
          }
          data-testid={mode === 'create' ? 'mother-create-submit' : 'mother-join-submit'}
          className="mt-2 min-h-[36px] w-full rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === mode ? '处理中…' : mode === 'create' ? '创建小组' : '加入小组'}
        </button>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      </div>
    </section>
  );
}
