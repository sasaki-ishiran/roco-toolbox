import { useImportOutcome } from './importOutcomeStore';
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
  if (outcome.local === 'idle') return null;

  const local =
    outcome.local === 'importing'
      ? { kind: 'loading' as const, title: '正在保存到本机…' }
      : outcome.local === 'failed'
        ? { kind: 'error' as const, title: '导入失败', description: outcome.message ?? undefined }
        : { kind: 'success' as const, title: '已保存到本机', description: outcome.message ?? undefined };
  const cloud = CLOUD_TEXT[outcome.cloud];

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
        kind="unknown"
        title="小组资源未自动更新"
        description="私有同步不会更新小组资源；进入小组查看是否需要发布。"
        testId="import-outcome-group"
        action={
          onOpenGroups ? (
            <Button variant="secondary" onClick={onOpenGroups} data-testid="import-outcome-open-groups">
              去小组查看
            </Button>
          ) : undefined
        }
      />
    </section>
  );
}
