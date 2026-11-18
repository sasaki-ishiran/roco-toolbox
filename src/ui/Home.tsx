import { useEffect, useMemo, useState } from 'react';
import { species } from '../data/catalog';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { HomeResident, HomeSnapshot, OwnedPet } from '../domain/types';
import { EmptyState } from './EmptyState';
import { HomeDemandPlacements } from './HomeDemandPlacements';
import { HomePairDiagram, buildHomePairClusters } from './HomePairDiagram';
import { PetCompactCard } from './PetCompactCard';
import { BODY, CARD, HINT, INSET, PAGE, TITLE } from './primitives/styles';
import { useSnapshots } from './useSnapshots';
import { labelerFor } from './useOwnedPets';
import { useHomeRefresh, type HomeRefreshController } from './useHomeRefresh';

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
}

function formatCapturedAt(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '时间未知';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

const GENDER_OF = (value: string | undefined): '公' | '母' | '未知' =>
  value === '公' || value === '母' ? value : '未知';

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));

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

function nestLabel(home: HomeSnapshot, furnitureGuid: string): string {
  const nest = home.nests.find((item) => item.furnitureGuid === furnitureGuid);
  if (!nest) return furnitureGuid ? `小窝 ${furnitureGuid}` : '未知位置';
  const name = nest.nestName || (nest.nestType === 'academy' ? '学院小窝' : '普通小窝');
  return nest.roomName ? `${name} · ${nest.roomName}` : name;
}

/**
 * 家园精灵卡（2026-10-29 用户口径）：直接复用紧凑精灵卡，
 * 头像 + 名称 + 性别 + 奖牌 + 蛋组 + 性格，底部一行声音 / 身高 / 体重。
 */
function HomePetCard({ pet, resident }: { pet?: OwnedPet; resident: HomeResident }) {
  const name = resident.name || pet?.name || `精灵 ${resident.instanceId}`;
  const gender = GENDER_OF(resident.gender || pet?.gender);
  const nature = resident.nature || pet?.nature || '';
  const nest = resident.nest;
  const avatarGameId = pet?.gameId ?? (Number(resident.baseId) || null);
  const entry = avatarGameId != null ? speciesByGameId.get(avatarGameId) : undefined;

  return (
    <PetCompactCard
      gameId={avatarGameId}
      name={name}
      number={entry?.number}
      gender={gender}
      nature={nature}
      medalBody={pet?.medalBody}
      voiceDb={pet?.voiceDb}
      heightPercent={pet?.heightPercent}
      weightPercent={pet?.weightPercent}
      eggGroups={entry?.eggGroups ?? []}
      isShiny={pet?.isShiny}
      isColorful={pet?.isColorful}
      academy={nest?.nestType === 'academy'}
      testId="home-pet-card"
    />
  );
}

/**
 * 「刷新家园」：起一次短采集，回来只更新家园（2026-11-01 用户拍板）。
 * 浏览器里没有采集桥；说明文案收进右侧问号帮助卡。
 */
function HomeRefreshBar({ refresh }: { refresh: HomeRefreshController }) {
  const { available, stage, message, start, finish, cancel } = refresh;
  const [helpOpen, setHelpOpen] = useState(false);
  const busy = stage === 'starting' || stage === 'saving';
  const hint = available
    ? '点开始后进游戏打开一次家园即可；只更新家园，宠物和蛋不动。'
    : '当前环境没有本机采集（只在安卓工具箱安装包内可用）。';
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
    <div className="relative flex flex-col items-end" data-testid="home-refresh">
      <div className="flex shrink-0 items-center gap-1">
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
          className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-600 disabled:text-slate-300"
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
          className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 hover:border-emerald-400 hover:text-emerald-700"
          data-testid="home-refresh-help"
        >
          ?
        </button>
      </div>
      {helpOpen ? (
        <p
          id="home-refresh-hint"
          role="note"
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-600 shadow-lg"
        >
          {hint}
        </p>
      ) : null}
      {message ? (
        <p
          className={`mt-1 text-[11px] ${stage === 'failed' ? 'text-rose-600' : 'text-emerald-700'}`}
          data-testid="home-refresh-message"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function AccountHome({ snapshot, label }: { snapshot: AccountSnapshot; label: string }) {
  const home = snapshot.home;
  // 先建索引再判空：hook 不能写在条件 return 之后
  const pets = useMemo(
    () => (home ? petsByInstance(snapshot) : new Map<string, OwnedPet>()),
    [snapshot, home],
  );
  /**
   * 家园住户 → 背包精灵：先按实例 id，找不到再按名字兜底（同名唯一时才算）。
   * 换过采集 / 短采集刷新家园后，住户的实例 id 可能不在旧背包快照里，
   * 不兜底的话性别会显示「未知」（2026-11-01 用户反馈兽花蕾 / 恶魔叮）。
   */
  const petOf = useMemo(() => {
    const byName = new Map<string, OwnedPet[]>();
    for (const pet of pets.values()) {
      const list = byName.get(pet.name) ?? [];
      list.push(pet);
      byName.set(pet.name, list);
    }
    return (resident: HomeResident): OwnedPet | undefined => {
      const exact = pets.get(resident.instanceId);
      if (exact) return exact;
      const sameName = byName.get(resident.name);
      return sameName?.length === 1 ? sameName[0] : undefined;
    };
  }, [pets]);
  if (!home) return null;
  const academy = home.nests.filter((nest) => nest.nestType === 'academy').length;
  const eggCount = home.sceneEggs.length;
  /**
   * 家园精灵按配对顺序排（2026-11-01 用户口径）：同一簇（一对 / 学院 1:2）的精灵挨在一起；
   * 1:2 那种三个人共享一只的簇整簇排到后面，保证「配对的精灵都排到一起」。
   * 没参与配对的住户保持原顺序排在最后。
   */
  const orderedResidents = (() => {
    const clusters = buildHomePairClusters(home.layEggCouples, home.residents, pets);
    const byActor = new Map(home.residents.map((resident) => [resident.actorId, resident]));
    const sorted = [...clusters].sort(
      (a, b) => Number(a.nodes.length > 2) - Number(b.nodes.length > 2),
    );
    const seen = new Set<string>();
    const list: HomeResident[] = [];
    for (const cluster of sorted) {
      for (const node of cluster.nodes) {
        const resident = byActor.get(node.actorId);
        if (!resident || seen.has(resident.instanceId)) continue;
        list.push(resident);
        seen.add(resident.instanceId);
      }
    }
    for (const resident of home.residents) {
      if (!seen.has(resident.instanceId)) list.push(resident);
    }
    return list;
  })();

  return (
    <section className="rounded-2xl bg-white p-1.5 shadow-sm" data-testid={`home-account-${snapshot.gameId}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className={TITLE}>{label} 的家园</h2>
          <p className={HINT}>
            采集时间 {formatCapturedAt(home.capturedAt)}
            {home.homeLevel ? ` · 家园 ${home.homeLevel} 级` : ''}
            {home.roomLevel ? ` · 房间 ${home.roomLevel} 级` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
            eggCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}
          data-testid="home-egg-count"
        >
          {eggCount > 0 ? `有 ${eggCount} 枚蛋` : '没有蛋'}
        </span>
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
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="home-stale">
          采集期间有精灵进出，游戏配对可能已经过期；重新采集一次家园会更准。
        </p>
      ) : null}
      {home.snapshotKind === 'delta' ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
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
            <HomePairDiagram couples={home.layEggCouples} residents={home.residents} pets={pets} />
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">家园精灵</div>
          <div className="text-[10px] text-slate-400">声音、身高与体重</div>
        </div>
        {home.residents.length === 0 ? (
          <p className={HINT}>当前家园没有精灵。</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap justify-center gap-2" data-testid="home-residents">
            {orderedResidents.map((resident) => (
              <HomePetCard
                key={resident.instanceId}
                pet={petOf(resident)}
                resident={resident}
              />
            ))}
          </div>
        )}
      </div>

      <div className={`${INSET} mt-3`}>
        <div className="text-xs font-medium text-slate-500">地上的蛋</div>
        {eggCount === 0 ? (
          <p className={HINT} data-testid="home-no-eggs">
            当前家园没有蛋。
          </p>
        ) : (
          <ul className="mt-1 space-y-1" data-testid="home-eggs">
            {home.sceneEggs.map((egg, index) => (
              <li key={`${egg.actorId}-${index}`} className={BODY}>
                第 {index + 1} 枚 · {nestLabel(home, egg.furnitureGuid)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const HOME_VIEW_KEY = 'roco.homeView';
type HomeView = 'nests' | 'demands';

const readHomeView = (): HomeView => {
  if (typeof window === 'undefined') return 'nests';
  return window.localStorage.getItem(HOME_VIEW_KEY) === 'demands' ? 'demands' : 'nests';
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
export function HomeLand({ onGoImport }: HomeLandProps = {}) {
  const { snapshots, loaded } = useSnapshots();
  const homeRefresh = useHomeRefresh();
  const labelOf = useMemo(() => labelerFor(snapshots), [snapshots]);
  const accounts = useMemo(() => snapshots.map(labelOf), [snapshots, labelOf]);
  const [view, setView] = useState<HomeView>(() => readHomeView());
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const activeAccount = accounts.includes(selectedAccount ?? '')
    ? selectedAccount
    : accounts[0] ?? null;
  const activeSnapshot = snapshots.find((snapshot) => labelOf(snapshot) === activeAccount);
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
    const target: HomeView = next === 'demands' ? 'demands' : 'nests';
    setView(target);
    setAccountPickerOpen(false);
    saveHomeView(target);
  };

  return (
    <div className={PAGE}>
      <header
        className="flex items-center justify-between gap-2"
        data-tour="home-tabs"
        data-testid="home-header"
      >
        {view === 'nests' && loaded && activeAccount ? (
          <section className="relative min-w-0 flex-1" data-testid="home-account-switcher">
            <button
              type="button"
              onClick={() => setAccountPickerOpen((open) => !open)}
              aria-expanded={accountPickerOpen}
              aria-controls={accountPickerOpen ? 'home-account-options' : undefined}
              title={activeAccount}
              className="flex min-h-[36px] w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 shadow-sm"
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
        ) : (
          <div className="min-w-0 flex-1" aria-hidden="true" />
        )}
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
      {!loaded ? (
        <p className={`${HINT}`}>正在读取本地数据…</p>
      ) : view === 'demands' ? (
        snapshots.length === 0 ? (
          <EmptyState onGoImport={onGoImport} />
        ) : (
          // 接单上窝按全部账号计算，不受家园页的当前账号选择影响。
          <HomeDemandPlacements snapshots={snapshots} labelOf={labelOf} />
        )
      ) : snapshots.length === 0 ? (
        <EmptyState onGoImport={onGoImport} />
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
        />
      )}
    </div>
  );
}
