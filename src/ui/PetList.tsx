import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetCard } from './PetCard';

export interface PetListProps {
  pets: OwnedPet[];
  speciesByGameId: Map<number, SpeciesEntry>;
  eggGroupNames: Record<number, string>;
  showCount?: boolean;
  /**
   * 卡片网格列数（2026-11-18 用户口径：三列时卡片内容整体放大、一行铺满；宽横屏可到 5/6）。
   * 收集页收起筛选后由 columnsForCollapsedRail 算出更多列，卡片宽度保持不变（2026-11-23）。
   */
  columns?: number;
}

/**
 * 三列模式的缩放倍数：
 * 四列时卡片宽度 ≈ (W - 3*gap)/4，三列时 ≈ (W - 2*gap)/3，两者之比约 1.35，
 * 用 CSS zoom 让字号、头像、奖牌、圆角一起等比放大（不用改卡片里的每一处尺寸）。
 */
const THREE_COLUMN_ZOOM = 1.35;

/**
 * 首屏先渲染这么多张卡，滚动靠近底部再续一屏。
 *
 * 口径仍是「全部展示、不分页」（2026-11-18 用户要求），但 500 只的账号一进页面
 * 就建 500 张卡会把安卓 WebView 卡住；按可视区逐步追加，滚动体验和全量渲染一致。
 *
 * P5（2026-11-27）：滚动追加不再一次性同步插入 RENDER_CHUNK 张卡，
 * 改用 requestIdleCallback 空闲分片（每批 IDLE_BATCH 张），批之间让出主线程。
 *
 * 滚动检测用 IntersectionObserver 监听底部哨兵（2026-11-27 修复横屏无法加载）：
 * 横屏时 window 不滚动（内部容器 overflow-y:auto 自己滚），window scroll 事件
 * 收不到；IntersectionObserver 以视口为 root，无论哪个祖先容器在滚动都能触发。
 */
const RENDER_CHUNK = 20;
/** 每次空闲回调最多追加的卡片数 */
const IDLE_BATCH = 20;
/** 哨兵进入视口下方这么多像素时就开始加载下一批 */
const SENTINEL_ROOT_MARGIN = '400px 0px';

export function PetList({
  pets,
  speciesByGameId,
  eggGroupNames,
  showCount = true,
  columns = 4,
}: PetListProps) {
  const zoomStyle: CSSProperties | undefined =
    columns === 3 ? { zoom: THREE_COLUMN_ZOOM } : undefined;

  const [limit, setLimit] = useState(RENDER_CHUNK);
  const idleHandleRef = useRef<number | null>(null);
  const pendingAppendRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const cancelIdle = useCallback(() => {
    if (idleHandleRef.current !== null) {
      const scope = globalThis as unknown as {
        cancelIdleCallback?: (handle: number) => void;
        clearTimeout?: (handle: number) => void;
      };
      if (typeof scope.cancelIdleCallback === 'function') {
        scope.cancelIdleCallback(idleHandleRef.current);
      } else if (typeof scope.clearTimeout === 'function') {
        scope.clearTimeout(idleHandleRef.current);
      }
      idleHandleRef.current = null;
    }
    pendingAppendRef.current = false;
  }, []);

  // 搜索 / 筛选改变结果集时从头开始渲染，取消未完成的空闲追加
  useEffect(() => {
    cancelIdle();
    setLimit(RENDER_CHUNK);
  }, [pets, cancelIdle]);

  /** 调度一次空闲追加：每批 IDLE_BATCH 张 */
  const scheduleIdleAppend = useCallback(() => {
    if (idleHandleRef.current !== null || pendingAppendRef.current) return;
    pendingAppendRef.current = true;
    const run = () => {
      idleHandleRef.current = null;
      pendingAppendRef.current = false;
      setLimit((current) => Math.min(current + IDLE_BATCH, pets.length));
    };
    const scope = globalThis as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof scope.requestIdleCallback === 'function') {
      idleHandleRef.current = scope.requestIdleCallback(run, { timeout: 300 });
    } else {
      idleHandleRef.current = window.setTimeout(run, 0);
    }
  }, [pets.length]);

  // IntersectionObserver 监听底部哨兵：进入视口附近就调度空闲追加。
  // root 用 null（视口），所以横屏内部容器滚动也能触发；不支持时退回 window scroll。
  useEffect(() => {
    if (limit >= pets.length) return;
    const sentinel = sentinelRef.current;
    if (sentinel && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) scheduleIdleAppend();
        },
        { root: null, rootMargin: SENTINEL_ROOT_MARGIN },
      );
      observer.observe(sentinel);
      return () => {
        observer.disconnect();
        cancelIdle();
      };
    }
    // 兜底：无 IntersectionObserver 时仍监听 window scroll（竖屏）
    const onScroll = () => {
      const doc = document.documentElement;
      const viewportBottom = window.scrollY + window.innerHeight;
      if (viewportBottom >= doc.scrollHeight - 400) scheduleIdleAppend();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelIdle();
    };
  }, [limit, pets.length, scheduleIdleAppend, cancelIdle]);

  // 组件卸载时清理未完成的空闲任务
  useEffect(() => {
    return () => cancelIdle();
  }, [cancelIdle]);

  const renderedPets = limit >= pets.length ? pets : pets.slice(0, limit);

  return (
    <div className="space-y-2">
      {showCount ? (
        <p className="text-xs text-slate-500" data-testid="pet-count">
          共 {pets.length} 只
        </p>
      ) : null}

      {/* 一行四张 / 三张：移动端保持紧凑卡片网格 */}
      <ul
        className={`grid gap-1.5 ${columns === 3 ? 'grid-cols-3' : columns === 4 ? 'grid-cols-4' : ''}`}
        style={columns > 4 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
        data-testid="pet-list-items"
        data-columns={columns}
      >
        {renderedPets.map((pet, index) => (
          <li key={`${pet.account}-${pet.gameId}-${index}`} style={zoomStyle}>
            <PetCard
              pet={pet}
              species={speciesByGameId.get(pet.gameId)}
              eggGroupNames={eggGroupNames}
            />
          </li>
        ))}
      </ul>
      {limit < pets.length ? (
        <>
          {/* 哨兵：进入视口附近触发加载更多；也承担原有的提示文案 */}
          <div ref={sentinelRef} aria-hidden />
          <p className="text-center text-[11px] text-slate-400" data-testid="pet-list-more">
            已显示 {renderedPets.length} / {pets.length} 只，继续下滑加载更多
          </p>
        </>
      ) : null}
    </div>
  );
}