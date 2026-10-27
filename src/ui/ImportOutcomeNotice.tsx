import { useState } from 'react';
import { completeCollectionDemand } from '../api/collectionGroups';
import { useImportOutcome, updateImportOutcome } from './importOutcomeStore';
import { saveLastGroupId } from './collectionGroupStore';
import { setGroupList } from './listViewStore';
import { Button } from './primitives/Button';
import { StateNotice } from './primitives/StateNotice';

export interface ImportOutcomeNoticeProps {
  /** 去小组查看是否需要发布（没有小组入口时只展示文字） */
  onOpenGroups?: () => void;
}

const CLOUD_TEXT: Record<
  ReturnType<typeof useImportOutcome>['cloud'],
  { kind: 'loading' | 'success' | 'error' | 'unknown'; text: string }
> = {
  'not-enabled': { kind: 'unknown', text: '私有同步未开启（只保存在本机）' },
  syncing: { kind: 'loading', text: '正在同步私有云…' },
  synced: { kind: 'success', text: '私有云已同步' },
  failed: { kind: 'error', text: '私有云同步失败（本机数据已保存）' },
  conflict: { kind: 'unknown', text: '私有云有另一份更新，到「私有同步」处理（本机数据已保存）' },
};

/**
 * 导入的三个阶段分别反馈（2026-10-24）：本机 / 私有云 / 小组。
 *
 * 小组永远是 `unverified`：私有同步不会改小组资源，不能因为同步成功就说小组已更新。
 */
export function ImportOutcomeNotice({ onOpenGroups }: ImportOutcomeNoticeProps = {}) {
  const outcome = useImportOutcome();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (outcome.local === 'idle') return null;

  const local =
    outcome.local === 'importing'
      ? { kind: 'loading' as const, title: '正在保存到本机…' }
      : outcome.local === 'failed'
        ? { kind: 'error' as const, title: '导入失败', description: outcome.message ?? undefined }
        : { kind: 'success' as const, title: '已保存到本机', description: outcome.message ?? undefined };
  const cloud = CLOUD_TEXT[outcome.cloud];
  const totalClaims = outcome.claims.reduce((sum, claim) => sum + claim.count, 0);
  const claimers = [...new Set(outcome.claims.flatMap((claim) => claim.claimers))];
  const primaryClaim = outcome.claims[0];
  const claimTitle =
    claimers.length > 0
      ? `${claimers.join('、')}接了你 ${totalClaims} 单，可以结单了`
      : `${totalClaims} 单已经有人接了，可以结单了`;
  const openClaimCenter = () => {
    if (!primaryClaim) return;
    saveLastGroupId(primaryClaim.accountId, 'mother', primaryClaim.groupId);
    setGroupList(primaryClaim.accountId, primaryClaim.groupId, {
      view: 'mine',
      query: '',
      memberFilter: '',
    });
    onOpenGroups?.();
  };
  const allItems = outcome.claims.flatMap((claim) =>
    claim.items.map((item) => ({ ...item, groupId: claim.groupId })),
  );
  const visibleItems = allItems.slice(0, 5);
  const completeAll = async () => {
    if (busy || allItems.length === 0) return;
    setBusy(true);
    setMessage('');
    setError('');
    let completed = 0;
    const remaining: typeof outcome.claims = [];
    for (const claim of outcome.claims) {
      const kept: typeof claim.items = [];
      for (const item of claim.items) {
        try {
          await completeCollectionDemand(claim.groupId, {
            demanderAccountId: claim.accountId,
            eggGameId: item.eggGameId,
            nature: item.nature,
            gender: item.gender,
            body: item.body,
            voice: item.voice,
            version: item.version,
          });
          completed += 1;
        } catch {
          kept.push(item);
        }
      }
      if (kept.length > 0) {
        remaining.push({
          ...claim,
          items: kept,
          count: kept.length,
          claimers: [...new Set(kept.map((item) => item.claimerName))],
        });
      }
    }
    updateImportOutcome(outcome.operationId, { claims: remaining });
    if (completed > 0) setMessage(`已结单 ${completed} 单，对方已记上一笔`);
    if (remaining.length > 0) {
      setError(
        `还有 ${remaining.reduce((sum, claim) => sum + claim.count, 0)} 单没结成功，去需求中心再试`,
      );
    }
    setBusy(false);
  };

  return (
    <section className="space-y-2" data-testid="import-outcome">
      <StateNotice kind={local.kind} title={local.title} description={local.description} />
      <StateNotice
        kind={cloud.kind}
        title={cloud.text}
        description={
          outcome.cloud === 'synced' && outcome.message ? outcome.message : undefined
        }
      />
      <StateNotice
        kind={outcome.group === 'updated' ? 'success' : 'unknown'}
        title={outcome.group === 'updated'
          ? `已自动更新 ${outcome.groupCount} 个小组的资源`
          : '小组资源未自动更新'}
        description={outcome.group === 'updated'
          ? '导入后已自动发布到已加入的小组；需要调整共享账号可在小组页改选号。'
          : '私有同步不会更新小组资源；进入小组查看是否需要发布。'}
        testId="import-outcome-group"
        action={
          onOpenGroups ? (
            <Button variant="secondary" onClick={onOpenGroups} data-testid="import-outcome-open-groups">
              去小组查看
            </Button>
          ) : undefined
        }
      />
      {outcome.local === 'saved' && totalClaims > 0 ? (
        <div
          className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800"
          data-testid="import-outcome-claims"
        >
          <p className="text-sm font-medium">{claimTitle}</p>
          <p className="mt-0.5 text-xs opacity-90">
            {outcome.claims.length === 1
              ? `在「${primaryClaim?.groupName ?? '小组'}」里，`
              : `共 ${outcome.claims.length} 个组，`}
            确认完成后对方会多一笔「已结单」，大家都更愿意接着换蛋。
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {visibleItems.map((item) => (
              <li
                key={`${item.groupId}:${item.eggGameId}:${item.nature}:${item.gender}:${item.body}:${item.voice}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 flex-1 truncate">
                  {item.eggName}
                  {item.nature ? ` · ${item.nature}` : ' · 不挑性格'}
                  {` · ${item.gender || '性别不挑'} · ${item.body || '体型不限'} · ${
                    item.voice || '声音不限'
                  }`}
                </span>
                <span className="shrink-0 opacity-80">{item.claimerName} 接的</span>
              </li>
            ))}
            {allItems.length > visibleItems.length ? (
              <li className="opacity-80">还有 {allItems.length - visibleItems.length} 单…</li>
            ) : null}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              busy={busy}
              onClick={() => void completeAll()}
              data-testid="import-outcome-complete-all"
            >
              一键结单 {totalClaims} 单
            </Button>
            {onOpenGroups ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={openClaimCenter}
                data-testid="import-outcome-open-claims"
              >
                去需求中心
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {message ? (
        <StateNotice kind="success" title={message} testId="import-outcome-claims-done" />
      ) : null}
      {error ? (
        <StateNotice kind="error" title={error} testId="import-outcome-claims-error" />
      ) : null}
    </section>
  );
}
