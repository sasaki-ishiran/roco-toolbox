import { useState } from 'react';
import { refreshSnapshots } from '../storage/snapshotStore';
import { Button } from './primitives/Button';
import { StateNotice } from './primitives/StateNotice';

export function SnapshotRefreshNotice({ error, refreshedAt }: {
  error: string | null;
  refreshedAt: number | null;
}) {
  const [busy, setBusy] = useState(false);
  if (!error) return null;

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshSnapshots();
    } catch {
      // 错误由共享缓存状态统一展示；重试失败仍保留旧内容。
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pt-3">
      <StateNotice
        kind="error"
        title={refreshedAt == null ? '暂时无法读取本机数据' : '本机数据刷新失败，仍显示上次成功读取的内容'}
        description={`${error}${refreshedAt == null ? '' : ` · 上次成功读取 ${new Date(refreshedAt).toLocaleString()}`}`}
        action={<Button variant="secondary" disabled={busy} onClick={() => void retry()}>{busy ? '读取中…' : '重试读取'}</Button>}
        testId="snapshot-refresh-error"
      />
    </div>
  );
}
