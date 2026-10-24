import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { installFlushOnHide, platform, track } from './api/analytics';
import { CHANGELOG, markChangelogSeen, pendingChangelog, readChangelogSeen } from './data/changelog';
import { refreshApp } from './pwa/hardRefresh';
import { ChangelogModal } from './ui/ChangelogModal';
import { GuideModal } from './ui/GuideModal';
import { guidePending, markGuideSeen } from './ui/guide';
import { hasPendingNativeShare } from './share/nativeShare';
import { Dashboard } from './ui/Dashboard';
import { Collection } from './ui/Collection';
import { CollectionGroups } from './ui/CollectionGroups';
import { Profile } from './ui/Profile';
import { TabNav } from './ui/TabNav';
import {
  focusPending,
  initialNavigation,
  legacyLocation,
  resolveNavigation,
  type AppNavigation,
  type NavigationIntent,
} from './ui/navigation';
import { readLastTab, saveLastTab, hasSavedTab } from './ui/lastTab';
import { readSwapMainView, saveSwapMainView } from './ui/swapViewStore';
import { getImportOutcome, useImportOutcome } from './ui/importOutcomeStore';
import { useSnapshots } from './ui/useSnapshots';
import { useDraftLeaveGuard } from './ui/useDraftLeaveGuard';
import { SnapshotRefreshNotice } from './ui/SnapshotRefreshNotice';

export default function App() {
  const [navigation, setNavigation] = useState<AppNavigation>(() =>
    initialNavigation(readLastTab(), readSwapMainView()),
  );
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const [groupsDraftDirty, setGroupsDraftDirty] = useState(false);
  const { confirmLeave, leaveConfirmation } = useDraftLeaveGuard(groupsDraftDirty);
  /** 统一入口：页面只发意图，状态变化全部走纯函数（见 ui/navigation.ts）。 */
  const navigate = useCallback((intent: NavigationIntent) => {
    // 分享正在解析／保存期间不要卸载消费页面（否则这次分享会被静默搁置）；
    // 普通私有同步不锁导航（2026-10-24）。
    if (getImportOutcome().local === 'importing' && intent.type !== 'consume-focus') return;
    const current = navigationRef.current;
    const next = resolveNavigation(current, intent);
    if (current.page === 'groups' && next.page !== 'groups' && groupsDraftDirty) {
      void confirmLeave().then((leave) => {
        if (leave) setNavigation((latest) => resolveNavigation(latest, intent));
      });
    } else {
      setNavigation((latest) => resolveNavigation(latest, intent));
    }
  }, [confirmLeave, groupsDraftDirty]);
  const importOutcome = useImportOutcome();
  const activeTab = navigation.page;
  /** 手动刷新按钮的忙碌态（真正刷新会让页面重载，这里只防连点） */
  const [refreshing, setRefreshing] = useState(false);
  const { snapshots, loaded, refreshError, refreshedAt } = useSnapshots();
  // 壳（APK）把分享内容注入**当前页面**，而消费分享的监听挂在「导入数据」页里（只挂载当前页）：
  // 应用开着且停在别的页签时，分享会被静默搁置（看起来像「分享过来什么都没发生」）。
  // 所以一收到分享事件就切到导入页、并先按住「自动落看板」；等这次分享**导入完成**后
  // （ImportPanel 的 onShareImported 回调）再跳回看板，让用户直接看到「本次新增」——
  // 与网页版分享目标的行为一致。
  const [shareSeen, setShareSeen] = useState(() => hasPendingNativeShare());
  /**
   * 「分享导入完成后跳一次看板」的一次性标记。
   * 不复用 autoRedirected：那会把它重新武装，导致用户之后手动回「导入数据」页
   * 管理数据时又被弹走（原设计明确要避免这一点）。
   */
  const shareRedirect = useRef(false);
  useEffect(() => {
    const onShare = () => {
      shareRedirect.current = false;
      // 先按住自动落看板：否则导入还没跑完、导入页就被切走卸载了
      setShareSeen(true);
      navigate({ type: 'open-profile', section: 'data' });
    };
    window.addEventListener('roco-share', onShare);
    return () => window.removeEventListener('roco-share', onShare);
  }, [navigate]);
  // 有数据时默认落看板：首帧仍停在「导入数据」，读到数据后只在「还没被用户手动切走过、
  //  且仍停在导入页」时跳一次到看板，之后用户自由切换（回到导入数据页管理数据不再被打扰）。
  // 注意：本机已经记过页签（= 不是第一次打开）时不再自动跳，否则重开后点「导入数据」会被弹回看板。
  const autoRedirected = useRef(hasSavedTab());
  const onProfileDataPage = navigation.page === 'profile' && navigation.profileSection === 'data';
  useEffect(() => {
    if (loaded && !autoRedirected.current && !shareSeen && snapshots.length > 0 && onProfileDataPage) {
      autoRedirected.current = true;
      navigate({ type: 'tab', page: 'dashboard' });
    }
  }, [loaded, snapshots, onProfileDataPage, shareSeen, navigate]);
  /** 分享数据导入成功后标记「待跳看板」；等快照真的更新了再跳（保证看板已能看到新数据） */
  const handleShareImported = () => {
    shareRedirect.current = true;
  };
  useEffect(() => {
    if (!shareRedirect.current || snapshots.length === 0) return;
    shareRedirect.current = false;
    navigate({ type: 'tab', page: 'dashboard' });
  }, [snapshots, navigate]);
  // 切页面（含看板卡片跳转）时回到页面顶部：否则新页面会沿用上一页的滚动偏移，
  // 跳转落点不准（2026-10-05 修）。用 useLayoutEffect 在浏览器绘制前复位，避免闪现旧位置。
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [navigation.page, navigation.profileSection]);
  // 首启（还没看过教程）：不自动叠阻断弹窗，只在「我的 · 游戏数据」给一张非阻断入门卡（2026-10-24）
  const firstRun = useState(() => guidePending())[0];
  // 更新内容弹窗：启动时算一次「本机没看过的更新」，点「知道了」后记住已读（2026-10-05 起固定做法）
  const [changelog, setChangelog] = useState(() =>
    firstRun ? [] : pendingChangelog(readChangelogSeen()),
  );
  const closeChangelog = () => {
    if (CHANGELOG[0]) markChangelogSeen(CHANGELOG[0].id);
    setChangelog([]);
  };
  // 使用教程：完整教程只由明确动作打开（首启给非阻断入门卡）；已读记 guide.ts 的版本号
  const [guide, setGuide] = useState(false);
  const closeGuide = () => {
    markGuideSeen();
    setGuide(false);
  };
  // 匿名使用统计（2026-10-06 自建埋点）：启动报一次、切页签各报一次，页面隐藏前把队列发出去
  useEffect(() => {
    track('app_open', { platform: platform() });
    return installFlushOnHide();
  }, []);
  useEffect(() => {
    // 兼容桥阶段仍上报旧页签名（任务 9 再换新页面名，避免埋点口径提前断档）
    track('tab_view', { tab: activeTab });
    // 记住停留的页签：关后台后重开不会莫名其妙回到「导入数据」。
    // **不把四个新 page 字符串直接写进旧键**：旧版安装升级 / 降级都要能理解。
    const legacy = legacyLocation(navigation);
    saveLastTab(legacy.lastTab);
    if (legacy.lastTab === 'swap') saveSwapMainView(legacy.swapView);
  }, [navigation, activeTab]);
  // 覆盖度矩阵的展开态放在这里，切页签回来不会收起
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  /**
   * 精准直达的聚焦（2026-10-24）：看板「去看怎么迭代」带着蛋组跳过来时，
   * 展开它并滚到视野中间。等数据读完后才滚；成功后消费这次 revision，
   * 用户手动离开再回来不会被旧聚焦重新改列表。
   */
  useEffect(() => {
    if (!focusPending(navigation) || navigation.page !== 'collection') return;
    const location = navigation.collection;
    if (location.kind !== 'studs' || location.view !== 'coverage') return;
    if (!loaded) return;
    const revision = navigation.focusRevision;
    if (location.groupId == null) {
      navigate({ type: 'consume-focus', revision });
      return;
    }
    setExpandedGroupId(location.groupId);
    // 等这次渲染提交完再滚（顶部栏是 sticky，所以用 center 而不是 start）
    const timer = window.setTimeout(() => {
      document
        .querySelector(
          `[data-testid="coverage-group-row"][data-group-id="${location.groupId}"]`,
        )
        ?.scrollIntoView({ block: 'center' });
      navigate({ type: 'consume-focus', revision });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [navigation, loaded, navigate]);

  const collection = navigation.collection;
  return (
    <>
      {/* 顶部标签常显：滚动页面时 header + 页签固定在视口顶部（2026-10-04 优化） */}
      <div className="sticky top-0 z-50 bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-2">
          <h1 className="text-base font-semibold text-slate-900">洛克工具箱</h1>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (refreshing) return;
                setRefreshing(true);
                void refreshApp();
              }}
              data-testid="app-refresh"
              title="刷新到最新版本（清掉旧缓存）"
              className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500 disabled:opacity-50"
              disabled={refreshing}
            >
              {refreshing ? '刷新中…' : '刷新'}
            </button>
            <button
              type="button"
              onClick={() => setGuide(true)}
              data-testid="guide-open"
              className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500"
            >
              教程
            </button>
            <span className="text-[10px] text-slate-300" data-testid="app-version">
              版本 {__APP_BUILD__}
            </span>
          </div>
        </header>
        <TabNav active={activeTab} onChange={(page) => navigate({ type: 'tab', page })} />
      </div>
      <SnapshotRefreshNotice error={refreshError} refreshedAt={refreshedAt} />
      {/* 2026-10-06 修复（M3）：不要在渲染体里用「每次渲染都是新引用」的内联箭头组件
          拼 Record<TabId, ComponentType>——App 任何 state 变化（比如开关更新弹窗）都会
          让 React 认为页面组件类型变了，把整个页面卸载重挂，页内状态全部丢失。
          改成条件渲染：组件引用稳定，只有切页签才挂/卸。 */}
      {navigation.page === 'dashboard' ? (
        <Dashboard onNavigate={navigate} />
      ) : navigation.page === 'profile' ? (
        <Profile
          section={navigation.profileSection}
          returnToGroups={navigation.returnToGroups}
          onNavigate={navigate}
          onShareImported={handleShareImported}
          onOpenGuide={() => setGuide(true)}
        />
      ) : navigation.page === 'groups' ? (
        <CollectionGroups
          onDraftDirtyChange={setGroupsDraftDirty}
          focus={{ groupType: navigation.groupType, eggGameId: navigation.groupEggGameId }}
          onGoAccount={() =>
            navigate({ type: 'open-profile', section: 'identity', returnToGroups: true })
          }
        />
      ) : (
        <Collection
          location={collection}
          focusRevision={navigation.focusRevision}
          onNavigate={navigate}
          expandedGroupId={expandedGroupId}
          onToggleGroup={setExpandedGroupId}
        />
      )}
      {changelog.length > 0 ? <ChangelogModal entries={changelog} onClose={closeChangelog} /> : null}
      {/* 完整教程不再首启自动弹：由顶部「教程」或「我的」入门卡明确打开 */}
      {guide ? <GuideModal onClose={closeGuide} /> : null}
      {leaveConfirmation}
      {importOutcome.local === 'importing' ? (
        <div
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-2 text-xs text-white shadow-lg"
          role="status"
          data-testid="import-busy"
        >
          正在保存导入的数据…
        </div>
      ) : null}
    </>
  );
}
