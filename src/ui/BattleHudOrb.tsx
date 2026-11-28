import { useEffect, useMemo, useRef, useState } from 'react';
import { observeCollectorState } from '../collector/captureOriginStore';
import { battleTargetHit, useBattleTarget } from '../collector/battleTargetStore';
import {
  hasNativeBattleOverlay,
  readCollectorState,
  requestOverlayPermission,
  updateBattleOverlay,
  type BattleOverlayField,
  type CollectorState,
} from '../collector/nativeCollector';
import { useNearbySnapshot } from '../collector/nearbyStore';
import { useCaptureProgress } from '../collector/useCaptureProgress';
import type { SeasonEncounter } from '../collector/captureProgress';
import { createModuleStore } from './createModuleStore';

/**
 * 战斗采集悬浮球（2026-11-07 剥离，2026-11-08 改为系统级）。
 *
 * 两种运行环境：
 * - **安卓壳**：把状态推给 {@link updateBattleOverlay}，由原生用系统悬浮窗
 *   （TYPE_APPLICATION_OVERLAY）画在游戏等其它应用上方；网页不再画球，
 *   只有还没授予「显示在其他应用上层」时给一个去授权的入口。
 * - **网页版 / 旧壳**：回退到应用内的 DOM 小球（下面这段渲染）。
 *
 * 球本身无字，只有两个状态：默认色（没命中 / 没设目标）、命中目标变红 + 呼吸。
 * 点击展开详情；按住拖动可挪位置（网页存 localStorage，原生存 SharedPreferences）。
 *
 * 数据：自己轻量轮询采集状态，phase=capturing 时用 live 解码刷新快照。
 * 原生模式下切到后台也继续轮询 / 解码（background: true），否则球在游戏上方不会更新。
 */

/** 悬浮球位置（视口左上角 px）；null = 用户还没拖过，用默认右下角 */
interface OrbPos { x: number; y: number }
const posStore = createModuleStore<OrbPos | null>(null, { persistKey: 'roco.battleOrbPos' });

const ORB_SIZE = 48;
const EDGE = 8;

/** 详情卡里的小标签：每个字段单独框起来，比「A · B · C」更好读 */
const chip = 'rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] leading-4 text-slate-600';
/** 达标的牌子（声音 ±96dB / 体重百分位 ≥98 或 ≤2）用琥珀色提示 */
const chipHot = 'bg-amber-100 font-semibold text-amber-700';

const clampPos = (centerX: number, centerY: number): OrbPos => {
  const width = typeof window === 'undefined' ? 360 : window.innerWidth;
  const height = typeof window === 'undefined' ? 640 : window.innerHeight;
  return {
    x: Math.min(Math.max(EDGE, centerX - ORB_SIZE / 2), Math.max(EDGE, width - ORB_SIZE - EDGE)),
    y: Math.min(Math.max(EDGE, centerY - ORB_SIZE / 2), Math.max(EDGE, height - ORB_SIZE - EDGE)),
  };
};

/** 测试用：重置位置。 */
export function resetBattleOrbPosForTest(): void {
  posStore.set(null);
}

/**
 * 详情字段（应用内球与系统浮窗共用同一份，保证两边看到的信息完全一致）。
 * 固定两排（2026-11-08）：第一排 名字 / 性别（♂♀）/ 等级（xx级）/ 性格 / 声音；
 * 第二排 身高 / 体重。
 */
export function battleOverlayFields(encounter: SeasonEncounter | null): BattleOverlayField[] {
  if (!encounter) return [];
  const fields: BattleOverlayField[] = [
    { text: encounter.rewardName || encounter.guardName, primary: true, row: 1 },
  ];
  if (encounter.gender) fields.push({ text: encounter.gender === '公' ? '♂' : '♀', row: 1 });
  fields.push({ text: `${encounter.level}级`, row: 1 });
  if (encounter.natureConfirmed && encounter.nature) fields.push({ text: encounter.nature, row: 1 });
  if (encounter.voiceDb != null) {
    fields.push({
      text: `${encounter.voiceDb}dB`,
      hot: encounter.voiceDb >= 96 || encounter.voiceDb <= -96,
      row: 1,
    });
  }
  fields.push({
    text: `${(encounter.height / 100).toFixed(2)}m${encounter.heightPct != null ? `（${encounter.heightPct}%）` : ''}`,
    row: 2,
  });
  fields.push({
    text: `${(encounter.weight / 1000).toFixed(2)}kg${encounter.weightPct != null ? `（${encounter.weightPct}%）` : ''}`,
    hot: encounter.weightPct != null && (encounter.weightPct >= 98 || encounter.weightPct <= 2),
    row: 2,
  });
  return fields;
}

export function BattleHudOrb() {
  const [state, setState] = useState<CollectorState | null>(null);
  const [checked, setChecked] = useState(() => typeof window === 'undefined' || !window.RocoCapture);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<OrbPos | null>(() => posStore.get());
  /** 系统浮窗是否可用：可用时球由安卓壳画在其它应用上方，网页不再画球 */
  const nativeOverlay = hasNativeBattleOverlay();
  const [overlayStatus, setOverlayStatus] = useState<'ok' | 'need-permission' | 'unsupported'>('ok');
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean; id: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.RocoCapture) return;
    let disposed = false;
    const read = async () => {
      try {
        const next = await readCollectorState();
        if (disposed) return;
        setState(next);
        setChecked(true);
        // 悬浮球在非附近页也负责把会话绑进采集归属（附近页挂载时同一份逻辑，幂等）
        observeCollectorState(next);
      } catch {
        // 桥短暂读不到：保持上一次状态，下一轮再试
      }
    };
    void read();
    // 采集开始 / 结束直接从原生状态读，频率高一点悬浮球才跟手；
    // 原生模式下要在游戏上方刷新，所以切到后台也继续轮询
    const timer = window.setInterval(() => { if (nativeOverlay || !document.hidden) void read(); }, 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [nativeOverlay]);

  // live 解码：phase=capturing 时持续刷新 nearbyStore（encounter 由此而来）
  // 2026-11-09：原生浮窗下统一走 2MiB 尾窗——悬浮窗要跟手，全量重解在后台跟不上心跳；
  // 「我的」页的自动导入进度由采集页 / 附近页自己的（全量）解码负责，不在这里判断。
  useCaptureProgress(state, {
    live: true,
    persist: false,
    background: nativeOverlay,
    windowBytes: nativeOverlay ? 2 * 1024 * 1024 : 0,
  });
  const snapshot = useNearbySnapshot();
  const target = useBattleTarget();
  const encounter = snapshot?.encounter ?? null;
  const hit = encounter != null && battleTargetHit(target, encounter);
  const capturing = state?.phase === 'capturing';
  const fields = useMemo(() => battleOverlayFields(encounter), [encounter]);
  const fieldsKey = JSON.stringify(fields);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  // 把状态推给系统浮窗：采集开始显示、命中变色、结束隐藏
  useEffect(() => {
    if (!nativeOverlay) return;
    let disposed = false;
    const push = !capturing
      ? updateBattleOverlay({ visible: false })
      : updateBattleOverlay({ visible: true, hit, fields: fieldsRef.current });
    void push
      .then((status) => { if (!disposed) setOverlayStatus(status); })
      // 桥超时 / 原生抛错：认定原生这条路不可用，回退到页面内的球
      .catch(() => { if (!disposed) setOverlayStatus('unsupported'); });
    return () => { disposed = true; };
  }, [nativeOverlay, capturing, hit, fieldsKey]);

  // 安卓壳：球由系统浮窗画；只有还没授权时在页面上给一个去授权的入口。
  // 桥在但原生没接住（新旧版本混装）时退回页面内的球，避免两边都看不到。
  if (nativeOverlay && overlayStatus !== 'unsupported') {
    if (!capturing || overlayStatus !== 'need-permission') return null;
    return (
      <button
        type="button"
        data-testid="battle-overlay-permission"
        onClick={() => { requestOverlayPermission().catch(() => { /* 打不开就保持提示，用户可去系统设置手动开 */ }); }}
        className="fixed bottom-24 left-3 right-3 z-[60] rounded-xl bg-slate-800 px-3 py-2 text-left text-xs text-white shadow-lg"
      >
        开启「显示在其他应用上层」后，战斗提醒会浮在游戏上方
      </button>
    );
  }

  if (!checked || !capturing) return null;

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = { startX: event.clientX, startY: event.clientY, moved: false, id: event.pointerId };
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') {
      try { element.setPointerCapture(event.pointerId); } catch { /* 部分环境不支持：忽略 */ }
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8) return;
    drag.moved = true;
    setPos(clampPos(event.clientX, event.clientY));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      // 松手位置记住：下次（哪怕下次采集）还在这里
      posStore.set(clampPos(event.clientX, event.clientY));
    } else {
      setOpen((value) => !value);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={hit ? '战斗悬浮球：已命中目标' : '战斗悬浮球'}
        data-testid="battle-hud-orb"
        data-hit={hit ? 'true' : 'false'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={`fixed z-[60] h-12 w-12 touch-none rounded-full shadow-lg outline-none transition-colors ${
          pos ? '' : 'bottom-24 right-4'
        } ${hit ? 'animate-pulse bg-rose-500' : 'bg-slate-700/85'}`}
      />
      {open ? (
        <div
          data-testid="battle-hud-detail"
          className={`fixed z-[61] w-56 rounded-2xl bg-white p-2.5 shadow-xl ${pos ? '' : 'bottom-40 right-4'}`}
          style={
            pos
              ? {
                  left: Math.max(EDGE, pos.x - 208 + ORB_SIZE),
                  top: Math.min(Math.max(EDGE, pos.y + ORB_SIZE + EDGE), window.innerHeight - 200),
                }
              : undefined
          }
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-800">战斗 · 赛季奇遇</p>
            <button
              type="button"
              aria-label="关闭悬浮球详情"
              data-testid="battle-hud-detail-close"
              onClick={() => setOpen(false)}
              className="min-h-[28px] min-w-[28px] rounded-full text-base leading-none text-slate-400"
            >
              ×
            </button>
          </div>
          {encounter ? (
            <div className="mt-1 space-y-1" data-testid="battle-hud-fields">
              {[1, 2].map((row) => {
                const rowFields = fields.filter((field) => (field.row ?? 1) === row);
                if (row === 2 && rowFields.length === 0 && !hit) return null;
                return (
                  <div key={row} className="flex flex-wrap gap-1" data-testid={`battle-hud-fields-row${row}`}>
                    {rowFields.map((field) => (
                      <span
                        key={field.text}
                        className={`${chip} ${field.primary ? 'bg-slate-800 font-semibold text-white' : ''} ${field.hot ? chipHot : ''}`}
                      >
                        {field.text}
                      </span>
                    ))}
                    {row === 1 && hit ? <span className={`${chip} bg-rose-500 text-white`}>命中目标</span> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-slate-400">进入赛季奇遇战后，这里会显示守卫的个体数据。</p>
          )}
        </div>
      ) : null}
    </>
  );
}
