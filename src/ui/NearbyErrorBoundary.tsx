import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 兜底卡片的布局（全屏地图用 h-full w-full，正常页用正方形） */
  className?: string;
}

interface State {
  error: Error | null;
}

/**
 * 附近页兜底（2026-11-10 真机反馈：点刷新整页白屏）。
 *
 * 页面渲染 / effect 抛异常时只替换这一页，不把整个工具箱打白；
 * 采集本身在壳里跑，出错后仍可点「重新载入附近页」继续看数据。
 */
export class NearbyErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('附近页渲染出错', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto max-w-md space-y-2 p-3">
        <section className="rounded-2xl bg-white p-4 shadow-sm" role="alert">
          <h2 className="text-sm font-semibold text-slate-800">附近页刚刚出错了</h2>
          <p className="mt-1 text-xs text-slate-500">采集不受影响，点下面按钮重新载入这一页。</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 min-h-[36px] rounded-xl bg-slate-900 px-3 text-xs font-medium text-white"
          >
            重新载入附近页
          </button>
        </section>
      </main>
    );
  }
}

/**
 * 地图局部兜底（2026-11-10 真机反馈：在附近页缩放地图会弹整页错误）。
 *
 * 只替换地图这一块，列表 / 刷新 / 全屏按钮照常可用；并把错误信息直接显示出来，
 * 方便真机上直接读出是哪一步抛的（不用连电脑看控制台）。
 */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('附近地图渲染出错', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-slate-800 p-3 text-center ${this.props.className ?? 'aspect-square w-full'}`}
      >
        <p className="text-xs font-medium text-white">地图暂时画不出来</p>
        <p className="max-h-16 overflow-auto break-all text-[10px] leading-3 text-slate-300">
          {this.state.error.message || '未知错误'}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="min-h-[32px] rounded-lg bg-white/90 px-3 text-[11px] font-medium text-slate-700"
        >
          重试地图
        </button>
      </div>
    );
  }
}
