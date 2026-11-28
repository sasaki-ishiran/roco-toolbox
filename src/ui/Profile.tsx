import type { NavigationIntent, ProfileSection } from './navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { appUpdateSnapshot, checkAppUpdate, hasAppUpdateShell, installAppUpdateBridge, seedAppUpdate, subscribeAppUpdate } from '../collector/appUpdate';
import { readAccountId, subscribeSession } from '../api/session';
import { AccountPanel } from './AccountPanel';
import { useAccountName } from './accountMe';
import { collectAvatarCandidates } from './avatarCandidates';
import { CollectionGroups } from './CollectionGroups';
import { Nearby } from './Nearby';
import { NearbyErrorBoundary } from './NearbyErrorBoundary';
import { ProfileAvatarPicker } from './ProfileAvatarPicker';
import { ProfileHome } from './profile/ProfileHome';
import { useProfileTodos } from './profile/useProfileTodos';
import type { ProfilePageContext } from './profile/types';
import { useProfileAvatar } from './useProfileAvatar';
import { Button } from './primitives/Button';
import { ServerAddressPanel, serverBridge, toggleServer } from './ServerAddressPanel';
import { serverEnvOf } from './serverEnv';
import { StateNotice } from './primitives/StateNotice';
import { setSyncConflict, useSyncFeedback } from './syncNoticeStore';
import { useSnapshots } from './useSnapshots';

export type ProfileDataView = 'import' | 'nearby';

export interface ProfileProps {
  section: ProfileSection;
  returnToGroups: boolean;
  onNavigate: (intent: NavigationIntent) => void;
  /** 重播「先导入一次」的首启引导（入门卡上的「教程」按钮） */
  onStartTour?: () => void;
  /** 「游戏数据」里的二级视图：导入 / 附近（附近不再是独立页签，2026-11-21） */
  dataView?: ProfileDataView;
  /** 小组资源的编辑草稿有没有未保存改动（离开时拦一下） */
  onDraftDirtyChange?: (dirty: boolean) => void;
}

/** 内测入口：2 秒内连点版本号 5 次，在测试站 / 正式站之间互切 */
const VERSION_TAPS = 5;
const TAP_WINDOW_MS = 2000;

/**
 * 「我的」。
 *
 * 2026-11-28 重排（RUI-01/03/04/05）：首页不再是一个大组件，而是由
 * `src/ui/profile/recipes.ts` 的配方决定放哪些区块；二级分区（小组 / 身份 / 游戏数据）
 * 仍是本文件里的子视图。首屏只回答「我现在什么状态」：身份 → 三个数字 → 三个入口；
 * 采集/导入与更多设置排在它们后面。
 */
export function Profile({
  section,
  returnToGroups,
  onNavigate,
  onStartTour,
  dataView = 'import',
  onDraftDirtyChange,
}: ProfileProps) {
  // 导入后的自动上传冲突仍以 syncNoticeStore 为准，交给 AccountPanel 二选一
  const { conflict: autoConflict } = useSyncFeedback();
  // 入门卡只在「本机还没有任何导入数据」时出现：导入过一次就不再打扰（2026-11-01）
  const { snapshots, loaded } = useSnapshots();
  // 登录态（本机模式 / 已登录）：概览卡与蛋仓入口都要用；只读，不在这里做登录
  const accountId = useSyncExternalStore(subscribeSession, readAccountId, () => null);
  // 用户名：与账号面板共用一份 /api/me 缓存（2026-11-28 RUI P1-02），读不到就退回「已登录」
  const accountName = useAccountName(accountId);
  // 头像（2026-11-28）：A 图鉴精灵 + 云端；点头像直接换
  const avatarState = useProfileAvatar(accountId);
  const avatarCandidates = useMemo(() => collectAvatarCandidates(snapshots), [snapshots]);
  // 首屏待办数字（2026-11-28 用户口径：待认领 / 待确认 / 附近目标；收集进度归看板）
  const todos = useProfileTodos(accountId);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  useEffect(() => {
    if (!accountId) setAvatarPickerOpen(false);
  }, [accountId]);
  // 更新入口（1.3.6）：壳负责检查 / 下载 / 安装，这里只显示状态与触发
  const update = useSyncExternalStore(subscribeAppUpdate, appUpdateSnapshot);
  const [updateSupported] = useState(hasAppUpdateShell);
  useEffect(() => {
    installAppUpdateBridge();
    seedAppUpdate();
  }, []);
  // 「服务器地址」只在内测壳里存在：浏览器没有 RocoServer，连点也不会开
  const [serverPanelOpen, setServerPanelOpen] = useState(false);
  const [serverSwitching, setServerSwitching] = useState(false);
  const [serverNotice, setServerNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const versionTaps = useRef<number[]>([]);
  /** 「采集数据」入口：滚到采集/导入区块（区块自带 scroll-mt，让开 sticky 头）。 */
  const scrollToCollect = () => {
    document
      .querySelector('[data-testid="profile-collect"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  /** 换头像：未登录只提示，不给弹层入口（2026-11-28） */
  const openAvatarPicker = () => {
    if (!accountId) {
      avatarState.showNotice('登录后才能设置头像');
      return;
    }
    setAvatarPickerOpen(true);
  };
  const closeAvatarPicker = () => setAvatarPickerOpen(false);
  const goImportFromAvatar = () => {
    setAvatarPickerOpen(false);
    scrollToCollect();
  };
  // 概览卡右上角的「同步」2026-11-28 已删（FX1 ①）：它不执行同步、只滚动到下面的
  // 「私有同步」卡并高亮 2 秒，属于「按钮 = 滚动」的伪动作。同步只留「立即同步」一处。

  const onVersionTap = () => {
    const bridge = serverBridge();
    if (!bridge || serverSwitching) return;
    const now = Date.now();
    versionTaps.current = [...versionTaps.current, now].filter((at) => now - at < TAP_WINDOW_MS);
    if (versionTaps.current.length < VERSION_TAPS) return;
    versionTaps.current = [];
    // 1.3 内测包默认测试站：连点直接在测试站 / 正式站之间互切（成功时壳会清缓存并重载页面）
    setServerSwitching(true);
    setServerNotice({ kind: 'ok', text: '正在探活并切换服务器…' });
    // 桥调用是同步阻塞的（探活最多 5 秒），先让「切换中」画出来再进桥
    window.setTimeout(() => {
      const result = toggleServer(bridge);
      setServerSwitching(false);
      if (result.ok) {
        setServerNotice({ kind: 'ok', text: result.message });
        return;
      }
      // 探活失败时壳不会重载：把原因留在页面上，并打开手动面板兜底
      setServerNotice({ kind: 'error', text: result.message });
      setServerPanelOpen(true);
    }, 30);
  };

  const env = serverEnvOf(typeof window === 'undefined' ? '' : window.location.hostname);
  const envMeta = {
    test: { label: '内测', cls: 'border-orange-200 bg-orange-50 text-orange-600' },
    prod: { label: '正式', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
    custom: { label: '自定义', cls: 'border-sky-200 bg-sky-50 text-sky-600' },
  }[env];
  // 环境角标不再单独占右上角（2026-11-21）：跟着版本信息走——有更新入口时在「检查更新」卡里，
  // 浏览器（没有壳）挂在底部版本号行上，两处只出现一份。
  const envBadge = (
    <span
      data-testid="env-badge"
      data-env={env}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${envMeta.cls}`}
    >
      {envMeta.label}
    </span>
  );

  const goSection = (next: ProfileSection) => onNavigate({ type: 'open-profile', section: next });
  const backToProfile = () => goSection('data');
  /** 首页区块共享的只读数据 + 回调（区块之间不互相 import）。 */
  const pageCtx: ProfilePageContext = {
    loaded,
    snapshots,
    accountId,
    accountName,
    avatar: avatarState.avatar,
    avatarNotice: avatarState.notice,
    todos,
    onOpenAvatar: openAvatarPicker,
    onCollect: scrollToCollect,
    onGoEggStock: () => onNavigate({ type: 'open-egg-stock' }),
    onGoGroups: () => goSection('groups'),
    onOpenGroups: () => onNavigate({ type: 'open-groups' }),
    onGoIdentity: () => goSection('identity'),
    onGoNearby: () => onNavigate({ type: 'tab', page: 'nearby' }),
    onGoDashboard: () => onNavigate({ type: 'tab', page: 'dashboard' }),
    onStartTour,
    autoConflict,
    onAutoConflictHandled: () => setSyncConflict(null),
  };
  /** 二级分区（小组 / 我的身份）左上角的返回行；就是回到「我的」首页（数据视图）。 */
  const backRow = (
    <button
      type="button"
      onClick={backToProfile}
      data-testid="profile-section-data"
      className="flex min-h-[44px] w-full items-center gap-1 px-1 text-left text-sm font-medium text-emerald-700 transition-colors active:bg-surface-sunken"
    >
      ‹ 返回我的
    </button>
  );

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      {serverNotice ? (
        <p
          className={`text-xs ${serverNotice.kind === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}
          data-testid="server-switch-notice"
          aria-live="polite"
        >
          {serverNotice.text}
        </p>
      ) : null}

      {/* 切 section 的淡入（2026-11-28 FX1 ④）：120ms 只做透明度，不做位移——位移会和滚动打架。
          key 跟着 section 换，等于换一个容器让动画重播；容器本身沿用原来的 space-y-3，不改版式。 */}
      <div key={section} data-testid="profile-section-fade" className="profile-section-fade space-y-3">
      {section === 'data' && dataView === 'nearby' ? (
        <>
          {backRow}
          <NearbyErrorBoundary>
            <Nearby embedded onNavigate={onNavigate} />
          </NearbyErrorBoundary>
        </>
      ) : null}

      {section === 'data' && dataView === 'import' ? <ProfileHome ctx={pageCtx} /> : null}

      {section === 'groups' ? (
        <>
          {backRow}
          {returnToGroups ? (
            <Button
              variant="secondary"
              className="active:bg-surface-sunken"
              onClick={() => onNavigate({ type: 'open-groups' })}
              data-testid="profile-return-groups"
            >
              返回小组
            </Button>
          ) : null}
          <CollectionGroups
            embedded
            variant="admin"
            onDraftDirtyChange={onDraftDirtyChange}
            onGoAccount={() => goSection('identity')}
            // 「没有找到你的游戏号？」= 先去导入，不是去登录（2026-11-27）
            onGoImport={() => goSection('data')}
          />
        </>
      ) : null}

      {section === 'identity' ? (
        <>
          {backRow}
          {returnToGroups ? (
            <Button
              variant="secondary"
              className="active:bg-surface-sunken"
              onClick={() => onNavigate({ type: 'open-groups' })}
              data-testid="profile-return-groups"
            >
              返回小组
            </Button>
          ) : null}
          <StateNotice
            kind="unknown"
            title="我的身份"
            description="用来跨设备同步同一份数据。游戏账号（UID）是游戏里的角色，在「游戏数据」里单独管理。"
            testId="profile-identity-intro"
          />
          <AccountPanel
            section="identity"
            autoConflict={autoConflict}
            onAutoConflictHandled={() => setSyncConflict(null)}
          />
        </>
      ) : null}
      </div>

      {/* 更新入口 A：左「检查更新 / 当前版本」右按钮；有新版变「更新」并显示新版本号 */}
      {updateSupported ? (
        <section className="flex items-center justify-between gap-2 rounded-2xl bg-white p-4 shadow-sm" data-testid="app-update-card">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-slate-800">检查更新</p>
              {envBadge}
            </div>
            <p className="text-xs text-slate-500">当前版本 {update.current || '—'}</p>
            {update.state === 'available' ? (
              <p className="text-xs text-emerald-700">发现新版本 {update.latest}</p>
            ) : update.state === 'latest' ? (
              <p className="text-xs text-slate-400">已是最新版本</p>
            ) : update.state === 'failed' ? (
              <p className="text-xs text-rose-600">{update.message ?? '检查失败，请稍后重试'}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => { checkAppUpdate(); }}
            disabled={update.state === 'checking'}
            data-testid="app-update-button"
            className="min-h-[28px] shrink-0 rounded-lg border border-slate-200 px-2 text-xs text-slate-600 transition-colors active:bg-surface-sunken disabled:text-slate-300"
          >
            {update.state === 'available' ? '更新' : update.state === 'checking' ? '检查中' : '检查'}
          </button>
        </section>
      ) : null}

      {/* 构建时间（原顶栏版本标记）：排障时确认「拿到的是不是最新一版」 */}
      <div
        className="flex flex-col items-center gap-1 rounded-tile px-s3 pt-1 transition-colors active:bg-surface-sunken"
        data-testid="app-version"
        onClick={onVersionTap}
      >
        <span className="text-[10px] text-ink-muted">版本 {__APP_BUILD__}</span>
        {updateSupported ? null : envBadge}
      </div>

      {section === 'data' && dataView === 'import' ? (
        <ProfileAvatarPicker
          open={avatarPickerOpen}
          current={avatarState.avatar}
          candidates={avatarCandidates}
          displayName={accountName || '已登录'}
          colorSeed={accountId ? accountName || accountId : null}
          busy={avatarState.busy}
          onPick={(next) => {
            setAvatarPickerOpen(false);
            void avatarState.choose(next);
          }}
          onClose={closeAvatarPicker}
          onGoImport={goImportFromAvatar}
        />
      ) : null}

      {serverPanelOpen ? (
        <ServerAddressPanel onClose={() => setServerPanelOpen(false)} />
      ) : null}

    </main>
  );
}
