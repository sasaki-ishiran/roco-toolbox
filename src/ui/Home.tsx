import { useEffect, useMemo, useState } from 'react';
import { species } from '../data/catalog';
import type { AccountSnapshot } from '../domain/parseBackup';
import type { HomeResident, HomeSnapshot, OwnedPet } from '../domain/types';
import { useAccountFilter } from './accountFilterStore';
import { AccountFilterBar } from './AccountFilterBar';
import { EmptyState } from './EmptyState';
import { HomeDemandPlacements } from './HomeDemandPlacements';
import { HomePairDiagram, buildHomePairClusters } from './HomePairDiagram';
import { PetCompactCard } from './PetCompactCard';
import { BODY, CARD, HINT, INSET, PAGE, TITLE } from './primitives/styles';
import { SegmentedControl } from './primitives/SegmentedControl';
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
 * 配窝卡片用「摆位图」画法（2026-11-01 用户口径，与看板配窝建议一致）：按配对关系紧凑排，
 * 学院小窝那只绿底；抓包里的窝坐标大多为空，所以不按真实坐标画。没采集过家园时，
 * 明确告诉用户采集时要进家园走一圈。
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
 * 浏览器里没有采集桥，按钮不可用并说明只能在安卓工具箱内刷。
 */
function HomeRefreshBar({ refresh }: { refresh: HomeRefreshController }) {
  const { available, stage, message, start, finish, cancel } = refresh;
  const busy = stage === 'starting' || stage === 'saving';
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
    <section className="rounded-xl bg-white px-2.5 py-2 shadow-sm" data-testid="home-refresh">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">刷新家园</p>
          <p className="mt-0.5 text-[11px] text-slate-500" data-testid="home-refresh-hint">
            {available
              ? '开始后进游戏打开一次家园，只更新家园。'
              : '当前环境没有本机采集（只在安卓工具箱安装包内可用）。'}
          </p>
        </div>
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
        </div>
      </div>
      {message ? (
        <p
          className={`mt-1 text-[11px] ${stage === 'failed' ? 'text-rose-600' : 'text-emerald-700'}`}
          data-testid="home-refresh-message"
        >
          {message}
        </p>
      ) : null}
    </section>
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
          采集期间有精灵进出，配对可能已过期。
        </p>
      ) : null}
      {home.snapshotKind === 'delta' ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          这份是增量快照，可能不含全部住户。
        </p>
      ) : null}

      <div className="mt-3" data-testid="home-pair-cards">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">配窝卡片</div>
          <div className="text-[10px] text-slate-400">按游戏实际配对</div>
        </div>
        {home.layEggCouples.length === 0 ? (
          <p className={HINT} data-testid="home-no-pairs">
            游戏数据里没有当前配对。
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

/**
 * 家园页（2026-10-30 加分页）：
 * - 家园现状：抓包里的住户、实际配对、地上的蛋；
 * - 接单上窝：需求中心里我接的单，按账号给出母本 / 种公名单。
 */
export function HomeLand({ onGoImport }: HomeLandProps = {}) {
  const { snapshots, loaded } = useSnapshots();
  const { excluded } = useAccountFilter();
  const homeRefresh = useHomeRefresh();
  const labelOf = useMemo(() => labelerFor(snapshots), [snapshots]);
  const accounts = snapshots.map(labelOf);
  const visible = snapshots.filter((snapshot) => !excluded.has(labelOf(snapshot)));
  const withHome = visible.filter((snapshot) => snapshot.home);
  const [view, setView] = useState<HomeView>(() => readHomeView());
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
    saveHomeView(target);
  };

  return (
    <div className={PAGE}>
      <div data-tour="home-tabs">
        <SegmentedControl
          label="家园视图"
          value={view}
          options={[
            { value: 'nests', label: '家园现状' },
            { value: 'demands', label: '接单上窝' },
          ]}
          onValueChange={changeView}
          optionTestId={(value) => `home-view-${value}`}
        />
      </div>
      {snapshots.length > 0 ? <AccountFilterBar accounts={accounts} /> : null}
      {loaded && view === 'nests' && snapshots.length > 0 ? (
        <HomeRefreshBar refresh={homeRefresh} />
      ) : null}
      {!loaded ? (
        <p className={`${HINT}`}>正在读取本地数据…</p>
      ) : view === 'demands' ? (
        snapshots.length === 0 ? (
          <EmptyState onGoImport={onGoImport} />
        ) : (
          // 账号筛选只影响「家园现状」；上窝按全部账号计算，保证可用产线与同组其他人一致（R2-2-U01）
          <HomeDemandPlacements snapshots={snapshots} labelOf={labelOf} />
        )
      ) : snapshots.length === 0 ? (
        <EmptyState onGoImport={onGoImport} />
      ) : visible.length === 0 ? (
        <p className={`${HINT}`}>未选择游戏账号：上面点「全选」可恢复。</p>
      ) : withHome.length === 0 ? (
        <section className={CARD} data-testid="home-no-capture">
          <h2 className={TITLE}>这份数据里没有家园记录</h2>
          <p className={`${HINT} mt-1`}>
            采集时进入家园走一圈，抓包里才会有家园数据。
          </p>
        </section>
      ) : (
        withHome.map((snapshot) => (
          <AccountHome
            key={snapshot.accountKey || snapshot.gameId}
            snapshot={snapshot}
            label={labelOf(snapshot)}
          />
        ))
      )}
    </div>
  );
}
