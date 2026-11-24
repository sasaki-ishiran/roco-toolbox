import type { NavigationIntent, ProfileSection } from './navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { appUpdateSnapshot, checkAppUpdate, hasAppUpdateShell, installAppUpdateBridge, seedAppUpdate, subscribeAppUpdate } from '../collector/appUpdate';
import { AccountPanel } from './AccountPanel';
import { CollectionGroups } from './CollectionGroups';
import { Nearby } from './Nearby';
import { NearbyErrorBoundary } from './NearbyErrorBoundary';
import { ImportOutcomeNotice } from './ImportOutcomeNotice';
import { ImportPanel } from './ImportPanel';
import { NativeCollectorPanel } from './NativeCollectorPanel';
import { Button } from './primitives/Button';
import { SegmentedControl } from './primitives/SegmentedControl';
import { ServerAddressPanel, serverBridge, toggleServer } from './ServerAddressPanel';
import { serverEnvOf } from './serverEnv';
import { StateNotice } from './primitives/StateNotice';
import { setSyncConflict, useSyncFeedback } from './syncNoticeStore';
import { useSnapshots } from './useSnapshots';
import { useLandscape } from './useWideLandscape';
import { RailLayout, RailAside, RailNav, RailNavItem } from './primitives/RailLayout';

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

const SECTIONS = [
  { value: 'groups', label: '小组' },
  { value: 'identity', label: '我的身份' },
  { value: 'data', label: '游戏数据' },
];

const DATA_VIEWS = [
  { value: 'import', label: '导入' },
  { value: 'nearby', label: '附近' },
];

/** 横屏右栏只放两字：小组 / 身份 / 数据（完整叫法走 aria-label / title）。 */
const SECTION_SHORT: Record<ProfileSection, string> = {
  groups: '小组',
  identity: '身份',
  data: '数据',
};

/** 内测入口：2 秒内连点版本号 5 次，在测试站 / 正式站之间互切 */
const VERSION_TAPS = 5;
const TAP_WINDOW_MS = 2000;

/**
 * 「我的」：小组 / 我的身份 / 游戏数据三块（2026-11-21 起）。
 *
 * 私有同步已从分区挪到「游戏数据 · 本机采集」下方：导入完就能顺手同步，
 * 不用再记一个单独的分区。
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
  // 横屏三栏：分区 / 子视图挪到右边缘纵向标题栏，高度留给内容（2026-11-22 规范）
  const landscape = useLandscape();
  const { conflict: autoConflict } = useSyncFeedback();
  // 入门卡只在「本机还没有任何导入数据」时出现：导入过一次就不再打扰（2026-11-01）
  const { snapshots, loaded } = useSnapshots();
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

  const sectionControl = (
    <SegmentedControl
      label="我的分区"
      value={section}
      options={SECTIONS}
      onValueChange={(next) =>
        onNavigate({ type: 'open-profile', section: next as ProfileSection })
      }
      optionTestId={(value) => `profile-section-${value}`}
    />
  );
  const dataControl = section === 'data' ? (
    <SegmentedControl
      label="游戏数据视图"
      value={dataView}
      options={DATA_VIEWS}
      onValueChange={(next) =>
        next === 'nearby'
          ? onNavigate({ type: 'tab', page: 'nearby' })
          : onNavigate({ type: 'open-profile', section: 'data' })
      }
      optionTestId={(value) => `data-view-${value}`}
    />
  ) : null;
  const rail = landscape ? (
    <RailAside
      title="我的"
      hideTitle
      back={
        returnToGroups
          ? { label: '返回小组', onClick: () => onNavigate({ type: 'open-groups' }) }
          : undefined
      }
      testIds={{ aside: 'profile-rail', title: 'profile-rail-title', back: 'profile-rail-back' }}
    >
      <RailNav label="我的分区">
        {SECTIONS.map((item) => (
          <RailNavItem
            key={item.value}
            active={section === item.value}
            title={item.label}
            testId={`profile-section-${item.value}`}
            onClick={() =>
              onNavigate({ type: 'open-profile', section: item.value as ProfileSection })
            }
          >
            {SECTION_SHORT[item.value as ProfileSection]}
          </RailNavItem>
        ))}
      </RailNav>
      {section === 'data' ? (
        <RailNav label="游戏数据视图">
          {DATA_VIEWS.map((item) => (
            <RailNavItem
              key={item.value}
              active={dataView === item.value}
              title={item.label}
              testId={`data-view-${item.value}`}
              onClick={() =>
                item.value === 'nearby'
                  ? onNavigate({ type: 'tab', page: 'nearby' })
                  : onNavigate({ type: 'open-profile', section: 'data' })
              }
            >
              {item.label}
            </RailNavItem>
          ))}
        </RailNav>
      ) : null}
    </RailAside>
  ) : null;

  const content = (
    <>
      {!landscape ? sectionControl : null}

      {serverNotice ? (
        <p
          className={`text-xs ${serverNotice.kind === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}
          data-testid="server-switch-notice"
          aria-live="polite"
        >
          {serverNotice.text}
        </p>
      ) : null}

      {returnToGroups && !landscape ? (
        <Button
          variant="secondary"
          onClick={() => onNavigate({ type: 'open-groups' })}
          data-testid="profile-return-groups"
        >
          返回小组
        </Button>
      ) : null}

      {section === 'groups' ? (
        <CollectionGroups
          embedded
          variant="admin"
          onDraftDirtyChange={onDraftDirtyChange}
          onGoAccount={() => onNavigate({ type: 'open-profile', section: 'identity' })}
        />
      ) : null}

      {section === 'identity' ? (
        <>
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

      {section === 'data' ? (
        <>
          {!landscape ? dataControl : null}
          {dataView === 'nearby' ? (
            <NearbyErrorBoundary>
              <Nearby embedded onNavigate={onNavigate} />
            </NearbyErrorBoundary>
          ) : null}
          {dataView === 'import' && loaded && snapshots.length === 0 ? (
            <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="first-run-card">
              <h2 className="text-base font-semibold text-slate-900">先采集一次，看看还缺什么</h2>
              <p className="mt-1 text-sm text-slate-600">
                采集完成后这里会出现母本和种公的进度、缺口与下一步；看板、收集、小组也都按这份数据算。
              </p>
              {onStartTour ? (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={onStartTour}
                  data-testid="first-run-guide"
                >
                  教程
                </Button>
              ) : null}
            </section>
          ) : null}
          {dataView === 'import' ? (
            <>
              <ImportOutcomeNotice onOpenGroups={() => onNavigate({ type: 'open-groups' })} />
              <NativeCollectorPanel />
              {/* 私有同步（2026-11-21 从独立分区挪到这里）：本机采集 / 导入的下方 */}
              <ImportPanel
                afterAnalytics={
                  <AccountPanel
                    section="sync"
                    autoConflict={autoConflict}
                    onAutoConflictHandled={() => setSyncConflict(null)}
                  />
                }
              />
            </>
          ) : null}
        </>
      ) : null}

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
            className="min-h-[28px] shrink-0 rounded-lg border border-slate-200 px-2 text-xs text-slate-600 disabled:text-slate-300"
          >
            {update.state === 'available' ? '更新' : update.state === 'checking' ? '检查中' : '检查'}
          </button>
        </section>
      ) : null}

      {/* 构建时间（原顶栏版本标记）：排障时确认「拿到的是不是最新一版」 */}
      <div
        className="flex flex-col items-center gap-1 pt-1"
        data-testid="app-version"
        onClick={onVersionTap}
      >
        <span className="text-[10px] text-slate-300">版本 {__APP_BUILD__}</span>
        {updateSupported ? null : envBadge}
      </div>
    </>
  );

  return (
    <main className="mx-auto max-w-md space-y-3 p-4" data-testid="profile-page">
      {landscape ? (
        <RailLayout
          collapsed={false}
          aside={rail}
          testIds={{ scope: 'profile-rail-scope', main: 'profile-main' }}
        >
          {content}
        </RailLayout>
      ) : (
        content
      )}

      {serverPanelOpen ? (
        <ServerAddressPanel onClose={() => setServerPanelOpen(false)} />
      ) : null}

    </main>
  );
}
