import { useEffect, useState } from 'react';
import { track } from '../api/analytics';
import {
  type CloudMeta,
  type MeResult,
  deleteAccount,
  errorText,
  fetchMe,
  logoutAccount,
  markSynced,
  readAccountId,
  recoverAccount,
  registerAccount,
  rotateRecoveryCode,
  subscribeSession,
} from '../api/session';
import { applySnapshot, downloadSnapshot, localSizeHint, syncNow, uploadSnapshot } from '../api/sync';
import { recordSyncedPets } from './syncAdditions';
import { useSnapshots } from './useSnapshots';

/**
 * 账号 & 云同步（2026-10-06，免密：设备绑定 + 恢复码）
 *
 * 用户主线只有两条：
 * - 第一台设备：点「开启云同步」→ **必须存下恢复码**（只显示一次）
 * - 换设备：输恢复码 → 自动把云端数据拉下来写进本机（一键）
 *
 * 日常对齐两台设备只需要点「立即同步」：拉云端 → 与本机按账号合并 → 推回云端，一个动作搞定
 * （2026-10-07：原来的「上传 / 从云端恢复 / 冲突二选一」三步并成这一步，用户不用再理解版本号）。
 * 「用本机覆盖云端」保留为逃生口（合并只增不减，删掉的账号得靠它推上去）。
 *
 * 恢复码只显示一次（服务端只存哈希），文案要提醒保存；但也不用写得像「丢了就完了」——
 * 只要还有一台已登录的设备，点「重新生成恢复码」就能换一张新的（旧码同时失效）。
 */
const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const timeText = (ms: number): string => (ms ? new Date(ms).toLocaleString() : '—');

export interface AccountPanelProps {
  /**
   * 由「导入数据」页转来的自动上传冲突（2026-10-06）：导入后的自动上传遇到 409 时，
   * 由上层把云端元信息透进来，这里复用既有的冲突二选一 UI（原来是静默吞掉的）。
   */
  autoConflict?: CloudMeta | null;
  /** 冲突被处理（选云端 / 选本机）后通知上层清掉提示 */
  onAutoConflictHandled?: () => void;
}

export function AccountPanel({
  autoConflict = null,
  onAutoConflictHandled,
}: AccountPanelProps = {}) {
  const [accountId, setAccountId] = useState(() => readAccountId());
  const [me, setMe] = useState<MeResult | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<CloudMeta | null>(null);
  const [size, setSize] = useState<{ accounts: number; bytes: number } | null>(null);
  // 同步前的本机快照（同步后用来算「本次新增」）；订阅式读取，导入/同步后自动跟着更新
  const { snapshots } = useSnapshots();

  // 上层转来的冲突 → 并进本面板的冲突态（用户在这里二选一）
  useEffect(() => {
    if (autoConflict) setConflict(autoConflict);
  }, [autoConflict]);

  /** 冲突解决后一并清掉上层的提示 */
  const clearConflict = () => {
    setConflict(null);
    onAutoConflictHandled?.();
  };

  useEffect(() => subscribeSession(() => setAccountId(readAccountId())), []);

  useEffect(() => {
    void localSizeHint()
      .then(setSize)
      .catch(() => setSize(null));
  }, []);

  useEffect(() => {
    if (!accountId) {
      setMe(null);
      return;
    }
    let alive = true;
    void fetchMe()
      .then((result) => {
        if (alive) setMe(result);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const run = async (tag: string, action: () => Promise<void>) => {
    setBusy(tag);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };

  const handleRegister = () =>
    run('register', async () => {
      const { recoveryCode: code } = await registerAccount();
      setRecoveryCode(code);
      setMessage('已开启云同步。恢复码建议复制或截图保存——换手机、重装都靠它。');
      track('account_create');
      // 开号后立刻把本机数据传上去，免得用户以为「开了同步但云端还是空的」
      const result = await uploadSnapshot();
      if (!result.ok) setConflict(result.conflict);
      else setMe(await fetchMe());
    });

  const handleRecover = () =>
    run('recover', async () => {
      await recoverAccount(codeInput.trim());
      track('account_recover');
      setCodeInput('');
      const cloud = await downloadSnapshot();
      if (!cloud) {
        setMessage('这个账号云端还没有数据。已把本机数据作为第一份上传。');
        const result = await uploadSnapshot();
        if (!result.ok) setConflict(result.conflict);
        setMe(await fetchMe());
        return;
      }
      await applySnapshot(cloud.snapshot, cloud.meta);
      track('sync_download', { version: cloud.meta.version, restored: true });
      setMessage('已把云端数据写到本机，正在刷新…');
      window.setTimeout(() => window.location.reload(), 800);
    });

  /** 一键同步：拉云端 → 与本机合并 → 推回云端（正常情况只需要点这一个按钮） */
  const handleSync = () =>
    run('sync', async () => {
      // 同步前的本机快照：同步后拿它比对，算出云端这次带来了什么（看板「本次新增」卡）
      const before = snapshots;
      const result = await syncNow();
      if (!result.ok) {
        setConflict(result.conflict);
        setMessage('云端刚被别的设备改过，再点一次「立即同步」即可。');
        return;
      }
      clearConflict();
      track('sync_now', { added: result.added.length, updated: result.updated.length });
      const summary = result.seeded
        ? '本机数据已作为第一份上传'
        : `并入 ${result.added.length} 个账号 · 更新 ${result.updated.length} 个`;
      setMessage(
        `已同步（云端版本 ${result.version}）：${summary}` +
          (result.prefsAdopted.length > 0 ? '。补上了本机缺的设置，正在刷新…' : ''),
      );
      // 同步真的带进来东西 → 把够格的新增记进看板「本次新增」，让用户看得见同步了什么
      if (result.added.length > 0 || result.updated.length > 0) {
        await recordSyncedPets(before);
      }
      setMe(await fetchMe());
      // 设置键是模块级 store 启动时读进内存的，补上的那些（如目标模式/母本达标标准）
      // 只有刷新页面才真正生效 —— 别试图就地刷新（2026-10-06 记录过的坑）
      if (result.prefsAdopted.length > 0) {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    });

  /** 逃生口：用本机数据整份覆盖云端（合并只增不减，本机删掉的账号得靠它推上去） */
  const handleForcePush = () =>
    run('force', async () => {
      markSynced(conflict?.version ?? me?.snapshot?.version ?? 0);
      clearConflict();
      const result = await uploadSnapshot();
      if (!result.ok) {
        setConflict(result.conflict);
        setMessage('云端刚被别的设备改过，再点一次。');
        return;
      }
      setMessage(`已用本机数据覆盖云端（版本 ${result.version}）`);
      setMe(await fetchMe());
    });

  const handleRotate = () =>
    run('rotate', async () => {
      const code = await rotateRecoveryCode();
      setRecoveryCode(code);
      setMessage('已生成新的恢复码，旧的立即失效，请保存新的。');
    });

  const handleLogout = () =>
    run('logout', async () => {
      await logoutAccount();
      setMe(null);
      setMessage('已退出登录（本机数据保留）。');
    });

  const handleDelete = () =>
    run('delete', async () => {
      if (!window.confirm('注销会把云端数据全部删掉（本机数据保留），确定吗？')) return;
      await deleteAccount();
      setMe(null);
      setMessage('账号已注销，云端数据已清空。');
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="account-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-700">云同步（跨设备）</h2>
        {/* 文案避开「N 个账号」的写法：导入面板那行用的是那个格式，别让 e2e 的选择器撞车 */}
        <span className="text-[11px] text-slate-400">
          {size ? `本机数据 约 ${sizeText(size.bytes)} · 账号 ${size.accounts} 个` : '本机数据读取中…'}
        </span>
      </div>

      {accountId ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-500" data-testid="account-status">
            已登录 · 云端版本 {me?.snapshot ? me.snapshot.version : '暂无'} · 上次更新{' '}
            {me?.snapshot ? timeText(me.snapshot.updatedAt) : '—'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="account-sync"
              onClick={handleSync}
              disabled={busy !== ''}
              className="min-h-[40px] rounded-xl bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === 'sync' ? '同步中…' : '立即同步'}
            </button>
            <button
              type="button"
              data-testid="account-force-push"
              onClick={handleForcePush}
              disabled={busy !== ''}
              className="min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs text-slate-500 disabled:opacity-50"
            >
              {busy === 'force' ? '上传中…' : '用本机覆盖云端'}
            </button>
            <button
              type="button"
              data-testid="account-rotate"
              onClick={handleRotate}
              disabled={busy !== ''}
              className="min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 disabled:opacity-50"
            >
              重新生成恢复码
            </button>
            <button
              type="button"
              data-testid="account-logout"
              onClick={handleLogout}
              disabled={busy !== ''}
              className="min-h-[40px] rounded-xl border border-slate-200 px-3 text-xs text-slate-500 disabled:opacity-50"
            >
              退出登录
            </button>
            <button
              type="button"
              data-testid="account-delete"
              onClick={handleDelete}
              disabled={busy !== ''}
              className="min-h-[40px] rounded-xl border border-red-100 px-3 text-xs text-red-500 disabled:opacity-50"
            >
              注销账号
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <button
            type="button"
            data-testid="account-register"
            onClick={handleRegister}
            disabled={busy !== ''}
            className="min-h-[44px] w-full rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'register' ? '开启中…' : '开启云同步（生成恢复码）'}
          </button>
          <div className="flex gap-2">
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="已有恢复码？输在这里"
              data-testid="account-recover-input"
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm uppercase"
            />
            <button
              type="button"
              data-testid="account-recover-submit"
              onClick={handleRecover}
              disabled={busy !== '' || codeInput.trim().length === 0}
              className="min-h-[44px] shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 disabled:opacity-50"
            >
              登录
            </button>
          </div>
        </div>
      )}

      {recoveryCode ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2" data-testid="account-recovery-block">
          <p className="text-[11px] text-amber-700">
            恢复码只显示这一次，建议复制或截图保存（换手机、重装都靠它）。万一丢了也没关系：在仍登录的设备上点「重新生成恢复码」就能换一张新的。
          </p>
          <p className="mt-1 select-all font-mono text-base font-semibold tracking-wider text-amber-900" data-testid="account-recovery-code">
            {recoveryCode}
          </p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              data-testid="account-copy-code"
              onClick={() => {
                void navigator.clipboard?.writeText(recoveryCode);
                setMessage('已复制恢复码');
              }}
              className="min-h-[32px] rounded-lg border border-amber-300 px-2 text-[11px] text-amber-800"
            >
              复制
            </button>
            <button
              type="button"
              onClick={() => setRecoveryCode(null)}
              className="min-h-[32px] rounded-lg border border-amber-300 px-2 text-[11px] text-amber-800"
            >
              我已保存
            </button>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2" data-testid="account-conflict">
          <p className="text-xs text-rose-700">
            云端有另一份更新的数据（版本 {conflict.version}，{timeText(conflict.updatedAt)}）。点「再同步一次」会把两份合并；
            「用本机覆盖云端」则是拿本机这份整份顶掉云端。
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="account-conflict-retry"
              onClick={handleSync}
              className="min-h-[36px] rounded-lg border border-rose-300 bg-white px-3 text-[11px] font-medium text-rose-700"
            >
              再同步一次（合并）
            </button>
            <button
              type="button"
              data-testid="account-conflict-keep-local"
              onClick={handleForcePush}
              className="min-h-[36px] rounded-lg border border-rose-300 bg-white px-3 text-[11px] font-medium text-rose-700"
            >
              用本机（覆盖云端）
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="mt-2 text-xs text-emerald-700" data-testid="account-message">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-red-600" data-testid="account-error">
          {error}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] text-slate-400">
        同步内容：账号数据 + 设置。目标模式、母本达标标准、账号筛选以云端为准（两台算出来的数字才一致）；
        分页、复制提示等显示习惯各设备各留。恢复码与统计开关不参与。
      </p>
    </section>
  );
}
