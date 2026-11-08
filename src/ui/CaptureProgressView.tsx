import { useEffect, useRef } from 'react';
import { useCaptureProgress } from '../collector/useCaptureProgress';
import type { CollectorState } from '../collector/nativeCollector';
import { isDesktopShell, notifyRareAlert } from '../collector/nativeCollector';
import { nearbyAlertGate } from '../collector/nearbyAlert';
import { rareAlertTitle } from '../pcap/rareRules';
import { StateNotice } from './primitives/StateNotice';
import { LiveCaptureBanner } from './LiveCaptureBanner';

export interface CaptureProgressViewProps {
  state: CollectorState;
  /** 进度条走满（内容稳定、没有新流量）时触发一次；由外层自动停止并保存 */
  onReady?: () => void;
  /** 持续获取模式：走满也不自动停止，继续刷新实时计数 */
  live?: boolean;
  /** 稀有精灵提醒开关；关闭后只展示不弹通知 */
  rareAlertOn?: boolean;
}

export function CaptureProgressView({ state, onReady, live = false, rareAlertOn = false }: CaptureProgressViewProps) {
  const { progress, sourceBytes, error, checking } = useCaptureProgress(state, { live });
  const firedFor = useRef<string | null>(null);
  // 进度条走满就是最终状态（2026-10-25 用户要求）：之后再有数据包也不复核，
  // 直接自动停止保存 → 自动导入，避免卡在「有新流量，正在复核」。
  const ready = state.phase === 'capturing' && progress?.stage === 'ready';
  const verifying = !ready && (checking || (state.savedBytes ?? 0) > sourceBytes);

  useEffect(() => {
    // 持续获取模式不自动停止；关掉开关后同一个 ready 会话会再次触发，交回原流程。
    if (!ready || !progress || !onReady || live) return;
    if (firedFor.current === progress.session) return;
    firedFor.current = progress.session;
    onReady();
  }, [ready, progress, onReady, live]);

  // 换会话 / 关提醒时清空去重表，避免上一局的精灵压住这一局。
  useEffect(() => {
    nearbyAlertGate.reset();
  }, [state.fileId, rareAlertOn]);

  useEffect(() => {
    if (!rareAlertOn || state.phase !== 'capturing') return;
    const nearby = progress?.analysis?.nearby;
    if (!nearby?.length) return;
    const fresh = nearbyAlertGate.scan(nearby, (pet) => pet.key, (pet) => Boolean(pet.alertReason));
    const hits = fresh.filter((pet) => pet.alertReason);
    if (!hits.length) return;
    const lines = hits.slice(0, 3).map((pet) => `${pet.name} Lv${pet.level} · ${pet.alertReason}`);
    if (hits.length > 3) lines.push(`…另有 ${hits.length - 3} 只`);
    void notifyRareAlert(rareAlertTitle(hits.length), lines.join('\n')).catch(() => {});
  }, [progress?.analysis, rareAlertOn, state.phase]);

  if (state.phase !== 'capturing') return null;
  if (state.progressVersion !== 1) return <p className="text-xs text-slate-500">更新安卓安装包可查看实时数据进度；当前仍可停止保存后解析。</p>;
  const analysis = progress?.analysis;
  let title = '等待游戏数据';
  if (progress) {
    switch (progress.stage) {
      case 'waiting': break;
      case 'login': title = '还没拿到登录密钥'; break;
      case 'multiple': title = '本次识别到多个角色，请每次只采集一个账号'; break;
      case 'collecting': title = analysis!.missingRecords > 0 ? `还差 ${analysis!.missingRecords} 只精灵详情`
        : !analysis!.hasEggInventory ? '等待蛋仓，请打开游戏中的蛋仓'
          : !analysis!.eggInventoryComplete ? '蛋仓数据尚未收齐，请等待分页加载' : '仍在收集数据，请等待页面加载'; break;
      case 'stabilizing': title = `已识别内容正在稳定，还需 ${Math.ceil(progress.remainingMs / 1000)} 秒`; break;
      case 'ready': title = live ? '数据已收齐 · 持续获取中，可随时停止导入'
        : isDesktopShell() ? '数据已收齐 · 需要入库时点「停止并保存」'
          : verifying ? '有新流量，正在复核已识别内容' : '已识别内容稳定，正在自动停止保存'; break;
    }
  }
  return <div className="space-y-2" data-testid="capture-progress">
    {live ? <LiveCaptureBanner analysis={analysis ?? null} sourceBytes={sourceBytes} /> : null}
    <StateNotice kind={error || progress?.stage === 'multiple' ? 'unknown' : progress?.stage === 'ready' && !verifying ? 'success' : 'loading'}
      title={error ? '暂时无法核对数据进度，正在重试' : title}
      description={error || (progress?.stage === 'login' || !progress ? '采集要在登录前开始：请退出到登录界面，重新登录一次（不同机型加载时间不同，这里不设超时）。' : '根据本次已识别内容判断，未打开的页面仍可能缺失。')} />
    {analysis ? <ul className="grid gap-1 text-sm text-slate-600" aria-label="采集数据检查">
      <li>角色：{analysis.hasProfile ? '已识别' : '等待登录'}</li>
      <li>精灵：已识别 {analysis.records} 只 · {analysis.boxes} 个盒子{analysis.missingRecords > 0 ? ` · 还差 ${analysis.missingRecords} 只详情` : ''}</li>
      <li>蛋仓：{analysis.hasEggInventory ? `已识别 ${analysis.eggRecords} 条${analysis.eggInventoryComplete ? '，分页已收齐' : '，等待剩余分页'}` : '尚未识别'}</li>
    </ul> : null}
    {progress?.stage === 'stabilizing' ? <progress className="h-1.5 w-full accent-emerald-600" aria-label="内容稳定等待"
      max={analysis!.stableWaitMs} value={analysis!.stableWaitMs - progress.remainingMs} /> : null}
  </div>;
}
