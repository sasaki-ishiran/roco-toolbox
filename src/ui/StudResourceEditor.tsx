import { useMemo, useState } from 'react';
import { CATALOG_VERSION } from '../data/catalog';
import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import { buildStudResource, isStudTargetReady } from '../domain/studResource';
import type { SpeciesEntry } from '../domain/types';
import type { StudTargetConfig } from '../shared/collectionGroups';
import type { CollectionGroupsHook } from './useCollectionGroups';

const timeText = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleString() : '—';

export interface StudResourceEditorProps {
  hook: CollectionGroupsHook;
  snapshots: AccountSnapshot[];
  species: SpeciesEntry[];
  onGoAccount?: () => void;
}

/**
 * 种公组的「我的共享资源」：选号 → 预览覆盖/可迭代 → 手动发布。
 *
 * 预览与发布都按**本组目标**生成；目标未确认、图鉴不一致时不允许发布。
 * 本机缺少已共享账号时禁止发布，避免静默缩小共享范围。
 */
export function StudResourceEditor({ hook, snapshots, species, onGoAccount }: StudResourceEditorProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const target = hook.target;
  const studTarget = target?.kind === 'stud' ? target : null;
  const ready = isStudTargetReady(studTarget);
  const published = hook.myMember?.studResource ?? null;
  const preview = hook.publishPreview.kind === 'stud' ? hook.publishPreview : null;
  const selection = hook.draftSelection;

  const claimsOf = useMemo(() => {
    if (!studTarget || !ready) return new Map<string, { covered: number; breedable: number }>();
    const localTarget: StudTargetConfig = { ...studTarget, catalogVersion: CATALOG_VERSION };
    const map = new Map<string, { covered: number; breedable: number }>();
    for (const snapshot of snapshots) {
      const key = snapshot.accountKey ?? accountKeyOf(snapshot);
      try {
        const resource = buildStudResource({
          snapshots: [snapshot],
          selectedAccountKeys: [key],
          species,
          catalogVersion: CATALOG_VERSION,
          target: localTarget,
          targetRevision: hook.currentGroup?.group.targetRevision ?? 0,
        });
        const account = resource.accounts[0];
        map.set(key, {
          covered: account?.covered.length ?? 0,
          breedable: account?.breedable.length ?? 0,
        });
      } catch {
        map.set(key, { covered: 0, breedable: 0 });
      }
    }
    return map;
  }, [snapshots, species, studTarget, ready, hook.currentGroup?.group.targetRevision]);

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
      await hook.refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => {
    hook.setDraftSelection(
      selection.includes(key) ? selection.filter((item) => item !== key) : [...selection, key],
    );
  };

  const localKeys = new Set(snapshots.map((snapshot) => snapshot.accountKey ?? accountKeyOf(snapshot)));
  const missingAccounts = published?.accounts.filter((account) => !localKeys.has(account.accountKey)) ?? [];
  const unchanged = published != null && preview?.diff?.unchanged === true;
  const canPublish =
    ready &&
    !busy &&
    (preview?.error ?? '') === '' &&
    (selection.length === 0 ? published != null : preview?.resource != null) &&
    !unchanged;

  const publishedSlots = published
    ? new Set(published.accounts.flatMap((account) => account.covered.map((slot) => `${slot.groupId}:${slot.natureId}:${slot.grade}`))).size
    : 0;
  const publishedBreedable = published
    ? new Set(published.accounts.flatMap((account) => account.breedable.map((slot) => `${slot.groupId}:${slot.natureId}:${slot.grade}`))).size
    : 0;

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="stud-resource-editor">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">我的共享资源</h2>
        <span className="text-[11px] text-slate-400" data-testid="stud-my-status">
          {published
            ? `已覆盖 ${publishedSlots} 格 · 可迭代 ${publishedBreedable} 格 · ${timeText(published.publishedAt)}`
            : '尚未发布'}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        只统计真实公精灵的覆盖格与同账号可孵格；可迭代不算已收齐。
      </p>

      {!ready ? (
        <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 text-xs text-amber-800" data-testid="stud-target-pending">
          本组目标还没确认。请组长先在「本组目标」里确认蛋组、性格与档位。
        </p>
      ) : null}

      {snapshots.length === 0 ? (
        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500" data-testid="stud-no-local-data">
          本机还没有导入任何账号。先导入游戏数据，或在导入页用云同步拉齐。
          {published ? '已发布的资源不会因此被撤回。' : ''}
          {onGoAccount ? (
            <button
              type="button"
              onClick={onGoAccount}
              className="mt-2 block min-h-[30px] rounded-lg border border-emerald-500 px-2.5 text-xs text-emerald-700"
            >
              去导入数据
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="mt-2 space-y-1">
          {snapshots.map((snapshot) => {
            const key = snapshot.accountKey ?? accountKeyOf(snapshot);
            const on = selection.includes(key);
            const claim = claimsOf.get(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-pressed={on}
                  data-testid={`stud-account-${key}`}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                    on
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <span className="font-medium">{snapshot.accountName}</span>
                  <span className="ml-1 text-[11px] text-slate-400">
                    UID {snapshot.gameId > 0 ? snapshot.gameId : '未知'} · 覆盖 {claim?.covered ?? 0} · 可迭代 {claim?.breedable ?? 0}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    导出 {snapshot.exportedAt ? new Date(snapshot.exportedAt).toLocaleString() : '未知'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {missingAccounts.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {missingAccounts.map((account) => (
            <li key={account.accountKey}>
              <button
                type="button"
                onClick={() => toggle(account.accountKey)}
                aria-pressed={selection.includes(account.accountKey)}
                data-testid={`stud-account-${account.accountKey}`}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                  selection.includes(account.accountKey)
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <span className="font-medium">{account.accountName}</span>
                <span className="ml-1 text-[11px] text-slate-400">UID {account.accountKey.slice(4)} · 本机无数据</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {selection.includes(account.accountKey) ? '点此从本次共享中撤回；发布后生效' : '已从本次选号撤回；可点此选回'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {preview?.missingAccountKeys.length ? (
        <p className="mt-2 text-xs text-rose-600" data-testid="stud-missing-accounts">
          本机缺少这些账号的数据（{preview.missingAccountKeys.join('、')}）：先导入或云同步，或在选号里撤回。
        </p>
      ) : null}

      {preview?.error ? (
        <p className="mt-2 text-xs text-rose-600" data-testid="stud-preview-error">{preview.error}</p>
      ) : null}

      <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5" data-testid="stud-preview">
        {selection.length === 0 ? (
          <p className="text-xs text-slate-500">
            {published ? '当前选号为空：点下面的按钮会停止共享（保留组员身份）。' : '还没有选号。勾选你要共享的游戏账号。'}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            本次共享 {selection.length} 个账号
            {preview?.resource ? (
              <span className="ml-1">
                · 覆盖 {new Set(preview.resource.accounts.flatMap((account) => account.covered.map((slot) => `${slot.groupId}:${slot.natureId}:${slot.grade}`))).size} 格
                · 可迭代 {new Set(preview.resource.accounts.flatMap((account) => account.breedable.map((slot) => `${slot.groupId}:${slot.natureId}:${slot.grade}`))).size} 格
              </span>
            ) : null}
            {preview?.diff && !preview.diff.unchanged ? (
              <span className="ml-1" data-testid="stud-preview-diff">
                （新增 {preview.diff.addedSlots.length} 格、移除 {preview.diff.removedSlots.length} 格）
              </span>
            ) : null}
          </p>
        )}
        {hook.draftDirty ? (
          <p className="mt-1 text-[11px] text-amber-700" data-testid="stud-draft-dirty">
            选号有未发布的修改，发布前请确认上面的预览。
          </p>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {selection.length === 0 && published ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('停止共享会从小组里撤掉你已发布的全部种公摘要（保留组员身份），确定吗？')) return;
              void run(() => hook.stopSharing(), '已停止共享，组员将看到你为「待发布」');
            }}
            data-testid="stud-stop-sharing"
            className="min-h-[36px] flex-1 rounded-lg border border-rose-200 px-3 text-sm font-medium text-rose-600 disabled:opacity-50"
          >
            {busy ? '处理中…' : '停止共享我的资源'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run(() => hook.publish(), published ? '已更新，组员刷新后就能看到' : '已发布，组员刷新后就能看到')}
            disabled={!canPublish}
            data-testid="stud-publish"
            className="min-h-[36px] flex-1 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? '发布中…' : published ? '更新我的资源' : '发布我的资源'}
          </button>
        )}
      </div>
      {published && unchanged ? (
        <p className="mt-1 text-[11px] text-slate-400">当前选号与线上一致，无需更新。</p>
      ) : null}
      {message ? <p className="mt-2 text-xs text-emerald-700" data-testid="stud-editor-message">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600" data-testid="stud-editor-error">{error}</p> : null}
    </section>
  );
}
