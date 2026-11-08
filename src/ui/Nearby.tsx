import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveNearbyPet } from '../collector/captureProgress';
import { hideNearbyOverlay, isDesktopOverlaySupported, pushNearbyOverlay, readDesktopOverlayState, setDesktopOverlayClickThrough, showNearbyOverlay } from '../collector/desktopOverlay';
import { requestAutoImport, useAutoImport } from '../collector/autoImportFlow';
import { markCaptureOrigin } from '../collector/captureOriginStore';
import { nearbyAlertGate } from '../collector/nearbyAlert';
import { canDrawOverlay, collectorAction, notifyRareAlert, requestOverlayPermission, startCollectorCapture } from '../collector/nativeCollector';
import { readNearbyRetained, writeNearbyRetained } from '../collector/nearbyRetainStore';
import { readNearbySnapshot } from '../collector/nearbyStore';
import { useRareAlert } from '../collector/rareAlertStore';
import { useNearbyFeed } from '../collector/useNearbyFeed';
import { buildNearbyOverlayPayload } from '../nearby/overlayPayload';
import { hasNearbyOverlayShell, pushNearbyOverlayToShell } from '../nearby/overlayBridge';
import { isLastEnabledNearbyOverlayPanel, setNearbyOverlayPanel, useNearbyOverlayPanels } from '../nearby/overlayPanels';
import { species, eggGroupNames } from '../data/catalog';
import { demandHitsForPet, demandSpeciesIndex, type DemandHit } from '../pcap/demandMatch';
import { buildRadar, DEFAULT_RADAR_RADIUS_M, type RadarData } from '../pcap/nearbyRadar';
import { worldMapForScene } from '../pcap/worldMap';
import { createSelfEstimate, updateSelfEstimate } from '../pcap/selfOdometry';
import { pruneRetained, isHighValuePet, type RetainedEntry } from '../pcap/nearbyRetain';
import { KIND_LABELS, rareAlertTitle } from '../pcap/rareRules';
import type { NavigationIntent } from './navigation';
import { NearbyBattleCard } from './NearbyBattleCard';
import { NearbyMap } from './NearbyMap';
import { NearbyRadar } from './NearbyRadar';
import { ModalSurface } from './primitives/ModalSurface';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';
import { useDemandCenter } from './useDemandCenter';

type NearbyFilter = 'all' | 'rare' | 'demand';
type NearbyView = 'map' | 'list';

export interface NearbyProps {
  onNavigate: (intent: NavigationIntent) => void;
}

const DEMAND_INDEX = demandSpeciesIndex(species);

/** 需求中心条目在 UI 上的一句话说明：蛋 / 蛋组 + 已选条件 + 待确认项。 */
export function demandHitLabel(hit: DemandHit): string {
  const demand = hit.demand;
  const target = demand.eggGameId > 0
    ? DEMAND_INDEX.byGameId.get(demand.eggGameId)?.name ?? `蛋 #${demand.eggGameId}`
    : `蛋组 ${eggGroupNames[-demand.eggGameId] ?? `#${-demand.eggGameId}`}`;
  const criteria = [
    demand.nature || '不挑性格',
    demand.gender || '不限性别',
    demand.body || '不限体型',
    demand.voice || '不限声音',
  ].join(' / ');
  return `${target} · ${criteria}${hit.unverified.length ? `（${hit.unverified.join('、')}需确认）` : ''}`;
}

/** 常驻列表排序：仍在视野内 → 命中需求 → 可提醒 → 稀有牌子多 → 距离近。 */
function sortRows(rows: readonly RetainedEntry[], radar: RadarData): RetainedEntry[] {
  const distanceOf = new Map(radar.points.map((point) => [point.key, point.distanceM]));
  return [...rows].sort((left, right) => {
    const present = Number(right.present) - Number(left.present);
    if (present !== 0) return present;
    const demand = Number(right.demandHits.length > 0) - Number(left.demandHits.length > 0);
    if (demand !== 0) return demand;
    const alert = Number(Boolean(right.pet.alertReason)) - Number(Boolean(left.pet.alertReason));
    if (alert !== 0) return alert;
    if (left.pet.kinds.length !== right.pet.kinds.length) return right.pet.kinds.length - left.pet.kinds.length;
    const a = distanceOf.get(left.key) ?? Number.POSITIVE_INFINITY;
    const b = distanceOf.get(right.key) ?? Number.POSITIVE_INFINITY;
    if (a !== b) return a - b;
    return left.key.localeCompare(right.key);
  });
}

const MUTATION_KINDS = new Set(['colorful', 'shiny', 'pollution']);

/** 全屏列表的价值分：需求命中 > 可提醒 > 炫彩/异色/污染 > 其它牌子 > 仍在视野。 */
export function valueScoreOf(row: RetainedEntry): number {
  let score = 0;
  if (row.demandHits.length > 0) score += 100;
  if (row.pet.alertReason) score += 50;
  for (const kind of row.pet.kinds) score += MUTATION_KINDS.has(kind) ? 20 : 5;
  if (row.present) score += 3;
  if (row.pet.rare) score += 2;
  return score;
}

/** 全屏列表不做筛选，纯按价值从高到低；同分按距离近、key 稳定排序。 */
function sortRowsByValue(rows: readonly RetainedEntry[], radar: RadarData): RetainedEntry[] {
  const distanceOf = new Map(radar.points.map((point) => [point.key, point.distanceM]));
  return [...rows].sort((left, right) => {
    const score = valueScoreOf(right) - valueScoreOf(left);
    if (score !== 0) return score;
    const a = distanceOf.get(left.key) ?? Number.POSITIVE_INFINITY;
    const b = distanceOf.get(right.key) ?? Number.POSITIVE_INFINITY;
    if (a !== b) return a - b;
    return left.key.localeCompare(right.key);
  });
}

const timeText = (value: number) =>
  new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** 附近精灵行：页面列表与全屏列表共用，避免两套渲染漂移。 */
function NearbyRowItem({
  row,
  point,
  dark = false,
}: {
  row: RetainedEntry;
  point: { distanceM: number; bearingLabel: string } | undefined;
  dark?: boolean;
}) {
  const demandLabel = row.demandHits[0] ? demandHitLabel(row.demandHits[0]) : '';
  return (
    <div
      data-testid="nearby-row"
      className={`rounded-xl px-3 py-2 ${dark ? 'bg-slate-900 text-slate-100' : 'bg-white shadow-sm'} ${
        row.demandHits.length > 0 ? 'ring-1 ring-amber-300'
          : row.pet.alertReason ? 'ring-1 ring-rose-200' : ''
      } ${row.present ? '' : 'opacity-70'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm ${row.pet.rare ? `font-semibold ${dark ? 'text-white' : 'text-slate-800'}` : dark ? 'text-slate-200' : 'text-slate-700'}`}>
          {row.pet.name} <span className="text-xs text-slate-400">Lv{row.pet.level}</span>
        </span>
        <span className="shrink-0 text-xs text-slate-400">
          {point ? `${point.distanceM.toFixed(1)}m ${point.bearingLabel}` : '—'}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
        {!row.present ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">已离开视野</span> : null}
        {row.demandHits.length > 0 ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">需求中心</span>
        ) : null}
        {row.pet.nature ? (
          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">{`性格 ${row.pet.nature}`}</span>
        ) : null}
        {row.pet.gender ? (
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{row.pet.gender}</span>
        ) : null}
        {row.pet.kinds.map((kind) => (
          <span key={kind} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
            {KIND_LABELS[kind as keyof typeof KIND_LABELS] || kind}
          </span>
        ))}
        {row.pet.voiceDb ? (
          <span className="text-slate-400">{row.pet.voiceDb > 0 ? '+' : ''}{row.pet.voiceDb}dB</span>
        ) : null}
        {row.pet.alertReason ? <span className="text-rose-500">可提醒 · {row.pet.alertReason}</span> : null}
      </div>
      {demandLabel ? <p className="mt-1 text-[11px] text-amber-600">{`需求：${demandLabel} · 可叫发需求的人来抓`}</p> : null}
    </div>
  );
}

/**
 * 附近页（2026-11-06）：雷达 / 列表两种视图，共用筛选。
 *
 * - 雷达画「当前还在视野内」的精灵；列表是常驻列表，高价值（稀有 / 命中需求中心）
 *   离开视野后仍保留 10 分钟，普通精灵离开即清理。
 * - 命中需求中心时走系统通知 + 页内强提示；性格 / 性别野生实体读不到，标记「需确认」。
 * - 雷达中心是附近精灵坐标的几何中位数（真实抓包里没有自身坐标帧），只作估算。
 */
export function Nearby({ onNavigate }: NearbyProps) {
  const { state, snapshot, error, refresh, progress, checked } = useNearbyFeed();
  const flow = useAutoImport();
  const { items: demands } = useDemandCenter();
  const rareAlertOn = useRareAlert();
  /** 手机悬浮球展开后显示哪些面板（本机记忆，只影响安卓壳，不重排本页） */
  const overlayPanels = useNearbyOverlayPanels();
  const shellOverlaySupported = hasNearbyOverlayShell();
  const [view, setView] = useState<NearbyView>('map');
  const [filter, setFilter] = useState<NearbyFilter>('all');
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenView, setFullscreenView] = useState<NearbyView>('map');
  const [rows, setRows] = useState<RetainedEntry[]>(() => readNearbyRetained());
  /** 本页采集开关的操作中标志与行内错误（开始 / 停止失败时提示） */
  const [captureToggling, setCaptureToggling] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  /** 开始采集前发现没悬浮窗权限：先问一次，避免进游戏才发现没有球（2026-11-08） */
  const [overlayPrompt, setOverlayPrompt] = useState(false);
  const overlayPendingStart = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const sessionRef = useRef<string | null>(null);
  // 估算自身位置：用精灵帧间位移做里程计，否则走动时点位看起来不动（2026-11-06）
  const selfRef = useRef(createSelfEstimate());
  const [self, setSelf] = useState<{ x: number; y: number } | null>(null);
  const [alert, setAlert] = useState<{ title: string; lines: string[] } | null>(null);

  const hitByKey = useMemo(() => {
    const map = new Map<string, DemandHit[]>();
    for (const pet of snapshot?.pets ?? []) {
      map.set(pet.key, demandHitsForPet(pet, demands, DEMAND_INDEX));
    }
    return map;
  }, [snapshot, demands]);

  const classify = useMemo(
    () => (pet: LiveNearbyPet) => {
      const hits = demandHitsForPet(pet, demands, DEMAND_INDEX);
      return { highValue: isHighValuePet(pet, hits), demandHits: hits };
    },
    [demands],
  );

  // 每次快照到达就更新估算自身位置（精灵整体移动 = 玩家反向移动）
  useEffect(() => {
    if (!snapshot) return;
    const next = updateSelfEstimate(selfRef.current, snapshot.session, snapshot.pets, snapshot.updatedAt);
    selfRef.current = next;
    setSelf(next.self);
  }, [snapshot]);

  // 每次快照到达就刷新常驻列表；离开视野的高价值条目由 pruneRetained 按 10 分钟 TTL 清理。
  // 换采集会话时先清空上一局的常驻列表与共享去重表，避免旧精灵压住新一局。
  useEffect(() => {
    if (!snapshot) return;
    let base = rowsRef.current;
    if (sessionRef.current !== snapshot.session) {
      sessionRef.current = snapshot.session;
      nearbyAlertGate.reset();
      base = [];
    }
    const next = pruneRetained(
      base,
      snapshot.pets.filter((pet) => classify(pet).highValue),
      Date.now(),
      classify,
    );
    rowsRef.current = next;
    writeNearbyRetained(next);
    setRows(next);
  }, [snapshot, classify]);

  // 没有新快照时也要定期清理到期的「已离开」记录
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = readNearbyRetained();
      const snap = readNearbySnapshot();
      if (!snap || current.length === 0) return;
      const next = pruneRetained(current, snap.pets, Date.now(), classify);
      rowsRef.current = next;
      writeNearbyRetained(next);
      setRows(next);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [classify]);

  // 强提示：稀有（±100dB / 体重牌+声音牌）或命中需求中心；同一只只响一次
  useEffect(() => {
    if (!rareAlertOn || !snapshot) return;
    const hitOf = (pet: LiveNearbyPet) => hitByKey.get(pet.key) ?? [];
    const fresh = nearbyAlertGate.scan(
      snapshot.pets,
      (pet) => pet.key,
      (pet) => Boolean(pet.alertReason) || hitOf(pet).length > 0,
    );
    if (fresh.length === 0) return;
    const demandLines = fresh.flatMap((pet) =>
      hitOf(pet).slice(0, 1).map((hit) => {
        const caller = hit.groupName ? `可叫「${hit.groupName}」发需求的人来抓` : '可叫发需求的人来抓';
        return `${pet.name} Lv${pet.level}${pet.nature ? ` · 性格 ${pet.nature}` : ''}${pet.gender ? ` · ${pet.gender}` : ''} · 需求：${demandHitLabel(hit)} · ${caller}`;
      }));
    const rareLines = fresh
      .filter((pet) => pet.alertReason)
      .map((pet) => `${pet.name} Lv${pet.level} · ${pet.alertReason}`);
    const lines = [...demandLines, ...rareLines].slice(0, 3);
    if (fresh.length > 3) lines.push(`…另有 ${fresh.length - 3} 只`);
    const title = demandLines.length > 0
      ? (demandLines.length === 1 ? '需求中心精灵出现！' : `需求中心精灵 ×${demandLines.length}`)
      : rareAlertTitle(rareLines.length);
    setAlert({ title, lines });
    void notifyRareAlert(title, lines.join('\n')).catch(() => {});
  }, [snapshot, hitByKey, rareAlertOn]);

  const pets = snapshot?.pets ?? [];
  // 最近一次赛季奇遇战（龙棋士 → 蛋包蛋），战斗中已带真实性格
  const encounter = snapshot?.encounter ?? null;
  // 自身坐标优先用解码器解析出的上行 307；拿不到时退回里程计估算
  const captureSelf = snapshot?.self ?? null;
  const radar = useMemo(
    () => buildRadar(pets, {
      origin: captureSelf ?? self,
      radiusM: DEFAULT_RADAR_RADIUS_M,
      trustOrigin: Boolean(captureSelf),
    }),
    [pets, self, captureSelf],
  );
  const rareCount = pets.filter((pet) => pet.rare).length;
  const demandCount = [...hitByKey.values()].filter((hits) => hits.length > 0).length;
  const capturing = state?.phase === 'capturing';
  const captureBusy = state != null && ['starting', 'capturing', 'stopping'].includes(state.phase);
  /** 有采集桥（安卓壳）才给本页开关；网页版只能去「我的 · 游戏数据」导入文件 */
  const captureSupported = checked && state != null;
  const hasAny = rows.length > 0 || pets.length > 0;

  // 「数据已收齐」时触发全局自动导入：附近页发起的（雷达导向）会在流程里直接跳过，
  // 我的页发起的不管停在哪页，都会自动停止并导入（见 autoImportFlow / captureOriginStore）。
  useEffect(() => {
    if (progress?.stage === 'ready') requestAutoImport(progress.session);
  }, [progress]);

  /** 真正的开始 / 停止动作：这里开始的采集是雷达导向（不自动停止 / 不自动导入） */
  const runCapture = async (starting: boolean) => {
    setCaptureToggling(true);
    setCaptureError(null);
    try {
      if (starting) {
        markCaptureOrigin('nearby');
        // 附近 / 战斗浮窗采集允许原生滚动裁剪，避免文件无限涨大
        await startCollectorCapture('battle');
      } else {
        await collectorAction('stopCapture');
      }
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : '操作采集失败，请重试');
    } finally {
      setCaptureToggling(false);
      refresh();
    }
  };

  /**
   * 本页开关采集（2026-11-08）：开始前先查悬浮窗权限，没有先问用户。
   * 之前是等进了游戏、球没出现才在页面底部提示，用户根本看不到。
   */
  const toggleCapture = async () => {
    if (captureToggling) return;
    if (captureBusy) { await runCapture(false); return; }
    setCaptureToggling(true);
    const allowed = await canDrawOverlay();
    setCaptureToggling(false);
    if (allowed === false) { setOverlayPrompt(true); return; }
    await runCapture(true);
  };

  /** 用户选择去开权限：跳到系统设置，回来（页面重新可见）自动开始采集。 */
  const grantOverlayPermission = () => {
    setOverlayPrompt(false);
    overlayPendingStart.current = true;
    requestOverlayPermission().catch((cause) => {
      overlayPendingStart.current = false;
      setCaptureError(cause instanceof Error ? cause.message : '无法打开悬浮窗权限设置');
    });
  };

  /** 用户选择不用悬浮球：直接开始，球由 BattleHudOrb 在应用内兜底显示。 */
  const startWithoutOverlay = () => {
    setOverlayPrompt(false);
    void runCapture(true);
  };

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !overlayPendingStart.current) return;
      overlayPendingStart.current = false;
      void runCapture(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // runCapture 只依赖稳定的 setState / refresh，闭包可安全固定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const radarKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const pet of pets) {
      const hits = hitByKey.get(pet.key) ?? [];
      const allowed = filter === 'all'
        || (filter === 'rare' ? pet.rare : hits.length > 0);
      if (allowed) keys.add(pet.key);
    }
    return keys;
  }, [pets, hitByKey, filter]);

  const filtered = useMemo(() => {
    const allowed = (row: RetainedEntry) => filter === 'all'
      || (filter === 'rare' ? row.pet.rare : row.demandHits.length > 0);
    return sortRows(rows.filter(allowed), radar);
  }, [rows, radar, filter]);

  // 全屏列表：不筛选，只按价值从高到低
  const fullscreenRows = useMemo(() => sortRowsByValue(rows, radar), [rows, radar]);

  const radarView = useMemo(
    () => ({ ...radar, points: radar.points.filter((point) => radarKeys.has(point.key)) }),
    [radar, radarKeys],
  );

  /** 当前场景有没有内置地图（目前只有野外 10003）；没有就退回雷达 */
  const worldMap = useMemo(() => worldMapForScene(snapshot?.scene ?? null), [snapshot?.scene]);
  /** 地图显示按筛选后的全部有坐标精灵（不再受 115m 视野限制） */
  const mapPets = useMemo(
    () => pets.filter((pet) => pet.pos && radarKeys.has(pet.key)),
    [pets, radarKeys],
  );
  /** 没有自身坐标时用雷达的估算中心，地图至少能落到有人区域 */
  const mapSelf = captureSelf ?? radar?.origin ?? null;

  // 桌面版：把附近列表推给置顶小窗；采集中自动弹出，停止后收起
  const overlaySupported = isDesktopOverlaySupported();
  const overlayShown = useRef(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  /** 高级选项：鼠标直接落到游戏（点不到小窗），Ctrl+Alt+O 恢复 */
  const [overlayClickThrough, setOverlayClickThroughState] = useState(false);
  const lastOverlayPush = useRef(0);
  useEffect(() => {
    if (!overlaySupported || !overlayVisible) return;
    void readDesktopOverlayState().then((value) => setOverlayClickThroughState(Boolean(value?.clickThrough)));
  }, [overlaySupported, overlayVisible]);
  const toggleOverlayClickThrough = async () => {
    const next = !overlayClickThrough;
    await setDesktopOverlayClickThrough(next);
    setOverlayClickThroughState(next);
  };
  useEffect(() => {
    if (!overlaySupported) return;
    if (!capturing) {
      if (overlayShown.current) {
        overlayShown.current = false;
        setOverlayVisible(false);
        void hideNearbyOverlay();
      }
      lastOverlayPush.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastOverlayPush.current < 800) return;
    lastOverlayPush.current = now;
    const bearingByKey = new Map(radar.points.map((point) => [point.key, point.bearingLabel]));
    void pushNearbyOverlay({
      capturing: true,
      hasKey: Boolean(progress?.analysis.hasKey),
      scene: snapshot?.scene ?? null,
      self: mapSelf,
      updatedAt: snapshot?.updatedAt ?? Date.now(),
      pets: pets.map((pet) => ({
        key: pet.key,
        name: pet.name,
        level: pet.level,
        kinds: pet.kinds,
        rare: pet.rare,
        alert: Boolean(pet.alertReason),
        nature: pet.nature ?? null,
        gender: pet.gender ?? null,
        distanceM: pet.distanceM ?? null,
        bearingLabel: bearingByKey.get(pet.key) ?? null,
        x: pet.pos?.x ?? null,
        y: pet.pos?.y ?? null,
      })),
    });
    if (!overlayShown.current) {
      overlayShown.current = true;
      setOverlayVisible(true);
      void showNearbyOverlay();
    }
  }, [overlaySupported, capturing, snapshot, pets, progress, mapSelf, radar]);

  // 安卓壳：把「面板配置 + 附近 payload」推给原生悬浮球（节流 800ms，与 PC 同一口径）。
  // 旧 APK 没有 updateNearbyOverlay 时 pushNearbyOverlayToShell 静默返回 false，网页不受影响。
  const lastShellPush = useRef(0);
  const shellPanelsSignature = useRef('');
  useEffect(() => {
    if (!shellOverlaySupported) return;
    const signature = `${overlayPanels.battle}-${overlayPanels.nearby}`;
    const panelsChanged = shellPanelsSignature.current !== signature;
    shellPanelsSignature.current = signature;
    if (!capturing) {
      // 停止采集：推一次 visible=false，壳侧收起并隐藏悬浮球（没推过就不用推）
      if (lastShellPush.current > 0) {
        lastShellPush.current = 0;
        void pushNearbyOverlayToShell(buildNearbyOverlayPayload({
          capturing: false,
          hasKey: Boolean(progress?.analysis.hasKey),
          snapshot,
        }));
      }
      return;
    }
    const now = Date.now();
    // 开关变化立即重推（否则用户要点开球才看到旧配置）
    if (!panelsChanged && now - lastShellPush.current < 800) return;
    lastShellPush.current = now;
    void pushNearbyOverlayToShell(buildNearbyOverlayPayload({
      capturing: true,
      hasKey: Boolean(progress?.analysis.hasKey),
      snapshot,
    }));
  }, [shellOverlaySupported, capturing, snapshot, progress, overlayPanels]);

  // 全屏时支持 Esc 退出
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const summary = `场景 ${snapshot?.scene ?? '—'} · 附近 ${pets.length} 只 · 稀有 ${rareCount} 只 · 需求命中 ${demandCount} 只`;

  return (
    <main className="mx-auto max-w-md space-y-2 p-3">
      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="nearby-status">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">大世界采集 · 附近精灵</h2>
          <div className="flex shrink-0 items-center gap-1">
            {overlaySupported ? (
              <button
                type="button"
                onClick={() => {
                  if (overlayVisible) {
                    overlayShown.current = false;
                    setOverlayVisible(false);
                    void hideNearbyOverlay();
                  } else {
                    overlayShown.current = true;
                    setOverlayVisible(true);
                    void showNearbyOverlay();
                  }
                }}
                data-testid="nearby-overlay-toggle"
                className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-xs text-slate-600"
              >
                {overlayVisible ? '隐藏小窗' : '悬浮小窗'}
              </button>
            ) : null}
            {overlaySupported && overlayVisible ? (
              <button
                type="button"
                onClick={() => { void toggleOverlayClickThrough(); }}
                aria-pressed={overlayClickThrough}
                title="打开后鼠标点击直接落到游戏里（点不到小窗），按 Ctrl+Alt+O 恢复"
                className={`min-h-[28px] rounded-lg border px-2 text-xs ${
                  overlayClickThrough ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'
                }`}
              >
                {overlayClickThrough ? '恢复点击' : '小窗不挡点击'}
              </button>
            ) : null}
          {captureSupported ? (
            <button
              type="button"
              onClick={toggleCapture}
              disabled={captureToggling}
              data-testid="nearby-capture-toggle"
              className={`min-h-[28px] shrink-0 rounded-lg px-2.5 text-xs font-medium ${
                captureBusy
                  ? 'bg-rose-50 text-rose-600'
                  : 'bg-emerald-600 text-white disabled:bg-emerald-300'
              }`}
            >
              {captureBusy ? '停止采集' : '开始采集'}
            </button>
          ) : (
            <span className={`shrink-0 text-xs ${capturing ? 'text-emerald-700' : 'text-slate-400'}`}>
              {capturing ? '采集中' : '已停止'}
            </span>
          )}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">{summary}</p>
        <p className="text-[11px] text-slate-400">
          {snapshot ? `更新于 ${timeText(snapshot.updatedAt)}` : '尚未收到采集数据'}
        </p>
        {shellOverlaySupported ? (
          <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="nearby-panel-settings">
            <span className="text-[11px] text-slate-400">悬浮球展开显示</span>
            {(['battle', 'nearby'] as const).map((key) => {
              const on = overlayPanels[key];
              const locked = isLastEnabledNearbyOverlayPanel(overlayPanels, key);
              const label = key === 'battle' ? '战斗命中' : '附近面板';
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  disabled={locked}
                  title={locked ? '至少保留一项' : `展开${on ? '隐藏' : '显示'}${label}`}
                  onClick={() => setNearbyOverlayPanel(key, !on)}
                  data-testid={`nearby-panel-${key}`}
                  className={`min-h-[28px] rounded-lg border px-2 text-xs ${
                    on ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400'
                  } ${locked ? 'opacity-50' : ''}`}
                >
                  {label}
                </button>
              );
            })}
            {!overlayPanels.battle || !overlayPanels.nearby ? (
              <span className="text-[11px] text-slate-400">至少保留一项</span>
            ) : null}
          </div>
        ) : null}
        {captureSupported ? (
          <p className="text-[11px] text-slate-400">
            这里开始的采集只刷新地图与列表，不会自动停止 / 导入；要入库请到「我的 · 游戏数据」。
          </p>
        ) : null}
        {demands.length > 0 ? (
          <p className="text-[11px] text-slate-400">{`需求中心共 ${demands.length} 条未完成需求参与匹配`}</p>
        ) : null}
        {error ? <p className="mt-1 text-xs text-rose-600" role="alert">{error}</p> : null}
        {captureError ? <p className="mt-1 text-xs text-rose-600" role="alert">{captureError}</p> : null}
        {flow.error ? <p className="mt-1 text-xs text-rose-600" role="alert">{flow.error}</p> : null}
      </section>

      <NearbyBattleCard encounter={encounter} />

      {capturing && progress && !progress.analysis.hasKey ? (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200" data-testid="nearby-waiting-key">
          还没拿到登录密钥：采集要在登录前开始。请退出到登录界面，再重新登录一次；登录后地图会自动刷新。
        </div>
      ) : null}

      {alert ? (
        <div className="rounded-xl bg-rose-50 px-3 py-2 ring-1 ring-rose-200" data-testid="nearby-alert" role="alert">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-rose-700">{alert.title}</p>
              {alert.lines.map((line) => (
                <p key={line} className="text-xs text-rose-600">{line}</p>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAlert(null)}
              className="shrink-0 text-xs text-rose-500"
              aria-label="关闭提示"
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}

      {hasAny ? (
        <>
          <div className="space-y-1.5 rounded-2xl bg-white p-3 shadow-sm" data-tour="nearby-filters">
            <SegmentedControl
              label="筛选附近精灵"
              value={filter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'rare', label: '稀有' },
                { value: 'demand', label: '需求' },
              ]}
              onValueChange={(value) => setFilter(value as NearbyFilter)}
              optionTestId={(value) => `nearby-filter-${value}`}
            />
            <SegmentedControl
              label="查看方式"
              value={view}
              options={[
                { value: 'map', label: '地图' },
                { value: 'list', label: '列表' },
              ]}
              onValueChange={(value) => setView(value as NearbyView)}
              optionTestId={(value) => `nearby-view-${value}`}
            />
          </div>

          {view === 'map' ? (
            <section
              className="rounded-2xl bg-white p-1 shadow-sm"
              data-tour="nearby-radar"
              data-testid={worldMap ? 'nearby-map' : 'nearby-radar'}
            >
              <div className="flex items-center justify-between px-1 pb-1">
                <p className="text-xs font-medium text-slate-600">
                  {worldMap ? `地图 · ${worldMap.name}` : '雷达 · 115m'}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={refresh}
                    className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-xs text-slate-500"
                    data-testid="nearby-refresh"
                  >
                    刷新
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullscreen(true)}
                    className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-xs text-slate-500"
                    data-testid="nearby-fullscreen-open"
                  >
                    全屏
                  </button>
                </div>
              </div>
              {worldMap ? (
                <>
                  <NearbyMap pets={mapPets} origin={mapSelf} scene={snapshot?.scene ?? null} />
                  <p className="mt-1 text-center text-[11px] text-slate-400">
                    拖动 / 滚轮缩放；点位是世界坐标实测位置，不随视野裁剪
                  </p>
                </>
              ) : (
                <>
                  <NearbyRadar radar={radarView} />
                  <p className="mt-1 text-center text-[11px] text-slate-400">
                    {captureSelf
                      ? '当前场景没有内置地图，先用雷达；中心为自身位置'
                      : '当前场景没有内置地图，先用雷达；中心为估算位置'}
                  </p>
                  {radar.outsideRadius > 0 ? (
                    <p className="mt-0.5 text-center text-[11px] text-slate-400">
                      {`另有 ${radar.outsideRadius} 只超出 115m，未画到雷达`}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          ) : rows.length === 0 ? (
            <StateNotice
              kind="empty-data"
              title="还没有高价值精灵"
              description="地图仍显示当前普通精灵；常驻列表只保留可提醒、炫彩 / 异色 / 污染或命中需求中心的精灵。"
            />
          ) : filtered.length === 0 ? (
            <StateNotice
              kind="empty-query"
              title="当前筛选下没有精灵"
              description="切换到「全部」查看其它附近精灵。"
            />
          ) : (
            <section className="space-y-1" aria-label="附近精灵常驻列表">
              <p className="px-1 text-[11px] text-slate-400">
                {`常驻 ${rows.length} 只 · 仅高价值（可提醒 / 炫彩异色污染 / 需求命中），离开后保留 10 分钟`}
              </p>
              {filtered.map((row) => (
                <NearbyRowItem
                  key={row.key}
                  row={row}
                  point={radar.points.find((item) => item.key === row.key)}
                />
              ))}
            </section>
          )}
        </>
      ) : (
        <StateNotice
          kind={snapshot ? 'loading' : 'empty-data'}
          title={snapshot ? '正在等待附近精灵' : '还没有附近精灵数据'}
          description={
            snapshot
              ? '进入野外场景后，地图会随刷新自动更新。'
              : captureSupported
                ? '点上方「开始采集」后进入野外场景，地图会实时刷新。'
                : '在「我的 · 游戏数据」开始采集后进入野外场景，地图会实时刷新。'
          }
          action={
            // 有采集桥时本页就能直接开始（顶部按钮），不再给跳转；网页版才引导去「我的」导入
            !captureSupported && !capturing ? (
              <button
                type="button"
                onClick={() => onNavigate({ type: 'open-profile', section: 'data' })}
                className="min-h-[30px] rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white"
              >
                去开始采集
              </button>
            ) : undefined
          }
        />
      )}

      {fullscreen ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950" data-testid="nearby-fullscreen-view">
          {/* 顶部条：左侧概要固定左上角，右侧是「雷达 / 列表」切换与关闭 */}
          <div className="flex shrink-0 items-start justify-between gap-2 px-3 pt-3">
            <div className="min-w-0 rounded-xl bg-slate-900/85 px-3 py-2 text-white shadow-lg">
              <p className="text-sm font-semibold">附近精灵 · {capturing ? '采集中' : '已停止'}</p>
              <p className="text-xs text-slate-300">{summary}</p>
              <p className="text-[11px] text-slate-400">
                {snapshot ? `更新于 ${timeText(snapshot.updatedAt)}` : '尚未收到采集数据'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {(['map', 'list'] as NearbyView[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFullscreenView(mode)}
                  aria-pressed={fullscreenView === mode}
                  data-testid={`nearby-fullscreen-view-${mode}`}
                  className={`min-h-[32px] rounded-lg px-3 text-xs ${
                    fullscreenView === mode ? 'bg-white font-medium text-emerald-700' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {mode === 'map' ? '地图' : '列表'}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="min-h-[32px] rounded-lg bg-slate-800 px-3 text-xs text-white"
                aria-label="退出全屏"
                data-testid="nearby-fullscreen-close"
              >
                关闭
              </button>
            </div>
          </div>
          {/* 主体撑满剩余空间：雷达在正方形内尽可能大，列表可滚动 */}
          {fullscreenView === 'map' ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-slate-950 p-1">
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-white">
                {worldMap
                  ? <NearbyMap pets={mapPets} origin={mapSelf} scene={snapshot?.scene ?? null} className="h-full w-full" />
                  : <NearbyRadar radar={radarView} className="h-full w-full scale-[1.3]" />}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" data-testid="nearby-fullscreen-list">
              <p className="px-1 text-[11px] text-slate-400">
                {`按价值排序 · 共 ${fullscreenRows.length} 只（不筛选）`}
              </p>
              {fullscreenRows.length === 0 ? (
                <p className="rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-300">还没有高价值精灵</p>
              ) : fullscreenRows.map((row) => (
                <NearbyRowItem
                  key={row.key}
                  row={row}
                  dark
                  point={radar.points.find((item) => item.key === row.key)}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      <ModalSurface
        open={overlayPrompt}
        title="开启战斗悬浮球"
        onClose={() => setOverlayPrompt(false)}
        testId="overlay-permission-dialog"
        footer={(
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startWithoutOverlay}
              className="min-h-[40px] flex-1 rounded-xl bg-slate-100 text-sm font-medium text-slate-600"
            >
              先不用悬浮球
            </button>
            <button
              type="button"
              onClick={grantOverlayPermission}
              className="min-h-[40px] flex-1 rounded-xl bg-emerald-600 text-sm font-medium text-white"
            >
              去开启权限
            </button>
          </div>
        )}
      >
        <div className="space-y-2 px-4 py-3 text-sm text-slate-600">
          <p>战斗悬浮球要浮在游戏上方，需要系统「显示在其他应用上层」权限，否则进了游戏看不到球。</p>
          <p className="text-xs text-slate-400">开启后返回会自动开始采集；不开也能采集，只是没有悬浮球。</p>
        </div>
      </ModalSurface>
    </main>
  );
}
