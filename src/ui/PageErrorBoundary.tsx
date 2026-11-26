import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 出错时显示的页面名（如「收集页」「家园页」），用于按钮文案 */
  pageName: string;
}

interface State {
  error: Error | null;
}

/**
 * 页面级错误边界（2026-11-27）：给主要页签（看板 / 家园 / 收集 / 换蛋 / 我的）兜底。
 *
 * 页面渲染 / effect 抛异常时只替换这一页，不把整个工具箱打白；
 * 用户可点「重新载入」恢复。已有 NearbyErrorBoundary 覆盖附近页，这里不再重复。
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.pageName}渲染出错`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto max-w-md space-y-2 p-3">
        <section className="rounded-2xl bg-white p-4 shadow-sm" role="alert" data-testid="page-error-boundary">
          <h2 className="text-sm font-semibold text-slate-800">{this.props.pageName}刚刚出错了</h2>
          <p className="mt-1 text-xs text-slate-500">
            数据已保存在本机，点下面按钮重新载入这一页。
          </p>
          {this.state.error.message ? (
            <p className="mt-2 max-h-20 overflow-auto break-all rounded bg-slate-50 p-1.5 text-[10px] leading-3 text-slate-400">
              {this.state.error.message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 min-h-[36px] rounded-xl bg-slate-900 px-3 text-xs font-medium text-white"
            data-testid="page-error-retry"
          >
            重新载入{this.props.pageName}
          </button>
        </section>
      </main>
    );
  }
}
