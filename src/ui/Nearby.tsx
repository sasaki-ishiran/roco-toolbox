import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveNearbyPet } from '../collector/captureProgress';
import { hideNearbyOverlay, isDesktopOverlaySupported, pushNearbyOverlay, readDesktopOverlayState, setDesktopOverlayClickThrough, showNearbyOverlay } from '../collector/desktopOverlay';
import { requestAutoImport, useAutoImport } from '../collector/autoImportFlow';
import { markCaptureOrigin } from '../collector/captureOriginStore';
import { nearbyAlertGate } from '../collector/nearbyAlert';
import { canDrawOverlay, collectorAction, notifyRareAlert, readOrbHidden, requestOverlayPermission, setOrbHidden, startCollectorCapture } from '../collector/nativeCollector';
import { readNearbyRetained, writeNearbyRetained } from '../collector/nearbyRetainStore';
import { readNearbySnapshot } from '../collector/nearbyStore';
import { useRareAlert } from '../collector/rareAlertStore';
import { useNearbyFeed } from '../collector/useNearbyFeed';
import { hasNearbyOverlayShell } from '../nearby/overlayBridge';
import { buildNearbyOverlayPayload } from '../nearby/overlayPayload';
import { species, eggGroupNames } from '../data/catalog';
import { buildRadar, DEFAULT_RADAR_RADIUS_M, type RadarData } from '../pcap/nearbyRadar';
import { worldMapForScene } from '../pcap/worldMap';
import { createSelfEstimate, updateSelfEstimate } from '../pcap/selfOdometry';
import { pruneRetained, isHighValuePet, type RetainedEntry } from '../pcap/nearbyRetain';
import { KIND_LABELS, rareAlertTitle } from '../pcap/rareRules';
import type { NavigationIntent } from './navigation';
import { NearbyBattleCard } from './NearbyBattleCard';
import { NearbyAlertCard } from './NearbyAlertCard';
import { MapErrorBoundary } from './NearbyErrorBoundary';
import { NearbyMap } from './NearbyMap';
import { NearbyRadar } from './NearbyRadar';
import { ModalSurface } from './primitives/ModalSurface';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';
import { setNearbyFilter, useNearbyFilter, type NearbyFilter } from '../nearby/nearbyFilterStore';
import {
  clearNearbyTargets,
  nearbyRangeAllows,
  nearbyTargetAllows,
  toggleNearbyTarget,
  useNearbyTargets,
} from '../nearby/nearbyTargetStore';

type NearbyView = 'map' | 'list';

export interface NearbyProps {
  onNavigate: (intent: NavigationIntent) => void;
  /** 嵌在「我的 · 游戏数据」里：不再自带最大宽度与内边距（2026-11-21）。 */
  embedded?: boolean;
}

/** 目标精灵名单 / 选择面板用的图鉴名（gameId → 名称）。 */
const SPECIES_NAME = new Map(species.map((entry) => [entry.gameId, entry.name]));
/** 搜索结果上限：图鉴 600+ 条，全量渲染在手机上太卡，超过就提示继续输入。 */
const TARGET_SEARCH_LIMIT = 60;

const mmss = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * 桌面小窗推送节流（2026-11-11，与手机悬浮面板对齐 250ms）。
 * 命中节流时排尾随补发而不是直接丢帧，最坏延迟 = 一轮解码 + 一个窗口。
 */
const OVERLAY_PUSH_INTERVAL_MS = 250;

/** 常驻列表排序：仍在视野内 → 目标出现 → 稀有牌子多 → 距离近。 */
function sortRows(rows: readonly RetainedEntry[], radar: RadarData): RetainedEntry[] {
  const distanceOf = new Map(radar.points.map((point) => [point.key, point.distanceM]));
  return [...rows].sort((left, right) => {
    const present = Number(right.present) - Number(left.present);
    if (present !== 0) return present;
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

/** 全屏列表的价值分：目标出现 > 炫彩/异色/污染 > 其它牌子 > 仍在视野。 */
export function valueScoreOf(row: RetainedEntry): number {
  let score = 0;
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

/** 百分位文案：截断一位小数（不四舍五入），整数去掉 `.0`，缺失给 `—`。 */
const formatPct = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  const truncated = Math.trunc(value * 10) / 10;
  return `${Number.isInteger(truncated) ? truncated : truncated.toFixed(1)}%`;
};
const isHotPct = (value: number | null | undefined): boolean =>
  value != null && Number.isFinite(value) && (value >= 98 || value <= 2);
const voiceTextOf = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${Math.round(value)}dB`;
const isHotVoice = (value: number | null | undefined): boolean =>
  value != null && Number.isFinite(value) && Math.abs(value) >= 96;

/** 附近精灵行：页面列表与全屏列表共用，避免两套渲染漂移。 */
function NearbyRowItem({
  row,
  point,
  dark = false,
  open = false,
  onToggle,
}: {
  row: RetainedEntry;
  point: { distanceM: number; bearingLabel: string } | undefined;
  dark?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const pet = row.pet;
  const valueCls = (hot: boolean, missing = false) =>
    hot ? 'font-semibold text-amber-700 dark:text-amber-300'
      : missing ? 'text-slate-300 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300';
  const visibleKinds = pet.kinds.filter((kind) => kind !== 'high' && kind !== 'low');
  const details: Array<[string, string]> = [
    ['身高', formatPct(pet.heightPct)],
    ['体重', formatPct(pet.weightPct)],
    ['声音', voiceTextOf(pet.voiceDb)],
    ['性别', pet.gender || '未知'],
    ['性格', pet.nature || '未知'],
    ['稀有', pet.rare ? '是' : '否'],
    ['目标', pet.alertReason ? '出现' : '否'],
    ['首次', timeText(row.firstSeenAt)],
    ['最近', timeText(row.lastSeenAt)],
    ['坐标', pet.pos ? `${Math.round(pet.pos.x)}, ${Math.round(pet.pos.y)}` : '—'],
    ['距离', point ? `${point.distanceM.toFixed(1)}m ${point.bearingLabel}` : '—'],
    ['状态', row.present ? '仍在视野' : '已离开'],
    ['编号', pet.petId != null ? `#${pet.petId}` : '—'],
  ];
  return (
    <div
      data-testid="nearby-row"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle?.();
        }
      }}
      className={`cursor-pointer rounded-xl px-3 py-2 ${dark ? 'bg-slate-900 text-slate-100' : 'bg-white shadow-sm'} ${
        pet.alertReason ? 'ring-1 ring-rose-200' : ''
      } ${row.present ? '' : 'opacity-70'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate text-sm ${pet.rare ? `font-semibold ${dark ? 'text-white' : 'text-slate-800'}` : dark ? 'text-slate-200' : 'text-slate-700'}`}>
            {pet.name}
          </span>
          <span className="shrink-0 text-xs text-slate-400">Lv{pet.level}</span>
          {pet.gender ? (
            <span className={`shrink-0 rounded-full px-1.5 text-[10px] font-semibold ${
              pet.gender === '公' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300'
                : 'bg-pink-50 text-pink-600 dark:bg-pink-950/50 dark:text-pink-300'
            }`}>{pet.gender}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-slate-400">
          {point ? `${point.distanceM.toFixed(1)}m ${point.bearingLabel}` : '—'}
        </span>
      </div>
      <div className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
        <span>{pet.nature ? `性格 ${pet.nature}` : '性格 未知'}</span>
        <span className="text-slate-300">·</span>
        <span className={`tabular-nums ${valueCls(isHotPct(pet.heightPct), pet.heightPct == null)}`}>
          {`高${formatPct(pet.heightPct)}`}
        </span>
        <span className={`tabular-nums ${valueCls(isHotPct(pet.weightPct), pet.weightPct == null)}`}>
          {`重${formatPct(pet.weightPct)}`}
        </span>
        <span className="text-slate-300">·</span>
        <span className={`tabular-nums ${valueCls(isHotVoice(pet.voiceDb), pet.voiceDb == null)}`}>
          {voiceTextOf(pet.voiceDb)}
        </span>
      </div>
      {pet.alertReason || visibleKinds.length > 0 || !row.present ? (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
          {visibleKinds.map((kind) => (
            <span key={kind} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {KIND_LABELS[kind as keyof typeof KIND_LABELS] || kind}
            </span>
          ))}
          {pet.alertReason ? (
            <span className="rounded bg-rose-50 px-1.5 py-0.5 font-medium text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">目标出现！</span>
          ) : null}
          {!row.present ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400">已离开视野</span>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <dl className={`mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-dashed pt-1.5 text-[11px] ${
          dark ? 'border-slate-700' : 'border-slate-200'
        }`}>
          {details.map(([label, value]) => (
            <div key={label} className="flex min-w-0 gap-1">
              <dt className="shrink-0 text-slate-400">{label}</dt>
              <dd className={`m-0 truncate ${dark ? 'text-slate-200' : 'text-slate-700'}`}>{value}</dd>
            </div>
          ))}
          <div className="col-span-2 flex min-w-0 gap-1">
            <dt className="shrink-0 text-slate-400">牌子</dt>
            <dd className={`m-0 truncate ${dark ? 'text-slate-200' : 'text-slate-700'}`}>
              {pet.kinds.length > 0 ? pet.kinds.map((kind) => KIND_LABELS[kind as keyof typeof KIND_LABELS] || kind).join(' · ') : '无'}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

/**
 * 附近页（2026-11-06）：雷达 / 列表两种视图，共用筛选。
 *
 * - 雷达画「当前还在视野内」的精灵；列表是常驻列表，高价值（稀有 / 目标出现）
 *   离开视野后仍保留 10 分钟，普通精灵离开即清理。
 * - 目标出现时走系统通知 + 页内强提示；性格 / 性别野生实体读不到，标记「需确认」。
 * - 雷达中心是附近精灵坐标的几何中位数（真实抓包里没有自身坐标帧），只作估算。
 */
export function Nearby({ onNavigate, embedded = false }: NearbyProps) {
  const { state, snapshot, error, refresh, progress, checked } = useNearbyFeed();
  const flow = useAutoImport();
  const rareAlertOn = useRareAlert();
  /** 手机悬浮球展开后显示哪些面板（本机记忆，只影响安卓壳，不重排本页） */
  const shellOverlaySupported = hasNearbyOverlayShell();
  /** 悬浮球是否被隐藏（1.3.6）：长按球隐藏，这里负责恢复；null = 旧壳没有这个能力 */
  const [orbHidden, setOrbHiddenState] = useState<boolean | null>(null);
  const [view, setView] = useState<NearbyView>('map');
  // 顶部总范围：与悬浮窗共用同一份状态（下沉到 nearbyFilterStore，切页不丢）
  const filter = useNearbyFilter();
  /** 蹲守名单（目标档）：空数组即关闭，与三档共用同一份「范围」语义 */
  const targets = useNearbyTargets();
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targetQuery, setTargetQuery] = useState('');
  /** 目标档下「都不在视野」的等待计时：进入等待时记开始时刻，目标出现即清零 */
  const targetWaitSince = useRef<number | null>(null);
  const [waitTick, setWaitTick] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenView, setFullscreenView] = useState<NearbyView>('map');
  const [rows, setRows] = useState<RetainedEntry[]>(() => readNearbyRetained());
  /** 当前展开详情的那一行（同一时间只开一条；全屏列表共用） */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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

  const classify = useMemo(
    () => (pet: LiveNearbyPet) => ({
      // 蹲守目标也算高价值：离开视野后按同样 10 分钟保留在常驻列表里
      highValue: isHighValuePet(pet) || nearbyTargetAllows(targets, pet),
    }),
    [targets],
  );

  // 名单被清空（如面板里「清除全部」）时，范围不能停在目标档：退回「全部」
  useEffect(() => {
    if (filter === 'target' && targets.length === 0) setNearbyFilter('all');
  }, [filter, targets.length]);

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
      setExpandedKey(null);
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

  // 强提示：稀有（±100dB / 体重牌+声音牌）；同一只只响一次。
  // 目标档下只看蹲守的那几只，别的精灵不打扰（2026-11-13）
  useEffect(() => {
    if (!rareAlertOn || !snapshot) return;
    const candidates = filter === 'target'
      ? snapshot.pets.filter((pet) => nearbyTargetAllows(targets, pet))
      : snapshot.pets;
    const fresh = nearbyAlertGate.scan(
      candidates,
      (pet) => pet.key,
      (pet) => Boolean(pet.alertReason),
    );
    if (fresh.length === 0) return;
    const lines = fresh
      .filter((pet) => pet.alertReason)
      .map((pet) => `${pet.name} ${pet.level}级 · ${pet.alertReason}`)
      .slice(0, 3);
    if (fresh.length > 3) lines.push(`…另有 ${fresh.length - 3} 只`);
    const title = rareAlertTitle(lines.length);
    setAlert({ title, lines });
    void notifyRareAlert(title, lines.join('\n')).catch(() => {});
  }, [snapshot, rareAlertOn, filter, targets]);

  const pets = snapshot?.pets ?? [];
  // 最近一次赛季奇遇战（龙棋士 → 蛋包蛋），战斗中已带真实性格
  const encounter = snapshot?.encounter ?? null;
  // 自身坐标优先用解码器解析出的上行 307；拿不到时退回里程计估算
  const captureSelf = snapshot?.self ?? null;
  // 来源只用于文案：307 = 真实坐标，其它（里程计 / 沿用上一帧）= 估算
  const selfSource = snapshot?.selfSource ?? (captureSelf ? 'packet' : 'none');
  // 307 是稀疏帧：解码线程已经在写快照时跑过里程计，这里直接消费，
  // 避免页面与悬浮窗各算一套导致两边不一致（2026-11-10）
  const estimatedSelf = snapshot?.estimatedSelf ?? self;
  // 自身坐标优先用解码器解析出的上行 307；拿不到时退回里程计估算
  const radar = useMemo(
    () => buildRadar(pets, {
      origin: captureSelf ?? estimatedSelf,
      radiusM: DEFAULT_RADAR_RADIUS_M,
      trustOrigin: Boolean(captureSelf),
      // 有人物朝向时，雷达/列表方位都按「面朝方向为正上方」算（2026-11-10）
      heading: snapshot?.selfHeading ?? null,
    }),
    [pets, estimatedSelf, captureSelf, snapshot?.selfHeading],
  );
  const rareCount = pets.filter((pet) => pet.rare).length;
  /** 目标档下：当前视野内的目标数量（决定要不要显示「都不在视野内」） */
  const targetPresent = pets.filter((pet) => nearbyTargetAllows(targets, pet)).length;
  const targetWaiting = filter === 'target' && targets.length > 0 && targetPresent === 0;
  const capturing = state?.phase === 'capturing';
  const captureBusy = state != null && ['starting', 'capturing', 'stopping'].includes(state.phase);
  /** 有采集桥（安卓壳）才给本页开关；网页版只能去「我的 · 游戏数据」导入文件 */
  const captureSupported = checked && state != null;
  // 目标档即使暂时没有精灵数据也要显示筛选区：否则「编辑 / 清除」入口会消失
  const hasAny = rows.length > 0 || pets.length > 0 || filter === 'target';

  // 目标都不在视野时开始计时（只在页面里显示等待时长，不发通知、不打断）
  useEffect(() => {
    if (!targetWaiting) {
      targetWaitSince.current = null;
      return;
    }
    if (targetWaitSince.current == null) {
      targetWaitSince.current = Date.now();
      setWaitTick(Date.now());
    }
  }, [targetWaiting]);

  useEffect(() => {
    if (!targetWaiting) return;
    const timer = window.setInterval(() => setWaitTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [targetWaiting]);

  const waitedText = targetWaiting && targetWaitSince.current != null
    ? mmss((waitTick - targetWaitSince.current) / 1000)
    : '0:00';

  /** 选择面板的搜索结果：空关键词不铺全量图鉴，避免几百行卡顿 */
  const targetMatches = useMemo(() => {
    const keyword = targetQuery.trim();
    if (!keyword) return [];
    return species
      .filter((entry) => entry.name.includes(keyword) || (entry.officialName ?? '').includes(keyword))
      .slice(0, TARGET_SEARCH_LIMIT);
  }, [targetQuery]);

  // 「数据已收齐」时触发全局自动导入：附近页发起的（雷达导向）会在流程里直接跳过，
  // 我的页发起的不管停在哪页，都会自动停止并导入（见 autoImportFlow / captureOriginStore）。
  useEffect(() => {
    if (progress?.stage === 'ready') requestAutoImport(progress.session);
  }, [progress]);

  // 悬浮球隐藏态：进页面读一次；采集开关变化时再读一次（期间可能长按隐藏过）
  useEffect(() => {
    if (!shellOverlaySupported) return;
    let alive = true;
    void readOrbHidden().then((value) => { if (alive) setOrbHiddenState(value); });
    return () => { alive = false; };
  }, [shellOverlaySupported, capturing]);

  const toggleOrbHidden = async () => {
    const next = !(orbHidden ?? false);
    if (await setOrbHidden(next)) setOrbHiddenState(next);
  };

  /** 手动刷新：失败只显示行内提示，不能让整页白屏（2026-11-10 真机反馈）。 */
  const safeRefresh = () => {
    try {
      refresh();
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : '刷新失败，请稍后再试');
    }
  };

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
      if (nearbyRangeAllows(filter, pet, targets)) keys.add(pet.key);
    }
    return keys;
  }, [pets, filter, targets]);

  const filtered = useMemo(() => {
    const allowed = (row: RetainedEntry) => nearbyRangeAllows(filter, row.pet, targets);
    return sortRows(rows.filter(allowed), radar);
  }, [rows, radar, filter, targets]);

  // 全屏列表：平时不筛选、只按价值排序；目标档下与主视图一致，只列蹲守目标
  const fullscreenRows = useMemo(() => {
    const source = filter === 'target'
      ? rows.filter((row) => nearbyTargetAllows(targets, row.pet))
      : rows;
    return sortRowsByValue(source, radar);
  }, [rows, radar, filter, targets]);

  const radarView = useMemo(
    () => ({ ...radar, points: radar.points.filter((point) => radarKeys.has(point.key)) }),
    [radar, radarKeys],
  );

  /** 当前场景有没有内置地图（目前只有野外 10003）；没有就退回雷达 */
  const worldMap = useMemo(() => worldMapForScene(snapshot?.scene ?? null), [snapshot?.scene]);
  /** 地图显示按筛选后的全部有坐标精灵（不再受 115m 视野限制） */
  const mapPets = useMemo(() => {
    const list = pets.filter((pet) => pet.pos && radarKeys.has(pet.key));
    if (list.length <= 40) return list;
    // 实体堆积时不再全量画点：目标出现/稀有优先，最多 40 个（2026-11-12）
    const score = (pet: (typeof list)[number]) => (pet.alertReason ? 2 : pet.rare ? 1 : 0);
    return [...list].sort((a, b) => score(b) - score(a)).slice(0, 40);
  }, [pets, radarKeys]);
  /** 没有自身坐标时用雷达的估算中心，地图至少能落到有人区域 */
  const mapSelf = captureSelf ?? estimatedSelf ?? radar?.origin ?? null;

  // 桌面版：把附近列表推给置顶小窗；采集中自动弹出，停止后收起
  const overlaySupported = isDesktopOverlaySupported();
  const overlayShown = useRef(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  /** 高级选项：鼠标直接落到游戏（点不到小窗），Ctrl+Alt+O 恢复 */
  const [overlayClickThrough, setOverlayClickThroughState] = useState(false);
  const lastOverlayPush = useRef(0);
  /** 尾随补发的定时器：同一时刻只排一个（与手机悬浮窗推送同一套 2026-11-10 口径） */
  const overlayPending = useRef<number | null>(null);
  /** 补发读的都是 ref：定时器触发时推的一定是最新一帧，而不是排期那一刻的旧数据 */
  const overlaySource = useRef({ snapshot, hasKey: false });
  overlaySource.current = { snapshot, hasKey: Boolean(progress?.analysis.hasKey) };

  const pushOverlay = () => {
    const latest = overlaySource.current;
    // 与手机悬浮面板共用同一个 payload 组装：分贝、方位箭头、身高/体重、自身朝向同一份口径
    void pushNearbyOverlay(buildNearbyOverlayPayload({
      capturing: true,
      hasKey: latest.hasKey,
      snapshot: latest.snapshot,
    }));
    if (!overlayShown.current) {
      overlayShown.current = true;
      setOverlayVisible(true);
      void showNearbyOverlay();
    }
  };

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
      if (overlayPending.current != null) {
        window.clearTimeout(overlayPending.current);
        overlayPending.current = null;
      }
      if (overlayShown.current) {
        overlayShown.current = false;
        setOverlayVisible(false);
        void hideNearbyOverlay();
      }
      lastOverlayPush.current = 0;
      return;
    }
    // 节流窗口内不丢帧：排一个窗口结束的尾随补发，读最新快照重推（最坏多等一个窗口）
    if (overlayPending.current != null) return;
    const wait = Math.max(0, OVERLAY_PUSH_INTERVAL_MS - (Date.now() - lastOverlayPush.current));
    if (wait > 0) {
      overlayPending.current = window.setTimeout(() => {
        overlayPending.current = null;
        lastOverlayPush.current = Date.now();
        pushOverlay();
      }, wait);
      return;
    }
    lastOverlayPush.current = Date.now();
    pushOverlay();
  }, [overlaySupported, capturing, snapshot, progress]);

  // 页面卸载：清掉尾随补发，别在组件没了以后还把旧数据推给小窗
  useEffect(() => () => {
    if (overlayPending.current != null) window.clearTimeout(overlayPending.current);
  }, []);

  // 安卓壳悬浮面板的推送已移到应用级（src/nearby/useNearbyOverlayPush.ts）：
  // 推送跟随采集状态，不随本页卸载，从「我的」页发起采集也照样有面板。

  // 全屏时支持 Esc 退出
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const summary = `场景 ${snapshot?.scene ?? '—'} · 附近 ${pets.length} 只 · 稀有 ${rareCount} 只`;

  return (
    <div
      className={embedded ? 'space-y-2' : 'mx-auto max-w-md space-y-2 p-3'}
      data-testid="nearby-page"
    >
      <NearbyAlertCard />
      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="nearby-status">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">跑图 · 附近精灵</h2>
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
          {orbHidden !== null ? (
            <button
              type="button"
              onClick={() => { void toggleOrbHidden(); }}
              data-testid="nearby-orb-toggle"
              className="min-h-[28px] rounded-lg border border-slate-200 px-2 text-xs text-slate-600"
            >
              {orbHidden ? '显示悬浮球' : '隐藏悬浮球'}
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

        {captureSupported ? (
          <p className="text-[11px] text-slate-400">
            这里开始的采集只刷新地图与列表，不会自动停止 / 导入；要入库请到「我的 · 本机采集」。
          </p>
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
                { value: 'target', label: targets.length > 0 ? `目标 · ${targets.length}` : '目标' },
              ]}
              onValueChange={(value) => {
                // 还没选精灵时点「目标」先开选择面板，不把范围切到空名单
                if (value === 'target' && targets.length === 0) {
                  setTargetsOpen(true);
                  return;
                }
                setNearbyFilter(value as NearbyFilter);
              }}
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
            {filter === 'target' ? (
              <div className="flex flex-wrap items-center gap-1 pt-0.5" data-testid="nearby-target-row">
                <span className="text-[11px] text-slate-400">蹲守</span>
                {targets.map((gameId) => (
                  <span
                    key={gameId}
                    className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
                  >
                    {SPECIES_NAME.get(gameId) ?? `#${gameId}`}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setTargetsOpen(true)}
                  data-testid="nearby-target-edit"
                  className="min-h-[26px] rounded-lg border border-slate-200 px-2 text-[11px] text-slate-600"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => { clearNearbyTargets(); setNearbyFilter('all'); }}
                  data-testid="nearby-target-clear"
                  className="min-h-[26px] rounded-lg border border-slate-200 px-2 text-[11px] text-slate-600"
                >
                  清除
                </button>
              </div>
            ) : null}
          </div>

          {filter === 'target' ? (
            <div
              className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 ring-1 ring-emerald-200"
              data-testid="nearby-target-status"
            >
              {targetWaiting
                ? `目标的 ${targets.length} 只都不在视野内 · 已等待 ${waitedText}`
                : `目标 ${targets.length} 只 · 视野内 ${targetPresent} 只 · 已隐藏 ${Math.max(0, pets.length - targetPresent)} 只非目标精灵`}
            </div>
          ) : null}

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
                    onClick={safeRefresh}
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
                  <MapErrorBoundary>
                    <NearbyMap pets={mapPets} origin={mapSelf} scene={snapshot?.scene ?? null} />
                  </MapErrorBoundary>
                  <p className="mt-1 text-center text-[11px] text-slate-400">
                    拖动 / 滚轮缩放；点位是世界坐标实测位置，不随视野裁剪
                  </p>
                </>
              ) : (
                <>
                  <NearbyRadar radar={radarView} />
                  <p className="mt-1 text-center text-[11px] text-slate-400">
                    {selfSource === 'packet'
                      ? '当前场景没有内置地图，先用雷达；中心为自身位置'
                      : '当前场景没有内置地图，先用雷达；中心为估算位置'}
                  </p>
                  {filter !== 'target' && radar.outsideRadius > 0 ? (
                    <p className="mt-0.5 text-center text-[11px] text-slate-400">
                      {`另有 ${radar.outsideRadius} 只超出 115m，未画到雷达`}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          ) : filter === 'target' && filtered.length === 0 ? (
            <StateNotice
              kind="empty-query"
              title={`目标的 ${targets.length} 只都不在视野内`}
              description={
                targetWaiting
                  ? `已等待 ${waitedText} · 目标进入附近后会自动出现在这里`
                  : '目标进入附近后会自动出现在这里；也可以回地图看看。'
              }
            />
          ) : rows.length === 0 ? (
            <StateNotice
              kind="empty-data"
              title="还没有高价值精灵"
              description="地图仍显示当前普通精灵；常驻列表只保留目标出现、炫彩 / 异色 / 污染的精灵。"
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
                {filter === 'target'
                  ? `蹲守 ${targets.length} 只 · 离开视野后保留 10 分钟`
                  : `常驻 ${rows.length} 只 · 仅高价值（目标出现 / 炫彩异色污染），离开后保留 10 分钟`}
              </p>
              {filtered.map((row) => (
                <NearbyRowItem
                  key={row.key}
                  row={row}
                  point={radar.points.find((item) => item.key === row.key)}
                  open={expandedKey === row.key}
                  onToggle={() => setExpandedKey((current) => current === row.key ? null : row.key)}
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
                  ? (
                    <MapErrorBoundary className="h-full w-full">
                      <NearbyMap pets={mapPets} origin={mapSelf} scene={snapshot?.scene ?? null} className="h-full w-full" />
                    </MapErrorBoundary>
                  )
                  : <NearbyRadar radar={radarView} className="h-full w-full scale-[1.3]" />}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" data-testid="nearby-fullscreen-list">
              <p className="px-1 text-[11px] text-slate-400">
                {filter === 'target'
                  ? `按价值排序 · 蹲守 ${targets.length} 只`
                  : `按价值排序 · 共 ${fullscreenRows.length} 只（不筛选）`}
              </p>
              {fullscreenRows.length === 0 ? (
                <p className="rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-300">
                  {filter === 'target' ? `目标的 ${targets.length} 只都不在视野内` : '还没有高价值精灵'}
                </p>
              ) : fullscreenRows.map((row) => (
                <NearbyRowItem
                  key={row.key}
                  row={row}
                  dark
                  point={radar.points.find((item) => item.key === row.key)}
                  open={expandedKey === row.key}
                  onToggle={() => setExpandedKey((current) => current === row.key ? null : row.key)}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      <ModalSurface
        open={targetsOpen}
        title="目标精灵"
        placement="sheet"
        onClose={() => setTargetsOpen(false)}
        testId="nearby-target-sheet"
        closeTestId="nearby-target-sheet-close"
        footer={(
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => clearNearbyTargets()}
              data-testid="nearby-target-clear-all"
              className="min-h-[40px] rounded-xl bg-slate-100 px-4 text-sm font-medium text-slate-600"
            >
              清除全部
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetsOpen(false);
                if (targets.length > 0) setNearbyFilter('target');
              }}
              disabled={targets.length === 0}
              data-testid="nearby-target-done"
              className="min-h-[40px] flex-1 rounded-xl bg-emerald-600 text-sm font-medium text-white disabled:bg-emerald-300"
            >
              {targets.length > 0 ? `完成 · 蹲守 ${targets.length} 只` : '先勾选精灵'}
            </button>
          </div>
        )}
      >
        <div className="space-y-2 px-4 py-3">
          <p className="text-xs text-slate-500">输入名字搜索，勾选想蹲的那几只（可多选）。开启后地图与列表只显示它们。</p>
          <SearchField
            label="搜索精灵"
            value={targetQuery}
            onValueChange={setTargetQuery}
            placeholder="输入精灵名搜索"
            testId="nearby-target-search"
          />
          {targets.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1" data-testid="nearby-target-selected">
              <span className="text-[11px] text-slate-400">{`已选 ${targets.length} 只`}</span>
              {targets.map((gameId) => (
                <button
                  key={gameId}
                  type="button"
                  onClick={() => toggleNearbyTarget(gameId)}
                  aria-label={`移除 ${SPECIES_NAME.get(gameId) ?? gameId}`}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
                >
                  {SPECIES_NAME.get(gameId) ?? `#${gameId}`} ×
                </button>
              ))}
            </div>
          ) : null}
          <div className="divide-y divide-slate-100">
            {targetQuery.trim() === '' ? (
              <p className="py-6 text-center text-xs text-slate-400">输入精灵名后从结果里勾选</p>
            ) : targetMatches.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">没有匹配的精灵，换个关键词试试</p>
            ) : targetMatches.map((entry) => {
              const on = targets.includes(entry.gameId);
              return (
                <button
                  key={entry.gameId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleNearbyTarget(entry.gameId)}
                  data-testid={`nearby-target-option-${entry.gameId}`}
                  className="flex min-h-[44px] w-full items-center gap-2.5 py-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border text-[11px] leading-none ${
                      on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span className="text-sm text-slate-800">{entry.name}</span>
                  <span className="text-[11px] text-slate-400">
                    {entry.eggGroups.length > 0 ? eggGroupNames[entry.eggGroups[0]!] ?? '' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </ModalSurface>

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
    </div>
  );
}
