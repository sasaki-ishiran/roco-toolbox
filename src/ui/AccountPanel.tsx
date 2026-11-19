import { useEffect, useState } from 'react';
import { track } from '../api/analytics';
import {
  type CloudMeta,
  type MeResult,
  changePassword,
  deleteAccount,
  errorText,
  fetchMe,
  logoutAccount,
  markSynced,
  readAccountId,
  setupAccount,
  signIn,
  signUp,
  subscribeSession,
} from '../api/session';
import { applySnapshot, downloadSnapshot, syncNow, uploadSnapshot } from '../api/sync';
import { recordSyncedPets } from './syncAdditions';
import { useSnapshots } from './useSnapshots';

/**
 * 账号 & 云同步（2026-11-18 起：用户名 + 密码）
 *
 * 用户主线只有两条：
 * - 第一台设备：注册（用户名 + 密码）→ 云端立刻有这份数据
 * - 换设备：用同一个用户名密码登录 → 自动把云端数据拉下来写进本机（一键）
 *
 * 老账号（以前只有恢复码）只要这台设备还登录着，点「设置用户名和密码」即可保留全部数据和小组；
 * 忘记密码没有自助找回，找管理员重置。
 *
 * 日常对齐两台设备只需要点「立即同步」：拉云端 → 与本机按账号合并 → 推回云端，一个动作搞定。
 * 「用本机覆盖云端」保留为逃生口（合并只增不减，删掉的账号得靠它推上去）。
 */
const timeText = (ms: number): string => (ms ? new Date(ms).toLocaleString() : '—');

/**
 * 最近一次云端账号信息（进程内缓存）。
 * 切到「我的」会重挂本组件：先显示上次结果，再后台刷新，不再先闪「云端版本 暂无」。
 */
let meCache: { accountId: string; me: MeResult } | null = null;

export interface AccountPanelProps {
  /**
   * 由「导入数据」页转来的自动上传冲突（2026-10-06）：导入后的自动上传遇到 409 时，
   * 由上层把云端元信息透进来，这里复用既有的冲突二选一 UI（原来是静默吞掉的）。
   */
  autoConflict?: CloudMeta | null;
  /** 冲突被处理（选云端 / 选本机）后通知上层清掉提示 */
  onAutoConflictHandled?: () => void;
  /**
   * 「我的」页分区（2026-10-24）：identity 只看身份动作、sync 只看私有同步。
   * 组件本身仍只挂载一份，切分区不会丢登录表单 / 同步提示。
   */
  section?: 'identity' | 'sync';
}

export function AccountPanel({
  autoConflict = null,
  onAutoConflictHandled,
  section,
}: AccountPanelProps = {}) {
  const [accountId, setAccountId] = useState(() => readAccountId());
  const [me, setMe] = useState<MeResult | null>(() => {
    const id = readAccountId();
    return id && meCache?.accountId === id ? meCache.me : null;
  });
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [credentialForm, setCredentialForm] = useState<'none' | 'setup' | 'password'>('none');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<CloudMeta | null>(null);
  // 同步前的本机快照（同步后用来算「本次新增」）；订阅式读取，导入/同步后自动跟着更新
  const { snapshots, loaded } = useSnapshots();

  /** 写回 me 时同步进程内缓存；账号切换 / 退出时清掉。 */
  const rememberMe = (next: MeResult | null) => {
    const id = readAccountId();
    meCache = next && id ? { accountId: id, me: next } : null;
    setMe(next);
  };

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
    if (!accountId) {
      meCache = null;
      rememberMe(null);
      return;
    }
    // 先显示上一次的云端状态，再后台刷新；只有换身份时才清空
    const cached = meCache?.accountId === accountId ? meCache.me : null;
    setMe(cached);
    let alive = true;
    void fetchMe()
      .then((result) => {
        if (!alive) return;
        meCache = { accountId, me: result };
        setMe(result);
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

  const credentialProblem = (): string => {
    const name = usernameInput.trim();
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,16}$/.test(name)) return '用户名需为 3-16 位字母、数字、下划线或中文';
    if (passwordInput.length < 8 || passwordInput.length > 32) return '密码需为 8-32 位';
    if (passwordInput !== confirmInput) return '两次输入的密码不一致';
    return '';
  };

  const handleSignUp = () =>
    run('signup', async () => {
      const invalid = credentialProblem();
      if (invalid) {
        setError(invalid);
        return;
      }
      const name = await signUp(usernameInput.trim(), passwordInput);
      track('account_create');
      setPasswordInput('');
      setConfirmInput('');
      setMessage(`已开启云同步（用户名 ${name}）。换手机时用这个用户名和密码登录。`);
      // 开号后立刻把本机数据传上去，免得用户以为「开了同步但云端还是空的」
      const result = await uploadSnapshot();
      if (!result.ok) setConflict(result.conflict);
      else rememberMe(await fetchMe());
    });

  const handleSignIn = () =>
    run('login', async () => {
      await signIn(usernameInput.trim(), passwordInput);
      track('account_recover');
      setPasswordInput('');
      const cloud = await downloadSnapshot();
      if (!cloud) {
        setMessage('这个账号云端还没有数据。已把本机数据作为第一份上传。');
        const result = await uploadSnapshot();
        if (!result.ok) setConflict(result.conflict);
        rememberMe(await fetchMe());
        return;
      }
      await applySnapshot(cloud.snapshot, cloud.meta);
      track('sync_download', { version: cloud.meta.version, restored: true });
      setMessage('已把云端数据写到本机，正在刷新…');
      window.setTimeout(() => window.location.reload(), 800);
    });

  /** 老账号：在这台仍登录的设备上补设用户名密码，原有数据和小组都保留 */
  const handleSetupCredentials = () =>
    run('setup', async () => {
      const invalid = credentialProblem();
      if (invalid) {
        setError(invalid);
        return;
      }
      const name = await setupAccount(usernameInput.trim(), passwordInput);
      setUsernameInput('');
      setPasswordInput('');
      setConfirmInput('');
      setCredentialForm('none');
      setMessage(`已设置用户名 ${name}，换手机时用它登录。`);
      rememberMe(await fetchMe());
    });

  const handleChangePassword = () =>
    run('password', async () => {
      if (newPassword.length < 8 || newPassword.length > 32) {
        setError('新密码需为 8-32 位');
        return;
      }
      if (newPassword !== newPasswordConfirm) {
        setError('两次输入的新密码不一致');
        return;
      }
      await changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setCredentialForm('none');
      setMessage('密码已修改，下次登录用新密码。');
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
      rememberMe(await fetchMe());
      // 设置键是模块级 store 启动时读进内存的，补上的那些（如目标模式/母本达标标准）
      // 只有刷新页面才真正生效 —— 别试图就地刷新（2026-10-06 记录过的坑）
      if (result.prefsAdopted.length > 0) {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    });

  /** 逃生口：用本机数据整份覆盖云端（合并只增不减，本机删掉的账号得靠它推上去） */
  const handleForcePush = () => {
    // 2026-10-24：这是不可逆的整份替换，先确认再发写请求
    const confirmed = window.confirm(
      `用本机数据整份覆盖云端？\n\n` +
        `本机 ${snapshots.length} 个账号的数据会替换云端现有内容；` +
        `云端独有的账号或更新可能被移除。\n\n` +
        `拿不准就先到「游戏数据」导出备份。确定继续吗？`,
    );
    if (!confirmed) return;
    void run('force', async () => {
      markSynced(conflict?.version ?? me?.snapshot?.version ?? 0);
      clearConflict();
      const result = await uploadSnapshot();
      if (!result.ok) {
        setConflict(result.conflict);
        setMessage('云端刚被别的设备改过，再点一次。');
        return;
      }
      setMessage(`已用本机数据覆盖云端（版本 ${result.version}）`);
      rememberMe(await fetchMe());
    });
  };

  const handleLogout = () =>
    run('logout', async () => {
      await logoutAccount();
      rememberMe(null);
      setMessage('已退出登录（本机数据保留）。');
    });

  const handleDelete = () =>
    run('delete', async () => {
      if (
        !window.confirm(
          '注销会把云端数据全部删掉（本机数据保留）；你创建的小组会解散，你在其他小组共享的母本会撤回。确定吗？',
        )
      ) {
        return;
      }
      await deleteAccount();
      rememberMe(null);
      setMessage('账号已注销，云端数据已清空。');
    });

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-3"
      data-testid="account-panel"
      data-tour="profile-account"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-700">
          {section === 'identity' ? '我的身份' : section === 'sync' ? '私有同步' : '云同步（跨设备）'}
        </h2>
        {/* 文案避开「N 个账号」的写法：导入面板那行用的是那个格式，别让 e2e 的选择器撞车。
            账号数直接读内存快照，避免异步算大小导致切页时文字先闪一下。 */}
        <span className="text-[11px] text-slate-400" data-testid="account-local-size">
          {loaded ? `本机数据 · 账号 ${snapshots.length} 个` : '本机数据读取中…'}
        </span>
      </div>

      {accountId ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-500" data-testid="account-status">
            已登录 · 云端版本 {me?.snapshot ? me.snapshot.version : '暂无'} · 上次更新{' '}
            {me?.snapshot ? timeText(me.snapshot.updatedAt) : '—'}
          </p>
          {section !== 'sync' ? (
            <p className="text-xs text-slate-500" data-testid="account-username">
              {me ? (me.username ? `用户名：${me.username}` : '还没有用户名，设置后才能在别的设备上登录') : ' '}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {section !== 'identity' ? (
              <button
                type="button"
                data-testid="account-sync"
                onClick={handleSync}
                disabled={busy !== ''}
                className="min-h-[30px] rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {busy === 'sync' ? '同步中…' : '立即同步'}
              </button>
            ) : null}
            {section !== 'identity' ? (
              <button
                type="button"
                data-testid="account-force-push"
                onClick={handleForcePush}
                disabled={busy !== ''}
                className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500 disabled:opacity-50"
              >
                {busy === 'force' ? '上传中…' : '用本机覆盖云端'}
              </button>
            ) : null}
            {section !== 'sync' && me && !me.username ? (
              <button
                type="button"
                data-testid="account-open-setup"
                onClick={() => {
                  setUsernameInput('');
                  setPasswordInput('');
                  setConfirmInput('');
                  setCredentialForm(credentialForm === 'setup' ? 'none' : 'setup');
                }}
                disabled={busy !== ''}
                className="min-h-[30px] rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white disabled:opacity-50"
              >
                设置用户名和密码
              </button>
            ) : null}
            {section !== 'sync' && me?.username ? (
              <button
                type="button"
                data-testid="account-open-password"
                onClick={() => {
                  setOldPassword('');
                  setNewPassword('');
                  setNewPasswordConfirm('');
                  setCredentialForm(credentialForm === 'password' ? 'none' : 'password');
                }}
                disabled={busy !== ''}
                className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 disabled:opacity-50"
              >
                修改密码
              </button>
            ) : null}
            {section !== 'sync' ? (
              <button
                type="button"
                data-testid="account-logout"
                onClick={handleLogout}
                disabled={busy !== ''}
                className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500 disabled:opacity-50"
              >
                退出登录
              </button>
            ) : null}
            {section !== 'sync' ? (
              <button
                type="button"
                data-testid="account-delete"
                onClick={handleDelete}
                disabled={busy !== ''}
                className="min-h-[30px] rounded-lg border border-red-100 px-2.5 text-xs text-red-500 disabled:opacity-50"
              >
                注销账号
              </button>
            ) : null}
          </div>

          {credentialForm === 'setup' ? (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="account-setup-form">
              <p className="text-[11px] text-slate-500">设置后换设备用用户名和密码登录，现有数据和小组都保留。</p>
              <input
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                placeholder="用户名（3-16 位）"
                data-testid="account-setup-username"
                autoComplete="username"
                className="min-h-[32px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
              />
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                placeholder="密码（8-32 位）"
                data-testid="account-setup-password"
                autoComplete="new-password"
                className="min-h-[32px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
              />
              <input
                type="password"
                value={confirmInput}
                onChange={(event) => setConfirmInput(event.target.value)}
                placeholder="再输一次密码"
                data-testid="account-setup-confirm"
                autoComplete="new-password"
                className="min-h-[32px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="account-setup-submit"
                  onClick={handleSetupCredentials}
                  disabled={busy !== ''}
                  className="min-h-[32px] flex-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {busy === 'setup' ? '保存中…' : '保存'}
                </button>
                <button
                  type="button"
                  onClick={() => setCredentialForm('none')}
                  className="min-h-[32px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {credentialForm === 'password' ? (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="account-password-form">
              <input
                type="password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                placeholder="原密码"
                data-testid="account-password-old"
                autoComplete="current-password"
                className="min-h-[32px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="新密码（8-32 位）"
                data-testid="account-password-new"
                autoComplete="new-password"
                className="min-h-[32px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
              />
              <input
                type="password"
                value={newPasswordConfirm}
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
                placeholder="再输一次新密码"
                data-testid="account-password-confirm"
                autoComplete="new-password"
                className="min-h-[32px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="account-password-submit"
                  onClick={handleChangePassword}
                  disabled={busy !== ''}
                  className="min-h-[32px] flex-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {busy === 'password' ? '保存中…' : '保存新密码'}
                </button>
                <button
                  type="button"
                  onClick={() => setCredentialForm('none')}
                  className="min-h-[32px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : section === 'sync' ? (
        <p className="mt-2 text-xs text-slate-500" data-testid="account-sync-needs-identity">
          还没有我的身份。先到「我的身份」注册或登录。
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5" role="group">
            <button
              type="button"
              data-testid="account-mode-register"
              onClick={() => setMode('register')}
              aria-pressed={mode === 'register'}
              className={`min-h-[30px] flex-1 rounded-md text-xs font-medium ${
                mode === 'register' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              注册
            </button>
            <button
              type="button"
              data-testid="account-mode-login"
              onClick={() => setMode('login')}
              aria-pressed={mode === 'login'}
              className={`min-h-[30px] flex-1 rounded-md text-xs font-medium ${
                mode === 'login' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              登录
            </button>
          </div>
          <input
            value={usernameInput}
            onChange={(event) => setUsernameInput(event.target.value)}
            placeholder="用户名"
            data-testid="account-username-input"
            autoComplete="username"
            className="min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
          />
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            placeholder="密码（8-32 位）"
            data-testid="account-password-input"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            className="min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
          />
          {mode === 'register' ? (
            <input
              type="password"
              value={confirmInput}
              onChange={(event) => setConfirmInput(event.target.value)}
              placeholder="再输一次密码"
              data-testid="account-confirm-input"
              autoComplete="new-password"
              className="min-h-[36px] w-full rounded-lg border border-slate-200 px-2.5 text-sm"
            />
          ) : null}
          <button
            type="button"
            data-testid={mode === 'register' ? 'account-register' : 'account-login'}
            onClick={mode === 'register' ? handleSignUp : handleSignIn}
            disabled={busy !== ''}
            className="min-h-[36px] w-full rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {mode === 'register'
              ? busy === 'signup'
                ? '注册中…'
                : '注册并开启云同步'
              : busy === 'login'
                ? '登录中…'
                : '登录'}
          </button>
          <p className="text-[11px] text-slate-400">忘记密码联系管理员重置。</p>
        </div>
      )}

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
              className="min-h-[28px] rounded-md border border-rose-300 bg-white px-2.5 text-xs font-medium text-rose-700"
            >
              再同步一次（合并）
            </button>
            <button
              type="button"
              data-testid="account-conflict-keep-local"
              onClick={handleForcePush}
              className="min-h-[28px] rounded-md border border-rose-300 bg-white px-2.5 text-xs font-medium text-rose-700"
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
        同步内容：账号数据 + 设置；目标模式、母本达标标准、账号筛选以云端为准。
      </p>
    </section>
  );
}
