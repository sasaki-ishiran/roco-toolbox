import type { NavigationIntent, ProfileSection } from './navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { appUpdateSnapshot, checkAppUpdate, hasAppUpdateShell, installAppUpdateBridge, seedAppUpdate, subscribeAppUpdate } from '../collector/appUpdate';
import { AccountPanel } from './AccountPanel';
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

export interface ProfileProps {
  section: ProfileSection;
  returnToGroups: boolean;
  onNavigate: (intent: NavigationIntent) => void;
  /** 重播「先导入一次」的首启引导（入门卡上的「教程」按钮） */
  onStartTour?: () => void;
}

const SECTIONS = [
  { value: 'identity', label: '我的身份' },
  { value: 'data', label: '游戏数据' },
  { value: 'sync', label: '私有同步' },
];

/** 内测入口：2 秒内连点版本号 5 次，在测试站 / 正式站之间互切 */
const VERSION_TAPS = 5;
const TAP_WINDOW_MS = 2000;

/**
 * 「我的」（2026-10-24 重构任务 6）：身份、游戏数据、私有同步三块。
 *
 * AccountPanel 只挂载**一份**（数据分区用 CSS 隐藏，不是卸载）：
 * 切分区不会丢登录表单 / 同步提示，也不会重复挂认证与同步处理。
 */
export function Profile({
  section,
  returnToGroups,
  onNavigate,
  onStartTour,
}: ProfileProps) {
  // 导入后的自动上传冲突仍以 syncNoticeStore 为准，交给 AccountPanel 二选一
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

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      {/* 环境角标：按当前域名自动判定（测试站 / 正式站 / 自定义），切服重载后自动变化 */}
      <div className="flex justify-end" data-testid="env-badge-row">
        <span
          data-testid="env-badge"
          data-env={env}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${envMeta.cls}`}
        >
          {envMeta.label}
        </span>
      </div>
      <SegmentedControl
        label="我的分区"
        value={section}
        options={SECTIONS}
        onValueChange={(next) =>
          onNavigate({ type: 'open-profile', section: next as ProfileSection })
        }
        optionTestId={(value) => `profile-section-${value}`}
      />

      {serverNotice ? (
        <p
          className={`text-xs ${serverNotice.kind === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}
          data-testid="server-switch-notice"
          aria-live="polite"
        >
          {serverNotice.text}
        </p>
      ) : null}

      {returnToGroups ? (
        <Button
          variant="secondary"
          onClick={() => onNavigate({ type: 'open-groups' })}
          data-testid="profile-return-groups"
        >
          返回小组
        </Button>
      ) : null}

      {section === 'identity' ? (
        <StateNotice
          kind="unknown"
          title="我的身份"
          description="用来跨设备同步同一份数据。游戏账号（UID）是游戏里的角色，在「游戏数据」里单独管理。"
          testId="profile-identity-intro"
        />
      ) : null}

      {section === 'sync' ? (
        <StateNotice
          kind="unknown"
          title="私有同步"
          description="只同步给你自己的设备；不会更新小组资源，也不会自动发布。"
          testId="profile-sync-intro"
        />
      ) : null}

      {section === 'data' ? (
        <>
          {loaded && snapshots.length === 0 ? (
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
          <ImportOutcomeNotice onOpenGroups={() => onNavigate({ type: 'open-groups' })} />
          <NativeCollectorPanel />
          <ImportPanel />
        </>
      ) : null}

      {/* 更新入口 A：左「检查更新 / 当前版本」右按钮；有新版变「更新」并显示新版本号 */}
      {updateSupported ? (
        <section className="flex items-center justify-between gap-2 rounded-2xl bg-white p-4 shadow-sm" data-testid="app-update-card">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">检查更新</p>
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
      <p
        className="pt-1 text-center text-[10px] text-slate-300"
        data-testid="app-version"
        onClick={onVersionTap}
      >
        版本 {__APP_BUILD__}
      </p>

      {serverPanelOpen ? (
        <ServerAddressPanel onClose={() => setServerPanelOpen(false)} />
      ) : null}

      {/* AccountPanel 常驻：数据分区只是隐藏，切回来登录表单与同步提示仍在 */}
      <div className={section === 'data' ? 'hidden' : 'space-y-3'} data-testid="profile-account-slot">
        <AccountPanel
          section={section === 'sync' ? 'sync' : 'identity'}
          autoConflict={autoConflict}
          onAutoConflictHandled={() => setSyncConflict(null)}
        />
      </div>
    </main>
  );
}
