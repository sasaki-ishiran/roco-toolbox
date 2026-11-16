import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { installFlushOnHide, platform, track } from './api/analytics';
import { CHANGELOG, markChangelogSeen, pendingChangelog, readChangelogSeen } from './data/changelog';
import { refreshApp } from './pwa/hardRefresh';
import { ChangelogModal } from './ui/ChangelogModal';
import { TourOverlay } from './ui/TourOverlay';
import {
  TOUR_SEGMENTS,
  anyTourPending,
  markSegmentSeen,
  migrateLegacyTourSeen,
  segmentOfPage,
  segmentPending,
  startTourPending,
  type TourSegment,
  type TourStep,
} from './ui/tour';
import { Dashboard } from './ui/Dashboard';
import { HomeLand, saveHomeView } from './ui/Home';
import { Collection } from './ui/Collection';
import { CollectionGroups } from './ui/CollectionGroups';
import { Nearby } from './ui/Nearby';
import { NearbyErrorBoundary } from './ui/NearbyErrorBoundary';
import { BattleHudOrb } from './ui/BattleHudOrb';
import { useNearbyOverlayPush } from './nearby/useNearbyOverlayPush';
import { Profile } from './ui/Profile';
import { TabNav } from './ui/TabNav';
import {
  focusPending,
  initialNavigation,
  legacyLocation,
  resolveNavigation,
  type AppNavigation,
  type AppPage,
  type NavigationIntent,
} from './ui/navigation';
import { readLastTab, saveLastTab } from './ui/lastTab';
import { readSwapMainView, saveSwapMainView } from './ui/swapViewStore';
import { getImportOutcome, useImportOutcome } from './ui/importOutcomeStore';
import { usePlanBadge } from './ui/plan/usePlanBadge';
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
  // 安卓壳悬浮面板推送：应用级，跟随采集状态而不是跟随「附近」页
  useNearbyOverlayPush();
  const activeTab = navigation.page;
  /** 手动刷新按钮的忙碌态（真正刷新会让页面重载，这里只防连点） */
  const [refreshing, setRefreshing] = useState(false);
  const { snapshots, loaded, refreshError, refreshedAt } = useSnapshots();
  usePlanBadge();
  // 壳（APK）把分享内容注入**当前页面**，而消费分享的监听挂在「导入数据」页里（只挂载当前页）：
  // 应用开着且停在别的页签时，分享会被静默搁置（看起来像「分享过来什么都没发生」）。
  // 所以一收到分享事件就切到导入页；导入完成后**不再自动跳看板**（2026-10-25 用户要求）：
  // 现在用户多在工具箱内采集导入，更关心采集/导入/上传是否成功，应留在原页看进度。
  useEffect(() => {
    const onShare = () => {
      navigate({ type: 'open-profile', section: 'data' });
    };
    window.addEventListener('roco-share', onShare);
    return () => window.removeEventListener('roco-share', onShare);
  }, [navigate]);
  // 切页面（含看板卡片跳转）时回到页面顶部：否则新页面会沿用上一页的滚动偏移，
  // 跳转落点不准（2026-10-05 修）。用 useLayoutEffect 在浏览器绘制前复位，避免闪现旧位置。
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [navigation.page, navigation.profileSection]);
  // 更新内容弹窗：启动时算一次「本机没看过的更新」，点「知道了」后记住已读（2026-10-05 起固定做法）
  // 引导与更新弹窗不叠加：还有任一分段待引导时先不讲更新，等下次启动再看（同教程互斥的处理）
  const [changelog, setChangelog] = useState(() =>
    anyTourPending() ? [] : pendingChangelog(readChangelogSeen()),
  );
  const closeChangelog = () => {
    if (CHANGELOG[0]) markChangelogSeen(CHANGELOG[0].id);
    setChangelog([]);
  };
  /**
   * 新手引导（2026-11-01 第二轮）：按场景分段，不再固定一条 15 步主线。
   * - 首启只自动弹 `start`（先打开「开始采集」，数据到位后收尾提示「教程」入口）；
   * - 看板 / 收集 / 小组 / 家园 / 我的：第一次进入该页各弹一次；
   * - 顶部「教程」= 直接重播当前页那一段（文字教程已下线）。
   */
  const [tour, setTour] = useState<TourSegment | null>(() => {
    migrateLegacyTourSeen();
    return startTourPending() ? 'start' : null;
  });
  const closeTour = () => {
    if (tour) markSegmentSeen(tour);
    setTour(null);
  };
  const replayTour = () => {
    // 引导进行中点赞「教程」：先按已看结束当前这段，再重播当前页，避免两层浮层
    if (tour) markSegmentSeen(tour);
    setTour(segmentOfPage(navigation.page));
  };
  const startTour = () => {
    if (tour) markSegmentSeen(tour);
    setTour('start');
  };
  // 首次进入某个页签 → 自动弹该页的引导。引导自己切页时只记下位置，不叠加触发；
  // 初值取当前页，避免「刚走完引导 / 刷新页面」立刻又弹一次。
  const tourPageRef = useRef<AppPage>(navigation.page);
  useEffect(() => {
    const page = navigation.page;
    if (tourPageRef.current === page) return;
    tourPageRef.current = page;
    if (tour) return;
    const segment = segmentOfPage(page);
    if (segmentPending(segment)) setTour(segment);
  }, [navigation.page, tour]);
  /** 引导切页面：家园页内分页不在导航合同里，先写偏好再切页签 */
  const enterTourStep = useCallback(
    (step: TourStep) => {
      if (step.homeView) saveHomeView(step.homeView);
      if (step.collection) {
        navigate({ type: 'open-collection', location: step.collection });
      } else if (step.profileSection) {
        navigate({ type: 'open-profile', section: step.profileSection });
      } else if (step.page) {
        navigate({ type: 'tab', page: step.page });
      }
    },
    [navigate],
  );
  // 匿名使用统计（2026-10-06 自建埋点）：启动报一次、切页签各报一次，页面隐藏前把队列发出去
  useEffect(() => {
    track('app_open', { platform: platform() });
    return installFlushOnHide();
  }, []);
  useEffect(() => {
    // 引导自己会切好几页，别把这几次跳转算成用户行为
    if (tour) return;
    // 兼容桥阶段仍上报旧页签名（任务 9 再换新页面名，避免埋点口径提前断档）
    track('tab_view', { tab: activeTab });
    // 记住停留的页签：关后台后重开不会莫名其妙回到「导入数据」。
    // **不把四个新 page 字符串直接写进旧键**：旧版安装升级 / 降级都要能理解。
    const legacy = legacyLocation(navigation);
    saveLastTab(legacy.lastTab);
    if (legacy.lastTab === 'swap') saveSwapMainView(legacy.swapView);
  }, [navigation, activeTab, tour]);
  // 覆盖度矩阵的展开态放在这里，切页签回来不会收起
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  /**
   * 精准直达的聚焦（2026-10-24）：看板「看缺口」带着蛋组跳过来时，展开它并滚到视野中间；
   * 「看推荐种公」（view = eggs）滚到种公阵列卡（2026-11-01 R2-5-M02：这两个入口此前落点完全相同）。
   * 等数据读完后才滚；成功后消费这次 revision，用户手动离开再回来不会被旧聚焦重新改列表。
   */
  useEffect(() => {
    if (!focusPending(navigation) || navigation.page !== 'collection') return;
    const location = navigation.collection;
    if (location.kind !== 'studs') return;
    if (!loaded) return;
    const revision = navigation.focusRevision;
    const toStudMatrix = location.view === 'eggs';
    const groupId = location.view === 'coverage' ? location.groupId : undefined;
    if (!toStudMatrix && groupId == null) {
      navigate({ type: 'consume-focus', revision });
      return;
    }
    if (groupId != null) setExpandedGroupId(groupId);
    // 等这次渲染提交完再滚（顶部栏是 sticky，所以用 center 而不是 start）
    const timer = window.setTimeout(() => {
      const selector = toStudMatrix
        ? '[data-testid="stud-matrix"]'
        : `[data-testid="coverage-group-row"][data-group-id="${groupId}"]`;
      document.querySelector(selector)?.scrollIntoView({ block: 'center' });
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
              onClick={replayTour}
              data-testid="guide-open"
              data-tour="guide-open"
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
      ) : navigation.page === 'home' ? (
        <HomeLand onGoImport={() => navigate({ type: 'open-profile', section: 'data' })} />
      ) : navigation.page === 'profile' ? (
        <Profile
          section={navigation.profileSection}
          returnToGroups={navigation.returnToGroups}
          onNavigate={navigate}
          onStartTour={startTour}
        />
      ) : navigation.page === 'groups' ? (
        <CollectionGroups
          onDraftDirtyChange={setGroupsDraftDirty}
          focus={{ groupType: navigation.groupType }}
          onGoAccount={() =>
            navigate({ type: 'open-profile', section: 'identity', returnToGroups: true })
          }
        />
      ) : navigation.page === 'nearby' ? (
        <NearbyErrorBoundary>
          <Nearby onNavigate={navigate} />
        </NearbyErrorBoundary>
      ) : (
        <Collection
          location={collection}
          onNavigate={navigate}
          expandedGroupId={expandedGroupId}
          onToggleGroup={setExpandedGroupId}
        />
      )}
      {changelog.length > 0 ? <ChangelogModal entries={changelog} onClose={closeChangelog} /> : null}
      {/* 首启自动走「先导入一次」主线；其余分段在第一次进入对应页时弹，顶部「教程」重播当前页 */}
      {tour ? (
        <TourOverlay
          key={tour}
          steps={TOUR_SEGMENTS[tour]}
          onClose={closeTour}
          onEnter={enterTourStep}
          importReady={snapshots.length > 0}
        />
      ) : null}
      {leaveConfirmation}
      {/* 战斗采集悬浮球（2026-11-07 剥离）：采集进行中全局显示，命中强提醒目标时变色 */}
      <BattleHudOrb />
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
