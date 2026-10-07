import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { installFlushOnHide, platform, track } from './api/analytics';
import type { PetView } from './domain/petFilters';
import { CHANGELOG, markChangelogSeen, pendingChangelog, readChangelogSeen } from './data/changelog';
import { ChangelogModal } from './ui/ChangelogModal';
import { GuideModal } from './ui/GuideModal';
import { guidePending, markGuideSeen } from './ui/guide';
import { hasPendingNativeShare } from './share/nativeShare';
import { Coverage } from './ui/Coverage';
import { Dashboard } from './ui/Dashboard';
import { ImportPanel } from './ui/ImportPanel';
import { MyPets } from './ui/MyPets';
import { Swap } from './ui/Swap';
import { TabNav, type TabId } from './ui/TabNav';
import { useSnapshots } from './ui/useSnapshots';

export default function App() {
  const [tab, setTab] = useState<TabId>('import');
  const { snapshots, loaded } = useSnapshots();
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
      setTab('import');
    };
    window.addEventListener('roco-share', onShare);
    return () => window.removeEventListener('roco-share', onShare);
  }, []);
  // 有数据时默认落看板：首帧仍停在「导入数据」，读到数据后只在「还没被用户手动切走过、
  //  且仍停在导入页」时跳一次到看板，之后用户自由切换（回到导入数据页管理数据不再被打扰）
  const autoRedirected = useRef(false);
  useEffect(() => {
    if (
      loaded &&
      !autoRedirected.current &&
      !shareSeen &&
      snapshots.length > 0 &&
      tab === 'import'
    ) {
      autoRedirected.current = true;
      setTab('dashboard');
    }
  }, [loaded, snapshots, tab, shareSeen]);
  /** 分享数据导入成功后标记「待跳看板」；等快照真的更新了再跳（保证看板已能看到新数据） */
  const handleShareImported = () => {
    shareRedirect.current = true;
  };
  useEffect(() => {
    if (!shareRedirect.current || snapshots.length === 0) return;
    shareRedirect.current = false;
    setTab('dashboard');
  }, [snapshots]);
  // 切页签（含看板卡片跳转）时回到页面顶部：否则新页面会沿用上一页的滚动偏移，
  // 跳转落点不准（2026-10-05 修）。用 useLayoutEffect 在浏览器绘制前复位，避免闪现旧位置。
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [tab]);
  // 更新内容弹窗：启动时算一次「本机没看过的更新」，点「知道了」后记住已读（2026-10-05 起固定做法）
  const [changelog, setChangelog] = useState(() => pendingChangelog(readChangelogSeen()));
  const closeChangelog = () => {
    if (CHANGELOG[0]) markChangelogSeen(CHANGELOG[0].id);
    setChangelog([]);
  };
  // 使用教程：首启自动弹一次（见 guide.ts 的版本号机制），顶部「教程」按钮随时回看
  const [guide, setGuide] = useState(() => guidePending());
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
    track('tab_view', { tab });
  }, [tab]);
  // 覆盖度矩阵的展开态放在这里，切页签回来不会收起
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  /**
   * 从看板「去看怎么迭代」跳过来时要聚焦的蛋组：展开它、并滚到视野中间
   * （页面挺长，不滚过去用户还得自己找那行）。每次跳转都塞一个新对象 → 效应会重跑。
   */
  const [coverageFocus, setCoverageFocus] = useState<{ groupId: number } | null>(null);
  useEffect(() => {
    if (!coverageFocus) return;
    // 等这次渲染提交完再滚（顶部栏是 sticky，所以用 center 而不是 start）
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-testid="coverage-group-row"][data-group-id="${coverageFocus.groupId}"]`)
        ?.scrollIntoView({ block: 'center' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [coverageFocus]);
  // 「我的精灵」的视角也放这里：看板的「种公全收集」卡可以带着种公视角跳过去
  const [myPetsView, setMyPetsView] = useState<PetView>('all');
  return (
    <>
      {/* 顶部标签常显：滚动页面时 header + 页签固定在视口顶部（2026-10-04 优化） */}
      <div className="sticky top-0 z-50 bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3">
          <h1 className="text-lg font-semibold text-slate-900">洛克工具箱</h1>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setGuide(true)}
              data-testid="guide-open"
              className="min-h-[28px] rounded-full border border-slate-200 px-2.5 text-[11px] text-slate-500"
            >
              教程
            </button>
            <span className="text-[10px] text-slate-300" data-testid="app-version">
              版本 {__APP_BUILD__}
            </span>
          </div>
        </header>
        <TabNav active={tab} onChange={setTab} />
      </div>
      {/* 2026-10-06 修复（M3）：不要在渲染体里用「每次渲染都是新引用」的内联箭头组件
          拼 Record<TabId, ComponentType>——App 任何 state 变化（比如开关更新弹窗）都会
          让 React 认为页面组件类型变了，把整个页面卸载重挂，页内状态全部丢失。
          改成条件渲染：组件引用稳定，只有切页签才挂/卸。 */}
      {tab === 'dashboard' ? (
        <Dashboard
          onOpenStuds={() => {
            setMyPetsView('stud');
            setTab('myPets');
          }}
          onOpenMothers={() => {
            setMyPetsView('mother');
            setTab('myPets');
          }}
          onOpenSwap={() => setTab('swap')}
          onOpenCoverage={(groupId) => {
            setTab('coverage');
            if (groupId == null) return;
            // 第一个「可迭代」的蛋组：跳过去直接展开并滚到它，省得用户在 14 行里找
            setExpandedGroupId(groupId);
            setCoverageFocus({ groupId });
          }}
        />
      ) : tab === 'myPets' ? (
        <MyPets
          view={myPetsView}
          onViewChange={setMyPetsView}
          onGoImport={() => setTab('import')}
        />
      ) : tab === 'import' ? (
        <ImportPanel onShareImported={handleShareImported} />
      ) : tab === 'coverage' ? (
        <Coverage
          expandedGroupId={expandedGroupId}
          onToggleGroup={setExpandedGroupId}
          onGoImport={() => setTab('import')}
        />
      ) : (
        <Swap onGoImport={() => setTab('import')} />
      )}
      {changelog.length > 0 ? <ChangelogModal entries={changelog} onClose={closeChangelog} /> : null}
      {/* 教程与更新弹窗不同时弹：先看完更新内容再引导 */}
      {changelog.length === 0 && guide ? <GuideModal onClose={closeGuide} /> : null}
    </>
  );
}
