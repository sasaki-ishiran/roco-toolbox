import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveNearbyPet } from '../collector/captureProgress';
import { metersPerPixel, projectToPixel, worldMapForScene, worldMapImageUrl } from '../pcap/worldMap';

/** 牌子 → 标记颜色；与列表/雷达同一套语义 */
const KIND_COLOR: Record<string, string> = {
  pollution: '#7c3aed',
  shiny: '#f59e0b',
  colorful: '#ec4899',
  big: '#0ea5e9',
  small: '#0ea5e9',
  high: '#059669',
  low: '#059669',
};
const KIND_PRIORITY = ['pollution', 'shiny', 'colorful', 'big', 'small', 'high', 'low'];
const KIND_LABEL: Record<string, string> = {
  colorful: '炫彩', shiny: '异色', pollution: '污染',
  big: '大块头', small: '小不点', high: '婉转声', low: '粗嗓门',
};

const colorOf = (kinds: readonly string[]): string => {
  for (const kind of KIND_PRIORITY) if (kinds.includes(kind)) return KIND_COLOR[kind];
  return '#475569';
};
const kindText = (kinds: readonly string[]) => kinds.map((kind) => KIND_LABEL[kind] || kind).join('·');

/** 默认视野半径 150m（= 横向 300m），刚好把 120m 圈完整包住 */
const DEFAULT_VIEW_METERS = 300;
/** 唯一的距离参考圈（半径 120m） */
const VIEW_RING_METERS = 120;
const ZOOM_KEY = 'roco.nearbyMapZoom';
const MIN_SCALE = 0.04;
const MAX_SCALE = 6;

/** 读取上次的缩放倍率；没有 / 非法时回默认 1（= 150m 视野）。导出仅供测试。 */
export function readSavedZoom(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const value = Number(window.localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(value) && value >= 0.25 && value <= 8) return value;
  } catch {
    /* 忽略 */
  }
  return 1;
}

export interface NearbyMapProps {
  pets: readonly LiveNearbyPet[];
  /** 自身世界坐标（307）；没有时退回第一只精灵/地图中心 */
  origin: { x: number; y: number } | null;
  scene: number | null;
  className?: string;
}

interface ViewState {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * 大世界地图（2026-11-08）。
 *
 * 和雷达的区别：雷达是「以估算中心为圆心的相对方位」，地图是真实世界坐标直接落点，
 * 可以缩放/拖动，能直接看到精灵在卡洛西亚大陆的位置，不会再出现「知道在旁边但找不到」。
 * 标定与坐标换算见 `src/pcap/worldMap.ts`（100 世界单位 = 1 米）。
 */
export function NearbyMap({ pets, origin, scene, className }: NearbyMapProps) {
  const map = worldMapForScene(scene);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<ViewState>({ scale: 0.6, tx: 0, ty: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const interacted = useRef(false);
  /** 用户缩放倍率（1 = 默认 150m）；存在 localStorage，下次打开沿用 */
  const zoom = useRef(readSavedZoom());

  const baseScale = useCallback((width: number) => {
    if (!map || width === 0) return 1;
    return width / (DEFAULT_VIEW_METERS / metersPerPixel(map));
  }, [map]);

  const saveZoom = useCallback((scale: number, width: number) => {
    const base = baseScale(width);
    if (!base) return;
    zoom.current = scale / base;
    try {
      window.localStorage.setItem(ZOOM_KEY, String(zoom.current));
    } catch {
      /* 忽略 */
    }
  }, [baseScale]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** 自身位置：有 307 用它，没有就取精灵里离地图中心最近的一只（保持画面在有人区域） */
  const self = useMemo(() => {
    if (origin) return origin;
    if (pets.length === 0) return null;
    return pets.reduce((best, pet) => {
      if (!pet.pos) return best;
      if (!best) return { x: pet.pos.x, y: pet.pos.y };
      return best;
    }, null as { x: number; y: number } | null);
  }, [origin, pets]);

  const centerOnSelf = useCallback(() => {
    if (!map || size.width === 0) return;
    const point = self ?? { x: map.originX + map.sideUnits / 2, y: map.originY + map.sideUnits / 2 };
    const { px, py } = projectToPixel(map, point);
    const scale = baseScale(size.width) * zoom.current;
    setView({
      scale,
      tx: size.width / 2 - px * scale,
      ty: size.height / 2 - py * scale,
    });
  }, [map, self, size.width, size.height, baseScale]);

  // 首屏 / 换场景 / 面板尺寸变化时自动对到自身；用户手动拖动过就不再抢镜头
  useEffect(() => {
    if (size.width === 0 || interacted.current) return;
    centerOnSelf();
  }, [centerOnSelf, size.width]);

  const zoomAt = useCallback((factor: number, focusX: number, focusY: number) => {
    interacted.current = true;
    setView((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      const ratio = scale / current.scale;
      saveZoom(scale, size.width);
      return {
        scale,
        tx: focusX - (focusX - current.tx) * ratio,
        ty: focusY - (focusY - current.ty) * ratio,
      };
    });
  }, [saveZoom, size.width]);

  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-map-pet]')) return;
    pinch.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
      drag.current = null;
      return;
    }
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pinch.current.has(event.pointerId)) pinch.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchStart.current && pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > 0) {
        interacted.current = true;
        setView((current) => {
          const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStart.current!.scale * (distance / pinchStart.current!.distance)));
          const ratio = scale / current.scale;
          saveZoom(scale, size.width);
          return { scale, tx: size.width / 2 - (size.width / 2 - current.tx) * ratio, ty: size.height / 2 - (size.height / 2 - current.ty) * ratio };
        });
      }
      return;
    }
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    interacted.current = true;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    drag.current = { ...current, x: event.clientX, y: event.clientY };
    setView((value) => ({ ...value, tx: value.tx + dx, ty: value.ty + dy }));
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pinch.current.delete(event.pointerId);
    if (pinch.current.size < 2) pinchStart.current = null;
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  if (!map) return null;

  const { scale, tx, ty } = view;
  const selectedPet = selected ? pets.find((pet) => pet.key === selected) ?? null : null;
  const toScreen = (point: { x: number; y: number }) => {
    const { px, py } = projectToPixel(map, point);
    return { x: tx + px * scale, y: ty + py * scale, px, py };
  };
  const selfScreen = self ? toScreen(self) : null;

  return (
    <div
      ref={containerRef}
      className={`relative touch-none overflow-hidden rounded-xl bg-slate-800 ${className ?? 'aspect-square w-full'}`}
      data-testid="nearby-map-view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, event.clientX - rect.left, event.clientY - rect.top);
      }}
    >
      <img
        src={worldMapImageUrl(map)}
        alt={`${map.name}地图`}
        draggable={false}
        className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
        style={{
          width: map.width * scale,
          height: map.height * scale,
          transform: `translate(${tx}px, ${ty}px)`,
          imageRendering: scale > 1.5 ? 'pixelated' : 'auto',
        }}
      />

      {/* 视野圈（以自身为圆心，帮助判断远近） */}
      {selfScreen ? [VIEW_RING_METERS].map((meters) => (
        <div
          key={meters}
          className="pointer-events-none absolute rounded-full border border-white/70"
          style={{
            left: selfScreen.x - (meters / metersPerPixel(map)) * scale,
            top: selfScreen.y - (meters / metersPerPixel(map)) * scale,
            width: (meters / metersPerPixel(map)) * scale * 2,
            height: (meters / metersPerPixel(map)) * scale * 2,
            boxShadow: '0 0 0 1px rgba(15,23,42,0.35)',
          }}
        >
          <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full rounded bg-slate-900/70 px-1 text-[9px] leading-3 text-white">
            {meters}m
          </span>
        </div>
      )) : null}

      {pets.map((pet) => {
        if (!pet.pos) return null;
        const screen = toScreen(pet.pos);
        if (screen.x < -40 || screen.y < -40 || screen.x > size.width + 40 || screen.y > size.height + 40) return null;
        const distance = self
          ? Math.hypot(pet.pos.x - self.x, pet.pos.y - self.y) / 100
          : pet.distanceM ?? null;
        return (
          <button
            key={pet.key}
            type="button"
            data-map-pet={pet.key}
            onClick={(event) => {
              event.stopPropagation();
              setSelected(pet.key === selected ? null : pet.key);
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: screen.x, top: screen.y }}
            title={`${pet.name} Lv${pet.level}${distance != null ? ` · ${distance.toFixed(0)}m` : ''}`}
          >
            {pet.alertReason ? (
              <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-rose-500" />
            ) : null}
            <span
              className={`block rounded-full border-2 border-white shadow ${pet.rare ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'} ${pet.key === selected ? 'ring-2 ring-emerald-400' : ''}`}
              style={{ background: colorOf(pet.kinds) }}
            />
            {pet.rare ? (
              <span className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/80 px-1 text-[9px] leading-3 text-white">
                {pet.name}
              </span>
            ) : null}
          </button>
        );
      })}

      {selfScreen && selfScreen.x > -20 && selfScreen.y > -20 && selfScreen.x < size.width + 20 && selfScreen.y < size.height + 20 ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: selfScreen.x, top: selfScreen.y }}
        >
          <span className="block h-4 w-4 rounded-full border-2 border-white bg-sky-500 shadow-lg" />
          <span className="block text-center text-[9px] font-medium text-white drop-shadow">我</span>
        </div>
      ) : null}

      {/* 缩放 / 回到自身 */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button type="button" aria-label="放大" onClick={() => zoomAt(1.35, size.width / 2, size.height / 2)}
          className="h-7 w-7 rounded-lg bg-white/90 text-sm font-semibold text-slate-700 shadow">+</button>
        <button type="button" aria-label="缩小" onClick={() => zoomAt(1 / 1.35, size.width / 2, size.height / 2)}
          className="h-7 w-7 rounded-lg bg-white/90 text-sm font-semibold text-slate-700 shadow">−</button>
        <button type="button" aria-label="回到自身" title="回到自身" onClick={() => { interacted.current = false; centerOnSelf(); }}
          className="h-7 w-7 rounded-lg bg-white/90 text-[10px] font-medium text-slate-700 shadow">我</button>
      </div>

      {/* 图例 */}
      <div className="pointer-events-none absolute bottom-1.5 left-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-white/90">
        <span className="flex items-center gap-0.5"><i className="inline-block h-2 w-2 rounded-full bg-sky-500" />我</span>
        <span className="flex items-center gap-0.5"><i className="inline-block h-2 w-2 rounded-full bg-slate-400" />普通</span>
        <span className="flex items-center gap-0.5"><i className="inline-block h-2 w-2 rounded-full bg-amber-500" />异色/炫彩</span>
        <span className="flex items-center gap-0.5"><i className="inline-block h-2 w-2 rounded-full bg-rose-500" />需求命中</span>
      </div>

      {selectedPet ? (
        <div className="absolute bottom-6 left-2 right-2 rounded-lg bg-slate-900/90 px-2 py-1.5 text-white shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">
                {selectedPet.name} · Lv{selectedPet.level}
                {selectedPet.gender ? ` · ${selectedPet.gender}` : ''}
              </p>
              <p className="text-[10px] text-slate-300">
                {[
                  selectedPet.nature ? `性格 ${selectedPet.nature}` : '',
                  kindText(selectedPet.kinds),
                  selectedPet.distanceM != null ? `${selectedPet.distanceM.toFixed(0)}m` : '',
                ].filter(Boolean).join(' · ') || '普通精灵'}
              </p>
            </div>
            <button type="button" className="shrink-0 text-[10px] text-slate-300" onClick={() => setSelected(null)}>关闭</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
