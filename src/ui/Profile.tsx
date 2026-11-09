import type { NavigationIntent, ProfileSection } from './navigation';
import { useRef, useState } from 'react';
import { AccountPanel } from './AccountPanel';
import { ImportOutcomeNotice } from './ImportOutcomeNotice';
import { ImportPanel } from './ImportPanel';
import { NativeCollectorPanel } from './NativeCollectorPanel';
import { Button } from './primitives/Button';
import { SegmentedControl } from './primitives/SegmentedControl';
import { ServerAddressPanel, serverBridge } from './ServerAddressPanel';
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
  { value: 'identity', label: '工具箱身份' },
  { value: 'data', label: '游戏数据' },
  { value: 'sync', label: '私有同步' },
];

/** 内测入口：2 秒内连点版本号 5 次 */
const VERSION_TAPS = 5;
const TAP_WINDOW_MS = 2000;

/**
 * 「我的」（2026-10-24 重构任务 6）：身份、游戏数据、私有同步三块。
 *
 * AccountPanel 只挂载**一份**（数据分区用 CSS 隐藏，不是卸载）：
 * 切分区不会丢恢复码 / 同步提示，也不会重复挂认证与同步处理。
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
  // 「服务器地址」只在内测壳里存在：浏览器没有 RocoServer，连点也不会开
  const [serverPanelOpen, setServerPanelOpen] = useState(false);
  const versionTaps = useRef<number[]>([]);

  const onVersionTap = () => {
    if (!serverBridge()) return;
    const now = Date.now();
    versionTaps.current = [...versionTaps.current, now].filter((at) => now - at < TAP_WINDOW_MS);
    if (versionTaps.current.length >= VERSION_TAPS) {
      versionTaps.current = [];
      setServerPanelOpen(true);
    }
  };

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      <SegmentedControl
        label="我的分区"
        value={section}
        options={SECTIONS}
        onValueChange={(next) =>
          onNavigate({ type: 'open-profile', section: next as ProfileSection })
        }
        optionTestId={(value) => `profile-section-${value}`}
      />

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
          title="工具箱身份"
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

      {/* AccountPanel 常驻：数据分区只是隐藏，切回来恢复码与同步提示仍在 */}
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
