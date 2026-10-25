import { useEffect, useRef } from 'react';
import { useCaptureProgress } from '../collector/useCaptureProgress';
import type { CollectorState } from '../collector/nativeCollector';
import { StateNotice } from './primitives/StateNotice';

export interface CaptureProgressViewProps {
  state: CollectorState;
  /** 进度条走满（内容稳定、没有新流量）时触发一次；由外层自动停止并保存 */
  onReady?: () => void;
}

export function CaptureProgressView({ state, onReady }: CaptureProgressViewProps) {
  const { progress, sourceBytes, error, checking } = useCaptureProgress(state);
  const firedFor = useRef<string | null>(null);
  // 进度条走满就是最终状态（2026-10-25 用户要求）：之后再有数据包也不复核，
  // 直接自动停止保存 → 自动导入，避免卡在「有新流量，正在复核」。
  const ready = state.phase === 'capturing' && progress?.stage === 'ready';
  const verifying = !ready && (checking || (state.savedBytes ?? 0) > sourceBytes);

  useEffect(() => {
    if (!ready || !progress || !onReady) return;
    if (firedFor.current === progress.session) return;
    firedFor.current = progress.session;
    onReady();
  }, [ready, progress, onReady]);

  if (state.phase !== 'capturing') return null;
  if (state.progressVersion !== 1) return <p className="text-xs text-slate-500">更新安卓安装包可查看实时数据进度；当前仍可停止保存后解析。</p>;
  const analysis = progress?.analysis;
  let title = '等待游戏数据';
  if (progress) {
    switch (progress.stage) {
      case 'waiting': break;
      case 'login': title = '已连接游戏，等待登录数据'; break;
      case 'multiple': title = '本次识别到多个角色，请每次只采集一个账号'; break;
      case 'collecting': title = analysis!.missingRecords > 0 ? `还差 ${analysis!.missingRecords} 只精灵详情`
        : !analysis!.hasEggInventory ? '等待蛋仓，请打开游戏中的蛋仓'
          : !analysis!.eggInventoryComplete ? '蛋仓数据尚未收齐，请等待分页加载' : '仍在收集数据，请等待页面加载'; break;
      case 'stabilizing': title = `已识别内容正在稳定，还需 ${Math.ceil(progress.remainingMs / 1000)} 秒`; break;
      case 'ready': title = verifying ? '有新流量，正在复核已识别内容' : '已识别内容稳定，正在自动停止保存'; break;
    }
  }
  return <div className="space-y-2" data-testid="capture-progress">
    <StateNotice kind={error || progress?.stage === 'multiple' ? 'unknown' : progress?.stage === 'ready' && !verifying ? 'success' : 'loading'}
      title={error ? '暂时无法核对数据进度，正在重试' : title}
      description={error || (progress?.stage === 'login' || !progress ? '请从登录前开始采集，等待游戏页面加载。' : '根据本次已识别内容判断，未打开的页面仍可能缺失。')} />
    {analysis ? <ul className="grid gap-1 text-sm text-slate-600" aria-label="采集数据检查">
      <li>角色：{analysis.hasProfile ? '已识别' : '等待登录'}</li>
      <li>精灵：已识别 {analysis.records} 只 · {analysis.boxes} 个盒子{analysis.missingRecords > 0 ? ` · 还差 ${analysis.missingRecords} 只详情` : ''}</li>
      <li>蛋仓：{analysis.hasEggInventory ? `已识别 ${analysis.eggRecords} 条${analysis.eggInventoryComplete ? '，分页已收齐' : '，等待剩余分页'}` : '尚未识别'}</li>
    </ul> : null}
    {progress?.stage === 'stabilizing' ? <progress className="h-1.5 w-full accent-emerald-600" aria-label="内容稳定等待"
      max={analysis!.stableWaitMs} value={analysis!.stableWaitMs - progress.remainingMs} /> : null}
  </div>;
}
