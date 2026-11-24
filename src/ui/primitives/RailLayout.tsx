import { useCallback, useState, type ReactNode } from 'react';
import './rail.css';

/**
 * 横屏三栏骨架（2026-11-22 从家园蛋仓抽出来，见 docs/设计系统/横屏布局规范）。
 *
 * 主区在左；功能列（搜索 + 条件）在右、可整列收起；纵向标题栏永远在最右。
 * 竖屏不套这一层（调用方按 useLandscape 分支），保持原来的上下顺序。
 */
export interface RailTestIds {
  scope?: string;
  main?: string;
  filters?: string;
  aside?: string;
  title?: string;
  back?: string;
  toggle?: string;
}

export interface RailLayoutProps {
  collapsed: boolean;
  /** 收起 / 展开由调用方持有（见 useRailCollapsed），这里只负责排版 */
  children: ReactNode;
  /** 功能列内容；不传 = 这页没有功能列，只留主区 + 标题栏 */
  filters?: ReactNode;
  /** 纵向标题栏（用 RailAside 组） */
  aside: ReactNode;
  className?: string;
  testIds?: RailTestIds;
}

export function RailLayout({
  collapsed,
  children,
  filters,
  aside,
  className = '',
  testIds,
}: RailLayoutProps) {
  const hasFilters = filters != null;
  return (
    <div
      className={`rail-layout ${className}`.trim()}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-has-filters={hasFilters ? 'true' : 'false'}
      data-testid={testIds?.scope}
    >
      <div className="rail-main" data-testid={testIds?.main}>
        {children}
      </div>
      {hasFilters && !collapsed ? (
        <div className="rail-filters" data-testid={testIds?.filters}>
          {filters}
        </div>
      ) : null}
      {aside}
    </div>
  );
}

export interface RailAsideProps {
  /** 页面标题（只用于标题栏的 aria-label；是否画出来见 hideTitle） */
  title: string;
  /**
   * 不画页面标题（2026-11-22 用户口径：「我的」「换蛋」的页名由左侧页签表达，
   * 右侧栏不再重复）。标题仍留给 aria-label。
   */
  hideTitle?: boolean;
  /** 折叠开关；不传 = 这页没有可收起的列 */
  collapse?: { collapsed: boolean; toggle: () => void };
  /** 返回动作，排在最上面（返回家园 / 返回换蛋） */
  back?: { label: string; onClick: () => void };
  /** 标题下方追加的内容（分区导航等） */
  children?: ReactNode;
  /** 新手引导锚点（data-tour）：横屏把顶栏收进标题栏的页，锚点跟着搬过来 */
  tour?: string;
  testIds?: RailTestIds;
}

export function RailAside({ title, hideTitle = false, collapse, back, children, tour, testIds }: RailAsideProps) {
  return (
    <aside className="rail-aside" data-testid={testIds?.aside} data-tour={tour} aria-label={`${title}标题栏`}>
      {back ? (
        <button
          type="button"
          onClick={back.onClick}
          title={back.label}
          className="rail-back"
          data-testid={testIds?.back}
        >
          {back.label}
        </button>
      ) : null}
      {hideTitle ? null : (
        <h2 className="rail-title" data-testid={testIds?.title}>
          {title}
        </h2>
      )}
      {children}
      {collapse ? (
        <button
          type="button"
          onClick={collapse.toggle}
          aria-expanded={!collapse.collapsed}
          aria-label={collapse.collapsed ? '展开筛选' : '收起筛选'}
          title={collapse.collapsed ? '展开筛选' : '收起筛选'}
          className="rail-toggle"
          data-testid={testIds?.toggle}
        >
          {collapse.collapsed ? '展开筛选' : '收起筛选'}
        </button>
      ) : null}
    </aside>
  );
}

/** 标题栏里的分区 / 子视图导航：按钮一行两个字，状态用 aria-pressed 表达。 */
export function RailNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rail-nav" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function RailNavItem({
  active,
  onClick,
  children,
  testId,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  /** 完整名称（按钮上只写两字），悬停与读屏用完整叫法 */
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      title={title}
      className="rail-nav-item"
    >
      {children}
    </button>
  );
}

export function readRailCollapsed(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function saveRailCollapsed(key: string, collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, collapsed ? '1' : '0');
  } catch {
    /* 隐私模式 / 配额满：本次照样生效 */
  }
}

/**
 * 折叠偏好按设备存（`localStorage`），不跟账号、不进云同步。
 * 键由页面给：`roco.eggStockRailCollapsed` / `roco.swapRailCollapsed`。
 */
export function useRailCollapsed(key: string): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(() => readRailCollapsed(key));
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      saveRailCollapsed(key, !current);
      return !current;
    });
  }, [key]);
  return { collapsed, toggle };
}
