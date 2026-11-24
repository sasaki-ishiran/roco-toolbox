import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { OwnedPet } from '../domain/types';
import { EmptyState } from './EmptyState';
import { HomeDemandPlacements } from './HomeDemandPlacements';
import { HomePairCards } from './HomePairCards';
import { sortByAccountName } from './accountOrder';
import { CARD, HINT, PAGE, TITLE } from './primitives/styles';
import { RailAside, RailLayout } from './primitives/RailLayout';
import { useSnapshots } from './useSnapshots';
import { labelerFor } from './useOwnedPets';
import { useHomeRefresh, type HomeRefreshController } from './useHomeRefresh';
import { useLandscape } from './useWideLandscape';
import { EggStockView } from './plan/EggStockView';

/**
 * 家园页（2026-10-27）。
 *
 * 数据只来自抓包里的家园场景（不是实时查询）：
 * - 家园里有哪些精灵（住户）
 * - 游戏给出的实际配对（layEggCouples）
 * - 家园地上有没有蛋（sceneEggs）
 *
 * 配窝卡片按公母数量紧凑排布，学院小窝那只绿底；抓包里的窝坐标大多为空，
 * 所以不按真实坐标画。没采集过家园时，明确告诉用户采集时要进家园走一圈。
 */
export interface HomeLandProps {
  onGoImport?: () => void;
  /** 蛋仓要跟着小组走：没入组时给一个直接去组内广场的出口 */
  onGoGroups?: () => void;
  /** 没登录时同样给出口，不在家园页里做登录表单 */
  onGoAccount?: () => void;
}

function formatCapturedAt(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '时间未知';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

/** 背包精灵按家园实例 id 建索引：避免每个住户都把配对的 pets 扫一遍 */
function petsByInstance(snapshot: AccountSnapshot): Map<string, OwnedPet> {
  const map = new Map<string, OwnedPet>();
  for (const pet of snapshot.pets) {
    if (!pet.captureId) continue;
    const index = pet.captureId.lastIndexOf('_');
    if (index < 0) continue;
    map.set(pet.captureId.slice(index + 1), pet);
  }
  return map;
}

/**
 * 「刷新家园」：起一次短采集，回来只更新家园（2026-11-01 用户拍板）。
 * 浏览器里没有采集桥；说明文案收进右侧问号帮助卡。
 *
 * 2026-11-23：状态文案挪到页头下方的 `HomeRefreshNotice`。以前它挂在按钮列里，
 * 长句会把页头撑宽（实测 375 屏整页 496px），「刷新家园」被推到屏幕外点不回来。
 */
function HomeRefreshBar({ refresh }: { refresh: HomeRefreshController }) {
  const { available, stage, start, finish, cancel } = refresh;
  const [helpOpen, setHelpOpen] = useState(false);
  const busy = stage === 'starting' || stage === 'saving';
  const hint = available
    ? '点开始后进游戏打开一次家园即可；只更新家园，宠物和蛋不动。'
    : '当前环境没有本机采集（只在安卓版小布助手安装包内可用）。';
  const label =
    stage === 'starting'
      ? '正在开始…'
      : stage === 'saving'
        ? '正在读取…'
        : stage === 'done'
          ? '再刷一次'
          : stage === 'failed'
            ? '重试'
            : '刷新家园';
  return (
    <div className="relative flex shrink-0 items-center gap-1" data-testid="home-refresh">
      {available && stage === 'waiting' ? (
        <button
          type="button"
          onClick={finish}
          className="min-h-[28px] rounded-lg border border-emerald-500 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700"
          data-testid="home-refresh-finish"
        >
          完成刷新
        </button>
      ) : null}
      <button
        type="button"
        onClick={stage === 'waiting' ? cancel : start}
        disabled={!available || busy}
        className="min-h-[28px] shrink-0 whitespace-nowrap rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-600 disabled:text-slate-300"
        data-testid="home-refresh-start"
      >
        {stage === 'waiting' ? '取消' : label}
      </button>
      <button
        type="button"
        onClick={() => setHelpOpen((open) => !open)}
        aria-label="刷新家园说明"
        aria-expanded={helpOpen}
        aria-controls={helpOpen ? 'home-refresh-hint' : undefined}
        title={hint}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 hover:border-emerald-400 hover:text-emerald-700"
        data-testid="home-refresh-help"
      >
        ?
      </button>
      {helpOpen ? (
        <p
          id="home-refresh-hint"
          role="note"
          className="absolute right-0 top-full z-30 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-600 shadow-lg"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 刷新状态提示（2026-11-23 用户报障后改）：单独一行放在页头下面，整行换行、不吃页头宽度。
 * 以前挤在页头按钮列里，长句把整页撑到 496px（375 屏），刷新按钮被推出屏幕且回不来；
 * 现在页头永远只有一行按钮，提示出现 / 关掉都不动页头，点 × 立刻复原。
 */
function HomeRefreshNotice({ refresh }: { refresh: HomeRefreshController }) {
  const { stage, message, dismiss } = refresh;
  if (!message) return null;
  const failed = stage === 'failed';
  return (
    <div
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      className={`flex w-full max-w-full items-start gap-2 rounded-lg px-3 py-2 text-xs ${
        failed ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
      }`}
      data-testid="home-refresh-message"
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="关闭提示"
        className="shrink-0 rounded px-1 text-slate-400 hover:text-slate-600"
      >
        ×
      </button>
    </div>
  );
}


/**
 * 家园配窝卡单列 / 双列（2026-11-22 用户口径）：由横屏高度自动决定，不再手动切换。
 * 手机横屏高度只有 360~540，排两列少滚动；16:9 / 16:10 / 4:3 / 3:2 这类高度够的屏保持单列。
 * 断点写在 src/index.css 的 `home-pair-card-list` 规则里，随视口旋转 / 改尺寸立即生效。
 */
function AccountHome({
  snapshot,
  label,
  actions,
}: {
  snapshot: AccountSnapshot;
  label: string;
  /** 横屏把「刷新家园 + ?」放到标题行右侧（页头让给右侧标题栏，2026-11-24 用户口径） */
  actions?: ReactNode;
}) {
  const home = snapshot.home;
  // 先建索引再判空：hook 不能写在条件 return 之后
  const pets = useMemo(
    () => (home ? petsByInstance(snapshot) : new Map<string, OwnedPet>()),
    [snapshot, home],
  );
  if (!home) return null;
  const academy = home.nests.filter((nest) => nest.nestType === 'academy').length;
  const eggCount = home.sceneEggs.length;
  return (
    <section className="rounded-2xl bg-white p-1.5 shadow-sm" data-testid={`home-account-${snapshot.gameId}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className={TITLE}>{label} 的家园</h2>
          <p className={`${HINT} flex flex-wrap items-center gap-x-2 gap-y-0.5`}>
            <span data-testid="home-captured-at">
              采集时间 {formatCapturedAt(home.capturedAt)}
            </span>
            {home.homeLevel ? <span>· 家园 {home.homeLevel} 级</span> : null}
            {home.roomLevel ? <span>· 房间 {home.roomLevel} 级</span> : null}
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                eggCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
              }`}
              data-testid="home-egg-count"
            >
              {eggCount > 0 ? `有 ${eggCount} 枚蛋` : '没有蛋'}
            </span>
          </p>
        </div>
        {actions}
      </div>

      {/* 2026-11-01 用户口径：三个数字方框太大 → 改成一行小标签 */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="home-stats">
        <span className="rounded-md bg-slate-50 px-1.5 py-[3px] text-[11px] leading-none text-slate-500">
          <span className="mr-0.5 text-[13px] font-semibold text-slate-800">
            {home.residents.length}
          </span>
          <span>家园精灵</span>
        </span>
        <span className="rounded-md bg-slate-50 px-1.5 py-[3px] text-[11px] leading-none text-slate-500">
          <span className="mr-0.5 text-[13px] font-semibold text-slate-800">{home.nests.length}</span>
          <span>小窝（学院 {academy}）</span>
        </span>
        <span className="rounded-md bg-slate-50 px-1.5 py-[3px] text-[11px] leading-none text-slate-500">
          <span className="mr-0.5 text-[13px] font-semibold text-slate-800">
            {home.layEggCouples.length}
          </span>
          <span>实际配对</span>
        </span>
      </div>

      {home.couplesStale ? (
        <p className="mt-2 w-fit max-w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="home-stale">
          采集期间有精灵进出，游戏配对可能已经过期；重新采集一次家园会更准。
        </p>
      ) : null}
      {home.snapshotKind === 'delta' ? (
        <p className="mt-2 w-fit max-w-full rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="home-delta-note">
          这份是增量快照，可能不包含全部住户；建议重新采集一次完整的家园场景。
        </p>
      ) : null}

      <div className="mt-3" data-testid="home-pair-cards">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">配窝卡片</div>
          <div className="text-[10px] text-slate-400">按游戏实际配对</div>
        </div>
        {home.layEggCouples.length === 0 ? (
          <p className={HINT} data-testid="home-no-pairs">
            游戏数据里没有当前配对（可能没有可配对的精灵，或采集时家园还没加载完）。
          </p>
        ) : (
          <div className="mt-1.5">
            <HomePairCards couples={home.layEggCouples} residents={home.residents} pets={pets} />
          </div>
        )}
      </div>

    </section>
  );
}

const HOME_VIEW_KEY = 'roco.homeView';
type HomeView = 'nests' | 'demands' | 'stock';

const readHomeView = (): HomeView => {
  if (typeof window === 'undefined') return 'nests';
  try {
    const saved = window.localStorage.getItem(HOME_VIEW_KEY);
    return saved === 'demands' || saved === 'stock' ? saved : 'nests';
  } catch {
    return 'nests';
  }
};

/** 已挂载的家园页：外部改了分页要立刻跟着切，不能等重新挂载（新手引导用）。 */
const homeViewListeners = new Set<(view: HomeView) => void>();

/** 新手引导要直接把家园切到某一页（导航合同不管页内分页）。 */
export function saveHomeView(view: HomeView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_VIEW_KEY, view);
  } catch {
    // 隐私模式 / 配额满：本次切换照样生效，只是下次打开不记住（同 lastTab.ts）
  }
  for (const listener of homeViewListeners) listener(view);
}

/** 家园现状默认展示首个账号；接单上窝可从页头切换。 */
export function HomeLand({ onGoImport, onGoGroups, onGoAccount }: HomeLandProps = {}) {
  const { snapshots, loaded } = useSnapshots();
  const homeRefresh = useHomeRefresh();
  const labelOf = useMemo(() => labelerFor(snapshots), [snapshots]);
  /** 账号切换器按数字排序（2026-11-20 用户口径）：默认第一个也是排最前的号。 */
  const orderedSnapshots = useMemo(
    () => sortByAccountName(snapshots, (snapshot) => labelOf(snapshot)),
    [snapshots, labelOf],
  );
  const accounts = useMemo(() => orderedSnapshots.map(labelOf), [orderedSnapshots, labelOf]);
  const [view, setView] = useState<HomeView>(() => readHomeView());
  /** 蛋仓屏把自己的角色筛选 portal 到标题行里（只有它知道这个账号下有哪些游戏角色）。 */
  const [eggStockHeaderSlot, setEggStockHeaderSlot] = useState<HTMLElement | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const activeAccount = accounts.includes(selectedAccount ?? '')
    ? selectedAccount
    : accounts[0] ?? null;
  const activeSnapshot = orderedSnapshots.find((snapshot) => labelOf(snapshot) === activeAccount);
  useEffect(() => {
    if (selectedAccount !== activeAccount) setSelectedAccount(activeAccount);
  }, [activeAccount, selectedAccount]);
  // 新手引导等外部调用 saveHomeView 时，已挂载的家园页要立刻跟着切分页
  useEffect(() => {
    homeViewListeners.add(setView);
    return () => {
      homeViewListeners.delete(setView);
    };
  }, []);

  const changeView = (next: string) => {
    // 2026-11-22：蛋仓也走页内分页（用户不要悬浮窗）
    const target: HomeView = next === 'demands' || next === 'stock' ? next : 'nests';
    setView(target);
    setAccountPickerOpen(false);
    saveHomeView(target);
  };

  /**
   * 横屏家园屏（2026-11-24 用户口径）：账号 / 接单上窝 / 蛋仓挪进右侧纵向标题栏，
   * 顶栏整行让给内容；「刷新家园」留在家园页的标题行里。
   * 蛋仓、接单上窝仍是页内一屏，不改成弹层。
   */
  const landscape = useLandscape();
  const rail = landscape && view === 'nests';

  const refreshBar = loaded && snapshots.length > 0 ? <HomeRefreshBar refresh={homeRefresh} /> : null;

  const accountOptions = accountPickerOpen ? (
    <div
      id="home-account-options"
      role="group"
      aria-label="切换家园账号"
      className="home-rail-account-options"
      data-testid="home-account-options"
    >
      {accounts.map((account) => {
        const selected = account === activeAccount;
        return (
          <button
            key={account}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              setSelectedAccount(account);
              setAccountPickerOpen(false);
            }}
            title={account}
            className={`min-h-[32px] min-w-0 truncate rounded-lg border px-2 text-left text-xs ${
              selected
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
            data-testid={`home-account-option-${account}`}
          >
            {account}
          </button>
        );
      })}
    </div>
  ) : null;

  const railAside = (
    <RailAside title="家园" hideTitle tour="home-tabs" testIds={{ aside: 'home-rail' }}>
      <div className="relative" data-testid="home-account-switcher">
        <button
          type="button"
          onClick={() => setAccountPickerOpen((open) => !open)}
          aria-expanded={accountPickerOpen}
          aria-controls={accountPickerOpen ? 'home-account-options' : undefined}
          title={activeAccount ?? undefined}
          className="rail-nav-item home-rail-account"
          data-testid="home-account-summary"
        >
          {activeAccount}
        </button>
        {accountOptions}
      </div>
      <button
        type="button"
        onClick={() => changeView('demands')}
        className="rail-nav-item"
        data-testid="home-rail-demands"
      >
        接单上窝
      </button>
      <button
        type="button"
        onClick={() => changeView('stock')}
        className="rail-nav-item"
        data-testid="home-rail-stock"
      >
        蛋仓
      </button>
    </RailAside>
  );

  const content = !loaded ? (
    <p className={`${HINT}`}>正在读取本地数据…</p>
  ) : view === 'demands' ? (
    snapshots.length === 0 ? (
      <div className="home-empty-center">
        <EmptyState onGoImport={onGoImport} />
      </div>
    ) : (
      // 接单上窝按全部账号计算，不受家园页的当前账号选择影响。
      <HomeDemandPlacements snapshots={snapshots} labelOf={labelOf} />
    )
  ) : view === 'stock' ? (
    // 蛋仓跟着小组走，和有没有家园数据无关，所以排在家园判空前面。
    <EggStockView
      snapshots={snapshots}
      onGoGroups={onGoGroups}
      onGoAccount={onGoAccount}
      onBack={() => changeView('nests')}
      headerSlot={eggStockHeaderSlot}
    />
  ) : snapshots.length === 0 ? (
    <div className="home-empty-center">
      <EmptyState onGoImport={onGoImport} />
    </div>
  ) : !activeSnapshot?.home ? (
    <section className={CARD} data-testid="home-no-capture">
      <h2 className={TITLE}>这份数据里没有家园记录</h2>
      <p className={`${HINT} mt-1`}>
        家园数据来自抓包里的家园场景。采集时要进入家园走一圈（最好切一次楼层、打开一次小窝），
        再退出并结束采集；否则抓包里没有家园。
      </p>
    </section>
  ) : (
    <AccountHome
      key={activeSnapshot.accountKey || activeSnapshot.gameId}
      snapshot={activeSnapshot}
      label={labelOf(activeSnapshot)}
      actions={rail ? refreshBar : undefined}
    />
  );

  return (
    <div className={PAGE} data-testid="home-page" data-view={view}>
      {rail ? (
        <RailLayout collapsed={false} aside={railAside} testIds={{ main: 'home-rail-main' }}>
          <HomeRefreshNotice refresh={homeRefresh} />
          {content}
        </RailLayout>
      ) : (
        <>
          <header
            className="flex items-center gap-2"
            data-tour="home-tabs"
            data-testid="home-header"
            data-view={view}
          >
        {/*
         * 账号胶囊两种屏宽各管一段（2026-11-22 合并 eavon/pr6 时核对过）：
         * - 竖屏：flex-1 + min-w-0，宽度让出来、名字自己截断 —— 修「一滑整窗横向走、
         *   问号被挤出屏幕」（线上实测 scrollWidth 391 / 视口 375，见 b4c0a7d）。
         * - 横屏：index.css 里 `header[data-testid="home-header"] > section` 改成
         *   `flex: 0 0 auto`，胶囊宽度跟着账号名走，不再固定 18rem（用户 2026-11-22 口径）。
         * 上限 60% 兜底，长名字最多占六成，右边的蛋仓/接单/刷新不被挤出去。
         */}
        {view === 'nests' && loaded && activeAccount ? (
          <section
            className="relative min-w-0 max-w-[60%] flex-1"
            data-testid="home-account-switcher"
          >
            <button
              type="button"
              onClick={() => setAccountPickerOpen((open) => !open)}
              aria-expanded={accountPickerOpen}
              aria-controls={accountPickerOpen ? 'home-account-options' : undefined}
              title={activeAccount}
              className="flex min-h-[36px] w-auto max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 shadow-sm"
              data-testid="home-account-summary"
            >
              <span className="truncate">{activeAccount}</span>
              <span aria-hidden className="shrink-0 text-xs text-slate-400">
                {accountPickerOpen ? '⌃' : '⌄'}
              </span>
            </button>
            {accountPickerOpen ? (
              <div
                id="home-account-options"
                role="group"
                aria-label="切换家园账号"
                className="absolute left-0 top-full z-20 mt-1 grid w-[calc(100vw-2rem)] max-w-[24rem] grid-cols-2 gap-1 rounded-xl border border-slate-100 bg-white p-2 shadow-lg"
                data-testid="home-account-options"
              >
                {accounts.map((account) => {
                  const selected = account === activeAccount;
                  return (
                    <button
                      key={account}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedAccount(account);
                        setAccountPickerOpen(false);
                      }}
                      title={account}
                      className={`min-h-[32px] min-w-0 truncate rounded-lg border px-2 text-left text-xs ${
                        selected
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                      data-testid={`home-account-option-${account}`}
                    >
                      {account}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : view === 'demands' ? (
          <h1 className={`${TITLE} min-w-0 flex-1`} data-testid="home-title">
            接单上窝
          </h1>
        ) : view === 'stock' ? (
          // 横屏：标题让给蛋仓右侧栏的标题栏（index.css 的 .home-stock-title 规则），竖屏照旧
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h1 className={`${TITLE} home-stock-title min-w-0 shrink-0`} data-testid="home-title">
              我的蛋仓
            </h1>
            {/* 角色筛选挂在标题后面（2026-11-23 用户口径）；选择器本体由蛋仓屏挂进来 */}
            <span
              ref={setEggStockHeaderSlot}
              className="flex min-w-0 items-center"
              data-testid="home-stock-character-slot"
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden="true" />
        )}
        {view === 'nests' && loaded ? (
          <button
            type="button"
            onClick={() => changeView('stock')}
            className="min-h-[28px] shrink-0 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-600"
            data-testid="home-egg-stock"
          >
            蛋仓
          </button>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          {view === 'nests' ? (
            <button
              type="button"
              onClick={() => changeView('demands')}
              className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-600"
              data-testid="home-view-demands"
            >
              接单上窝
            </button>
          ) : (
            <button
              type="button"
              onClick={() => changeView('nests')}
              className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-600"
              data-testid="home-view-nests"
            >
              返回家园
            </button>
          )}
          {loaded && view === 'nests' && snapshots.length > 0 ? (
            <HomeRefreshBar refresh={homeRefresh} />
          ) : null}
        </div>
      </header>
          {/* 刷新状态放在页头下面单独一行（2026-11-23）：页头只留按钮，宽度不再被文案撑开 */}
          {view === 'nests' ? <HomeRefreshNotice refresh={homeRefresh} /> : null}
          {content}
        </>
      )}
    </div>
  );
}
